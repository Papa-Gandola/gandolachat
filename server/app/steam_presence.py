"""«🎮 в Доте сейчас» — Steam presence привязанных игроков.

Джоба раз в PRESENCE_POLL_SEC опрашивает GetPlayerSummaries (батчами по
100 id) и держит in-memory набор user_id, у кого сейчас запущена Dota 2
(gameid 570). При СМЕНЕ состава — WS `dota_presence {playing: [...]}`
всем онлайн-сокетам; каждому новому WS-подключению хендлер шлёт снимок.

Требует STEAM_API_KEY (без ключа джоба молча спит) и публичного профиля
Steam (привязка и так делается по публичной статистике). Невидимка:
users.dota_presence_visible=False — юзер не опрашивается вовсе, а
выключение через PATCH /me убирает его из набора сразу (drop_user).
Рестарт сервера просто обнуляет набор до следующего опроса — не страшно.
"""
from __future__ import annotations

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import User
from app.ws.manager import manager

PRESENCE_POLL_SEC = 120
DOTA_GAME_ID = "570"

_playing: set[int] = set()


def playing_ids() -> list[int]:
    return sorted(_playing)


async def _broadcast() -> None:
    payload = {"type": "dota_presence", "playing": playing_ids()}
    for uid in list(manager.get_online_user_ids()):
        try:
            await manager.send_to_user(uid, payload)
        except Exception:
            pass


async def drop_user(user_id: int) -> None:
    """Невидимка включена — гасим значок сразу, не ждём опроса."""
    if user_id in _playing:
        _playing.discard(user_id)
        await _broadcast()


async def poll_presence() -> None:
    global _playing
    if not settings.STEAM_API_KEY:
        return
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(User.id, User.steam_id64).where(
                User.steam_id64.is_not(None),
                User.dota_account_id.is_not(None),
                User.dota_presence_visible.is_(True),
            )
        )
        rows = [(uid, sid) for uid, sid in res.all() if sid]
    if not rows:
        if _playing:
            _playing.clear()
            await _broadcast()
        return

    by_steam = {sid: uid for uid, sid in rows}
    now_playing: set[int] = set()
    from app.opendota import _get_client  # IPv4-прибитый клиент (грабля №3)
    client = _get_client()
    ids = list(by_steam.keys())
    try:
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            r = await client.get(
                "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
                params={"key": settings.STEAM_API_KEY, "steamids": ",".join(chunk)},
            )
            r.raise_for_status()
            for p in (r.json().get("response") or {}).get("players") or []:
                if p.get("gameid") == DOTA_GAME_ID:
                    uid = by_steam.get(str(p.get("steamid")))
                    if uid is not None:
                        now_playing.add(uid)
    except Exception as e:
        # Steam лёг — состав не трогаем: мигание «вышел/зашёл» хуже
        print(f"[presence] steam api failed: {type(e).__name__}: {e}")
        return

    if now_playing != _playing:
        _playing = now_playing
        await _broadcast()
