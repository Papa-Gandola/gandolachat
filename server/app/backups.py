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
    # изъятие) — выгружаем на WebDAV, если настроен. Ошибка выгрузки не
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

    Рассчитано на Яндекс.Диск (https://webdav.yandex.ru + «пароль
    приложения»), но подойдёт любой WebDAV: Nextcloud, Koofr и т.п.
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


async def run_backup() -> None:
    """Джоба: pg_dump в тредпуле (не блокируем event loop), ошибки — в лог."""
    try:
        await asyncio.to_thread(_run_backup_sync)
    except Exception as e:
        print(f"[backup] FAILED: {type(e).__name__}: {e}")
