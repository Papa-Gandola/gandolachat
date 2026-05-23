from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta, timezone
import asyncio
from app.models import Chat, Message, User, Reaction, read_receipts, chat_members
from app.ws.manager import manager
from app.config import settings


# asyncio only keeps WEAK references to tasks created via create_task — if no
# one holds a strong ref, a sleeping task can be GC'd before it fires. This
# bit us: a folded hand scheduled the next-hand timer, function returned, task
# got collected, next hand never started. Hold strong refs here until done.
_bg_tasks: set[asyncio.Task] = set()

def _spawn(coro):
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return t


async def websocket_endpoint(websocket: WebSocket, user_id: int, db: AsyncSession):
    # Load user's chat IDs
    result = await db.execute(
        select(Chat).join(Chat.members).where(User.id == user_id)
    )
    chats = result.scalars().all()
    chat_ids = [c.id for c in chats]

    is_first_connection = await manager.connect(websocket, user_id, chat_ids)

    # Broadcast online status only when this is the user's first device — avoids
    # spurious "online" flaps when they open a second device.
    if is_first_connection:
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
                    # Verify the sender is actually a member of the target chat —
                    # without this any logged-in user could push messages anywhere.
                    membership = await db.execute(
                        select(Chat).join(Chat.members).where(
                            Chat.id == target_chat_id, User.id == user_id
                        )
                    )
                    target_chat = membership.scalar_one_or_none()
                    if target_chat is None:
                        continue
                    # Channel mode: only creator can post
                    if target_chat.is_group and not target_chat.allow_all_write and target_chat.created_by != user_id:
                        continue
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

            elif event == "poker_action":
                await handle_poker_action(data, user_id, db)

            elif event == "poker_request_state":
                from app.poker_game import game_store, public_view
                table_id = data.get("table_id")
                g = game_store.get(table_id) if table_id else None
                if g and user_id in g.players:
                    await manager.send_to_user(user_id, {
                        "type": "poker_game_state",
                        "table_id": table_id,
                        "state": public_view(g, user_id),
                    })

            elif event == "call_signal":
                target_id = data.get("target_user_id")
                chat_id = data.get("chat_id")
                if target_id and chat_id:
                    # Verify target is a member of the chat.
                    # chat_users is an in-memory cache populated at connect-time
                    # and on join/add_member. It can drift in corner cases —
                    # rapid mobile reconnects, partial multi-device disconnect,
                    # a member added while their other socket holds an older
                    # chat_ids snapshot. When the cache says "not subscribed",
                    # consult the DB before giving up — if they really are a
                    # member, repair the cache and pass the signal through.
                    if target_id not in manager.chat_users.get(chat_id, set()):
                        membership = await db.execute(
                            select(chat_members.c.user_id).where(
                                chat_members.c.chat_id == chat_id,
                                chat_members.c.user_id == target_id,
                            ).limit(1)
                        )
                        if not membership.first():
                            print(f"[ws][call_signal] dropped: target={target_id} NOT a member of chat={chat_id} (sender={user_id})")
                            continue
                        # Cache was stale — heal it. send_to_user is a no-op if
                        # the target has no active sockets, which is fine.
                        manager.chat_users[chat_id].add(target_id)
                        print(f"[ws][call_signal] healed stale chat_users for target={target_id} chat={chat_id}")
                    # Check DM call limit (max 2 participants)
                    chat_result = await db.execute(
                        select(Chat).where(Chat.id == chat_id)
                    )
                    chat_obj = chat_result.scalar_one_or_none()
                    if chat_obj and not chat_obj.is_group:
                        active = manager.active_calls.get(chat_id, set())
                        if len(active) >= 2 and user_id not in active:
                            continue  # DM call full, reject
                    is_new_to_call = user_id not in manager.active_calls[chat_id]
                    manager.active_calls[chat_id].add(user_id)
                    # Track call meta for history
                    just_created_meta = chat_id not in manager.call_meta
                    if just_created_meta:
                        import time as _t
                        manager.call_meta[chat_id] = {
                            "started_at": _t.time(),
                            "initiator": user_id,
                            "all_participants": {user_id},
                            "answered": False,
                        }
                    meta = manager.call_meta[chat_id]
                    meta["all_participants"].add(user_id)
                    if is_new_to_call and user_id != meta["initiator"]:
                        meta["answered"] = True
                    # If this was the very first signal of the call, schedule a 60-sec
                    # "missed" timeout — finalises the call as missed if nobody picks up.
                    if just_created_meta:
                        async def _missed_timeout(_chat_id: int, _db: AsyncSession):
                            await asyncio.sleep(60)
                            m = manager.call_meta.get(_chat_id)
                            if not m:
                                return  # call already ended for another reason
                            if m.get("answered"):
                                return  # someone picked up before the timeout
                            # Force-end the call as missed
                            for uid in list(manager.active_calls.get(_chat_id, set())):
                                await manager.send_to_user(uid, {
                                    "type": "call_end",
                                    "from_user_id": m["initiator"],
                                    "chat_id": _chat_id,
                                    "timeout": True,
                                })
                            manager.active_calls.pop(_chat_id, None)
                            await _persist_call_record(_chat_id, _db, ended_by=m["initiator"], declined=False)
                        # Use a fresh session — the handler's `db` may close before 60s
                        from app.database import AsyncSessionLocal as _ASL
                        async def _wrap():
                            async with _ASL() as session:
                                await _missed_timeout(chat_id, session)
                        _spawn(_wrap())
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
                        "role": data.get("role"),
                    })

            elif event == "call_end":
                chat_id = data.get("chat_id")
                declined = bool(data.get("declined"))
                manager.active_calls.get(chat_id, set()).discard(user_id)
                if not manager.active_calls.get(chat_id):
                    manager.active_calls.pop(chat_id, None)
                    # Last person left → finalise the call and persist a history record
                    await _persist_call_record(chat_id, db, ended_by=user_id, declined=declined)
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

        # Only this socket goes away; the user may still be connected from
        # another device. fully_offline is True only when no sockets remain.
        fully_offline = manager.disconnect(user_id, chat_ids, websocket)

        if fully_offline:
            # Remove from any active calls + notify
            active_call_chats = [cid for cid, users in manager.active_calls.items() if user_id in users]
            for cid in active_call_chats:
                manager.active_calls[cid].discard(user_id)
                became_empty = not manager.active_calls.get(cid)
                if became_empty:
                    manager.active_calls.pop(cid, None)
                    await _persist_call_record(cid, db, ended_by=user_id, declined=False)
                await manager.broadcast_to_chat(cid, {
                    "type": "call_end",
                    "from_user_id": user_id,
                    "chat_id": cid,
                }, exclude_user=user_id)
            # Broadcast offline status
            last_seen_iso = user_obj.last_seen.isoformat() if user_obj and user_obj.last_seen else None
            for cid in chat_ids:
                await manager.broadcast_to_chat(cid, {
                    "type": "user_offline",
                    "user_id": user_id,
                    "last_seen": last_seen_iso,
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
    temp_id = data.get("_temp_id")  # client-supplied correlation id, echoed back

    if not chat_id or not content:
        return

    result = await db.execute(
        select(Chat).join(Chat.members).where(Chat.id == chat_id, User.id == sender_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        return

    # Channel mode: only the creator can post in a group whose allow_all_write is off.
    if chat.is_group and not chat.allow_all_write and chat.created_by != sender_id:
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
        "_temp_id": temp_id,
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


async def handle_poker_action(data: dict, user_id: int, db: AsyncSession):
    """Apply a poker action and broadcast updated state to all seated players."""
    from app.poker_game import game_store, apply_action, ActionError, start_hand, public_view
    from app.models import PokerTable, PokerSeat
    from sqlalchemy.orm import selectinload

    table_id = data.get("table_id")
    action = data.get("action")
    amount = int(data.get("amount") or 0)
    if not table_id or not action:
        return
    g = game_store.get(table_id)
    if not g:
        await manager.send_to_user(user_id, {
            "type": "poker_error",
            "table_id": table_id,
            "message": "Игра не запущена",
        })
        return
    try:
        result = apply_action(g, user_id, action, amount)
    except ActionError as e:
        await manager.send_to_user(user_id, {
            "type": "poker_error",
            "table_id": table_id,
            "message": str(e),
        })
        return

    # Broadcast new individualised game state to all seated players
    for uid in g.players.keys():
        await manager.send_to_user(uid, {
            "type": "poker_game_state",
            "table_id": table_id,
            "state": public_view(g, uid),
        })

    # Fast-forward: if everyone still in the hand is all-in, deal remaining streets
    # one at a time with a short pause between them so the UI shows cards appearing.
    from app.poker_game import needs_fast_forward, deal_next_street_or_finish
    if needs_fast_forward(g):
        async def _ff():
            try:
                # Small initial pause before the first reveal so the last action stays on screen
                await asyncio.sleep(0.7)
                while True:
                    live = game_store.get(table_id)
                    if live is not g or g.finished:
                        return
                    if g.hand is None or g.hand.street == "done":
                        return
                    deal_next_street_or_finish(g)
                    for uid in g.players.keys():
                        await manager.send_to_user(uid, {
                            "type": "poker_game_state",
                            "table_id": table_id,
                            "state": public_view(g, uid),
                        })
                    if g.hand and g.hand.street == "done":
                        # Hand-end path below in the regular flow handles stacks/next hand,
                        # but we're inside a background task so we need to do it ourselves.
                        await _finish_hand_and_maybe_next(table_id, g)
                        return
                    await asyncio.sleep(0.85)
            except Exception as exc:
                print(f"[poker] fast-forward task failed: {exc}")
        _spawn(_ff())
        return  # don't run the normal "hand ended" branch — _ff() will do it

    # Hand ended via the normal action flow (someone folded, or final showdown).
    if g.hand and g.hand.street == "done":
        await _finish_hand_and_maybe_next(table_id, g, db=db)


async def _finish_hand_and_maybe_next(table_id: int, g, db=None):
    """Persist stacks, end tournament if only one player has chips left, otherwise
    schedule the next hand. Safe to call from a background task (opens its own
    DB session if `db` is not provided)."""
    from app.database import AsyncSessionLocal
    from app.poker_game import start_hand, game_store, public_view
    from sqlalchemy import select as _select
    from app.models import PokerSeat as _PokerSeat, PokerTable as _PokerTable

    own_session = db is None
    if own_session:
        db = AsyncSessionLocal()
    try:
        rows = await db.execute(_select(_PokerSeat).where(_PokerSeat.table_id == table_id))
        seats = rows.scalars().all()
        for seat in seats:
            p = g.players.get(seat.user_id)
            if p:
                seat.stack = p.stack
                if p.stack <= 0:
                    seat.is_active = False
        await db.commit()

        alive = [p for p in g.players.values() if p.stack > 0]
        if len(alive) <= 1:
            g.finished = True
            g.winner_user_id = alive[0].user_id if alive else None
            t_rows = await db.execute(_select(_PokerTable).where(_PokerTable.id == table_id))
            t = t_rows.scalar_one_or_none()
            if t:
                t.status = "finished"
                from datetime import datetime as _dt, timezone as _tz
                t.finished_at = _dt.now(_tz.utc)
                await db.commit()
            for uid in g.players.keys():
                await manager.send_to_user(uid, {
                    "type": "poker_game_state",
                    "table_id": table_id,
                    "state": public_view(g, uid),
                })
            return

        # Schedule the next hand after a short pause. The pause is longer at showdown
        # (5s — players want to see who had what) and shorter on uncalled wins (3s).
        wait = 5.0 if (g.last_summary and g.last_summary.get("reason") == "showdown") else 3.0
        async def _next():
            try:
                await asyncio.sleep(wait)
                live = game_store.get(table_id)
                if live is not g or g.finished:
                    return
                start_hand(g)
                for uid in g.players.keys():
                    await manager.send_to_user(uid, {
                        "type": "poker_game_state",
                        "table_id": table_id,
                        "state": public_view(g, uid),
                    })
            except Exception as exc:
                print(f"[poker] next-hand task failed: {exc}")
        _spawn(_next())
    finally:
        if own_session:
            await db.close()


async def _persist_call_record(chat_id: int, db: AsyncSession, ended_by: int, declined: bool):
    """Drop a system message into the chat describing how the call ended.
    Content format: /call_record kind|duration_seconds|participant_count|initiator_id
    kind ∈ {completed, missed, declined, cancelled}.
    Reads + pops manager.call_meta[chat_id] so each call produces exactly one record."""
    import time as _t
    meta = manager.call_meta.pop(chat_id, None)
    if not meta:
        return
    started_at = meta["started_at"]
    initiator = meta["initiator"]
    answered = meta["answered"]
    participants = meta["all_participants"]
    duration = max(0, int(_t.time() - started_at))

    if not answered:
        # Nobody besides the caller joined → either they hung up (cancelled) or
        # the receiver pressed Reject (declined). DMs use declined flag from client.
        kind = "declined" if declined else ("cancelled" if ended_by == initiator else "missed")
    else:
        kind = "completed"

    content = f"/call_record {kind}|{duration}|{len(participants)}|{initiator}"
    sender_result = await db.execute(select(User).where(User.id == initiator))
    sender = sender_result.scalar_one_or_none()
    if not sender:
        return
    msg = Message(chat_id=chat_id, sender_id=initiator, content=content)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    await manager.broadcast_to_chat(chat_id, {
        "type": "message",
        "id": msg.id,
        "chat_id": chat_id,
        "sender_id": initiator,
        "sender_username": sender.username,
        "sender_avatar": sender.avatar_url,
        "content": content,
        "file_url": None,
        "file_name": None,
        "is_edited": False,
        "created_at": msg.created_at.isoformat(),
        "reply_to_id": None,
        "reply_to_username": None,
        "reply_to_content": None,
        "_temp_id": None,
    })
