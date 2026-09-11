"""«Заметки» — личный чат «сам с собой» + напоминания.

Чат — обычный Chat с is_notes=True и единственным участником, создаётся
лениво (GET /api/chats/notes), дальше живёт как любой другой (сообщения,
файлы, поиск). Напоминание = строка в reminders + карточка `/reminder
{json}` в Заметках. В срок джоба (каждые 30с) постит «⏰ текст» в Заметки,
помечает карточку сработавшей и шлёт Web Push (PWA-айфоны и открытые
вкладки). Expo-пуш НАРОЧНО не шлём: нативный андроид планирует ЛОКАЛЬНОЕ
уведомление сам при создании/ресинке — оно срабатывает БЕЗ интернета,
а серверный пуш давал бы дубль.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db, AsyncSessionLocal
from app.auth import get_current_user
from app.models import User, Chat, Message, Reminder, chat_members
from app.schemas import ChatOut, UserOut
from app.ws.manager import manager

router = APIRouter()

MAX_PENDING = 50


async def _get_or_create_notes_chat(db: AsyncSession, user: User) -> Chat:
    async def _find() -> Chat | None:
        res = await db.execute(
            select(Chat)
            .options(selectinload(Chat.members))
            .where(Chat.is_notes == True, Chat.created_by == user.id)  # noqa: E712
            .order_by(Chat.id)
            .limit(1)
        )
        return res.scalar_one_or_none()

    chat = await _find()
    if chat is None:
        chat = Chat(name="Заметки", is_group=False, is_notes=True, created_by=user.id)
        db.add(chat)
        try:
            await db.flush()
            await db.execute(chat_members.insert().values(chat_id=chat.id, user_id=user.id))
            await db.commit()
        except IntegrityError:
            # Гонка двух устройств: уникальный частичный индекс (0007) пустил
            # только одного — забираем чат победителя.
            await db.rollback()
            chat = await _find()
            if chat is None:
                raise HTTPException(500, "Не получилось создать Заметки")
        else:
            res = await db.execute(
                select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat.id)
            )
            chat = res.scalar_one()
    # КРИТИЧНО: живые сокеты юзера подключались ДО появления этого чата и в
    # manager.chat_users его нет — без join_chat все бродкасты (эхо сообщений,
    # карточки, «⏰») уходили бы в никуда до самого реконнекта.
    manager.join_chat(user.id, chat.id)
    return chat


@router.get("/api/chats/notes", response_model=ChatOut)
async def open_notes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chat = await _get_or_create_notes_chat(db, current_user)
    from app.api.chats import _get_last_message  # локальный импорт — избегаем цикла
    last = await _get_last_message(chat.id, db)
    return ChatOut(
        id=chat.id, name=chat.name, is_group=False, created_by=chat.created_by,
        members=[UserOut.model_validate(m) for m in chat.members],
        last_message=last, is_notes=True,
    )


class ReminderIn(BaseModel):
    text: str
    remind_at: datetime


def _reminder_marker(r_id: int, text: str, remind_at: datetime, fired: bool) -> str:
    return "/reminder " + json.dumps(
        {"id": r_id, "text": text, "remind_at": remind_at.isoformat(), "fired": fired},
        ensure_ascii=False,
    )


def _message_payload(msg: Message, sender: User) -> dict:
    return {
        "type": "message",
        "id": msg.id,
        "chat_id": msg.chat_id,
        "sender_id": sender.id,
        "sender_username": sender.username,
        "sender_avatar": sender.avatar_url,
        "content": msg.content,
        "file_url": None,
        "file_name": None,
        "is_edited": False,
        "created_at": msg.created_at.isoformat(),
        "reply_to_id": None,
        "reply_to_username": None,
        "reply_to_content": None,
        "_temp_id": None,
    }


@router.post("/api/notes/reminders")
async def create_reminder(
    body: ReminderIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Пустое напоминание")
    if len(text) > 500:
        raise HTTPException(400, "Слишком длинно (до 500 символов)")
    remind_at = body.remind_at
    if remind_at.tzinfo is None:
        remind_at = remind_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if remind_at <= now:
        raise HTTPException(400, "Время уже прошло")
    pending_res = await db.execute(
        select(Reminder.id).where(Reminder.user_id == current_user.id, Reminder.fired == False)  # noqa: E712
    )
    if len(pending_res.all()) >= MAX_PENDING:
        raise HTTPException(400, f"Слишком много активных напоминаний (макс. {MAX_PENDING})")

    chat = await _get_or_create_notes_chat(db, current_user)
    reminder = Reminder(user_id=current_user.id, text=text, remind_at=remind_at)
    db.add(reminder)
    await db.flush()
    msg = Message(
        chat_id=chat.id,
        sender_id=current_user.id,
        content=_reminder_marker(reminder.id, text, remind_at, fired=False),
    )
    db.add(msg)
    await db.flush()
    reminder.message_id = msg.id
    await db.commit()
    await db.refresh(msg)
    # На все свои устройства — карточка появляется везде сразу.
    await manager.broadcast_to_chat(chat.id, _message_payload(msg, current_user))
    return {
        "id": reminder.id,
        "text": text,
        "remind_at": remind_at.isoformat(),
        "message_id": msg.id,
        "chat_id": chat.id,
    }


@router.get("/api/notes/reminders")
async def list_reminders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Несработавшие напоминания — натив ресинкает по ним локальные
    уведомления (покрывает созданные с других устройств)."""
    res = await db.execute(
        select(Reminder)
        .where(Reminder.user_id == current_user.id, Reminder.fired == False)  # noqa: E712
        .order_by(Reminder.remind_at)
    )
    return [
        {"id": r.id, "text": r.text, "remind_at": r.remind_at.isoformat()}
        for r in res.scalars().all()
    ]


@router.delete("/api/notes/reminders/{reminder_id}")
async def cancel_reminder(
    reminder_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    r = await db.get(Reminder, reminder_id)
    if not r or r.user_id != current_user.id:
        raise HTTPException(404, "Напоминание не найдено")
    if r.fired:
        raise HTTPException(400, "Уже сработало")
    msg_id, msg_chat = None, None
    if r.message_id:
        msg = await db.get(Message, r.message_id)
        if msg:
            msg_id, msg_chat = msg.id, msg.chat_id
            await db.delete(msg)
    await db.delete(r)
    await db.commit()
    if msg_id and msg_chat:
        await manager.broadcast_to_chat(msg_chat, {
            "type": "message_deleted",
            "message_id": msg_id,
            "chat_id": msg_chat,
        })
    return {"ok": True}


async def fire_due_reminders():
    """Джоба (каждые 30с): созревшие напоминания → «⏰ …» в Заметки,
    карточка помечается сработавшей, юзеру летит Web Push.

    Порядок ВАЖЕН: каждое напоминание — атомарный UPDATE-захват (гонка с
    отменой = 0 строк = скип), КОММИТ и только потом бродкасты/пуш. Иначе
    клиент успевал mark_read по незакоммиченному сообщению (FK-взрыв ронял
    его сокет), а StaleData от параллельной отмены откатывал весь батч и
    дублировал «⏰» всем остальным на следующем тике."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        res = await db.execute(
            select(Reminder.id, Reminder.user_id, Reminder.text, Reminder.message_id, Reminder.remind_at)
            .where(Reminder.fired == False, Reminder.remind_at <= now)  # noqa: E712
            .order_by(Reminder.remind_at)
            .limit(100)
        )
        snaps = [tuple(row) for row in res.all()]
        if not snaps:
            return
        for rid, uid, text, mid, at in snaps:
            try:
                # Атомарный захват: параллельная отмена уже удалила строку →
                # rowcount 0 → пропускаем без сайд-эффектов.
                claimed = await db.execute(
                    update(Reminder)
                    .where(Reminder.id == rid, Reminder.fired == False)  # noqa: E712
                    .values(fired=True)
                )
                if claimed.rowcount != 1:
                    await db.commit()
                    continue
                user = await db.get(User, uid)
                if not user:
                    await db.commit()
                    continue
                chat_res = await db.execute(
                    select(Chat)
                    .where(Chat.is_notes == True, Chat.created_by == uid)  # noqa: E712
                    .order_by(Chat.id)
                    .limit(1)
                )
                chat = chat_res.scalar_one_or_none()
                fired_payload = None
                edited_payload = None
                if chat:
                    fired_msg = Message(chat_id=chat.id, sender_id=uid, content=f"⏰ {text}")
                    db.add(fired_msg)
                    await db.flush()
                    fired_payload = _message_payload(fired_msg, user)
                    # Флаг для клиентов: «своё» сообщение, но уведомить надо
                    # (иначе на десктопе срабатывание было бы немым).
                    fired_payload["reminder_fired"] = True
                    if mid:
                        card = await db.get(Message, mid)
                        if card and card.content.startswith("/reminder "):
                            card.content = _reminder_marker(rid, text, at, fired=True)
                            edited_payload = {
                                "type": "message_edited",
                                "message_id": mid,
                                "chat_id": chat.id,
                                "content": card.content,
                            }
                await db.commit()
                if chat and fired_payload:
                    await manager.broadcast_to_chat(chat.id, fired_payload)
                if edited_payload:
                    await manager.broadcast_to_chat(edited_payload["chat_id"], edited_payload)
                from app.webpush import send_web_push
                await send_web_push(
                    db, [uid], "⏰ Напоминание", text,
                    data={"type": "reminder", "chat_id": chat.id if chat else None},
                    tag=f"reminder-{rid}",
                )
            except Exception as e:
                try:
                    await db.rollback()
                except Exception:
                    pass
                print(f"[notes] fire reminder {rid} failed: {type(e).__name__}: {e}")
