"""Раздача /uploads с поддержкой HTTP Range.

StaticFiles в нашем starlette 0.37 на Range отвечает обычным 200 целиком.
Chromium тогда считает источник нестримящимся и не даёт перематывать
<audio>: клик по дорожке голосового на десктопе сводился в ноль, а чтобы
достать длительность (moov у m4a с телефона лежит в конце), браузер
вынужден был качать файл целиком. nginx на VPS Range сам не подкладывает
(proxy_force_ranges выключен по умолчанию), поэтому лечим у себя — это
не зависит от конфига, которого нет в репо (грабля №9).

Одиночный диапазон → 206 + Content-Range; несколько диапазонов или мусор
в заголовке → как без Range, целиком. Accept-Ranges отдаём всегда. HEAD —
явно (FastAPI сам его к GET не добавляет).
"""
from __future__ import annotations

import mimetypes
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import FileResponse, Response, StreamingResponse

from app.config import settings

# Голосовые с телефона — m4a; на части систем mimetypes про него не знает.
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/ogg", ".opus")

router = APIRouter()
ROOT = Path(settings.UPLOAD_DIR).resolve()
CHUNK = 1 << 16
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


def _safe_path(rel: str) -> Path:
    """Файл строго внутри UPLOAD_DIR — ../ и симлинки наружу не проходят."""
    path = (ROOT / rel).resolve()
    if path != ROOT and ROOT not in path.parents:
        raise HTTPException(404)
    if not path.is_file():
        raise HTTPException(404)
    return path


def _iter_range(path: Path, start: int, end: int):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = f.read(min(CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.api_route("/uploads/{rel:path}", methods=["GET", "HEAD"])
async def serve_upload(rel: str, request: Request):
    path = _safe_path(rel)
    size = path.stat().st_size
    ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    base = {"Accept-Ranges": "bytes"}

    rng = request.headers.get("range", "").strip()
    m = _RANGE.fullmatch(rng) if rng else None
    if not m or size == 0 or (m.group(1) == "" and m.group(2) == ""):
        if request.method == "HEAD":
            return Response(status_code=200, headers={**base, "Content-Length": str(size), "Content-Type": ctype})
        return FileResponse(path, media_type=ctype, headers=base)

    if m.group(1) == "":
        # bytes=-N — последние N байт (так Chromium ищет moov в хвосте)
        n = int(m.group(2))
        start, end = max(0, size - n), size - 1
    else:
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
    if start > end or start >= size:
        return Response(status_code=416, headers={**base, "Content-Range": f"bytes */{size}"})

    headers = {
        **base,
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(end - start + 1),
        "Content-Type": ctype,
    }
    if request.method == "HEAD":
        return Response(status_code=206, headers=headers)
    return StreamingResponse(_iter_range(path, start, end), status_code=206, headers=headers, media_type=ctype)
