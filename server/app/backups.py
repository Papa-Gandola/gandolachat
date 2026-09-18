"""Ночные бэкапы базы.

Вся переписка «вечная» и живёт на одном VPS — без дампов один сбой диска
уносит всё. Раз в сутки (04:00 МСК) `pg_dump -Fc` (сжатый custom-формат)
в /app/backups (ОТДЕЛЬНЫЙ docker-том: uploads раздаётся публично, дампу
там не место), храним последние 14 копий. На базе ~50 человек дамп — это
секунды и десятки мегабайт, нагрузки сервер не почувствует.

Достать бэкап с VPS:
    docker compose cp server:/app/backups/<файл> ./
Восстановить (ОСТОРОЖНО, затирает базу):
    docker compose cp <файл> server:/tmp/restore.dump
    docker compose exec server pg_restore --clean --if-exists \
        -h db -U gandola -d gandolachat /tmp/restore.dump
"""
from __future__ import annotations

import asyncio
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, unquote

from app.config import settings

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/backups"))
KEEP = 14


def _pg_params() -> dict:
    # postgresql+asyncpg://user:pass@host:port/dbname → параметры pg_dump
    u = urlparse(settings.DATABASE_URL.replace("+asyncpg", ""))
    return {
        "host": u.hostname or "localhost",
        "port": str(u.port or 5432),
        "user": unquote(u.username or "postgres"),
        "password": unquote(u.password or ""),
        "db": (u.path or "/postgres").lstrip("/"),
    }


def _run_backup_sync() -> None:
    p = _pg_params()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    final = BACKUP_DIR / f"gandola-{stamp}.dump"
    tmp = final.with_suffix(".part")
    env = {**os.environ, "PGPASSWORD": p["password"]}
    try:
        subprocess.run(
            [
                "pg_dump",
                "-h", p["host"], "-p", p["port"], "-U", p["user"], "-d", p["db"],
                "-Fc",  # custom-формат: сжат и восстанавливается pg_restore
                "-f", str(tmp),
            ],
            env=env, check=True, capture_output=True, timeout=600,
        )
    except subprocess.CalledProcessError as e:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"pg_dump: {e.stderr.decode(errors='replace')[:300]}") from e
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, final)
    size = final.stat().st_size
    # Ротация: свежие KEEP штук остаются, остальное подчищаем.
    dumps = sorted(BACKUP_DIR.glob("gandola-*.dump"))
    for old in dumps[:-KEEP]:
        try:
            old.unlink()
        except OSError:
            pass
    print(f"[backup] ok: {final.name} ({size // 1024} KiB), хранится {min(len(dumps), KEEP)} шт.")

    # Офсайт-копия: локальные дампы умирают вместе с VPS (блокировка/
    # изъятие) — выгружаем на WebDAV, если настроен. Хозяин не хочет
    # российские сервисы: рекомендованный приёмник — Koofr (ЕС, 10 ГБ
    # бесплатно, https://app.koofr.net/dav/Koofr + app-пароль); подойдёт
    # любой WebDAV (pCloud, Nextcloud...). Ошибка выгрузки не
    # роняет бэкап: локальный дамп уже на месте.
    try:
        _offsite_sync(final)
    except Exception as e:
        print(f"[backup] offsite failed: {type(e).__name__}: {e}")


def _webdav_client() -> "httpx.Client":
    import httpx
    return httpx.Client(
        auth=(settings.BACKUP_WEBDAV_USER or "", settings.BACKUP_WEBDAV_PASSWORD or ""),
        timeout=httpx.Timeout(connect=10.0, read=120.0, write=300.0, pool=10.0),
        # Грабля №3: IPv6 на VPS сломан — прибиваемся к IPv4
        transport=httpx.HTTPTransport(local_address="0.0.0.0", retries=2),
    )


def _offsite_sync(dump: Path) -> None:
    """PUT свежего дампа на WebDAV + удалённая ротация (KEEP новейших).

    Приёмник — любой WebDAV. Рекомендуется НЕроссийский (решение
    хозяина): Koofr (app.koofr.net/dav/Koofr + app-пароль, 10 ГБ
    бесплатно), pCloud, Nextcloud; Яндекс.Диск тоже работал бы.
    Имена дампов содержат таймстамп — сортировка по имени = по времени."""
    url = (settings.BACKUP_WEBDAV_URL or "").rstrip("/")
    if not url:
        return
    import httpx  # noqa: F401 — импорт тут: без настройки офсайта не нужен
    with _webdav_client() as client:
        # Каталог мог не существовать — MKCOL идемпотентен (405 = уже есть)
        try:
            client.request("MKCOL", url)
        except Exception:
            pass
        r = client.put(f"{url}/{dump.name}", content=dump.read_bytes())
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"PUT {r.status_code}: {r.text[:200]}")
        print(f"[backup] offsite ok: {dump.name}")

        # Удалённая ротация: PROPFIND списка → сносим всё старше KEEP штук
        try:
            r = client.request("PROPFIND", url, headers={"Depth": "1"})
            if r.status_code not in (207, 200):
                return
            import xml.etree.ElementTree as ET
            from urllib.parse import unquote as _unq
            names = []
            for el in ET.fromstring(r.content).iter():
                if el.tag.endswith("}href") or el.tag == "href":
                    name = _unq((el.text or "").rstrip("/").rsplit("/", 1)[-1])
                    if name.startswith("gandola-") and name.endswith(".dump"):
                        names.append(name)
            for old in sorted(set(names))[:-KEEP]:
                client.request("DELETE", f"{url}/{old}")
                print(f"[backup] offsite прибрал: {old}")
        except Exception as e:
            # Ротация — best-effort: главное, что свежий дамп уехал
            print(f"[backup] offsite rotate failed: {type(e).__name__}: {e}")


def log_health() -> None:
    """Строка о состоянии бэкапов в лог при старте сервера.

    Джоба ходит раз в сутки в 4 утра, и её падение (сломанный pg_dump
    после смены дистрибутива в базовом образе — уже ловили) видно только
    в логах той ночи. Печатаем возраст свежего дампа сразу при старте:
    хозяин смотрит `docker compose logs` как раз после деплоя.
    """
    try:
        dumps = sorted(BACKUP_DIR.glob("gandola-*.dump"))
        if not dumps:
            print("[backup] ВНИМАНИЕ: дампов нет ни одного — бэкап ни разу не отработал")
            return
        newest = dumps[-1]
        age_h = (datetime.now(timezone.utc).timestamp() - newest.stat().st_mtime) / 3600
        mark = "" if age_h < 48 else "  ← СТАРЫЙ, бэкап не отрабатывает!"
        print(
            f"[backup] свежий дамп: {newest.name} "
            f"({newest.stat().st_size // 1024} KiB, {age_h:.0f} ч назад), "
            f"всего {len(dumps)} шт.{mark}"
        )
    except Exception as e:
        print(f"[backup] health check failed: {type(e).__name__}: {e}")


async def run_backup() -> None:
    """Джоба: pg_dump в тредпуле (не блокируем event loop), ошибки — в лог."""
    try:
        await asyncio.to_thread(_run_backup_sync)
    except Exception as e:
        print(f"[backup] FAILED: {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Вложения (uploads) — офсайт инкрементально
# ---------------------------------------------------------------------------
# Дампы — только БД; фото/голосовые/видео жили в одном экземпляре на VPS.
# Раз в сутки (после дампа) докладываем на тот же WebDAV всё, чего там ещё
# нет или что отличается размером: uploads/<каталог>/<файл> →
# <BACKUP_WEBDAV_URL>/uploads/<каталог>/<файл>. Удалённое НЕ удаляем
# (это архив); apk (зеркало GitHub) и compendium (из репо) не копируем.
# Файл читаем целиком (≤50 МБ): chunked PUT не все WebDAV принимают.
# Восстановить: скачать /uploads/* с WebDAV обратно в том uploads.
UPLOADS_SKIP_DIRS = {"apk", "compendium"}
UPLOADS_SYNC_STATE = BACKUP_DIR / "uploads-sync.json"


def _mkcol(client, url: str) -> None:
    try:
        client.request("MKCOL", url)  # 405 = уже есть, это нормально
    except Exception:
        pass


def _propfind_sizes(client, url: str) -> dict[str, int]:
    """Имя → размер файлов каталога (Depth 1). Пусто при ошибке — тогда
    просто перезальём всё (PUT идемпотентен)."""
    import xml.etree.ElementTree as ET
    from urllib.parse import unquote
    sizes: dict[str, int] = {}
    try:
        r = client.request("PROPFIND", url, headers={"Depth": "1"})
        if r.status_code not in (207, 200):
            return sizes
        for resp in ET.fromstring(r.content).iter():
            if not (resp.tag.endswith("}response") or resp.tag == "response"):
                continue
            href = None
            size = None
            for el in resp.iter():
                if el.tag.endswith("}href") or el.tag == "href":
                    href = unquote((el.text or "").rstrip("/").rsplit("/", 1)[-1])
                elif el.tag.endswith("}getcontentlength"):
                    try:
                        size = int(el.text or "")
                    except ValueError:
                        size = None
            if href and size is not None:
                sizes[href] = size
    except Exception as e:
        print(f"[backup] uploads PROPFIND failed: {type(e).__name__}: {e}")
    return sizes


def _uploads_sync_impl() -> dict:
    import json
    from urllib.parse import quote
    url = (settings.BACKUP_WEBDAV_URL or "").rstrip("/")
    root = Path(settings.UPLOAD_DIR)
    stats: dict = {"uploaded": 0, "skipped": 0, "bytes": 0, "failed": 0}
    if not url or not root.is_dir():
        return stats
    base = f"{url}/uploads"
    with _webdav_client() as client:
        _mkcol(client, base)
        subdirs = sorted(p for p in root.iterdir() if p.is_dir() and p.name not in UPLOADS_SKIP_DIRS)
        for sub in subdirs:
            remote_dir = f"{base}/{quote(sub.name)}"
            _mkcol(client, remote_dir)
            existing = _propfind_sizes(client, remote_dir)
            for f in sorted(p for p in sub.rglob("*") if p.is_file()):
                rel = f.relative_to(sub).as_posix()
                size = f.stat().st_size
                # Сверка по размеру — только для плоского уровня (все наши
                # каталоги плоские); вложенное перезальётся, но его нет.
                if "/" not in rel and existing.get(rel) == size:
                    stats["skipped"] += 1
                    continue
                parts = rel.split("/")
                for i in range(1, len(parts)):
                    _mkcol(client, f"{remote_dir}/{'/'.join(quote(p) for p in parts[:i])}")
                try:
                    r = client.put(f"{remote_dir}/{'/'.join(quote(p) for p in parts)}", content=f.read_bytes())
                    if r.status_code not in (200, 201, 204):
                        raise RuntimeError(f"PUT {r.status_code}: {r.text[:120]}")
                    stats["uploaded"] += 1
                    stats["bytes"] += size
                except Exception as e:
                    stats["failed"] += 1
                    print(f"[backup] uploads PUT failed {sub.name}/{rel}: {type(e).__name__}: {e}")
                    if stats["failed"] >= 5:
                        raise RuntimeError("слишком много ошибок — прекращаю синк вложений")
    stats["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        UPLOADS_SYNC_STATE.write_text(json.dumps(stats))
    except Exception:
        pass
    print(
        f"[backup] uploads offsite: +{stats['uploaded']} файлов ({stats['bytes'] / 1e6:.1f} MB), "
        f"уже были {stats['skipped']}, ошибок {stats['failed']}"
    )
    return stats


async def run_uploads_backup() -> None:
    """Джоба: инкрементальная выгрузка uploads на WebDAV (в тредпуле).
    Без BACKUP_WEBDAV_URL — тихий no-op."""
    if not (settings.BACKUP_WEBDAV_URL or "").strip():
        return
    try:
        await asyncio.to_thread(_uploads_sync_impl)
    except Exception as e:
        print(f"[backup] uploads offsite FAILED: {type(e).__name__}: {e}")


def log_uploads_health() -> None:
    """Строка о последнем синке вложений — рядом с log_health при старте."""
    if not (settings.BACKUP_WEBDAV_URL or "").strip():
        return
    try:
        import json
        if not UPLOADS_SYNC_STATE.is_file():
            print("[backup] вложения на офсайт ещё ни разу не синкались (джоба в 04:20 МСК)")
            return
        st = json.loads(UPLOADS_SYNC_STATE.read_text())
        at = datetime.fromisoformat(st.get("at"))
        age_h = (datetime.now(timezone.utc) - at).total_seconds() / 3600
        mark = "" if age_h < 48 else "  ← СТАРЫЙ, синк вложений не отрабатывает!"
        print(
            f"[backup] вложения на офсайте: последний синк {age_h:.0f} ч назад "
            f"(+{st.get('uploaded', 0)}, ошибок {st.get('failed', 0)}){mark}"
        )
    except Exception as e:
        print(f"[backup] uploads health check failed: {type(e).__name__}: {e}")
