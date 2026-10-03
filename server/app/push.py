"""Expo Push Notification helper.

Routes messages/calls to mobile clients via Expo's push service, which in turn
delivers via FCM (Android) / APNs (iOS). Best-effort: failures are logged
but never propagate — the WS broadcast still happens regardless.

A user can have multiple registered tokens (multi-device). Looking up tokens
is a single SELECT on push_tokens.user_id.
"""
from __future__ import annotations
import asyncio
from typing import Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PushToken

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Single shared client — connection pool is faster than reopening per call.
_client: httpx.AsyncClient | None = None

# Anti-spam: don't fire a message push for the same chat more than once
# every PUSH_THROTTLE_SEC seconds. The chat still gets the WS message
# (so the open app updates immediately) — only the OS-level notification
# is suppressed, which is what stops the "ding ding ding" experience
# when a friend sends 20 messages back-to-back.
import time as _time
PUSH_THROTTLE_SEC = 15
_last_message_push_at: dict[int, float] = {}


def should_throttle_message_push(chat_id: int) -> bool:
    """Return True if the caller should SKIP pushing for this chat — we already
    pushed within the throttle window. Updates the in-memory timestamp on a
    pass so the next call sees fresh state."""
    now = _time.time()
    last = _last_message_push_at.get(chat_id, 0)
    if now - last < PUSH_THROTTLE_SEC:
        return True
    _last_message_push_at[chat_id] = now
    return False


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


# Сквозное гашение уведомлений (просьба хозяина 03.10): прочитал чат на одном
# устройстве — на остальных уведомление о новом сообщении должно пропасть.
# Пока приложение живо (в т.ч. в фоне с живым сокетом), устройства гасят
# сами по WS message_read. А вот PWA/айфон с закрытой страницей достаёт
# только Web Push: шлём ему ТИХИЙ пуш {type:"read", chat_id} — service
# worker закрывает уведомления этого чата и ничего не показывает. Expo
# (нативный Android) таким не кормим: data-only пуш без expo-task-manager
# (= нативный модуль = новый APK) убитым приложением не обрабатывается, а
# живое гасит по WS. Чтобы не слать «read» на КАЖДЫЙ mark_read (он летит
# при каждом открытии чата), помним, кому и в какой чат недавно уходил пуш
# о сообщении, и шлём тихий пуш только после него, один раз.
READ_SYNC_WINDOW_SEC = 12 * 3600
_recent_push: dict[tuple[int, int], float] = {}


def _note_pushed(user_ids: list[int], data: dict | None) -> None:
    d = data or {}
    chat_id = d.get("chat_id")
    if d.get("type") != "message" or not chat_id:
        return
    now = _time.time()
    for uid in user_ids:
        _recent_push[(uid, int(chat_id))] = now
    if len(_recent_push) > 5000:
        for key, at in list(_recent_push.items()):
            if now - at > READ_SYNC_WINDOW_SEC:
                _recent_push.pop(key, None)


async def send_read_sync(db: AsyncSession, user_id: int, chat_id: int) -> bool:
    """Юзер прочитал чат (mark_read с любого устройства) → тихий Web Push
    «прочитано» его же подпискам, если туда недавно уходил пуш о сообщении.
    Возвращает True, если пуш отправлен."""
    key = (user_id, int(chat_id))
    at = _recent_push.pop(key, None)
    if at is None or _time.time() - at > READ_SYNC_WINDOW_SEC:
        return False
    try:
        from app.webpush import send_web_push
        await send_web_push(
            db, [user_id], "", "",
            data={"type": "read", "chat_id": int(chat_id)},
            tag=f"chat-{chat_id}",
        )
    except Exception as e:
        print(f"[push][read-sync] failed: {type(e).__name__}: {e}")
        return False
    return True


async def send_push(
    db: AsyncSession,
    user_ids: Iterable[int],
    title: str,
    body: str,
    data: dict | None = None,
    channel_id: str = "default",
    priority: str = "high",
) -> None:
    """Look up every push channel for the given users: Expo tokens (native
    Android) get a single batched POST; Web Push subscriptions (PWA/айфоны)
    go through app/webpush.py. Обе ветки best-effort и независимы — юзер
    только с айфоном не должен зависеть от наличия Expo-токенов."""
    uids = list({uid for uid in user_ids if uid is not None})
    if not uids:
        return
    _note_pushed(uids, data)  # для тихого «прочитано» (send_read_sync)

    result = await db.execute(
        select(PushToken.token).where(PushToken.user_id.in_(uids))
    )
    tokens = [row[0] for row in result.all() if row[0]]
    if tokens:
        messages = [
            {
                "to": t,
                "title": title,
                "body": body,
                "data": data or {},
                "sound": "default",
                "priority": priority,
                "channelId": channel_id,
            }
            for t in tokens
        ]
        # Don't block the caller on the HTTP round-trip — fire and forget.
        asyncio.create_task(_fire(messages))

    try:
        from app.webpush import send_web_push
        await send_web_push(
            db, uids, title, body,
            data=data,
            tag=(data or {}).get("notification_tag"),
        )
    except Exception as e:
        print(f"[push][web] dispatch failed: {type(e).__name__}: {e}")


async def _fire(messages: list[dict]) -> None:
    try:
        resp = await _get_client().post(EXPO_PUSH_URL, json=messages)
        if resp.status_code != 200:
            print(f"[push] expo returned {resp.status_code}: {resp.text[:300]}")
            return
        # Expo returns a list of receipts; an "error" status on a receipt
        # usually means the token is invalid (uninstalled / token rotated).
        # We surface it so we can later prune dead tokens; pruning itself
        # is best done in a periodic job, not here.
        try:
            body = resp.json()
            if isinstance(body, dict):
                receipts = body.get("data", [])
                for r in receipts if isinstance(receipts, list) else []:
                    if isinstance(r, dict) and r.get("status") == "error":
                        print(f"[push] receipt error: {r.get('message')} details={r.get('details')}")
        except Exception:
            pass
    except Exception as e:
        print(f"[push] send failed: {type(e).__name__}: {e}")
