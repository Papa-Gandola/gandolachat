"""Зеркало свежего Android APK на нашем сервере.

GitHub-CDN (release-assets.githubusercontent.com) у российских провайдеров
регулярно душится на хвосте закачки: файл доходит до ~100% и «загрузка не
завершена» висит вечно. Поэтому QR в профиле десктопа ведёт на НАШ сервер
(`GET /apk`), а сервер сам держит копию последнего APK из скользящего
релиза mobile-latest.

Синк: при старте + периодической джобой (см. main.py). Сравниваем
updated_at ассета с сохранённым в meta.json — совпало = не качаем.
Скачивание в *.part с проверкой размера и атомарным os.replace, чтобы
никто не получил недокачанный файл. Сеть — sync-httpx в тредпуле
(файл большой, event loop не для него) и строго IPv4 (грабли №3).
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

from app.config import settings

REPO = "Papa-Gandola/gandolachat"
ASSET_NAME = "gandolachat.apk"
RELEASE_API = f"https://api.github.com/repos/{REPO}/releases/tags/mobile-latest"
# Фолбэк, пока зеркало ещё не набрало кэш (первый старт после деплоя).
FALLBACK_URL = f"https://github.com/{REPO}/releases/download/mobile-latest/{ASSET_NAME}"

_SYNC_LOCK = asyncio.Lock()

router = APIRouter()


def _apk_dir() -> Path:
    return Path(settings.UPLOAD_DIR) / "apk"


def _apk_path() -> Path:
    return _apk_dir() / ASSET_NAME


def _meta_path() -> Path:
    return _apk_dir() / "meta.json"


def _client() -> httpx.Client:
    # read=30: провайдер душит соединение молча — короткий read-таймаут
    # быстро выявляет застрявшую закачку, дальше докачиваем через Range.
    return httpx.Client(
        transport=httpx.HTTPTransport(local_address="0.0.0.0", retries=2),
        timeout=httpx.Timeout(30.0, connect=10.0),
        follow_redirects=True,
        headers={
            "User-Agent": "gandolachat-server",
            "Accept": "application/vnd.github+json",
        },
    )


def _download_resumable(client: httpx.Client, url: str, tmp: Path, want: int) -> int:
    """Скачивание, живучее при RU-глушении GitHub-CDN (грабли №12).

    Два приёма, недоступных обычному браузеру:
    - размер известен заранее → выходим, как только получены ВСЕ байты,
      не дожидаясь закрытия соединения (именно его провайдер и душит);
    - обрыв/стойло → следующая попытка докачивает с места обрыва (Range).
    """
    tmp.unlink(missing_ok=True)
    got = 0
    for attempt in range(1, 13):
        try:
            headers = {"Range": f"bytes={got}-"} if got else {}
            with client.stream("GET", url, headers=headers) as r:
                if got and r.status_code != 206:
                    got = 0  # сервер не умеет Range — начинаем заново
                r.raise_for_status()
                with open(tmp, "ab" if got else "wb") as f:
                    for chunk in r.iter_bytes(1 << 16):
                        f.write(chunk)
                        got += len(chunk)
                        if got >= want:
                            return got  # всё на месте — close не ждём
        except httpx.HTTPError as e:
            print(f"[apk-mirror] attempt {attempt}: {type(e).__name__} at {got}/{want}")
        if got >= want:
            return got
    return got


def _sync_impl() -> None:
    with _client() as client:
        resp = client.get(RELEASE_API)
        if resp.status_code == 404:
            # Релиза ещё нет (первая сборка в пути) — нечего зеркалить.
            return
        resp.raise_for_status()
        release = resp.json()
        asset = next(
            (a for a in release.get("assets", []) if a.get("name") == ASSET_NAME),
            None,
        )
        if not asset or asset.get("state") != "uploaded":
            return

        meta = {
            "updated_at": asset.get("updated_at"),
            "size": asset.get("size"),
            "release_name": release.get("name"),
        }
        try:
            old = json.loads(_meta_path().read_text())
        except Exception:
            old = None
        if old == meta and _apk_path().is_file():
            return  # уже свежий

        _apk_dir().mkdir(parents=True, exist_ok=True)
        tmp = _apk_path().with_suffix(".part")
        want = int(meta["size"] or 0)
        if want:
            got = _download_resumable(client, asset["browser_download_url"], tmp, want)
        else:  # размера в API нет (не должно случаться) — одиночная попытка
            with client.stream("GET", asset["browser_download_url"]) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes(1 << 16):
                        f.write(chunk)
            got = want = tmp.stat().st_size
        if got != want:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"size mismatch: got {got}, want {want}")
        os.replace(tmp, _apk_path())
        _meta_path().write_text(json.dumps(meta))
        print(f"[apk-mirror] synced {meta['release_name']} ({got} bytes)")


async def sync_apk() -> None:
    """Джоба/стартовый синк. Ошибки — в лог, не наружу (best-effort)."""
    async with _SYNC_LOCK:
        try:
            await asyncio.to_thread(_sync_impl)
        except Exception as e:
            print(f"[apk-mirror] sync failed: {type(e).__name__}: {e}")


@router.get("/apk")
async def download_apk():
    """Отдаём APK со своего диска; пока кэша нет — редирект на GitHub."""
    path = _apk_path()
    if path.is_file():
        return FileResponse(
            path,
            media_type="application/vnd.android.package-archive",
            filename=ASSET_NAME,
        )
    return RedirectResponse(FALLBACK_URL, status_code=302)
