from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pathlib import Path
from datetime import datetime, timezone
import aiofiles
import uuid
from pydantic import BaseModel
from app.database import get_db
from app.models import User, PushToken, WebPushSubscription
from app.schemas import UserOut
from app.auth import get_current_user, create_access_token
from app.schemas import Token, MeOut
from app.config import settings
from app.ws.manager import manager

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=MeOut)
async def get_me(current_user: User = Depends(get_current_user)):
    """Returns the user PLUS access_token/user wrapper so both pre-2.1.1
    clients (which read res.data.username directly) and 2.1.1+ clients
    (which read res.data.user and res.data.access_token) keep working."""
    user_out = UserOut.model_validate(current_user)
    token = create_access_token(current_user.id)
    return MeOut(
        **user_out.model_dump(),
        access_token=token,
        token_type="bearer",
        user=user_out,
    )


@router.get("/search", response_model=list[UserOut])
async def search_users(
    q: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(User).where(
            User.username.ilike(f"%{q}%"),
            User.id != current_user.id,
        ).limit(20)
    )
    return result.scalars().all()


@router.patch("/me", response_model=UserOut)
async def update_profile(
    data: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_username = data.get("username")
    if new_username and new_username != current_user.username:
        existing = await db.execute(select(User).where(User.username == new_username))
        if existing.scalar_one_or_none():
            raise HTTPException(400, "Никнейм уже занят")
        current_user.username = new_username

    if "status" in data:
        status = (data.get("status") or "").strip()[:50]
        current_user.status = status or None

    if "about" in data:
        about = (data.get("about") or "").strip()[:500]
        current_user.about = about or None

    await db.commit()
    await db.refresh(current_user)

    # Broadcast profile update to all chats this user is in
    from app.models import chat_members
    chat_ids_result = await db.execute(
        select(chat_members.c.chat_id).where(chat_members.c.user_id == current_user.id)
    )
    payload = {
        "type": "profile_updated",
        "user_id": current_user.id,
        "username": current_user.username,
        "avatar_url": current_user.avatar_url,
        "status": current_user.status,
        "about": current_user.about,
    }
    for row in chat_ids_result.all():
        await manager.broadcast_to_chat(row.chat_id, payload)

    return current_user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.post("/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        raise HTTPException(status_code=400, detail="Only image files allowed")

    upload_dir = Path(settings.UPLOAD_DIR) / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1]
    filename = f"{uuid.uuid4()}.{ext}"
    path = upload_dir / filename

    async with aiofiles.open(path, "wb") as f:
        content = await file.read()
        await f.write(content)

    current_user.avatar_url = f"/uploads/avatars/{filename}"
    await db.commit()
    await db.refresh(current_user)

    from app.models import chat_members
    chat_ids_result = await db.execute(
        select(chat_members.c.chat_id).where(chat_members.c.user_id == current_user.id)
    )
    payload = {
        "type": "profile_updated",
        "user_id": current_user.id,
        "username": current_user.username,
        "avatar_url": current_user.avatar_url,
        "status": current_user.status,
        "about": current_user.about,
    }
    for row in chat_ids_result.all():
        await manager.broadcast_to_chat(row.chat_id, payload)

    return current_user


class PushTokenIn(BaseModel):
    token: str
    platform: str = "android"


@router.post("/push-token")
async def register_push_token(
    data: PushTokenIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register or re-bind a mobile push token to the current user. Same
    token coming back for a different user (account switch on the device)
    just gets re-pointed — no duplicates."""
    if not data.token or not data.token.strip():
        raise HTTPException(400, "Empty token")
    tok = data.token.strip()
    existing = await db.execute(select(PushToken).where(PushToken.token == tok))
    row = existing.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        db.add(PushToken(user_id=current_user.id, token=tok, platform=data.platform[:16] or "android"))
    else:
        row.user_id = current_user.id
        row.platform = data.platform[:16] or row.platform
        row.updated_at = now
    await db.commit()
    return {"ok": True}


@router.delete("/push-token")
async def unregister_push_token(
    data: PushTokenIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drop a push token (called on logout). Only removes if it belongs to
    the current user — defence against accidentally clearing someone
    else's token if the same string ended up registered elsewhere."""
    tok = data.token.strip()
    if not tok:
        return {"ok": True}
    existing = await db.execute(
        select(PushToken).where(PushToken.token == tok, PushToken.user_id == current_user.id)
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Web Push (browser / iOS-PWA) — separate from the Expo native push above.
# ---------------------------------------------------------------------------

class WebPushKeys(BaseModel):
    p256dh: str
    auth: str


class WebPushSubscriptionIn(BaseModel):
    endpoint: str
    keys: WebPushKeys


@router.get("/web-push/vapid-public-key")
async def get_vapid_public_key():
    """Hand the browser the applicationServerKey it needs to subscribe.
    Empty string means web push isn't configured on this server — the client
    treats that as 'feature off' and skips subscribing."""
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/web-push/subscribe")
async def web_push_subscribe(
    data: WebPushSubscriptionIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save (or re-point) a browser Web Push subscription for the current user.
    Keyed by endpoint — the same browser re-subscribing just updates its row."""
    endpoint = (data.endpoint or "").strip()
    if not endpoint or not data.keys.p256dh or not data.keys.auth:
        raise HTTPException(400, "Incomplete subscription")
    existing = await db.execute(
        select(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint)
    )
    row = existing.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        db.add(WebPushSubscription(
            user_id=current_user.id,
            endpoint=endpoint,
            p256dh=data.keys.p256dh[:255],
            auth=data.keys.auth[:255],
        ))
    else:
        row.user_id = current_user.id
        row.p256dh = data.keys.p256dh[:255]
        row.auth = data.keys.auth[:255]
        row.updated_at = now
    await db.commit()
    return {"ok": True}


@router.post("/web-push/unsubscribe")
async def web_push_unsubscribe(
    data: WebPushSubscriptionIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drop a browser subscription (logout / permission revoked). Only removes
    the row if it belongs to the current user."""
    endpoint = (data.endpoint or "").strip()
    if not endpoint:
        return {"ok": True}
    existing = await db.execute(
        select(WebPushSubscription).where(
            WebPushSubscription.endpoint == endpoint,
            WebPushSubscription.user_id == current_user.id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return {"ok": True}
