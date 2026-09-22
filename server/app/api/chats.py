from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta, timezone
from pathlib import Path
import aiofiles
import uuid
from app.database import get_db
from app.models import Chat, User, Message, Reaction, chat_members, read_receipts
from app.schemas import ChatOut, UserOut, MessageOut, CreateGroupChat, AddMember, ChatStats, UpdateChat
from app.auth import get_current_user
from app.ws.manager import manager
from app.config import settings
import re as _re_mod
# Щит грабли №6 для подписи файла: /poll создаёт только сервер (polls.py)
__re_poll = _re_mod.compile(r"^/poll \d+$")

import json

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _parse_admin_ids(chat: Chat) -> list[int]:
    if not chat.admin_ids:
        return []
    try:
        v = json.loads(chat.admin_ids)
        return [int(x) for x in v] if isinstance(v, list) else []
    except Exception:
        return []


def _message_out(msg: Message) -> MessageOut:
    reply_username = None
    reply_content = None
    if msg.reply_to_id and msg.reply_to:
        reply_username = msg.reply_to.sender.username if msg.reply_to.sender else None
        reply_content = msg.reply_to.content
    return MessageOut(
        id=msg.id,
        chat_id=msg.chat_id,
        sender_id=msg.sender_id,
        sender_username=msg.sender.username,
        sender_avatar=msg.sender.avatar_url,
        content=msg.content,
        file_url=msg.file_url,
        file_name=msg.file_name,
        is_edited=msg.is_edited,
        reply_to_id=msg.reply_to_id,
        reply_to_username=reply_username,
        reply_to_content=reply_content,
        reactions=[{"emoji": r.emoji, "user_id": r.user_id} for r in (msg.reactions if hasattr(msg, 'reactions') and msg.reactions else [])],
        created_at=msg.created_at,
        media_group_id=msg.media_group_id,
    )


async def _get_last_message(chat_id: int, db: AsyncSession) -> MessageOut | None:
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender), selectinload(Message.reply_to).selectinload(Message.sender), selectinload(Message.reactions))
        .where(Message.chat_id == chat_id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    msg = result.scalar_one_or_none()
    return _message_out(msg) if msg else None


@router.get("", response_model=list[ChatOut])
async def get_chats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat)
        .options(selectinload(Chat.members))
        .join(Chat.members)
        .where(User.id == current_user.id)
        .order_by(Chat.created_at.desc())
    )
    chats = result.scalars().all()
    out = []
    for chat in chats:
        last = await _get_last_message(chat.id, db)
        out.append(ChatOut(
            id=chat.id,
            name=chat.name,
            is_group=chat.is_group,
            created_by=chat.created_by,
            members=[UserOut.model_validate(m) for m in chat.members],
            last_message=last,
            allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
            is_notes=chat.is_notes,
            avatar_url=chat.avatar_url,
            description=chat.description,
            admin_ids=_parse_admin_ids(chat),
        ))
    return out


@router.post("/dm", response_model=ChatOut)
async def create_dm(
    target_user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if target_user_id == current_user.id:
        raise HTTPException(400, "Cannot DM yourself")

    target = await db.get(User, target_user_id)
    if not target:
        raise HTTPException(404, "User not found")

    # Check if DM already exists
    result = await db.execute(
        select(Chat)
        .options(selectinload(Chat.members))
        .join(Chat.members)
        .where(Chat.is_group == False, User.id == current_user.id)
    )
    for chat in result.scalars().all():
        member_ids = {m.id for m in chat.members}
        if member_ids == {current_user.id, target_user_id}:
            return ChatOut(
                id=chat.id,
                name=chat.name,
                is_group=False,
                created_by=chat.created_by,
                members=[UserOut.model_validate(m) for m in chat.members],
                last_message=await _get_last_message(chat.id, db),
                allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
                avatar_url=chat.avatar_url,
                description=chat.description,
                admin_ids=_parse_admin_ids(chat),
            )

    chat = Chat(is_group=False, created_by=current_user.id)
    chat.members = [current_user, target]
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    # Notify the target user
    manager.join_chat(target_user_id, chat.id)
    manager.join_chat(current_user.id, chat.id)
    await manager.send_to_user(target_user_id, {
        "type": "new_chat",
        "chat_id": chat.id,
    })

    result2 = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat.id)
    )
    chat = result2.scalar_one()
    return ChatOut(
        id=chat.id,
        name=chat.name,
        is_group=False,
        created_by=chat.created_by,
        members=[UserOut.model_validate(m) for m in chat.members],
        last_message=None,
        allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
        avatar_url=chat.avatar_url,
    )


@router.post("/group", response_model=ChatOut)
async def create_group(
    data: CreateGroupChat,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(data.member_ids) > 6:
        raise HTTPException(400, "Group chats support up to 7 members (including you)")

    members = [current_user]
    for uid in data.member_ids:
        if uid == current_user.id:
            continue
        user = await db.get(User, uid)
        if user:
            members.append(user)

    chat = Chat(
        name=data.name,
        is_group=True,
        created_by=current_user.id,
        allow_all_write=data.allow_all_write,
    )
    chat.members = members
    db.add(chat)
    await db.commit()
    await db.refresh(chat)

    for m in members:
        manager.join_chat(m.id, chat.id)
        if m.id != current_user.id:
            await manager.send_to_user(m.id, {"type": "new_chat", "chat_id": chat.id})

    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat.id)
    )
    chat = result.scalar_one()
    return ChatOut(
        id=chat.id,
        name=chat.name,
        is_group=True,
        created_by=chat.created_by,
        members=[UserOut.model_validate(m) for m in chat.members],
        last_message=None,
        allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
        avatar_url=chat.avatar_url,
        description=chat.description,
        admin_ids=_parse_admin_ids(chat),
    )


@router.get("/{chat_id}/stats", response_model=ChatStats)
async def chat_stats(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Counts of media/links/files in the chat — shown on the GroupInfoPage."""
    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == current_user.id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(403, "Not a member")

    from sqlalchemy import func, or_, and_
    # Media: image + video files (anything in /uploads/files with a media extension)
    media_re = r"\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|m4v|webm|mkv|3gp)$"
    media_rows = await db.execute(
        select(func.count()).select_from(Message).where(
            Message.chat_id == chat_id,
            Message.file_url.is_not(None),
            Message.file_url.op("~*")(media_re),
        )
    )
    media_count = int(media_rows.scalar() or 0)
    # Files: non-image attachments
    files_rows = await db.execute(
        select(func.count()).select_from(Message).where(
            Message.chat_id == chat_id,
            Message.file_url.is_not(None),
            ~Message.file_url.op("~*")(media_re),
        )
    )
    file_count = int(files_rows.scalar() or 0)
    # Links: messages whose content contains http(s)://
    link_rows = await db.execute(
        select(func.count()).select_from(Message).where(
            Message.chat_id == chat_id,
            Message.content.op("~*")(r"https?://"),
        )
    )
    link_count = int(link_rows.scalar() or 0)

    return ChatStats(media_count=media_count, link_count=link_count, file_count=file_count)


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    chat_id: int,
    data: UpdateChat,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Creator-only: edit group name, description, admin list."""
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if not chat.is_group:
        raise HTTPException(400, "Только для групп")
    if chat.created_by != current_user.id:
        raise HTTPException(403, "Только создатель")
    if data.name is not None:
        chat.name = data.name.strip()[:100] or chat.name
    if data.description is not None:
        chat.description = data.description.strip()[:1000] or None
    if data.admin_ids is not None:
        # Filter to only existing members (creator is implicit, never stored here)
        member_ids = {m.id for m in chat.members}
        clean = [uid for uid in data.admin_ids if uid in member_ids and uid != chat.created_by]
        chat.admin_ids = json.dumps(sorted(set(clean)))
    if data.compendium_enabled is not None:
        # Куда поллер Гандолиума постит карточки заданий
        chat.compendium_enabled = bool(data.compendium_enabled)
    await db.commit()
    await db.refresh(chat)
    payload = ChatOut(
        id=chat.id, name=chat.name, is_group=True,
        created_by=chat.created_by,
        members=[UserOut.model_validate(m) for m in chat.members],
        last_message=None,
        allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
        avatar_url=chat.avatar_url,
        description=chat.description,
        admin_ids=_parse_admin_ids(chat),
    )
    await manager.broadcast_to_chat(chat.id, {
        "type": "chat_updated",
        "chat": payload.model_dump(mode="json"),
    })
    return payload


@router.delete("/{chat_id}/members/{user_id}")
async def kick_member(
    chat_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a member from a group. Creator OR admins can kick anyone except the creator."""
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if not chat.is_group:
        raise HTTPException(400, "Только для групп")
    admins = _parse_admin_ids(chat)
    can_kick = current_user.id == chat.created_by or current_user.id in admins
    if not can_kick:
        raise HTTPException(403, "Кикать могут только создатель и админы")
    if user_id == chat.created_by:
        raise HTTPException(400, "Нельзя удалить создателя группы")
    target = next((m for m in chat.members if m.id == user_id), None)
    if not target:
        raise HTTPException(404, "Не участник")
    chat.members.remove(target)
    # Strip from admins if was one
    if user_id in admins:
        admins.remove(user_id)
        chat.admin_ids = json.dumps(admins) if admins else None
    manager.chat_users.get(chat_id, set()).discard(user_id)
    await db.commit()
    await db.refresh(chat)
    payload = ChatOut(
        id=chat.id, name=chat.name, is_group=True,
        created_by=chat.created_by,
        members=[UserOut.model_validate(m) for m in chat.members],
        last_message=None,
        allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
        avatar_url=chat.avatar_url,
        description=chat.description,
        admin_ids=_parse_admin_ids(chat),
    )
    await manager.broadcast_to_chat(chat.id, {
        "type": "chat_updated",
        "chat": payload.model_dump(mode="json"),
    })
    # Tell the kicked user their chat is gone
    await manager.send_to_user(user_id, {"type": "chat_deleted", "chat_id": chat_id})
    return payload


@router.post("/{chat_id}/avatar", response_model=ChatOut)
async def upload_group_avatar(
    chat_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set/change the group avatar. Only the creator can do this. DM chats have no avatar."""
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if not chat.is_group:
        raise HTTPException(400, "Аватарка только для групп")
    if chat.created_by != current_user.id:
        raise HTTPException(403, "Только создатель может менять аватарку")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files allowed")

    upload_dir = Path(settings.UPLOAD_DIR) / "group_avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "png"
    filename = f"{uuid.uuid4()}.{ext}"
    path = upload_dir / filename
    async with aiofiles.open(path, "wb") as f:
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(400, "Avatar too large (max 10MB)")
        await f.write(content)

    # Delete old avatar file to avoid disk leak
    if chat.avatar_url:
        try:
            old = chat.avatar_url.lstrip("/")
            old_path = Path(old)
            if old_path.exists() and old_path.is_file():
                old_path.unlink()
        except Exception:
            pass

    chat.avatar_url = f"/uploads/group_avatars/{filename}"
    await db.commit()
    await db.refresh(chat)

    # Broadcast update so everyone sees the new avatar immediately
    payload_chat = ChatOut(
        id=chat.id, name=chat.name, is_group=True,
        created_by=chat.created_by,
        members=[UserOut.model_validate(m) for m in chat.members],
        last_message=None,
        allow_all_write=chat.allow_all_write, compendium_enabled=chat.compendium_enabled,
        avatar_url=chat.avatar_url,
        description=chat.description,
        admin_ids=_parse_admin_ids(chat),
    )
    await manager.broadcast_to_chat(chat.id, {
        "type": "chat_updated",
        "chat": payload_chat.model_dump(mode="json"),
    })
    return payload_chat


@router.post("/{chat_id}/members")
async def add_member(
    chat_id: int,
    data: AddMember,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if not chat.is_group:
        raise HTTPException(400, "Cannot add members to a DM")

    member_ids = {m.id for m in chat.members}
    if current_user.id not in member_ids:
        raise HTTPException(403, "Not a member")
    if len(member_ids) >= 7:
        raise HTTPException(400, "Group is full (max 7 members)")

    new_user = await db.get(User, data.user_id)
    if not new_user:
        raise HTTPException(404, "User not found")
    if data.user_id in member_ids:
        raise HTTPException(400, "User already in chat")

    chat.members.append(new_user)
    await db.commit()
    manager.join_chat(data.user_id, chat_id)
    await manager.send_to_user(data.user_id, {"type": "new_chat", "chat_id": chat_id})
    return {"ok": True}


@router.post("/{chat_id}/leave")
async def leave_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat or not chat.is_group:
        raise HTTPException(400, "Can only leave group chats")
    if current_user not in chat.members:
        raise HTTPException(400, "Not a member")
    chat.members.remove(current_user)
    manager.chat_users.get(chat_id, set()).discard(current_user.id)
    await db.commit()
    return {"ok": True}


@router.delete("/admin/messages/old")
async def admin_delete_old_messages(
    before_days: int | None = None,
    before_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(403, "Admin only")
    if before_date:
        try:
            cutoff = datetime.fromisoformat(before_date)
            if cutoff.tzinfo is None:
                cutoff = cutoff.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "before_date must be ISO format (YYYY-MM-DD)")
    elif before_days and before_days >= 1:
        cutoff = datetime.now(timezone.utc) - timedelta(days=before_days)
    else:
        raise HTTPException(400, "provide before_days or before_date")
    result = await db.execute(
        delete(Message).where(Message.created_at < cutoff)
    )
    await db.commit()
    return {"deleted": result.rowcount, "before": cutoff.isoformat()}


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if current_user not in chat.members:
        raise HTTPException(403, "Not a member")
    if chat.is_group and chat.created_by != current_user.id:
        raise HTTPException(403, "Only the creator can delete the group")

    member_ids = [m.id for m in chat.members]
    await db.delete(chat)
    await db.commit()

    for uid in member_ids:
        if uid != current_user.id:
            await manager.send_to_user(uid, {"type": "chat_deleted", "chat_id": chat_id})
    return {"ok": True}


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def get_messages(
    chat_id: int,
    limit: int = 50,
    before_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify membership
    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Not a member")

    query = (
        select(Message)
        .options(selectinload(Message.sender), selectinload(Message.reply_to).selectinload(Message.sender), selectinload(Message.reactions))
        .where(Message.chat_id == chat_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    if before_id:
        query = query.where(Message.id < before_id)

    result = await db.execute(query)
    messages = result.scalars().all()
    return [_message_out(m) for m in reversed(messages)]


# Расширения, которые клиенты играют инлайн-плеером (десктоп — <video>,
# мобилка — expo-av). Для них лимит размера выше — см. upload_file.
VIDEO_EXTS = {"mp4", "mov", "m4v", "webm", "mkv", "3gp"}


@router.post("/{chat_id}/files", response_model=MessageOut)
async def upload_file(
    chat_id: int,
    file: UploadFile = File(...),
    caption: str = Form(""),
    media_group_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify membership + channel write-permission
    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == current_user.id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(403, "Not a member")
    if chat.is_group and not chat.allow_all_write and chat.created_by != current_user.id:
        raise HTTPException(403, "Только создатель может писать в этот канал")

    upload_dir = Path(settings.UPLOAD_DIR) / "files"
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Имя может не прийти (multipart без filename) — не падать в 500.
    original_name = file.filename or "file.bin"
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
    filename = f"{uuid.uuid4()}.{ext}"
    path = upload_dir / filename

    # Лимит на файл: видео — до MAX_FILE_SIZE_MB (50; ролик с телефона в
    # 10 МБ не влезает — клиенты играют его инлайн), всё остальное — 10 МБ,
    # как и раньше (фото и документы влезают). nginx на VPS должен пускать
    # столько же (client_max_body_size) — иначе 413 прилетит от него.
    is_video = ext.lower() in VIDEO_EXTS or (file.content_type or "").startswith("video/")
    cap_mb = settings.MAX_FILE_SIZE_MB if is_video else min(10, settings.MAX_FILE_SIZE_MB)
    per_file_cap = cap_mb * 1024 * 1024

    # Пишем кусками и рвём по лимиту — не держим 50 МБ в памяти.
    size = 0
    try:
        async with aiofiles.open(path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > per_file_cap:
                    raise HTTPException(400, f"Файл больше {cap_mb} МБ")
                await f.write(chunk)
    except BaseException:
        # Перебор лимита ИЛИ оборвавшаяся загрузка — огрызок на диске не нужен
        path.unlink(missing_ok=True)
        raise

    # Карточки компендиума создаёт только поллер — /quest_card в подписи файла
    # отрисовался бы как настоящая ачивка (тот же щит, что в WS-обработчике).
    clean_caption = caption.strip()
    if clean_caption.startswith("/quest_card") or __re_poll.match(clean_caption):
        clean_caption = ""

    msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        file_url=f"/uploads/files/{filename}",
        file_name=original_name,
        content=clean_caption or None,
        media_group_id=(media_group_id[:40] if media_group_id else None),
    )
    db.add(msg)
    await db.commit()

    result2 = await db.execute(
        select(Message).options(selectinload(Message.sender), selectinload(Message.reply_to).selectinload(Message.sender), selectinload(Message.reactions)).where(Message.id == msg.id)
    )
    msg = result2.scalar_one()
    out = _message_out(msg)

    await manager.broadcast_to_chat(chat_id, {
        "type": "message",
        **out.model_dump(mode="json"),
    })

    # Пуш — как у текстовых сообщений в WS-обработчике: всем участникам,
    # кроме отправителя, с тем же троттлингом 15с/чат (пачка из 5 фото —
    # один пуш). Раньше файловые сообщения пуш не слали вовсе: кинул фото в
    # конфу — телефоны молчали. Best-effort, отправку не ломает.
    try:
        from app.push import send_push, should_throttle_message_push
        chat_full = (
            await db.execute(select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id))
        ).scalar_one_or_none()
        if chat_full and not should_throttle_message_push(chat_id):
            recipients = [m.id for m in chat_full.members if m.id != current_user.id]
            preview = _file_preview(original_name)
            if clean_caption:
                preview = f"{preview} · {clean_caption[:100]}"
            title = chat_full.name if chat_full.is_group else current_user.username
            sub_body = f"{current_user.username}: {preview}" if chat_full.is_group else preview
            # «Собеседник» — ДЛЯ ПОЛУЧАТЕЛЯ пуша, то есть отправитель. Раньше
            # брали «не отправителя», и получателю прилетал его же id: шапка
            # чата из пуша тянула свою аватарку, звонок из неё шёл бы себе.
            peer_user_id = None if chat_full.is_group else current_user.id
            await send_push(
                db,
                recipients,
                title=title,
                body=sub_body,
                data={
                    "type": "message",
                    "chat_id": chat_id,
                    "message_id": msg.id,
                    "is_group": chat_full.is_group,
                    "peer_user_id": peer_user_id,
                    "chat_name": chat_full.name or current_user.username,
                    "notification_tag": f"chat-{chat_id}",
                },
                channel_id="messages",
            )
    except Exception as _push_err:
        print(f"[push][file] failed: {type(_push_err).__name__}: {_push_err}")
    return out


def _file_preview(name: str) -> str:
    """Подпись файлового сообщения для пуша — как markers.ts/useChats у клиентов."""
    low = name.lower()
    if _re_mod.match(r"^voice_\d+\.", low):
        return "🎤 Голосовое"
    if _re_mod.search(r"\.(jpe?g|png|gif|webp|bmp|heic)$", low):
        return "🖼 Фото"
    if _re_mod.search(r"\.(mp4|mov|m4v|webm|mkv|3gp)$", low):
        return "🎬 Видео"
    return f"📎 {name}"


@router.get("/{chat_id}/search", response_model=list[MessageOut])
async def search_messages(
    chat_id: int,
    q: str = "",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q.strip():
        return []

    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Not a member")

    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender), selectinload(Message.reply_to).selectinload(Message.sender), selectinload(Message.reactions))
        .where(Message.chat_id == chat_id, Message.content.ilike(f"%{q}%"))
        .order_by(Message.created_at.desc())
        .limit(20)
    )
    return [_message_out(m) for m in reversed(result.scalars().all())]


@router.get("/{chat_id}/read-status")
async def get_read_status(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(read_receipts).where(read_receipts.c.chat_id == chat_id)
    )
    return [{"user_id": r.user_id, "last_read_message_id": r.last_read_message_id} for r in result.all()]


@router.get("/unread/counts")
async def get_unread_counts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Get all chats
    result = await db.execute(
        select(Chat).join(Chat.members).where(User.id == current_user.id)
    )
    chats = result.scalars().all()

    # Get read receipts for current user
    receipts = await db.execute(
        select(read_receipts).where(read_receipts.c.user_id == current_user.id)
    )
    read_map = {r.chat_id: r.last_read_message_id for r in receipts.all()}

    counts = {}
    for chat in chats:
        last_read = read_map.get(chat.id, 0) or 0
        count_result = await db.execute(
            select(Message.id).where(
                Message.chat_id == chat.id,
                Message.id > last_read,
                Message.sender_id != current_user.id,
            )
        )
        count = len(count_result.all())
        if count > 0:
            counts[chat.id] = count

    return counts


@router.get("/online/users")
async def get_online_users(current_user: User = Depends(get_current_user)):
    return {"online_user_ids": list(manager.get_online_user_ids())}
