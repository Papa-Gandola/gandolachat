"""Здоровье диска под uploads — строка в лог при старте.

Видео — до 50 МБ на файл, а VPS маленький и uploads никто не чистит
(сообщения вечные). Узнать, что место кончается, лучше из лога при деплое
(`docker compose logs server | grep disk`), чем из «не отправляется» от
людей. Обход дерева при старте — сотни/тысячи файлов, миллисекунды.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from app.config import settings

GB = 1024 ** 3
# Ниже этого — пометка «МЕСТО КОНЧАЕТСЯ» в логе (дампы БД тоже сюда же
# ложатся, им нужен запас).
FREE_WARN_BYTES = 2 * GB


def dir_size(path: Path) -> int:
    total = 0
    if not path.is_dir():
        return 0
    for f in path.rglob("*"):
        try:
            if f.is_file():
                total += f.stat().st_size
        except OSError:
            continue
    return total


def log_health() -> None:
    try:
        root = Path(settings.UPLOAD_DIR)
        root.mkdir(parents=True, exist_ok=True)
        used = dir_size(root)
        files = dir_size(root / "files")
        du = shutil.disk_usage(root)
        warn = " ← МЕСТО КОНЧАЕТСЯ" if du.free < FREE_WARN_BYTES else ""
        print(
            f"[disk] uploads {used / GB:.2f} GB (вложения {files / GB:.2f} GB), "
            f"свободно {du.free / GB:.1f} из {du.total / GB:.1f} GB{warn}"
        )
    except Exception as e:  # диагностика не должна ронять старт
        print(f"[disk] health check failed: {type(e).__name__}: {e}")
