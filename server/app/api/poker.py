from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_, and_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from app.database import get_db, AsyncSessionLocal
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
    reentries: int = 0
    gas_paid: int = 0

    class Config:
        from_attributes = True


# Пределы настроек стола. Стек и блайнды — в фишках, интервал — в минутах.
STACK_MIN, STACK_MAX = 1_000, 1_000_000
SB_MIN, SB_MAX = 10, 10_000
BLIND_MIN_MINUTES, BLIND_MAX_MINUTES = 1, 60
ENTRY_GAS_MIN, ENTRY_GAS_MAX = 10, 500
REENTRIES_MAX = 5
REENTRY_LEVEL_MAX = 10


class TableSettingsIn(BaseModel):
    """Что создатель настраивает до старта (и при создании)."""
    max_seats: int | None = None
    starting_stack: int | None = None
    starting_small_blind: int | None = None
    blind_increase_minutes: int | None = None
    mode: str | None = None              # chips | gas
    entry_gas: int | None = None
    max_reentries: int | None = None
    reentry_until_level: int | None = None


def _apply_settings(table: PokerTable, s: TableSettingsIn) -> None:
    """Валидация + применение настроек к столу (лобби). Большой блайнд —
    всегда 2×малого; в режиме «за газ» энтри обязателен."""
    if s.max_seats is not None:
        if not 2 <= s.max_seats <= 6:
            raise HTTPException(400, "Мест за столом — от 2 до 6")
        if len(table.seats) > s.max_seats:
            raise HTTPException(400, "Уже сидит больше людей, чем мест")
        # Клиенты рисуют слоты 0..max_seats-1: игрок на убираемом месте
        # пропал бы с экрана, а движок раздавал бы ему карты
        if any(seat.seat_index >= s.max_seats for seat in table.seats):
            raise HTTPException(400, "Кто-то сидит на убираемом месте — пусть сначала встанет")
        table.max_seats = s.max_seats
    if s.starting_stack is not None:
        if not STACK_MIN <= s.starting_stack <= STACK_MAX:
            raise HTTPException(400, f"Стек — от {STACK_MIN:,} до {STACK_MAX:,} фишек".replace(",", " "))
        table.starting_stack = s.starting_stack
    if s.starting_small_blind is not None:
        if not SB_MIN <= s.starting_small_blind <= SB_MAX:
            raise HTTPException(400, f"Малый блайнд — от {SB_MIN} до {SB_MAX:,}".replace(",", " "))
        table.starting_small_blind = s.starting_small_blind
        table.starting_big_blind = s.starting_small_blind * 2
    if table.starting_big_blind * 5 > table.starting_stack:
        raise HTTPException(400, "Стек меньше пяти больших блайндов — это не покер, а лотерея")
    if s.blind_increase_minutes is not None:
        if not BLIND_MIN_MINUTES <= s.blind_increase_minutes <= BLIND_MAX_MINUTES:
            raise HTTPException(400, f"Интервал роста блайндов — от {BLIND_MIN_MINUTES} до {BLIND_MAX_MINUTES} минут")
        table.blind_increase_minutes = s.blind_increase_minutes
    if s.mode is not None:
        if s.mode not in ("chips", "gas"):
            raise HTTPException(400, "Режим: chips или gas")
        table.mode = s.mode
    if s.entry_gas is not None:
        table.entry_gas = s.entry_gas
    if s.max_reentries is not None:
        if not 0 <= s.max_reentries <= REENTRIES_MAX:
            raise HTTPException(400, f"Докупок — от 0 до {REENTRIES_MAX}")
        table.max_reentries = s.max_reentries
    if s.reentry_until_level is not None:
        if not 0 <= s.reentry_until_level <= REENTRY_LEVEL_MAX:
            raise HTTPException(400, f"Окно докупки — до {REENTRY_LEVEL_MAX}-го повышения блайндов")
        table.reentry_until_level = s.reentry_until_level
    if table.mode == "gas":
        if not ENTRY_GAS_MIN <= table.entry_gas <= ENTRY_GAS_MAX:
            raise HTTPException(400, f"Энтри в режиме «за газ» — от {ENTRY_GAS_MIN} до {ENTRY_GAS_MAX} ⛽")
    else:
        table.entry_gas = 0


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
    mode: str = "chips"
    entry_gas: int = 0
    max_reentries: int = 2
    reentry_until_level: int = 3
    gas_pot: int = 0
    seats: list[PokerSeatOut]
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class CreateTableIn(TableSettingsIn):
    chat_id: int
    max_seats: int | None = 6


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
            reentries=s.reentries,
            gas_paid=s.gas_paid,
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
        mode=table.mode,
        entry_gas=table.entry_gas,
        max_reentries=table.max_reentries,
        reentry_until_level=table.reentry_until_level,
        gas_pot=table.gas_pot,
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
    # Дефолты колонок применяются только при INSERT — у свежего объекта
    # поля None, а _apply_settings их сравнивает. Заполняем явно.
    table = PokerTable(
        chat_id=data.chat_id, created_by=current_user.id,
        starting_stack=30000, starting_small_blind=100, starting_big_blind=200,
        blind_increase_minutes=7, max_seats=6, mode="chips", entry_gas=0,
        max_reentries=2, reentry_until_level=3, gas_pot=0,
    )
    table.seats = []
    _apply_settings(table, data)
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


def _locked_table(table_id: int):
    """Стол под FOR UPDATE (места — отдельным selectin-запросом, на них
    блокировка не нужна). ВСЕ мутирующие ручки читают стол так: join × start,
    join × join, close × финал шли параллельно и ловили гонки — место после
    снапшота игры (энтри терялся), два места одного юзера с двойным
    списанием, lost update котла. Под замком второй запрос ждёт коммита
    первого и перечитывает уже новое состояние. Замок держится до
    commit/rollback — не делать под ним долгих await'ов вне БД."""
    return (
        select(PokerTable).options(selectinload(PokerTable.seats))
        .where(PokerTable.id == table_id).with_for_update()
    )


@router.post("/{table_id}/join", response_model=PokerTableOut)
async def join_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(_locked_table(table_id))
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
    paid = 0
    if table.mode == "gas":
        # Энтри списываем атомарно (gas >= entry) из профиля ТЕКУЩЕГО
        # сезона — как эскроу ставок. Не хватило — за стол не пускаем.
        paid = await _debit_gas(db, current_user.id, table.entry_gas)
        table.gas_pot += paid
    seat = PokerSeat(
        table_id=table.id,
        user_id=current_user.id,
        seat_index=free_idx,
        stack=table.starting_stack,
        gas_paid=paid,
    )
    db.add(seat)
    try:
        await db.commit()
    except IntegrityError:
        # uq_poker_seat_user: второе место того же юзера (дабл-тап) —
        # откатывается вместе со списанием энтри (одна транзакция)
        await db.rollback()
        raise HTTPException(400, "Already seated")
    if paid:
        await _announce_gas(db, current_user)
    # Reload. populate_existing is CRITICAL here: the table object is already
    # in this session's identity map with its seats collection loaded BEFORE
    # the insert (and the new seat was added via raw FK, not relationship
    # append, so the in-memory collection never saw it). With
    # expire_on_commit=False a plain re-select returns that same stale object
    # untouched — the response and the WS broadcast then go out WITHOUT the
    # new seat, which is exactly the "sat down but nobody sees it until
    # re-entering the screen" bug.
    result = await db.execute(
        select(PokerTable)
        .options(selectinload(PokerTable.seats))
        .where(PokerTable.id == table.id)
        .execution_options(populate_existing=True)
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
    result = await db.execute(_locked_table(table_id))
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
        starting_stack=table.starting_stack,
        mode=table.mode,
        entry_gas=table.entry_gas,
        max_reentries=table.max_reentries,
        reentry_until_level=table.reentry_until_level,
        gas_pot=table.gas_pot,
        reentries={s.user_id: s.reentries for s in table.seats},
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
    # Под замком: параллельный финал турнира (_finish_tournament тоже
    # берёт FOR UPDATE) либо успеет первым — и мы увидим finished, ничего не
    # возвращая поверх выплаченного котла, — либо дождётся нас и увидит,
    # что стола нет
    result = await db.execute(_locked_table(table_id))
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    if table.created_by != current_user.id:
        raise HTTPException(403, "Только создатель стола может его закрыть")
    chat_id = table.chat_id
    # Стол «за газ» закрыли до финала — газ возвращаем всем, кто заносил
    refunded = await _refund_seats(db, table)
    # Drop the in-memory game and the DB row
    await db.delete(table)
    await db.commit()
    game_store.remove(table_id)
    for u in refunded:
        await _announce_gas(db, u)
    await manager.broadcast_to_chat(chat_id, {
        "type": "poker_table_removed",
        "table_id": table_id,
    })
    return {"ok": True}


async def _debit_gas(db: AsyncSession, user_id: int, amount: int) -> int:
    """Списать газ или 400. Возвращает списанное (для gas_paid)."""
    from app.compendium.bets import try_debit
    from app.compendium.engine import current_season
    if amount <= 0:
        return 0
    if not await try_debit(db, user_id, current_season(), amount):
        raise HTTPException(400, f"Не хватает газа: нужно {amount} ⛽")
    return amount


async def _credit_gas(db: AsyncSession, user_id: int, amount: int) -> None:
    from app.compendium.bets import _credit
    from app.compendium.engine import current_season
    if amount > 0:
        await _credit(db, user_id, current_season(), amount)


async def _refund_seats(db: AsyncSession, table: PokerTable) -> list[User]:
    """Вернуть каждому его gas_paid, если стол не доигран. Не коммитит.
    Возвращает юзеров, которым надо разослать profile_updated."""
    if table.mode != "gas" or table.status == "finished":
        return []
    users: list[User] = []
    for s in table.seats:
        if s.gas_paid > 0:
            await _credit_gas(db, s.user_id, s.gas_paid)
            u = (await db.execute(select(User).where(User.id == s.user_id))).scalar_one_or_none()
            if u:
                users.append(u)
            s.gas_paid = 0
    table.gas_pot = 0
    return users


async def _announce_gas(db: AsyncSession, user: User) -> None:
    """profile_updated — чтобы ⛽ у ника обновился сразу, а не по F5."""
    try:
        from app.api.users import _broadcast_profile
        await _broadcast_profile(db, user)
    except Exception as exc:
        print(f"[poker] profile broadcast failed: {exc}")


@router.patch("/{table_id}/settings", response_model=PokerTableOut)
async def update_settings(
    table_id: int,
    data: TableSettingsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создатель правит настройки, пока стол в лобби. Смена энтри/режима
    при уже сидящих людях запрещена: они садились по старым правилам —
    переключи chips→gas при сидящих, и они играли бы за котёл бесплатно."""
    result = await db.execute(_locked_table(table_id))
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    if table.created_by != current_user.id:
        raise HTTPException(403, "Настройки меняет только создатель стола")
    if table.status != "lobby":
        raise HTTPException(400, "Игра уже началась — настройки заморожены")
    money_changed = (
        (data.mode is not None and data.mode != table.mode)
        or (data.entry_gas is not None and data.entry_gas != table.entry_gas)
    )
    if money_changed and table.seats:
        raise HTTPException(400, "За столом уже сидят — режим и цену меняют до посадки, пусть встанут")
    _apply_settings(table, data)
    await db.commit()
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats))
        .where(PokerTable.id == table_id).execution_options(populate_existing=True)
    )
    table = result.scalar_one()
    await _broadcast_table(db, table, "poker_table_updated")
    return await _table_to_out(db, table)


@router.post("/{table_id}/reentry", response_model=PokerTableOut)
async def reentry(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Докупка в режиме «за газ»: вылетел — заплатил энтри ещё раз, получил
    стартовый стек, зашёл со следующей раздачи. Ограничения считает движок
    (окно по блайндам, лимит докупок)."""
    from app.poker_game import can_reenter, reenter
    from app.ws.handler import resume_after_reentry
    result = await db.execute(_locked_table(table_id))
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    if table.status != "playing":
        raise HTTPException(400, "Докупаться можно только в идущей игре")
    g = game_store.get(table_id)
    if not g:
        raise HTTPException(400, "Игра не запущена (сервер перезапускался?)")
    ok, why = can_reenter(g, current_user.id)
    if not ok:
        raise HTTPException(400, why)
    seat = next((s for s in table.seats if s.user_id == current_user.id), None)
    if not seat:
        raise HTTPException(400, "Ты не за этим столом")
    paid = await _debit_gas(db, current_user.id, table.entry_gas)
    # Гонка с дедлайном паузы: пока списывали газ, сторож мог закрыть турнир
    if g.finished or not can_reenter(g, current_user.id)[0]:
        await _credit_gas(db, current_user.id, paid)
        await db.commit()
        raise HTTPException(409, "Опоздал — турнир уже закрыт, газ возвращён")
    reenter(g, current_user.id)
    seat.stack = table.starting_stack
    seat.is_active = True
    seat.reentries += 1
    seat.gas_paid += paid
    table.gas_pot = g.gas_pot
    await db.commit()
    await _announce_gas(db, current_user)
    await resume_after_reentry(table_id, g)
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats))
        .where(PokerTable.id == table_id).execution_options(populate_existing=True)
    )
    table = result.scalar_one()
    await _broadcast_table(db, table, "poker_table_updated")
    return await _table_to_out(db, table)


@router.post("/{table_id}/restart", response_model=PokerTableOut)
async def restart_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """«Сыграть ещё» после финала: новый стол с теми же настройками и теми
    же людьми, не выходя. В режиме «за газ» энтри списывается заново —
    кому не хватило, за новый стол не садится (сообщим в ответе)."""
    result = await db.execute(_locked_table(table_id))
    old = result.scalar_one_or_none()
    if not old:
        raise HTTPException(404, "Table not found")
    if old.created_by != current_user.id:
        raise HTTPException(403, "Новую партию открывает создатель стола")
    if old.status != "finished":
        raise HTTPException(400, "Стол ещё не доигран")
    new = PokerTable(
        chat_id=old.chat_id,
        created_by=old.created_by,
        starting_stack=old.starting_stack,
        starting_small_blind=old.starting_small_blind,
        starting_big_blind=old.starting_big_blind,
        blind_increase_minutes=old.blind_increase_minutes,
        max_seats=old.max_seats,
        mode=old.mode,
        entry_gas=old.entry_gas,
        max_reentries=old.max_reentries,
        reentry_until_level=old.reentry_until_level,
    )
    db.add(new)
    await db.flush()
    skipped: list[str] = []
    paid_users: list[User] = []
    for s in sorted(old.seats, key=lambda x: x.seat_index):
        paid = 0
        if new.mode == "gas":
            from app.compendium.bets import try_debit
            from app.compendium.engine import current_season
            if not await try_debit(db, s.user_id, current_season(), new.entry_gas):
                u = (await db.execute(select(User).where(User.id == s.user_id))).scalar_one_or_none()
                skipped.append(u.username if u else str(s.user_id))
                continue
            paid = new.entry_gas
            new.gas_pot += paid
            u = (await db.execute(select(User).where(User.id == s.user_id))).scalar_one_or_none()
            if u:
                paid_users.append(u)
        db.add(PokerSeat(table_id=new.id, user_id=s.user_id, seat_index=s.seat_index,
                         stack=new.starting_stack, gas_paid=paid))
    chat_id = old.chat_id
    old_id = old.id
    await db.delete(old)
    await db.commit()
    game_store.remove(old_id)
    for u in paid_users:
        await _announce_gas(db, u)
    await manager.broadcast_to_chat(chat_id, {"type": "poker_table_removed", "table_id": old_id})
    result = await db.execute(
        select(PokerTable).options(selectinload(PokerTable.seats))
        .where(PokerTable.id == new.id).execution_options(populate_existing=True)
    )
    new = result.scalar_one()
    await _broadcast_table(db, new, "poker_table_created")
    from app.ws.handler import post_chat_text
    note = f"🃏 Ещё партия: стол #{new.id}" + (f" (без газа остались: {', '.join(skipped)})" if skipped else "")
    await post_chat_text(db, chat_id, current_user, f"/poker_table {new.id}")
    if skipped:
        await post_chat_text(db, chat_id, current_user, note)
    return await _table_to_out(db, new)


@router.get("/{table_id}/history")
async def table_history(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """История раздач стола — в памяти, пока стол жив. Свежие сверху."""
    from app.poker_game import history_view
    result = await db.execute(select(PokerTable).where(PokerTable.id == table_id))
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    await _ensure_chat_member(db, current_user, table.chat_id)
    g = game_store.get(table_id)
    if not g:
        return {"table_id": table_id, "hands": []}
    hands = history_view(g)
    user_ids = {uid for h in hands for uid in h.get("winners", [])} | {
        p["user_id"] for h in hands for p in h.get("players", [])
    }
    names: dict[int, str] = {}
    if user_ids:
        rows = await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
        names = {int(i): n for i, n in rows.all()}
    return {"table_id": table_id, "names": names, "hands": hands}


STALE_TABLE_HOURS = 6


async def close_stale_tables() -> None:
    """Джоба: столы старше STALE_TABLE_HOURS закрываем сами.

    Забытое лобби или брошенная игра висели в чате днями, пока создатель
    не вспомнит про кнопку «закрыть». Настоящий sit-and-go столько не
    живёт, так что режем всё по created_at без разбора статуса. Каждый стол
    — своя транзакция: один сбой не оставляет остальных висеть дальше."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=STALE_TABLE_HOURS)
    async with AsyncSessionLocal() as db:
        # Лобби — по created_at; играющий стол — от СТАРТА игры: лобби
        # могли собрать в обед, а сесть играть вечером — резать такой стол
        # посреди раздачи нельзя.
        res = await db.execute(
            select(PokerTable.id, PokerTable.chat_id).where(
                PokerTable.status != "finished",
                or_(
                    and_(PokerTable.status == "lobby", PokerTable.created_at < cutoff),
                    and_(
                        PokerTable.status == "playing",
                        func.coalesce(PokerTable.started_at, PokerTable.created_at) < cutoff,
                    ),
                ),
            )
        )
        stale = [(int(tid), int(cid)) for tid, cid in res.all()]
    for table_id, chat_id in stale:
        try:
            async with AsyncSessionLocal() as db:
                # «За газ» и не доиграно — вернуть занесённое, прежде чем сносить
                t = (await db.execute(_locked_table(table_id))).scalar_one_or_none()
                if t is None:
                    continue
                refunded = await _refund_seats(db, t)
                await db.execute(delete(PokerTable).where(PokerTable.id == table_id))
                await db.commit()
                for u in refunded:
                    await _announce_gas(db, u)
            # Игру из памяти — ПОСЛЕ коммита: упади коммит раньше, стол
            # остался бы в базе «playing» без игры до следующего прогона.
            game_store.remove(table_id)
            await manager.broadcast_to_chat(chat_id, {
                "type": "poker_table_removed",
                "table_id": table_id,
            })
            print(f"[poker] auto-closed stale table {table_id} (chat {chat_id})")
        except Exception as e:
            print(f"[poker] auto-close of table {table_id} failed: {type(e).__name__}: {e}")


@router.post("/{table_id}/leave", response_model=PokerTableOut | None)
async def leave_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(_locked_table(table_id))
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(404, "Table not found")
    seat = next((s for s in table.seats if s.user_id == current_user.id), None)
    if not seat:
        raise HTTPException(400, "Not seated")
    if table.status == "lobby":
        # Just remove seat; if table empties out, delete it.
        # Встал из лобби в режиме «за газ» — энтри назад.
        refund = seat.gas_paid
        if refund > 0:
            await _credit_gas(db, current_user.id, refund)
            table.gas_pot = max(0, table.gas_pot - refund)
        await db.delete(seat)
        await db.commit()
        if refund > 0:
            await _announce_gas(db, current_user)
        # populate_existing: same stale-identity-map trap as join_table — a
        # plain re-select would return the pre-delete seats collection, the
        # departed player would still be broadcast as seated, and the
        # "table emptied -> delete it" check below would count stale seats.
        result = await db.execute(
            select(PokerTable)
            .options(selectinload(PokerTable.seats))
            .where(PokerTable.id == table_id)
            .execution_options(populate_existing=True)
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
        # is_active was set via attribute (identity map is fresh for it), but
        # keep the reload consistent with the other paths anyway.
        result = await db.execute(
            select(PokerTable)
            .options(selectinload(PokerTable.seats))
            .where(PokerTable.id == table_id)
            .execution_options(populate_existing=True)
        )
        table = result.scalar_one()
        await _broadcast_table(db, table, "poker_table_updated")
        return await _table_to_out(db, table)
