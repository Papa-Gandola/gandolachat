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
CLIENT_TTL_SEC = 180  # хартбит десктопа раз в 60с — 3 пропуска и отметка гаснет

_playing: set[int] = set()
# Второй источник: десктоп сам видит запущенный dota2.exe и шлёт
# dota_client_presence (работает при стим-невидимке). user_id → дедлайн.
_client_until: dict[int, float] = {}


def _client_alive() -> set[int]:
    import time
    now = time.monotonic()
    return {uid for uid, t in _client_until.items() if t > now}


def playing_ids() -> list[int]:
    return sorted(set(_playing) | _client_alive())


async def set_client_presence(user_id: int, running: bool, db) -> None:
    """Отметка «Дота запущена на компе» от самого клиента. Невидимка
    уважается: у выключивших показ отметка игнорируется."""
    import time
    if running:
        from sqlalchemy import select as _select
        vis = await db.execute(
            _select(User.dota_presence_visible).where(User.id == user_id)
        )
        if not vis.scalar_one_or_none():
            running = False
    before = playing_ids()
    if running:
        _client_until[user_id] = time.monotonic() + CLIENT_TTL_SEC
    else:
        _client_until.pop(user_id, None)
    if playing_ids() != before:
        await _broadcast()


async def _prune_client() -> None:
    """Протухшие клиентские отметки (закрыл Гандолу вместе с Дотой —
    хартбиты кончились). Зовётся из джобы опроса, работает и БЕЗ
    STEAM_API_KEY — клиентский источник живёт сам по себе."""
    import time
    now = time.monotonic()
    expired = [uid for uid, t in _client_until.items() if t <= now]
    if expired:
        for uid in expired:
            _client_until.pop(uid, None)
        await _broadcast()


async def _broadcast() -> None:
    payload = {"type": "dota_presence", "playing": playing_ids()}
    for uid in list(manager.get_online_user_ids()):
        try:
            await manager.send_to_user(uid, payload)
        except Exception:
            pass


async def drop_user(user_id: int) -> None:
    """Невидимка включена — гасим значок сразу, не ждём опроса."""
    changed = user_id in _playing or user_id in _client_alive()
    _playing.discard(user_id)
    _client_until.pop(user_id, None)
    if changed:
        await _broadcast()


async def poll_presence() -> None:
    global _playing
    await _prune_client()
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

    # Гонка с тумблером невидимки: PATCH мог выключить видимость, пока мы
    # ходили в Steam со старым снапшотом — пересекаем с актуальным набором,
    # чтобы drop_user не «воскрес» через 2 минуты.
    async with AsyncSessionLocal() as db:
        vis_res = await db.execute(
            select(User.id).where(User.dota_presence_visible.is_(True))
        )
        visible_now = {r[0] for r in vis_res.all()}
    now_playing &= visible_now

    if now_playing != _playing:
        _playing = now_playing
        await _broadcast()
