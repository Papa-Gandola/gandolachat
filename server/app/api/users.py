from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pathlib import Path
import aiofiles
import uuid
from app.database import get_db
from app.models import User
from app.schemas import UserOut
from app.auth import get_current_user
from app.config import settings
from app.ws.manager import manager

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


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
    }
    for row in chat_ids_result.all():
        await manager.broadcast_to_chat(row.chat_id, payload)

    return current_user
