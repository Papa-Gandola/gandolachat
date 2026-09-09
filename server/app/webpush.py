"""Web Push для PWA (айфоны с ярлыком «На экран Домой», iOS 16.4+).

Дополняет Expo-пуши (натив): у веб-клиента нет Expo-токена, зато есть
PushManager-подписка из service worker'а (sw.js уже умеет показывать
уведомления по push-событию).

VAPID-ключи генерятся сами при первом старте и живут в uploads-томе
(переживают пересборки образа) — деплой без ручных шагов. Отправка идёт
через pywebpush (синхронный requests) в тредпуле, fire-and-forget;
протухшие подписки (404/410 от push-сервиса) вычищаются из базы.
"""
from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import WebPushSubscription

_VAPID_DIR = Path(settings.UPLOAD_DIR) / "vapid"
_PRIV_PEM = _VAPID_DIR / "private.pem"
_PUB_TXT = _VAPID_DIR / "public.txt"
_pub_cache: str | None = None


def _log(msg: str) -> None:
    print(f"[push][web] {msg}")


def get_public_key() -> str:
    """Публичный VAPID-ключ (urlsafe base64 без '=') — им клиент подписывается
    в PushManager.subscribe(applicationServerKey=...). Генерит пару при
    первом обращении."""
    global _pub_cache
    if _pub_cache:
        return _pub_cache
    if _PUB_TXT.exists() and _PRIV_PEM.exists():
        _pub_cache = _PUB_TXT.read_text().strip()
        return _pub_cache

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    _VAPID_DIR.mkdir(parents=True, exist_ok=True)
    priv = ec.generate_private_key(ec.SECP256R1())
    _PRIV_PEM.write_bytes(
        priv.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    pub_raw = priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    pub_b64 = base64.urlsafe_b64encode(pub_raw).decode().rstrip("=")
    _PUB_TXT.write_text(pub_b64)
    _log("VAPID keypair generated")
    _pub_cache = pub_b64
    return pub_b64


async def send_web_push(
    db: AsyncSession,
    user_ids: list[int],
    title: str,
    body: str,
    data: dict | None = None,
    tag: str | None = None,
) -> None:
    """Разослать веб-пуш всем подпискам указанных юзеров. Best-effort:
    ошибки логируются, HTTP-часть уходит в фон и не держит вызывающего."""
    if not user_ids:
        return
    res = await db.execute(
        select(WebPushSubscription).where(WebPushSubscription.user_id.in_(user_ids))
    )
    rows = [
        {"endpoint": s.endpoint, "p256dh": s.p256dh, "auth": s.auth}
        for s in res.scalars().all()
    ]
    if not rows:
        return
    get_public_key()  # убедиться, что private.pem существует до тредпула
    payload = json.dumps(
        {"title": title, "body": body, "data": data or {}, "tag": tag},
        ensure_ascii=False,
    )
    asyncio.create_task(_fire(rows, payload))


async def _fire(rows: list[dict], payload: str) -> None:
    try:
        dead = await asyncio.to_thread(_send_all_sync, rows, payload)
    except Exception as e:
        _log(f"send batch failed: {type(e).__name__}: {e}")
        return
    if not dead:
        return
    try:
        from sqlalchemy import delete as sa_delete

        async with AsyncSessionLocal() as db:
            await db.execute(
                sa_delete(WebPushSubscription).where(WebPushSubscription.endpoint.in_(dead))
            )
            await db.commit()
        _log(f"pruned {len(dead)} dead subscription(s)")
    except Exception as e:
        _log(f"prune failed: {type(e).__name__}: {e}")


def _send_all_sync(rows: list[dict], payload: str) -> list[str]:
    """Синхронная рассылка (в тредпуле). Возвращает endpoints протухших
    подписок (404/410 — человек удалил PWA или подписка ротировалась)."""
    from pywebpush import WebPushException, webpush

    dead: list[str] = []
    for r in rows:
        try:
            webpush(
                subscription_info={
                    "endpoint": r["endpoint"],
                    "keys": {"p256dh": r["p256dh"], "auth": r["auth"]},
                },
                data=payload,
                vapid_private_key=str(_PRIV_PEM),
                # pywebpush мутирует claims (добавляет aud/exp) — свежая копия
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                ttl=120,
            )
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                dead.append(r["endpoint"])
            else:
                _log(f"webpush error {code}: {e}")
        except Exception as e:
            _log(f"webpush failed: {type(e).__name__}: {e}")
    return dead
