from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
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
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_username = data.get("username")
    if new_username and new_username != current_user.username:
        existing = await db.execute(select(User).where(User.username == new_username))
        if existing.scalar_one_or_none():
            raise HTTPException(400, "Username already taken")
        current_user.username = new_username
    await db.commit()
    await db.refresh(current_user)
    return current_user


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
    return current_user
