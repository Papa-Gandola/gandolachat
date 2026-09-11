"""API Гандолиума: мой прогресс, таблица сезона, полка трофеев.

Все ответы собираются из строк DotaMatch/QuestCompletion теми же функциями,
что и движок — «что видишь на экране» и «что засчитал поллер» не расходятся.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, CompendiumProfile, QuestCompletion
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
FRAMES = ("lime", "animated")


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
    return titles


def _cosmetics_dict(user: User, earned: list[str]) -> dict:
    return {
        "max_level": user.comp_max_level or 0,
        "badge": user.comp_badge,
        "title": user.comp_title,
        "color": user.comp_color,
        "frame": user.comp_frame,
        "earned_titles": earned,
        "palette": NAME_PALETTE,
        "unlocks": UNLOCKS,
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
        "cosmetics": _cosmetics_dict(current_user, earned),
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
            if lvl < UNLOCKS["title"]:
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
            need = UNLOCKS["frame_lime"] if f == "lime" else UNLOCKS["frame_animated"]
            if lvl < need:
                raise HTTPException(400, f"Эта рамка открывается на уровне {need}")
            current_user.comp_frame = f

    await db.commit()
    await db.refresh(current_user)

    from app.api.users import _broadcast_profile
    await _broadcast_profile(db, current_user)

    earned = await _earned_titles(db, current_user.id)
    return _cosmetics_dict(current_user, earned)


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
