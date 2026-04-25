from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from pydantic import BaseModel
from app.database import get_db
from app.models import User, Chat, PokerTable, PokerSeat, Message
from app.auth import get_current_user
from app.ws.manager import manager
from app.poker_game import game_store, new_game, start_hand, public_view

router = APIRouter(prefix="/api/poker", tags=["poker"])


# === Schemas ===
class PokerSeatOut(BaseModel):
    id: int
    user_id: int
    username: str
    avatar_url: str | None
    seat_index: int
    stack: int
    is_active: bool

    class Config:
        from_attributes = True


class PokerTableOut(BaseModel):
    id: int
    chat_id: int
    created_by: int
    status: str
    starting_stack: int
    starting_small_blind: int
    starting_big_blind: int
    blind_increase_minutes: int
    max_seats: int
    seats: list[PokerSeatOut]
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class CreateTableIn(BaseModel):
    chat_id: int
    max_seats: int = 6


# === Helpers ===
async def _table_to_out(db: AsyncSession, table: PokerTable) -> PokerTableOut:
    # Pull usernames + avatars for each seat in one go
    user_ids = [s.user_id for s in table.seats]
    users_by_id: dict[int, User] = {}
    if user_ids:
        rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in rows.scalars():
            users_by_id[u.id] = u
    seats = [
        PokerSeatOut(
            id=s.id,
            user_id=s.user_id,
            username=users_by_id.get(s.user_id).username if users_by_id.get(s.user_id) else "?",
            avatar_url=users_by_id.get(s.user_id).avatar_url if users_by_id.get(s.user_id) else None,
            seat_index=s.seat_index,
            stack=s.stack,
            is_active=s.is_active,
        )
        for s in sorted(table.seats, key=lambda x: x.seat_index)
    ]
    return PokerTableOut(
        id=table.id,
        chat_id=table.chat_id,
        created_by=table.created_by,
        status=table.status,
        starting_stack=table.starting_stack,
        starting_small_blind=table.starting_small_blind,
        starting_big_blind=table.starting_big_blind,
        blind_increase_minutes=table.blind_increase_minutes,
        max_seats=table.max_seats,
        seats=seats,
        started_at=table.started_at,
        finished_at=table.finished_at,
        created_at=table.created_at,
    )


async def _ensure_chat_member(db: AsyncSession, user: User, chat_id: int) -> Chat:
    result = await db.execute(
        select(Chat).options(selectinload(Chat.members)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    if user not in chat.members:
        raise HTTPException(403, "Not a member of this chat")
    return chat


async def _broadcast_table(db: AsyncSession, table: PokerTable, event: str):
    out = await _table_to_out(db, table)
    await manager.broadcast_to_chat(table.chat_id, {
        "type": event,
        "table": out.model_dump(mode="json"),
    })


async def _broadcast_game_state(table_id: int):
    """Send each seated player an individualised view of the game (hides others' hole cards)."""
    g = game_store.get(table_id)
    if not g:
        return
    for uid in g.players.keys():
        snapshot = public_view(g, uid)
        await manager.send_to_user(uid, {
            "type": "poker_game_state",
            "table_id": table_id,
            "state": snapshot,
        })


# === Endpoints ===
@router.get("", response_model=list[PokerTableOut])
async def list_tables(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _ensure_chat_member(db, current_user, chat_id)
    result = await db.execute(
        select(PokerTable)
        .options(selectinload(PokerTable.seats))
        .where(PokerTable.chat_id == chat_id, PokerTable.status != "finished")
        .order_by(PokerTable.created_at.desc())
    )
    tables = result.scalars().all()
    return [await _table_to_out(db, t) for t in tables]


@router.post("", response_model=PokerTableOut)
async def create_table(
    data: CreateTableIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _ensure_chat_member(db, current_user, data.chat_id)
    if data.max_seats < 2 or data.max_seats > 6:
        raise HTTPException(400, "max_seats must be between 2 and 6")
    table = PokerTable(
        chat_id=data.chat_id,
        created_by=current_user.id,
        max_seats=data.max_seats,
    )
    db.add(table)
    await db.commit()
    # Reload with seats relation
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table.id)
    )
    table = result.scalar_one()
    await _broadcast_table(db, table, "poker_table_created")
    # Drop a system message into the chat so members get a clickable invite card
    msg = Message(
        chat_id=data.chat_id,
        sender_id=current_user.id,
        content=f"/poker_table {table.id}",
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
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
    return await _table_to_out(db, table)


@router.post("/{table_id}/join", response_model=PokerTableOut)
async def join_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table_id)
    )
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    await _ensure_chat_member(db, current_user, table.chat_id)
    if table.status != "lobby":
        raise HTTPException(400, "Game already started or finished")
    if any(s.user_id == current_user.id for s in table.seats):
        raise HTTPException(400, "Already seated")
    if len(table.seats) >= table.max_seats:
        raise HTTPException(400, "Table is full")
    taken = {s.seat_index for s in table.seats}
    free_idx = next((i for i in range(table.max_seats) if i not in taken), None)
    if free_idx is None:
        raise HTTPException(400, "No free seats")
    seat = PokerSeat(
        table_id=table.id,
        user_id=current_user.id,
        seat_index=free_idx,
        stack=table.starting_stack,
    )
    db.add(seat)
    await db.commit()
    # Reload
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table.id)
    )
    table = result.scalar_one()
    await _broadcast_table(db, table, "poker_table_updated")
    return await _table_to_out(db, table)


@router.post("/{table_id}/start", response_model=PokerTableOut)
async def start_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table_id)
    )
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    if table.created_by != current_user.id:
        raise HTTPException(403, "Только создатель стола может начать игру")
    if table.status != "lobby":
        raise HTTPException(400, "Игра уже идёт или закончена")
    if len(table.seats) < 2:
        raise HTTPException(400, "Нужно минимум 2 игрока")
    table.status = "playing"
    table.started_at = datetime.now(timezone.utc)
    await db.commit()
    # Boot in-memory game and deal first hand
    g = new_game(
        table_id=table.id,
        chat_id=table.chat_id,
        players_in=[(s.user_id, s.seat_index, table.starting_stack) for s in table.seats],
        small_blind=table.starting_small_blind,
        big_blind=table.starting_big_blind,
        blind_increase_seconds=table.blind_increase_minutes * 60,
    )
    game_store.put(g)
    start_hand(g)
    await _broadcast_table(db, table, "poker_table_updated")
    await _broadcast_game_state(table.id)
    return await _table_to_out(db, table)


@router.post("/{table_id}/close")
async def close_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force-close a table — only the creator can do this."""
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table_id)
    )
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    if table.created_by != current_user.id:
        raise HTTPException(403, "Только создатель стола может его закрыть")
    chat_id = table.chat_id
    # Drop the in-memory game and the DB row
    game_store.remove(table_id)
    await db.delete(table)
    await db.commit()
    await manager.broadcast_to_chat(chat_id, {
        "type": "poker_table_removed",
        "table_id": table_id,
    })
    return {"ok": True}


@router.post("/{table_id}/leave", response_model=PokerTableOut | None)
async def leave_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table_id)
    )
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    seat = next((s for s in table.seats if s.user_id == current_user.id), None)
    if not seat:
        raise HTTPException(400, "Not seated")
    if table.status == "lobby":
        # Just remove seat; if table empties out, delete it.
        await db.delete(seat)
        await db.commit()
        result = await db.execute(
            select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table_id)
        )
        table = result.scalar_one_or_none()
        if table and len(table.seats) == 0:
            await db.delete(table)
            await db.commit()
            await manager.broadcast_to_chat(table.chat_id, {
                "type": "poker_table_removed",
                "table_id": table_id,
            })
            return None
        if table:
            await _broadcast_table(db, table, "poker_table_updated")
            return await _table_to_out(db, table)
        return None
    else:
        # Mid-game leave: mark inactive (game logic in Phase 2 will treat as auto-fold/forfeit)
        seat.is_active = False
        await db.commit()
        result = await db.execute(
            select(PokerTable).options(selectinload(PokerTable.seats)).where(PokerTable.id == table_id)
        )
        table = result.scalar_one()
        await _broadcast_table(db, table, "poker_table_updated")
        return await _table_to_out(db, table)
