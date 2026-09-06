"""OpenDota API client + Steam-link input resolution.

Free tier: 2000 calls/day, 60/min — plenty for a friend-group compendium
(the poller does ~1 call per linked user per cycle plus 1 per new match).
An optional OPENDOTA_API_KEY is appended when configured.

All helpers return None / raise LinkError with a human message in Russian —
these strings surface directly in the client UI.
"""
from __future__ import annotations

import re
from typing import Any

import httpx

from app.config import settings

BASE = "https://api.opendota.com/api"
# steamID64 = account_id + this offset (Valve's 32→64 bit ID scheme)
STEAM64_OFFSET = 76561197960265728

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "GandolaChat compendium"},
            # OpenDota живёт за Cloudflare и резолвится в IPv6 первым. VPS с
            # настроенным, но неработающим IPv6 — классика: коннект висит до
            # таймаута, хотя IPv4-хосты (Expo и т.п.) прекрасно работают.
            # Привязка локального адреса к 0.0.0.0 заставляет httpx ходить
            # только по IPv4; retries=1 сглаживает разовые сетевые чихи.
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0", retries=1),
        )
    return _client


def _params(extra: dict | None = None) -> dict:
    p = dict(extra or {})
    if settings.OPENDOTA_API_KEY:
        p["api_key"] = settings.OPENDOTA_API_KEY
    return p


class LinkError(Exception):
    """User-facing error while resolving/validating a Steam link input."""


async def _get(path: str, params: dict | None = None) -> Any:
    resp = await _get_client().get(f"{BASE}{path}", params=_params(params))
    resp.raise_for_status()
    return resp.json()


async def get_player(account_id: int) -> dict:
    """GET /players/{id} → profile, rank_tier, leaderboard_rank."""
    data = await _get(f"/players/{account_id}")
    return data if isinstance(data, dict) else {}


async def get_recent_matches(account_id: int) -> list[dict]:
    """GET /players/{id}/recentMatches — last ~20 matches, includes lobby_type."""
    data = await _get(f"/players/{account_id}/recentMatches")
    return data if isinstance(data, list) else []


async def get_match(match_id: int) -> dict:
    """GET /matches/{id} — full match; parsed fields present once the replay
    parse has landed (match['version'] is not None)."""
    data = await _get(f"/matches/{match_id}")
    return data if isinstance(data, dict) else {}


async def request_parse(match_id: int) -> None:
    """POST /request/{id} — queue a (free) replay parse. Best-effort."""
    try:
        await _get_client().post(f"{BASE}/request/{match_id}", params=_params())
    except Exception:
        pass


async def _resolve_vanity(vanity: str) -> int | None:
    """steamcommunity.com/id/<vanity> → steamID64 via the Steam Web API.
    Needs STEAM_API_KEY; returns None when unavailable or not found."""
    if not settings.STEAM_API_KEY:
        return None
    try:
        resp = await _get_client().get(
            "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
            params={"key": settings.STEAM_API_KEY, "vanityurl": vanity},
        )
        resp.raise_for_status()
        body = resp.json().get("response", {})
        if body.get("success") == 1:
            return int(body["steamid"])
    except Exception:
        pass
    return None


async def resolve_link_input(raw: str) -> int:
    """Turn whatever the user pasted into a Dota account_id (32-bit).

    Accepts: steamID64, Dota Friend ID, steamcommunity.com/profiles/<id64>,
    steamcommunity.com/id/<vanity> (needs STEAM_API_KEY), dotabuff.com and
    opendota.com player links. Raises LinkError with a readable reason."""
    s = (raw or "").strip()
    if not s:
        raise LinkError("Пустая строка — вставь ссылку на Steam-профиль или Friend ID из Доты")

    m = re.search(r"steamcommunity\.com/profiles/(\d{15,20})", s)
    if m:
        id64 = int(m.group(1))
        if id64 <= STEAM64_OFFSET:
            # 15-значное число меньше базы steamID64 дало бы отрицательный
            # account_id и вечное «OpenDota не отвечает» — лучше честная ошибка
            raise LinkError("Ссылка битая: число в /profiles/… не похоже на steamID64")
        return id64 - STEAM64_OFFSET

    m = re.search(r"steamcommunity\.com/id/([\w.\-]+)", s)
    if m:
        id64 = await _resolve_vanity(m.group(1))
        if id64 is None:
            raise LinkError(
                "Ссылки вида /id/<имя> сервер пока не умеет разворачивать — "
                "вставь ссылку вида steamcommunity.com/profiles/… или Friend ID из Доты "
                "(профиль → в Доте под ником)"
            )
        return id64 - STEAM64_OFFSET

    m = re.search(r"(?:dotabuff|opendota)\.com/(?:players|esports/players)/(\d{1,12})", s)
    if m:
        return int(m.group(1))

    if s.isdigit():
        n = int(s)
        if n > STEAM64_OFFSET:  # steamID64
            return n - STEAM64_OFFSET
        if 0 < n < 2**31:  # Dota Friend ID (account_id)
            return n
        raise LinkError("Число не похоже ни на steamID64, ни на Friend ID")

    raise LinkError(
        "Не понял формат. Подойдёт: ссылка на Steam-профиль (…/profiles/…), "
        "ссылка Dotabuff/OpenDota или Friend ID из Доты"
    )


def extract_rank(player: dict) -> tuple[int | None, int | None]:
    """(rank_tier, leaderboard_rank) from a /players payload."""
    rt = player.get("rank_tier")
    lb = player.get("leaderboard_rank")
    return (int(rt) if rt else None, int(lb) if lb else None)


def profile_exists(player: dict) -> bool:
    """OpenDota returns {} or {'profile': None} for unknown accounts."""
    return bool(player.get("profile"))
