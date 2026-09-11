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


async def run_backup() -> None:
    """Джоба: pg_dump в тредпуле (не блокируем event loop), ошибки — в лог."""
    try:
        await asyncio.to_thread(_run_backup_sync)
    except Exception as e:
        print(f"[backup] FAILED: {type(e).__name__}: {e}")
