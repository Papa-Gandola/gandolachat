from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
from app.models import Chat, Message, User
from app.ws.manager import manager
from app.config import settings


async def websocket_endpoint(websocket: WebSocket, user_id: int, db: AsyncSession):
    # Load user's chat IDs
    result = await db.execute(
        select(Chat).join(Chat.members).where(User.id == user_id)
    )
    chats = result.scalars().all()
    chat_ids = [c.id for c in chats]

    await manager.connect(websocket, user_id, chat_ids)

    # Broadcast online status to all chats
    for cid in chat_ids:
        await manager.broadcast_to_chat(cid, {
            "type": "user_online",
            "user_id": user_id,
        }, exclude_user=user_id)

    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("type")

            if event == "message":
                await handle_message(data, user_id, db)

            elif event == "typing":
                chat_id = data.get("chat_id")
                await manager.broadcast_to_chat(chat_id, {
                    "type": "typing",
                    "user_id": user_id,
                    "chat_id": chat_id,
                }, exclude_user=user_id)

            elif event == "edit_message":
                await handle_edit_message(data, user_id, db)

            elif event == "delete_message":
                await handle_delete_message(data, user_id, db)

            elif event == "call_signal":
                target_id = data.get("target_user_id")
                if target_id:
                    await manager.send_to_user(target_id, {
                        "type": "call_signal",
                        "from_user_id": user_id,
                        "chat_id": data.get("chat_id"),
                        "signal": data.get("signal"),
                    })

            elif event == "call_end":
                chat_id = data.get("chat_id")
                await manager.broadcast_to_chat(chat_id, {
                    "type": "call_end",
                    "from_user_id": user_id,
                    "chat_id": chat_id,
                }, exclude_user=user_id)

    except WebSocketDisconnect:
        manager.disconnect(user_id, chat_ids)
        # Broadcast offline status
        for cid in chat_ids:
            await manager.broadcast_to_chat(cid, {
                "type": "user_offline",
                "user_id": user_id,
            })


async def handle_message(data: dict, sender_id: int, db: AsyncSession):
    chat_id = data.get("chat_id")
    content = data.get("content", "").strip()
    reply_to_id = data.get("reply_to_id")

    if not chat_id or not content:
        return

    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == sender_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        return

    sender_result = await db.execute(select(User).where(User.id == sender_id))
    sender = sender_result.scalar_one()

    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.MESSAGE_TTL_DAYS)

    # Build reply info
    reply_to_username = None
    reply_to_content = None
    if reply_to_id:
        reply_result = await db.execute(
            select(Message, User).join(User, Message.sender_id == User.id).where(Message.id == reply_to_id)
        )
        row = reply_result.first()
        if row:
            reply_msg, reply_user = row
            reply_to_username = reply_user.username
            reply_to_content = reply_msg.content

    msg = Message(
        chat_id=chat_id,
        sender_id=sender_id,
        content=content,
        reply_to_id=reply_to_id,
        expires_at=expires_at,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    payload = {
        "type": "message",
        "id": msg.id,
        "chat_id": chat_id,
        "sender_id": sender_id,
        "sender_username": sender.username,
        "sender_avatar": sender.avatar_url,
        "content": content,
        "file_url": None,
        "file_name": None,
        "created_at": msg.created_at.isoformat(),
        "reply_to_id": reply_to_id,
        "reply_to_username": reply_to_username,
        "reply_to_content": reply_to_content,
    }
    await manager.broadcast_to_chat(chat_id, payload)


async def handle_edit_message(data: dict, user_id: int, db: AsyncSession):
    msg_id = data.get("message_id")
    new_content = data.get("content", "").strip()
    if not msg_id or not new_content:
        return

    result = await db.execute(select(Message).where(Message.id == msg_id, Message.sender_id == user_id))
    msg = result.scalar_one_or_none()
    if not msg:
        return

    msg.content = new_content
    msg.is_edited = True
    await db.commit()

    await manager.broadcast_to_chat(msg.chat_id, {
        "type": "message_edited",
        "message_id": msg_id,
        "chat_id": msg.chat_id,
        "content": new_content,
    })


async def handle_delete_message(data: dict, user_id: int, db: AsyncSession):
    msg_id = data.get("message_id")
    if not msg_id:
        return

    result = await db.execute(select(Message).where(Message.id == msg_id, Message.sender_id == user_id))
    msg = result.scalar_one_or_none()
    if not msg:
        return

    chat_id = msg.chat_id
    await db.delete(msg)
    await db.commit()

    await manager.broadcast_to_chat(chat_id, {
        "type": "message_deleted",
        "message_id": msg_id,
        "chat_id": chat_id,
    })
