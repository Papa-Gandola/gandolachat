from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta, timezone
from pathlib import Path
import aiofiles
import uuid
from app.database import get_db
from app.models import Chat, User, Message, Reaction, chat_members, read_receipts
from app.schemas import ChatOut, UserOut, MessageOut, CreateGroupChat, AddMember
from app.auth import get_current_user
from app.ws.manager import manager
from app.config import settings

router = APIRouter(prefix="/api/chats", tags=["chats"])


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

    chat = Chat(name=data.name, is_group=True, created_by=current_user.id)
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
    )


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
    if not chat.is_group:
        raise HTTPException(400, "Cannot delete DM chats")
    if chat.created_by != current_user.id:
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


@router.post("/{chat_id}/files", response_model=MessageOut)
async def upload_file(
    chat_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify membership
    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Not a member")

    upload_dir = Path(settings.UPLOAD_DIR) / "files"
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin"
    filename = f"{uuid.uuid4()}.{ext}"
    path = upload_dir / filename

    async with aiofiles.open(path, "wb") as f:
        content = await file.read()
        if len(content) > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
            raise HTTPException(400, f"File too large (max {settings.MAX_FILE_SIZE_MB}MB)")
        await f.write(content)

    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.MESSAGE_TTL_DAYS)
    msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        file_url=f"/uploads/files/{filename}",
        file_name=file.filename,
        expires_at=expires_at,
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
    return out


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


@router.get("/online/users")
async def get_online_users(current_user: User = Depends(get_current_user)):
    return {"online_user_ids": list(manager.get_online_user_ids())}
