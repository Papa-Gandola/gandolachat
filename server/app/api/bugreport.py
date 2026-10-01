"""«Нашёл баг, отправить логи» (просьба хозяина 02.10).

Клиент шлёт описание словами + хвост своей консоли (services/logbuffer.ts
на десктопе, services/logBuffer.ts на мобилке) + мету (версия, платформа).
Сервер кладёт всё в текстовый файл `bugreport_<ник>_<время>.txt` в
uploads/files и ОТ ИМЕНИ репортёра постит его файловым сообщением в ЛС
каждому получателю (если получатель сам репортит — в его Заметки).
Получатели — `BUG_REPORT_TO` из env (ники/id через запятую; просьба
хозяина 02.10: админов два, репорты нужны только ему), пусто = все
админы; никто из списка не найден — лог и фолбэк на админов (опечатка в
.env не должна молча глотать репорты). Ничего выкачивать с устройства не
надо: файл лежит в чате, хозяин скачивает и пересылает Клоду. Пуш
получателю — без троттлинга.

ЛС ищется/создаётся общей chats.get_or_create_dm; репортёру тоже летит
new_chat (ревью 02.10: десктоп узнаёт о чатах только по этому событию, без
него новое ЛС и ответ хозяина в нём не появлялись до перезапуска).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import Message, User
from app.ws.manager import manager

router = APIRouter(prefix="/api/users", tags=["bugreport"])

LOG_MAX_CHARS = 1_500_000   # ~1.5 МБ текста; буферы клиентов на порядок меньше
NOTE_MAX = 500
META_MAX_KEYS = 40


class BugReportIn(BaseModel):
    note: str = ""              # что случилось — словами
    log: str = ""               # хвост консоли/событий клиента
    meta: dict = {}             # версия, платформа, юзер-агент — собирает клиент


def _clean(s: str) -> str:
    """Клиенты режут строки по UTF-16 (slice), и в JSON может приехать
    половинка эмодзи — одинокий суррогат. Postgres и запись файла в UTF-8
    на нём падают, поэтому заменяем на «?» (ревью 02.10)."""
    return s.encode("utf-8", "replace").decode("utf-8")


def _wanted() -> tuple[list[str], list[int]]:
    """BUG_REPORT_TO → (ники в нижнем регистре, числовые id)."""
    names: list[str] = []
    ids: list[int] = []
    for part in (settings.BUG_REPORT_TO or "").split(","):
        part = part.strip()
        if not part:
            continue
        if part.isdigit():
            ids.append(int(part))
        else:
            names.append(part.lower())
    return names, ids


async def _recipients(db: AsyncSession) -> list[User]:
    """Кому слать: список из BUG_REPORT_TO (только одобренные), иначе — или
    если никто из списка не нашёлся — все одобренные админы."""
    names, ids = _wanted()
    if names or ids:
        conds = []
        if names:
            conds.append(func.lower(User.username).in_(names))
        if ids:
            conds.append(User.id.in_(ids))
        res = await db.execute(
            select(User).where(User.is_approved.is_(True), or_(*conds)).order_by(User.id)
        )
        found = list(res.scalars().all())
        if found:
            return found
        print(f"[bugreport] BUG_REPORT_TO={settings.BUG_REPORT_TO!r}: никто не найден — шлю всем админам")
    res = await db.execute(
        select(User).where(User.is_admin.is_(True), User.is_approved.is_(True)).order_by(User.id)
    )
    return list(res.scalars().all())


@router.post("/bug-report")
async def send_bug_report(
    data: BugReportIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.chats import _message_out, get_or_create_dm

    recipients = await _recipients(db)
    if not recipients:
        raise HTTPException(503, "Некому отправить: получателей нет")

    note = _clean(data.note.strip()[:NOTE_MAX])
    log = _clean((data.log or "")[-LOG_MAX_CHARS:])
    now = datetime.now(timezone.utc)
    # \w в Python юникодный — кириллический ник остаётся в имени файла
    safe_user = re.sub(r"[^\w-]+", "_", current_user.username)[:24].strip("_") or f"u{current_user.id}"
    file_name = f"bugreport_{safe_user}_{now.strftime('%Y%m%d-%H%M%S')}.txt"

    upload_dir = Path(settings.UPLOAD_DIR) / "files"
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4()}.txt"
    header = [
        "GandolaChat bug report",
        f"from: {current_user.username} (id {current_user.id})",
        f"at: {now.isoformat()}",
        f"note: {note or '—'}",
    ]
    for i, (k, v) in enumerate((data.meta or {}).items()):
        if i >= META_MAX_KEYS:
            break
        header.append(_clean(f"{str(k)[:40]}: {str(v)[:300]}"))
    header += ["", "=== log ===", ""]
    async with aiofiles.open(upload_dir / stored, "w", encoding="utf-8", errors="replace") as f:
        await f.write("\n".join(header) + log)

    content = f"🐞 Баг-репорт: {note}" if note else "🐞 Баг-репорт"
    chat_ids: list[int] = []
    for rcpt in recipients:
        if rcpt.id == current_user.id:
            from app.notes import _get_or_create_notes_chat
            chat = await _get_or_create_notes_chat(db, current_user)
            fresh = True  # лениво созданные Заметки десктоп мог ещё не видеть
        else:
            chat, fresh = await get_or_create_dm(db, current_user, rcpt)
        msg = Message(
            chat_id=chat.id, sender_id=current_user.id, content=content,
            file_url=f"/uploads/files/{stored}", file_name=file_name,
        )
        db.add(msg)
        await db.commit()
        msg = (await db.execute(
            select(Message)
            .options(selectinload(Message.sender), selectinload(Message.reply_to).selectinload(Message.sender),
                     selectinload(Message.reactions))
            .where(Message.id == msg.id)
        )).scalar_one()
        if fresh:
            # Десктоп добавляет чаты в сайдбар только по new_chat (chatApi.list)
            await manager.send_to_user(current_user.id, {"type": "new_chat", "chat_id": chat.id})
        await manager.broadcast_to_chat(chat.id, {"type": "message", **_message_out(msg).model_dump(mode="json")})
        chat_ids.append(chat.id)
        if rcpt.id != current_user.id:
            try:
                from app.push import send_push
                await send_push(
                    db, [rcpt.id],
                    title=f"🐞 Баг-репорт от {current_user.username}",
                    body=note or "Логи приложены — файл в личке",
                    data={"type": "message", "chat_id": chat.id, "message_id": msg.id,
                          "is_group": False, "chat_name": current_user.username,
                          "peer_user_id": current_user.id,
                          "notification_tag": f"bug-{chat.id}"},
                    channel_id="messages", priority="high",
                )
            except Exception as e:
                print(f"[bugreport] push failed: {type(e).__name__}: {e}")
    print(f"[bugreport] {current_user.username}: {file_name} → chats {chat_ids}")
    return {"ok": True, "chat_ids": chat_ids, "file_name": file_name}
