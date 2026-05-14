from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models import User
from app.schemas import UserRegister, UserLogin, Token, UserOut
from app.auth import hash_password, verify_password, create_access_token, get_current_user
from app.ws.manager import manager

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
async def register(data: UserRegister, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    # Everyone registers as a regular user — needs approval, never admin.
    # Admin rights are granted only via the users.is_admin column (set by
    # the startup migration in main.py, or manual SQL on the VPS).
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        is_approved=False,
        is_admin=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Notify every admin in real-time (multiple admins supported).
    admins_result = await db.execute(select(User).where(User.is_admin == True))
    for admin in admins_result.scalars().all():
        await manager.send_to_user(admin.id, {
            "type": "new_pending_user",
            "id": user.id,
            "username": user.username,
            "created_at": user.created_at.isoformat(),
        })
    return {"status": "pending", "message": "Ваша заявка отправлена. Ожидайте одобрения администратора."}


@router.post("/login", response_model=Token)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    if not user.is_approved:
        raise HTTPException(status_code=403, detail="Администратор ещё не одобрил ваш аккаунт")

    token = create_access_token(user.id)
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


# Admin endpoints
@router.get("/pending-users")
async def get_pending_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can view pending users")

    result = await db.execute(select(User).where(User.is_approved == False))
    users = result.scalars().all()
    return [{"id": u.id, "username": u.username, "created_at": u.created_at.isoformat()} for u in users]


@router.post("/approve-user/{user_id}")
async def approve_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can approve users")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_approved = True
    await db.commit()
    return {"ok": True, "username": user.username}


@router.post("/reject-user/{user_id}")
async def reject_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can reject users")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.delete(user)
    await db.commit()
    return {"ok": True}


class ChangePassword(BaseModel):
    old_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    data: ChangePassword,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Wrong current password")

    current_user.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"ok": True}
