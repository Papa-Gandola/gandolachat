from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
from app.models import Chat, Message, User, Reaction, read_receipts
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

            if event == "ping":
                await websocket.send_json({"type": "pong", "t": data.get("t")})

            elif event == "message":
                await handle_message(data, user_id, db)

            elif event == "typing":
                chat_id = data.get("chat_id")
                await manager.broadcast_to_chat(chat_id, {
                    "type": "typing",
                    "user_id": user_id,
                    "chat_id": chat_id,
                }, exclude_user=user_id)

            elif event == "forward_message":
                target_chat_id = data.get("target_chat_id")
                original_content = data.get("content", "")
                original_author = data.get("original_author", "")
                if target_chat_id and original_content:
                    sender_result = await db.execute(select(User).where(User.id == user_id))
                    sender = sender_result.scalar_one()
                    fwd_content = f"[Переслано от {original_author}]\n{original_content}"
                    msg = Message(
                        chat_id=target_chat_id,
                        sender_id=user_id,
                        content=fwd_content,
                    )
                    db.add(msg)
                    await db.commit()
                    await db.refresh(msg)
                    await manager.broadcast_to_chat(target_chat_id, {
                        "type": "message",
                        "id": msg.id,
                        "chat_id": target_chat_id,
                        "sender_id": user_id,
                        "sender_username": sender.username,
                        "sender_avatar": sender.avatar_url,
                        "content": fwd_content,
                        "file_url": None,
                        "file_name": None,
                        "is_edited": False,
                        "created_at": msg.created_at.isoformat(),
                        "reply_to_id": None,
                        "reply_to_username": None,
                        "reply_to_content": None,
                    })

            elif event == "reaction":
                msg_id = data.get("message_id")
                emoji = data.get("emoji", "")
                chat_id = data.get("chat_id")
                if msg_id and emoji and chat_id:
                    reaction = Reaction(message_id=msg_id, user_id=user_id, emoji=emoji)
                    db.add(reaction)
                    await db.commit()
                    await manager.broadcast_to_chat(chat_id, {
                        "type": "reaction",
                        "message_id": msg_id,
                        "chat_id": chat_id,
                        "user_id": user_id,
                        "emoji": emoji,
                    })

            elif event == "remove_reaction":
                msg_id = data.get("message_id")
                emoji = data.get("emoji", "")
                chat_id = data.get("chat_id")
                if msg_id and emoji and chat_id:
                    result = await db.execute(
                        select(Reaction).where(
                            Reaction.message_id == msg_id,
                            Reaction.user_id == user_id,
                            Reaction.emoji == emoji,
                        ).limit(1)
                    )
                    r = result.scalar_one_or_none()
                    if r:
                        await db.delete(r)
                        await db.commit()
                        await manager.broadcast_to_chat(chat_id, {
                            "type": "reaction_removed",
                            "message_id": msg_id,
                            "chat_id": chat_id,
                            "user_id": user_id,
                            "emoji": emoji,
                        })

            elif event == "mark_read":
                chat_id = data.get("chat_id")
                msg_id = data.get("message_id")
                if chat_id and msg_id:
                    await db.execute(
                        read_receipts.delete().where(
                            read_receipts.c.user_id == user_id,
                            read_receipts.c.chat_id == chat_id,
                        )
                    )
                    await db.execute(
                        read_receipts.insert().values(
                            user_id=user_id, chat_id=chat_id, last_read_message_id=msg_id,
                        )
                    )
                    await db.commit()
                    await manager.broadcast_to_chat(chat_id, {
                        "type": "message_read",
                        "chat_id": chat_id,
                        "user_id": user_id,
                        "last_read_message_id": msg_id,
                    }, exclude_user=user_id)

            elif event == "video_status":
                chat_id = data.get("chat_id")
                await manager.broadcast_to_chat(chat_id, {
                    "type": "video_status",
                    "user_id": user_id,
                    "chat_id": chat_id,
                    "video_off": data.get("video_off", False),
                }, exclude_user=user_id)

            elif event == "screen_share_status":
                chat_id = data.get("chat_id")
                await manager.broadcast_to_chat(chat_id, {
                    "type": "screen_share_status",
                    "user_id": user_id,
                    "chat_id": chat_id,
                    "sharing": data.get("sharing", False),
                }, exclude_user=user_id)

            elif event == "mute_status":
                chat_id = data.get("chat_id")
                await manager.broadcast_to_chat(chat_id, {
                    "type": "mute_status",
                    "user_id": user_id,
                    "chat_id": chat_id,
                    "muted": data.get("muted", False),
                }, exclude_user=user_id)

            elif event == "edit_message":
                await handle_edit_message(data, user_id, db)

            elif event == "delete_message":
                await handle_delete_message(data, user_id, db)

            elif event == "call_signal":
                target_id = data.get("target_user_id")
                chat_id = data.get("chat_id")
                if target_id and chat_id:
                    # Verify target is a member of the chat
                    if target_id not in manager.chat_users.get(chat_id, set()):
                        continue
                    # Check DM call limit (max 2 participants)
                    chat_result = await db.execute(
                        select(Chat).where(Chat.id == chat_id)
                    )
                    chat_obj = chat_result.scalar_one_or_none()
                    if chat_obj and not chat_obj.is_group:
                        active = manager.active_calls.get(chat_id, set())
                        if len(active) >= 2 and user_id not in active:
                            continue  # DM call full, reject
                    manager.active_calls[chat_id].add(user_id)
                    # Always broadcast updated participants
                    if chat_obj and chat_obj.is_group:
                        await manager.broadcast_to_chat(chat_id, {
                            "type": "call_active",
                            "chat_id": chat_id,
                            "participants": list(manager.active_calls[chat_id]),
                        })
                    await manager.send_to_user(target_id, {
                        "type": "call_signal",
                        "from_user_id": user_id,
                        "chat_id": chat_id,
                        "signal": data.get("signal"),
                        "purpose": data.get("purpose", "webcam"),
                    })

            elif event == "call_end":
                chat_id = data.get("chat_id")
                manager.active_calls.get(chat_id, set()).discard(user_id)
                if not manager.active_calls.get(chat_id):
                    manager.active_calls.pop(chat_id, None)
                await manager.broadcast_to_chat(chat_id, {
                    "type": "call_end",
                    "from_user_id": user_id,
                    "chat_id": chat_id,
                }, exclude_user=user_id)

    except WebSocketDisconnect:
        # Update last_seen
        sender_result = await db.execute(select(User).where(User.id == user_id))
        user_obj = sender_result.scalar_one_or_none()
        if user_obj:
            user_obj.last_seen = datetime.now(timezone.utc)
            await db.commit()

        manager.disconnect(user_id, chat_ids)
        # Remove from any active calls + notify
        active_call_chats = [cid for cid, users in manager.active_calls.items() if user_id in users]
        for cid in active_call_chats:
            manager.active_calls[cid].discard(user_id)
            if not manager.active_calls[cid]:
                manager.active_calls.pop(cid, None)
            await manager.broadcast_to_chat(cid, {
                "type": "call_end",
                "from_user_id": user_id,
                "chat_id": cid,
            }, exclude_user=user_id)
        # Broadcast offline status
        for cid in chat_ids:
            await manager.broadcast_to_chat(cid, {
                "type": "user_offline",
                "user_id": user_id,
            })


def count_grammar_errors(text: str) -> int:
    """Simple Russian grammar error counter - dictionary-based."""
    import re
    if not text:
        return 0
    errors = 0
    lower = text.lower()
    # Common misspellings
    patterns = [
        r'\bчто\s?бы\b(?!\s+(?:было|было|будет|стало))',  # чтобы vs что бы
        r'\bтоже\s+(?:самое|самая)\b',  # то же самое
        r'\bпо(?:чему|тому)\s+что\b',  # false positive check
        r'жы|шы|чя|щя|чю|щю',  # жи-ши правило
        r'\bне\s?знаю\b',  # just count usage
    ]
    # Count stupid patterns
    stupid = [
        r'\bща\b', r'\bщас\b', r'\bчо\b', r'\bчё\b', r'\bтя\b',
        r'\bпоч\b', r'\bспс\b', r'\bнзч\b', r'\bкстат\b',
    ]
    for p in patterns[:4]:
        errors += len(re.findall(p, lower))
    for p in stupid:
        errors += len(re.findall(p, lower))
    return errors


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
    )
    db.add(msg)

    # Count grammar errors
    errors = count_grammar_errors(content)
    if errors > 0:
        sender.grammar_errors = (sender.grammar_errors or 0) + errors

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
        "is_edited": False,
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
