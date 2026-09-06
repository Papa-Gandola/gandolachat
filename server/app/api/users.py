from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from pathlib import Path
from datetime import datetime, timezone
import aiofiles
import uuid
from pydantic import BaseModel
from app.database import get_db
from app.models import User, PushToken
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
    await _broadcast_profile(db, current_user)
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
    await _broadcast_profile(db, current_user)
    return current_user


async def _broadcast_profile(db: AsyncSession, user: User) -> None:
    """Разослать profile_updated во все чаты пользователя (одна форма payload
    на все три места, где профиль меняется)."""
    from app.models import chat_members
    chat_ids_result = await db.execute(
        select(chat_members.c.chat_id).where(chat_members.c.user_id == user.id)
    )
    payload = {
        "type": "profile_updated",
        "user_id": user.id,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "status": user.status,
        "about": user.about,
        "dota_rank_tier": user.dota_rank_tier,
        "dota_leaderboard_rank": user.dota_leaderboard_rank,
        "dota_account_id": user.dota_account_id,
        "comp_max_level": user.comp_max_level,
        "comp_badge": user.comp_badge,
        "comp_title": user.comp_title,
        "comp_color": user.comp_color,
        "comp_frame": user.comp_frame,
    }
    for row in chat_ids_result.all():
        await manager.broadcast_to_chat(row.chat_id, payload)


class SteamLinkIn(BaseModel):
    input: str


@router.post("/me/steam", response_model=UserOut)
async def link_steam(
    data: SteamLinkIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Привязать Steam/Dota аккаунт: принимает ссылку на Steam-профиль,
    steamID64, Friend ID из Доты или ссылку Dotabuff/OpenDota. Валидирует
    через OpenDota и сразу подтягивает звание."""
    from app import opendota

    try:
        account_id = await opendota.resolve_link_input(data.input)
    except opendota.LinkError as e:
        raise HTTPException(400, str(e))

    try:
        player = await opendota.get_player(account_id)
    except Exception:
        raise HTTPException(502, "OpenDota не отвечает — попробуй ещё раз через минуту")
    if not opendota.profile_exists(player):
        raise HTTPException(400, "Профиль не найден в OpenDota — проверь ссылку или ID")

    dup = await db.execute(
        select(User).where(User.dota_account_id == account_id, User.id != current_user.id)
    )
    dup_user = dup.scalar_one_or_none()
    if dup_user:
        raise HTTPException(400, f"Этот Steam-аккаунт уже привязан к «{dup_user.username}»")

    now = datetime.now(timezone.utc)
    relink_same = current_user.dota_account_id == account_id
    rank_tier, lb = opendota.extract_rank(player)
    if not relink_same:
        # Привязали ДРУГОЙ аккаунт: старые катки к нему не относятся — иначе
        # марафоны/стрики сезона смешали бы игры двух разных дота-аккаунтов.
        # Заработанные выполнения и газ остаются (заслужено — заслужено).
        from app.models import DotaMatch
        await db.execute(DotaMatch.__table__.delete().where(DotaMatch.user_id == current_user.id))
    current_user.dota_account_id = account_id
    current_user.steam_id64 = str(account_id + opendota.STEAM64_OFFSET)
    current_user.dota_rank_tier = rank_tier
    current_user.dota_leaderboard_rank = lb
    current_user.dota_rank_updated_at = now
    if not relink_same or current_user.dota_linked_at is None:
        # Новая привязка: компендиум считает катки только с этого момента
        current_user.dota_linked_at = now

    # Базовая медаль сезона — для марафона «Восхождение»
    from app.compendium.poller import _get_or_create_profile
    from app.compendium.engine import current_season
    prof = await _get_or_create_profile(db, current_user.id, current_season())
    if prof.start_rank_tier is None and rank_tier is not None:
        prof.start_rank_tier = rank_tier

    try:
        await db.commit()
    except IntegrityError:
        # Гонка двух одновременных привязок одного аккаунта — уникальный
        # индекс ловит то, что проскочило мимо проверки выше
        await db.rollback()
        raise HTTPException(400, "Этот Steam-аккаунт уже привязан к другому пользователю")
    await db.refresh(current_user)
    await _broadcast_profile(db, current_user)
    return current_user


@router.delete("/me/steam", response_model=UserOut)
async def unlink_steam(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Отвязать Steam. История каток и трофеи остаются, поллер перестаёт следить."""
    current_user.dota_account_id = None
    current_user.steam_id64 = None
    current_user.dota_rank_tier = None
    current_user.dota_leaderboard_rank = None
    current_user.dota_rank_updated_at = None
    current_user.dota_linked_at = None
    await db.commit()
    await db.refresh(current_user)
    await _broadcast_profile(db, current_user)
    return current_user


@router.post("/me/steam/refresh", response_model=UserOut)
async def refresh_steam(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Обновить звание вручную (кнопка в профиле). Обычно это делает
    ежечасная джоба — ручка на случай «я только что откалибровался»."""
    from app import opendota

    if current_user.dota_account_id is None:
        raise HTTPException(400, "Steam не привязан")
    try:
        player = await opendota.get_player(current_user.dota_account_id)
    except Exception:
        raise HTTPException(502, "OpenDota не отвечает — попробуй ещё раз через минуту")
    rank_tier, lb = opendota.extract_rank(player)
    current_user.dota_rank_tier = rank_tier
    current_user.dota_leaderboard_rank = lb
    current_user.dota_rank_updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)
    await _broadcast_profile(db, current_user)
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
