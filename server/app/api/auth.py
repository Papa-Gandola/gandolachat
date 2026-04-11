from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.models import User
from app.schemas import UserRegister, UserLogin, Token, UserOut
from app.auth import hash_password, verify_password, create_access_token, get_current_user

ADMIN_USERNAME = "Papa Gandola"

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
async def register(data: UserRegister, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    # Admin auto-approved, everyone else needs approval
    is_admin = data.username == ADMIN_USERNAME
    user = User(
        username=data.username,
        email=f"{data.username}@gandolachat.local",
        password_hash=hash_password(data.password),
        is_approved=is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    if is_admin:
        token = create_access_token(user.id)
        return {"status": "approved", "access_token": token, "token_type": "bearer", "user": UserOut.model_validate(user).model_dump()}
    else:
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
    if current_user.username != ADMIN_USERNAME:
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
    if current_user.username != ADMIN_USERNAME:
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
    if current_user.username != ADMIN_USERNAME:
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
