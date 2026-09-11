"""API Гандолиума: мой прогресс, таблица сезона, полка трофеев.

Все ответы собираются из строк DotaMatch/QuestCompletion теми же функциями,
что и движок — «что видишь на экране» и «что засчитал поллер» не расходятся.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Bet, DotaMatch, CompendiumProfile, QuestCompletion, SeasonResult
from app.compendium.finale import month_gen
from app.auth import get_current_user
from app.compendium.engine import (
    current_season, day_key_of, week_key_of, level_for_gas,
)
from app.compendium.quests import (
    BY_ID, QUESTS, GAS_PER_LEVEL, daily_rotation, weekly_rotation,
)
from app.compendium import poller

router = APIRouter(prefix="/api/compendium", tags=["compendium"])

# === Косметика: пороги разблокировок (уровни навсегда, comp_max_level) ===
UNLOCKS = {
    "badge": 2,           # ⛽ рядом с ником
    "title": 4,           # титул под ником (из заработанных)
    "color": 6,           # цвет ника
    "frame_lime": 8,      # лаймовая рамка аватарки
    "dota_gold": 10,      # золотой /dota
    "frame_animated": 12, # переливающаяся рамка
}
# Палитра Гандолы для цветных ников
NAME_PALETTE = [
    "#c6ff3d", "#57f287", "#fee75c", "#faa61a", "#ff6a5e",
    "#eb459e", "#a78bda", "#5865f2", "#00b0f4", "#ffd24a",
]
FRAMES = ("lime", "animated", "gold", "silver", "bronze")
# Рамки за подиум сезона — открываются МЕСТОМ в season_results, не уровнем.
PODIUM_FRAME_PLACE = {"gold": 1, "silver": 2, "bronze": 3}


async def _champion_titles(db: AsyncSession, user_id: int) -> list[str]:
    """Титулы чемпионов сезонов — «Чемпион сентября» за 1-е место. Они за
    МЕСТО, не за уровень: PATCH пускает их мимо уровневого замка."""
    champ_res = await db.execute(
        select(SeasonResult.season)
        .where(SeasonResult.user_id == user_id, SeasonResult.place == 1)
        .order_by(SeasonResult.season)
    )
    return [f"Чемпион {month_gen(season)}" for (season,) in champ_res.all()]


async def _earned_titles(db: AsyncSession, user_id: int) -> list[str]:
    """Титулы со всех сезонов — «полка навсегда»."""
    res = await db.execute(
        select(QuestCompletion.quest_id).where(QuestCompletion.user_id == user_id).distinct()
    )
    titles = []
    for (qid,) in res.all():
        q = BY_ID.get(qid)
        if q and q.title and q.title not in titles:
            titles.append(q.title)
    for t in await _champion_titles(db, user_id):
        if t not in titles:
            titles.append(t)
    return titles


async def _podium_frames(db: AsyncSession, user_id: int) -> dict:
    """Какие рамки за подиум заработаны (место 1/2/3 в ЛЮБОМ сезоне)."""
    res = await db.execute(
        select(SeasonResult.place)
        .where(SeasonResult.user_id == user_id, SeasonResult.place <= 3)
    )
    places = {p for (p,) in res.all()}
    return {"gold": 1 in places, "silver": 2 in places, "bronze": 3 in places}


def _cosmetics_dict(user: User, earned: list[str], podium: dict | None = None) -> dict:
    return {
        "max_level": user.comp_max_level or 0,
        "badge": user.comp_badge,
        "title": user.comp_title,
        "color": user.comp_color,
        "frame": user.comp_frame,
        "earned_titles": earned,
        "palette": NAME_PALETTE,
        "unlocks": UNLOCKS,
        # Рамки за подиум сезона: заработано местом, не уровнем.
        "podium_frames": podium or {"gold": False, "silver": False, "bronze": False},
    }


def _quest_dict(q, done: bool = False, progress: tuple | None = None) -> dict:
    d = {
        "id": q.id, "num": q.num, "name": q.name, "desc": q.desc,
        "gas": q.gas, "cat": q.category, "needs_parse": q.needs_parse,
        "done": done,
    }
    if progress is not None:
        d["progress"], d["target"] = progress
    if q.title:
        d["title"] = q.title
    return d


@router.get("/me")
async def my_compendium(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    season = current_season()
    now = datetime.now(timezone.utc)
    today = day_key_of(now)
    this_week = week_key_of(now)

    if current_user.dota_account_id is None:
        return {"linked": False, "season": season}

    ctx = await poller._build_ctx(db, current_user, season)
    keys = ctx.completion_keys

    daily_active = daily_rotation(today)
    weekly_active = weekly_rotation(this_week)
    daily = [
        _quest_dict(BY_ID[qid], done=(qid, today) in keys)
        for qid in daily_active
    ]
    weekly = [
        _quest_dict(BY_ID[qid], done=(qid, this_week) in keys)
        for qid in weekly_active
    ]

    # Полные пулы (для разворота «показать все»): активные помечены. Отдаём
    # отдельными полями — старые клиенты продолжают видеть только тройки.
    def _pool(pool_ids: list[str], active_ids: list[str], period_key: str) -> list[dict]:
        out = []
        for qid in sorted(pool_ids, key=lambda i: BY_ID[i].num):
            d = _quest_dict(BY_ID[qid], done=(qid, period_key) in keys)
            d["active"] = qid in active_ids
            out.append(d)
        return out

    from app.compendium.quests import DAILY_POOL, WEEKLY_POOL
    daily_pool = _pool(DAILY_POOL, daily_active, today)
    weekly_pool = _pool(WEEKLY_POOL, weekly_active, this_week)

    season_quests = []
    for q in QUESTS:
        if q.category != "season":
            continue
        done = (q.id, season) in keys
        prog = None
        if q.progress is not None:
            try:
                prog = q.progress(ctx)
            except Exception:
                prog = None
        season_quests.append(_quest_dict(q, done=done, progress=prog))

    team = [
        _quest_dict(q, done=(q.id, season) in keys)
        for q in QUESTS if q.category == "team"
    ]

    comp_res = await db.execute(
        select(QuestCompletion)
        .where(QuestCompletion.user_id == current_user.id, QuestCompletion.season == season)
        .order_by(QuestCompletion.completed_at.desc())
    )
    season_completions = list(comp_res.scalars().all())
    season_qids = {c.quest_id for c in season_completions}

    # Анти-ачивки показываем списком — пусть боятся. Пасхалки не светим.
    # «done» — только по ТЕКУЩЕМУ сезону (прошлогодний «Донор крови» не в счёт).
    anti = [
        _quest_dict(q, done=q.id in season_qids)
        for q in QUESTS if q.category == "anti"
    ]

    trophies = []
    for c in season_completions:
        q = BY_ID.get(c.quest_id)
        if not q:
            continue
        trophies.append({
            "quest_id": c.quest_id, "name": q.name, "cat": q.category,
            # Своя полка: полное описание, включая тайные (сам же выполнил).
            "desc": q.desc,
            "gas": c.gas, "completed_at": c.completed_at.isoformat(),
            **({"title": q.title} if q.title else {}),
        })

    prof_res = await db.execute(
        select(CompendiumProfile).where(
            CompendiumProfile.user_id == current_user.id,
            CompendiumProfile.season == season,
        )
    )
    prof = prof_res.scalar_one_or_none()
    gas = prof.gas if prof else 0

    wins = sum(1 for r in ctx.rows if r.is_win)
    earned = await _earned_titles(db, current_user.id)
    return {
        "linked": True,
        "cosmetics": _cosmetics_dict(current_user, earned, await _podium_frames(db, current_user.id)),
        "season": season,
        "gas": gas,
        "level": level_for_gas(gas),
        "level_progress": gas % GAS_PER_LEVEL,
        "level_target": GAS_PER_LEVEL,
        "matches": len(ctx.rows),
        "wins": wins,
        "rank_tier": current_user.dota_rank_tier,
        "leaderboard_rank": current_user.dota_leaderboard_rank,
        "daily": daily,
        "weekly": weekly,
        "daily_pool": daily_pool,
        "weekly_pool": weekly_pool,
        "season_quests": season_quests,
        "team": team,
        "anti": anti,
        "trophies": trophies,
    }


class CosmeticsIn(BaseModel):
    badge: bool | None = None
    title: str | None = None       # "" = снять титул
    color: str | None = None       # "" = сбросить цвет
    frame: str | None = None       # "" = без рамки


@router.patch("/cosmetics")
async def update_cosmetics(
    data: CosmeticsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Выбор косметики. Снять можно всегда; надеть — только открытое уровнем
    (comp_max_level, копится навсегда) и, для титулов, реально заработанное."""
    lvl = current_user.comp_max_level or 0

    if data.badge is not None:
        if data.badge and lvl < UNLOCKS["badge"]:
            raise HTTPException(400, f"Значок ⛽ открывается на уровне {UNLOCKS['badge']}")
        current_user.comp_badge = data.badge

    if data.title is not None:
        t = data.title.strip()
        if not t:
            current_user.comp_title = None
        else:
            # Чемпионский титул — награда за место, носится с любого уровня
            if lvl < UNLOCKS["title"] and t not in await _champion_titles(db, current_user.id):
                raise HTTPException(400, f"Титулы открываются на уровне {UNLOCKS['title']}")
            earned = await _earned_titles(db, current_user.id)
            if t not in earned:
                raise HTTPException(400, "Такой титул ещё не заработан")
            current_user.comp_title = t[:40]

    if data.color is not None:
        c = data.color.strip()
        if not c:
            current_user.comp_color = None
        else:
            if lvl < UNLOCKS["color"]:
                raise HTTPException(400, f"Цвет ника открывается на уровне {UNLOCKS['color']}")
            if c not in NAME_PALETTE:
                raise HTTPException(400, "Только цвета из палитры Гандолы")
            current_user.comp_color = c

    if data.frame is not None:
        f = data.frame.strip()
        if not f:
            current_user.comp_frame = None
        else:
            if f not in FRAMES:
                raise HTTPException(400, "Нет такой рамки")
            if f in PODIUM_FRAME_PLACE:
                place = PODIUM_FRAME_PLACE[f]
                has = await db.execute(
                    select(SeasonResult.id)
                    .where(SeasonResult.user_id == current_user.id, SeasonResult.place == place)
                    .limit(1)
                )
                if has.first() is None:
                    medal = {1: "🥇 1-е", 2: "🥈 2-е", 3: "🥉 3-е"}[place]
                    raise HTTPException(400, f"Эта рамка — за {medal} место в сезоне")
            else:
                need = UNLOCKS["frame_lime"] if f == "lime" else UNLOCKS["frame_animated"]
                if lvl < need:
                    raise HTTPException(400, f"Эта рамка открывается на уровне {need}")
            current_user.comp_frame = f

    await db.commit()
    await db.refresh(current_user)

    from app.api.users import _broadcast_profile
    await _broadcast_profile(db, current_user)

    earned = await _earned_titles(db, current_user.id)
    return _cosmetics_dict(current_user, earned, await _podium_frames(db, current_user.id))


@router.get("/seasons")
async def seasons_archive(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Архив закрытых сезонов: финальные таблицы со снапшот-никами."""
    res = await db.execute(
        select(SeasonResult).order_by(SeasonResult.season.desc(), SeasonResult.place)
    )
    grouped: dict[str, list[dict]] = {}
    for r in res.scalars().all():
        grouped.setdefault(r.season, []).append({
            "place": r.place, "user_id": r.user_id, "username": r.username,
            "gas": r.gas, "level": r.level,
            "quests_done": r.quests_done, "anti_count": r.anti_count,
        })
    out = [
        {"season": s, "season_name": month_gen(s), "rows": rows}
        for s, rows in grouped.items()
    ]
    return out[:12]


# ======================= Ставки =======================
from app.compendium import bets as bets_mod


class BetIn(BaseModel):
    target_id: int
    market: str
    side: str
    line: int | None = None  # только для streak (2/3/5); линии kills/kda считает сервер
    stake: int


def _bet_dict(b: Bet, names: dict[int, str]) -> dict:
    return {
        "id": b.id,
        "bettor_id": b.bettor_id, "bettor": names.get(b.bettor_id, "?"),
        "target_id": b.target_id, "target": names.get(b.target_id, "?"),
        "market": b.market, "side": b.side, "line": b.line,
        "label": bets_mod.describe({"market": b.market, "side": b.side, "line": b.line}),
        "stake": b.stake, "status": b.status,
        "progress": b.progress, "payout": b.payout,
        "placed_at": b.placed_at.isoformat(),
        "resolved_at": b.resolved_at.isoformat() if b.resolved_at else None,
        "pending_parse": b.market == "roshan" and b.status == "open" and b.match_id is not None,
    }


@router.get("/bets")
async def bets_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ставки: мой газ, цели с персональными линиями, открытые ставки всех
    (социалка — всё на виду), моя недавняя история."""
    season = current_season()
    prof_res = await db.execute(
        select(CompendiumProfile.gas).where(
            CompendiumProfile.user_id == current_user.id,
            CompendiumProfile.season == season,
        )
    )
    my_gas = prof_res.scalar_one_or_none() or 0

    linked_res = await db.execute(
        select(User).where(User.dota_account_id.is_not(None), User.is_approved.is_(True))
    )
    linked = list(linked_res.scalars().all())
    names = {u.id: u.username for u in linked}
    targets = []
    for u in linked:
        lines = await bets_mod.lines_for(db, u.id)
        targets.append({
            "user_id": u.id, "username": u.username, "avatar_url": u.avatar_url,
            "kills_line": lines["kills"], "kda_line": lines["kda"],
            "roshan_line": bets_mod.ROSHAN_LINE,
            "is_me": u.id == current_user.id,
        })

    open_res = await db.execute(
        select(Bet).where(Bet.status == "open").order_by(Bet.placed_at.desc())
    )
    open_bets = list(open_res.scalars().all())
    mine_res = await db.execute(
        select(Bet)
        .where(Bet.bettor_id == current_user.id, Bet.status != "open")
        .order_by(Bet.resolved_at.desc())
        .limit(20)
    )
    history = list(mine_res.scalars().all())
    # Имена для ставок людей вне targets (отвязались после ставки)
    extra_ids = {b.bettor_id for b in open_bets + history} | {b.target_id for b in open_bets + history}
    missing = extra_ids - set(names)
    if missing:
        extra_res = await db.execute(select(User.id, User.username).where(User.id.in_(missing)))
        names.update({uid: uname for uid, uname in extra_res.all()})

    return {
        "season": season,
        "my_gas": my_gas,
        "linked": current_user.dota_account_id is not None,
        "stake_min": bets_mod.STAKE_MIN,
        "stake_max": bets_mod.STAKE_MAX,
        "streak_stake_max": bets_mod.STREAK_STAKE_MAX,
        "targets": targets,
        "open": [_bet_dict(b, names) for b in open_bets],
        "my_recent": [_bet_dict(b, names) for b in history],
    }


@router.post("/bets")
async def place_bet(
    data: BetIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Поставить ⛽. Анти-руин зашит в валидацию: на себя — только «за
    успех», рынка смертей нет, линии считает сервер, эскроу сразу."""
    if current_user.dota_account_id is None:
        raise HTTPException(400, "Ставки — только для привязанных к Dota (нужен твой account_id для честности)")
    if data.market not in bets_mod.MARKETS:
        raise HTTPException(400, "Нет такого рынка")
    target = await db.get(User, data.target_id)
    if not target or target.dota_account_id is None:
        raise HTTPException(400, "Цель не привязана к Dota")
    on_self = target.id == current_user.id

    # Стороны: match — win/lose, streak — только win, остальные over/under.
    valid_sides = {"match": ("win", "lose"), "streak": ("win",),
                   "kills": ("over", "under"), "kda": ("over", "under"),
                   "roshan": ("over", "under")}[data.market]
    if data.side not in valid_sides:
        raise HTTPException(400, "Нет такой стороны ставки")
    # Анти-руин: на себя нельзя ставить на ПЛОХОЙ исход — никакой мотивации
    # фидить/руинить свои (и чужие!) катки.
    if on_self and data.side in ("lose", "under"):
        raise HTTPException(400, "На себя — только за успех. Руин не оплачивается 🙂")

    # Линии: kills/kda — от средних цели (анти-принтер), roshan — фикс.
    if data.market == "streak":
        line = data.line or 0
        if line not in bets_mod.STREAK_STAKE_MAX:
            raise HTTPException(400, "Стрик бывает 2, 3 или 5 побед")
    elif data.market in ("kills", "kda"):
        lines = await bets_mod.lines_for(db, target.id)
        line = lines[data.market]
    elif data.market == "roshan":
        line = bets_mod.ROSHAN_LINE
    else:
        line = 0

    cap = bets_mod.STREAK_STAKE_MAX[line] if data.market == "streak" else bets_mod.STAKE_MAX
    if not (bets_mod.STAKE_MIN <= data.stake <= cap):
        raise HTTPException(400, f"Ставка от {bets_mod.STAKE_MIN} до {cap}⛽ на этот рынок")

    existing = await db.execute(
        select(Bet.id).where(
            Bet.bettor_id == current_user.id,
            Bet.target_id == target.id,
            Bet.status == "open",
        ).limit(1)
    )
    if existing.first() is not None:
        raise HTTPException(400, "У тебя уже есть открытая ставка на этого игрока — дождись развязки")

    season = current_season()
    ok = await bets_mod.try_debit(db, current_user.id, season, data.stake)
    if not ok:
        raise HTTPException(400, "Не хватает газа в этом сезоне — катай и закрывай задания")
    # Проигранный (поставленный) газ опускает и «вечный» максимум — решение
    # хозяина; несоответствующая косметика слетает внутри recalc.
    await bets_mod.recalc_max_level(db, current_user.id)

    bet = Bet(
        bettor_id=current_user.id, target_id=target.id, season=season,
        market=data.market, side=data.side, line=line, stake=data.stake,
    )
    db.add(bet)
    try:
        await db.commit()
    except IntegrityError:
        # Гонка двух параллельных ставок на одну пару: проигравший уникальный
        # индекс uq_bets_open_pair откатывается ВМЕСТЕ с эскроу — газ цел
        await db.rollback()
        raise HTTPException(400, "У тебя уже есть открытая ставка на этого игрока — дождись развязки")
    await db.refresh(bet)

    # Уровень/косметика могли измениться — чат должен увидеть живьём
    from app.api.users import _broadcast_profile
    await db.refresh(current_user)
    await _broadcast_profile(db, current_user)

    prof_res = await db.execute(
        select(CompendiumProfile.gas).where(
            CompendiumProfile.user_id == current_user.id,
            CompendiumProfile.season == season,
        )
    )
    names = {current_user.id: current_user.username, target.id: target.username}
    return {"bet": _bet_dict(bet, names), "my_gas": prof_res.scalar_one_or_none() or 0}


@router.get("/season")
async def season_table(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    season = current_season()
    users_res = await db.execute(select(User).where(User.dota_account_id.is_not(None)))
    users = list(users_res.scalars().all())
    if not users:
        return {"season": season, "rows": []}

    prof_res = await db.execute(
        select(CompendiumProfile).where(
            CompendiumProfile.season == season,
            CompendiumProfile.user_id.in_([u.id for u in users]),
        )
    )
    gas_by_user = {p.user_id: p.gas for p in prof_res.scalars().all()}

    counts_res = await db.execute(
        select(QuestCompletion.user_id, QuestCompletion.quest_id, func.count(QuestCompletion.id))
        .where(
            QuestCompletion.season == season,
            QuestCompletion.user_id.in_([u.id for u in users]),
        )
        .group_by(QuestCompletion.user_id, QuestCompletion.quest_id)
    )
    done_by_user: dict[int, int] = {}
    anti_by_user: dict[int, int] = {}
    for uid, qid, cnt in counts_res.all():
        q = BY_ID.get(qid)
        if not q:
            continue
        if q.category == "anti":
            anti_by_user[uid] = anti_by_user.get(uid, 0) + int(cnt)
        else:
            done_by_user[uid] = done_by_user.get(uid, 0) + int(cnt)

    rows = []
    for u in users:
        gas = gas_by_user.get(u.id, 0)
        rows.append({
            "user_id": u.id,
            "username": u.username,
            "avatar_url": u.avatar_url,
            "gas": gas,
            "level": level_for_gas(gas),
            "quests_done": done_by_user.get(u.id, 0),
            "anti_count": anti_by_user.get(u.id, 0),
            "rank_tier": u.dota_rank_tier,
            "leaderboard_rank": u.dota_leaderboard_rank,
            "comp_title": u.comp_title,
            "comp_color": u.comp_color,
            "comp_frame": u.comp_frame,
            "comp_badge": u.comp_badge,
        })
    rows.sort(key=lambda r: (-r["gas"], r["username"].lower()))
    return {"season": season, "rows": rows, "me": current_user.id}


@router.get("/user/{user_id}")
async def user_trophies(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Полка трофеев другого игрока (текущий сезон)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    season = current_season()
    comp_res = await db.execute(
        select(QuestCompletion)
        .where(QuestCompletion.user_id == user_id, QuestCompletion.season == season)
        .order_by(QuestCompletion.completed_at.desc())
    )
    trophies = []
    for c in comp_res.scalars().all():
        q = BY_ID.get(c.quest_id)
        if not q:
            continue
        trophies.append({
            "quest_id": c.quest_id, "name": q.name, "cat": q.category,
            # Чужая полка: описание для тултипа, у тайных — интрига «???».
            "desc": "???" if q.category == "secret" else q.desc,
            "gas": c.gas, "completed_at": c.completed_at.isoformat(),
            **({"title": q.title} if q.title else {}),
        })
    prof_res = await db.execute(
        select(CompendiumProfile).where(
            CompendiumProfile.user_id == user_id, CompendiumProfile.season == season
        )
    )
    prof = prof_res.scalar_one_or_none()
    gas = prof.gas if prof else 0
    return {
        "user_id": user_id, "username": user.username, "season": season,
        "gas": gas, "level": level_for_gas(gas), "trophies": trophies,
        "rank_tier": user.dota_rank_tier, "leaderboard_rank": user.dota_leaderboard_rank,
    }
