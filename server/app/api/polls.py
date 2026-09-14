"""Опросы в чатах + закрепы сообщений.

Опросы (требование хозяина — участники ДОПИСЫВАЮТ свои варианты):
носитель — обычное сообщение `/poll {id}`, создаётся ТОЛЬКО сервером в
одной транзакции с опросом. Рукописный маркер режется щитами грабли №6
(ws message/edit + caption файла): с СУЩЕСТВУЮЩИМ опросом чата он
рисовал бы вторую живую карточку от чужого имени; несуществующий
клиент и так показывает текстом (сверка poll.chat_id).
Живые обновления — WS `poll_updated` с ПОЛНЫМ PollOut (просто и
надёжно; опросы редкие, трафик копеечный).

Закрепы: несколько на чат, плашка у клиентов показывает последний.
Права: в группах — создатель чата и админы (admin_ids), в ЛС — оба
участника. WS `chat_pins` шлёт весь список после каждого изменения.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User, Chat, Message, chat_members,
    Poll, PollOption, PollVote, PinnedMessage,
)
from app.auth import get_current_user
from app.ws.manager import manager

router = APIRouter(prefix="/api", tags=["polls"])

MAX_OPTIONS = 12
MAX_PINS = 20


async def _require_member(db: AsyncSession, chat_id: int, user_id: int) -> Chat:
    chat = await db.get(Chat, chat_id)
    if not chat:
        raise HTTPException(404, "Чат не найден")
    mem = await db.execute(
        select(chat_members.c.user_id).where(
            chat_members.c.chat_id == chat_id, chat_members.c.user_id == user_id
        )
    )
    if mem.first() is None:
        raise HTTPException(403, "Ты не в этом чате")
    return chat


def _is_chat_admin(chat: Chat, user_id: int) -> bool:
    if chat.created_by == user_id:
        return True
    try:
        return user_id in (json.loads(chat.admin_ids) if chat.admin_ids else [])
    except Exception:
        return False


# ======================= Опросы =======================

class PollCreate(BaseModel):
    question: str
    options: list[str]
    allow_multi: bool = False
    allow_add: bool = True


class OptionAdd(BaseModel):
    text: str


class VoteIn(BaseModel):
    option_id: int


async def _poll_out(db: AsyncSession, poll: Poll, me_id: int) -> dict:
    opts_res = await db.execute(
        select(PollOption).where(PollOption.poll_id == poll.id)
        .order_by(PollOption.position, PollOption.id)
    )
    options = list(opts_res.scalars().all())
    votes_res = await db.execute(
        select(PollVote.option_id, PollVote.user_id).where(PollVote.poll_id == poll.id)
    )
    votes = votes_res.all()
    by_opt: dict[int, list[int]] = {}
    mine: set[int] = set()
    voters: set[int] = set()
    for oid, uid in votes:
        by_opt.setdefault(oid, []).append(uid)
        voters.add(uid)
        if uid == me_id:
            mine.add(oid)

    uid_pool = {poll.created_by} | {o.created_by for o in options}
    names_res = await db.execute(select(User.id, User.username).where(User.id.in_(uid_pool)))
    names = {uid: uname for uid, uname in names_res.all()}

    return {
        "id": poll.id,
        "chat_id": poll.chat_id,
        "message_id": poll.message_id,
        "question": poll.question,
        "allow_multi": poll.allow_multi,
        "allow_add": poll.allow_add,
        "closed": poll.closed_at is not None,
        "created_by": poll.created_by,
        "creator": names.get(poll.created_by, "?"),
        "total_voters": len(voters),
        "options": [
            {
                "id": o.id,
                "text": o.text,
                "votes": len(by_opt.get(o.id, [])),
                # voter_ids — чтобы КАЖДОЕ устройство считало mine само:
                # бродкаст с mine=false затирал галочку у второго девайса,
                # и клик там РАЗВОРАЧИВАЛ действие (снимал голос)
                "voter_ids": sorted(by_opt.get(o.id, [])),
                "mine": o.id in mine,
                # Автора показываем только у ДОПИСАННЫХ вариантов
                "author": names.get(o.created_by) if o.created_by != poll.created_by else None,
            }
            for o in options
        ],
    }


async def _broadcast_poll(db: AsyncSession, poll: Poll) -> None:
    # mine в бродкасте не значим (me_id=0): каждое устройство считает своё
    # mine из voter_ids — иначе второй девайс терял галочку и клик там
    # разворачивал действие.
    out = await _poll_out(db, poll, me_id=0)
    await manager.broadcast_to_chat(poll.chat_id, {"type": "poll_updated", "poll": out})


@router.post("/chats/{chat_id}/polls")
async def create_poll(
    chat_id: int,
    data: PollCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chat = await _require_member(db, chat_id, current_user.id)
    if chat.is_notes:
        raise HTTPException(400, "В Заметках опрашивать некого 🙂")
    # Режим канала: писать (и опрашивать) может только создатель — тот же
    # гард, что у сообщений/файлов/пересылки
    if chat.is_group and not chat.allow_all_write and chat.created_by != current_user.id:
        raise HTTPException(403, "В канале опросы создаёт только создатель")
    q = data.question.strip()
    if not q:
        raise HTTPException(400, "Вопрос пустой")
    opts = [o.strip()[:100] for o in data.options if o.strip()]
    # Дедуп с сохранением порядка
    seen: set[str] = set()
    opts = [o for o in opts if not (o.lower() in seen or seen.add(o.lower()))]
    if len(opts) < 2:
        raise HTTPException(400, "Нужно минимум два разных варианта")
    if len(opts) > MAX_OPTIONS:
        raise HTTPException(400, f"Максимум {MAX_OPTIONS} вариантов")

    poll = Poll(
        chat_id=chat_id, question=q[:300],
        allow_multi=data.allow_multi, allow_add=data.allow_add,
        created_by=current_user.id,
    )
    db.add(poll)
    await db.flush()
    for i, text_ in enumerate(opts):
        db.add(PollOption(poll_id=poll.id, text=text_, position=i, created_by=current_user.id))

    msg = Message(chat_id=chat_id, sender_id=current_user.id, content=f"/poll {poll.id}")
    db.add(msg)
    await db.flush()
    poll.message_id = msg.id
    await db.commit()
    await db.refresh(msg)

    await manager.broadcast_to_chat(chat_id, {
        "type": "message",
        "id": msg.id,
        "chat_id": chat_id,
        "sender_id": current_user.id,
        "sender_username": current_user.username,
        "sender_avatar": current_user.avatar_url,
        "content": msg.content,
        "file_url": None, "file_name": None, "is_edited": False,
        "created_at": msg.created_at.isoformat(),
        "reply_to_id": None, "reply_to_username": None, "reply_to_content": None,
        "reactions": [],
    })

    # Пуш как у обычного сообщения (создание идёт мимо WS-хендлера)
    try:
        from app.push import send_push, should_throttle_message_push
        if not should_throttle_message_push(chat_id):
            mem_res = await db.execute(
                select(chat_members.c.user_id).where(
                    chat_members.c.chat_id == chat_id,
                    chat_members.c.user_id != current_user.id,
                )
            )
            recipients = [r[0] for r in mem_res.all()]
            # Для ЛС деп-линку мобилки нужен peer_user_id — иначе тап по
            # пушу откроет ЛС как группу (тот же расчёт, что в ws-хендлере)
            peer_user_id = None
            if not chat.is_group and recipients:
                peer_user_id = current_user.id
            title = chat.name if chat.is_group else current_user.username
            await send_push(
                db, recipients,
                title=title or "Опрос",
                body=f"📊 Опрос: {q[:80]}",
                data={"type": "message", "chat_id": chat_id, "message_id": msg.id,
                      "is_group": chat.is_group,
                      "peer_user_id": peer_user_id,
                      "chat_name": chat.name or current_user.username,
                      "notification_tag": f"chat-{chat_id}"},
                channel_id="messages",
            )
    except Exception as e:
        print(f"[polls] push failed: {type(e).__name__}: {e}")

    return await _poll_out(db, poll, current_user.id)


@router.get("/polls/{poll_id}")
async def get_poll(
    poll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    poll = await db.get(Poll, poll_id)
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    await _require_member(db, poll.chat_id, current_user.id)
    return await _poll_out(db, poll, current_user.id)


@router.post("/polls/{poll_id}/vote")
async def vote_poll(
    poll_id: int,
    data: VoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Тоггл голоса: повторный клик по своему варианту снимает его; при
    одиночном выборе голос переезжает на новый вариант."""
    # Лок опроса сериализует голоса/варианты/закрытие: без него дабл-клик
    # ловил IntegrityError→500, а параллельные голоса за разные варианты в
    # одиночном опросе оставляли ДВА голоса (delete не видит чужой
    # незакоммиченный insert под READ COMMITTED)
    poll = await db.get(Poll, poll_id, with_for_update=True)
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    await _require_member(db, poll.chat_id, current_user.id)
    if poll.closed_at is not None:
        raise HTTPException(400, "Опрос завершён")
    opt = await db.get(PollOption, data.option_id)
    if not opt or opt.poll_id != poll.id:
        raise HTTPException(400, "Нет такого варианта")

    existing = await db.execute(
        select(PollVote).where(
            PollVote.option_id == opt.id, PollVote.user_id == current_user.id
        )
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
    else:
        if not poll.allow_multi:
            await db.execute(
                delete(PollVote).where(
                    PollVote.poll_id == poll.id, PollVote.user_id == current_user.id
                )
            )
        db.add(PollVote(poll_id=poll.id, option_id=opt.id, user_id=current_user.id))
    try:
        await db.commit()
    except IntegrityError:
        # Ремень: гонка всё же проскочила (например, лок снят рестартом) —
        # трактуем как «уже учтено» и отдаём свежий снапшот
        await db.rollback()
        return await _poll_out(db, poll, current_user.id)

    await _broadcast_poll(db, poll)
    return await _poll_out(db, poll, current_user.id)


@router.post("/polls/{poll_id}/options")
async def add_option(
    poll_id: int,
    data: OptionAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Свой вариант — главная фишка по требованию хозяина."""
    poll = await db.get(Poll, poll_id, with_for_update=True)
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    await _require_member(db, poll.chat_id, current_user.id)
    if poll.closed_at is not None:
        raise HTTPException(400, "Опрос завершён")
    if not poll.allow_add:
        raise HTTPException(400, "В этом опросе свои варианты выключены")
    text_ = data.text.strip()[:100]
    if not text_:
        raise HTTPException(400, "Пустой вариант")

    opts_res = await db.execute(select(PollOption).where(PollOption.poll_id == poll.id))
    options = list(opts_res.scalars().all())
    if len(options) >= MAX_OPTIONS:
        raise HTTPException(400, f"Уже {MAX_OPTIONS} вариантов — хватит 🙂")
    if any(o.text.lower() == text_.lower() for o in options):
        raise HTTPException(400, "Такой вариант уже есть")

    db.add(PollOption(
        poll_id=poll.id, text=text_,
        position=max((o.position for o in options), default=-1) + 1,
        created_by=current_user.id,
    ))
    await db.commit()
    await _broadcast_poll(db, poll)
    return await _poll_out(db, poll, current_user.id)


@router.post("/polls/{poll_id}/close")
async def close_poll(
    poll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    poll = await db.get(Poll, poll_id, with_for_update=True)
    if not poll:
        raise HTTPException(404, "Опрос не найден")
    chat = await _require_member(db, poll.chat_id, current_user.id)
    # В группе — автор или админ чата; в ЛС — только автор («создатель
    # ЛС-чата» админом собеседниковых опросов не считается)
    if poll.created_by != current_user.id and not (chat.is_group and _is_chat_admin(chat, current_user.id)):
        raise HTTPException(403, "Завершить может автор опроса или админ чата")
    if poll.closed_at is None:
        poll.closed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_poll(db, poll)
    return await _poll_out(db, poll, current_user.id)


# ======================= Закрепы =======================

class PinIn(BaseModel):
    message_id: int


async def _pins_out(db: AsyncSession, chat_id: int) -> list[dict]:
    res = await db.execute(
        select(PinnedMessage, Message, User.username)
        .join(Message, Message.id == PinnedMessage.message_id)
        .join(User, User.id == Message.sender_id)
        .where(PinnedMessage.chat_id == chat_id)
        .order_by(PinnedMessage.pinned_at.desc())
    )
    out = []
    for pin, msg, sender in res.all():
        out.append({
            "message_id": msg.id,
            "content": msg.content,
            "file_name": msg.file_name,
            "sender_username": sender,
            "pinned_by": pin.pinned_by,
            "pinned_at": pin.pinned_at.isoformat(),
        })
    return out


def _can_pin(chat: Chat, user_id: int) -> bool:
    if not chat.is_group:
        return True  # в ЛС могут оба
    return _is_chat_admin(chat, user_id)


async def _broadcast_pins(db: AsyncSession, chat_id: int) -> None:
    await manager.broadcast_to_chat(chat_id, {
        "type": "chat_pins", "chat_id": chat_id, "pins": await _pins_out(db, chat_id),
    })


@router.get("/chats/{chat_id}/pins")
async def list_pins(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_member(db, chat_id, current_user.id)
    return await _pins_out(db, chat_id)


@router.post("/chats/{chat_id}/pin")
async def pin_message(
    chat_id: int,
    data: PinIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chat = await _require_member(db, chat_id, current_user.id)
    if not _can_pin(chat, current_user.id):
        raise HTTPException(403, "Закреплять в группе могут создатель и админы")
    msg = await db.get(Message, data.message_id)
    if not msg or msg.chat_id != chat_id:
        raise HTTPException(404, "Сообщение не из этого чата")
    count = (await db.execute(
        select(func.count(PinnedMessage.id)).where(PinnedMessage.chat_id == chat_id)
    )).scalar_one()
    if count >= MAX_PINS:
        raise HTTPException(400, f"Максимум {MAX_PINS} закрепов — открепи что-нибудь")
    exists = await db.execute(
        select(PinnedMessage.id).where(
            PinnedMessage.chat_id == chat_id, PinnedMessage.message_id == msg.id
        )
    )
    if exists.first() is None:
        db.add(PinnedMessage(chat_id=chat_id, message_id=msg.id, pinned_by=current_user.id))
        await db.commit()
        await _broadcast_pins(db, chat_id)
    return await _pins_out(db, chat_id)


@router.delete("/chats/{chat_id}/pin/{message_id}")
async def unpin_message(
    chat_id: int,
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chat = await _require_member(db, chat_id, current_user.id)
    if not _can_pin(chat, current_user.id):
        raise HTTPException(403, "Открепить в группе могут создатель и админы")
    await db.execute(
        delete(PinnedMessage).where(
            PinnedMessage.chat_id == chat_id, PinnedMessage.message_id == message_id
        )
    )
    await db.commit()
    await _broadcast_pins(db, chat_id)
    return await _pins_out(db, chat_id)
