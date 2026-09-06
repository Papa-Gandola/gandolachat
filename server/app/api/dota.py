"""The /dota call-to-game card.

Typing /dota in a chat hits this endpoint, which drops a "/dota_call" system
message into the chat (clients render it as the "Газуем в дотан" card, same
mechanism as the poker invite card) and fires a push notification at every
other chat member so phones buzz even when the app is closed.

The "who pressed Играть" ready-list lives in ws/handler.py as ephemeral
in-memory state — a game call is a "right now" thing, it doesn't need to
survive a server restart.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from app.database import get_db
from app.models import User, Chat, Message
from app.auth import get_current_user
from app.ws.manager import manager

router = APIRouter(prefix="/api/dota", tags=["dota"])

DOTA_CALL_MARKER = "/dota_call"


class DotaCallIn(BaseModel):
    chat_id: int


@router.post("/call")
async def create_dota_call(
    data: DotaCallIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == data.chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if current_user not in chat.members:
        raise HTTPException(403, "Not a member of this chat")
    # Channel mode: only the creator can post there — same rule as messages.
    if chat.is_group and not chat.allow_all_write and chat.created_by != current_user.id:
        raise HTTPException(403, "Only the channel creator can post here")

    msg = Message(
        chat_id=data.chat_id,
        sender_id=current_user.id,
        content=DOTA_CALL_MARKER,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    # Same wire shape as a regular chat message so every client just renders it.
    await manager.broadcast_to_chat(data.chat_id, {
        "type": "message",
        "id": msg.id,
        "chat_id": data.chat_id,
        "sender_id": current_user.id,
        "sender_username": current_user.username,
        "sender_avatar": current_user.avatar_url,
        "content": msg.content,
        "file_url": None,
        "file_name": None,
        "is_edited": False,
        "created_at": msg.created_at.isoformat(),
        "reply_to_id": None,
        "reply_to_username": None,
        "reply_to_content": None,
        "reactions": [],
    })

    # Push everyone else in the chat. Deliberately NOT rate-limited by the
    # normal message-push throttle — a game call should always buzz. Wrapped:
    # push is best-effort and must never fail the card creation.
    try:
        from app.push import send_push
        recipients = [m.id for m in chat.members if m.id != current_user.id]
        peer_user_id = None
        if not chat.is_group and recipients:
            peer_user_id = recipients[0]
        await send_push(
            db,
            recipients,
            title="🎮 Газуем в дотан!",
            body=f"{current_user.username} зовёт катку",
            data={
                "type": "message",
                "chat_id": data.chat_id,
                "message_id": msg.id,
                "is_group": chat.is_group,
                "peer_user_id": peer_user_id,
                "chat_name": chat.name,
                "notification_tag": f"dota-{data.chat_id}",
            },
            channel_id="messages",
            priority="high",
        )
    except Exception as _push_err:
        print(f"[push][dota] failed: {type(_push_err).__name__}: {_push_err}")

    return {"message_id": msg.id}
