"""Приз чемпиону сезона — «секретное» в Гандолиуме.

Хозяин ведёт пул призов (Аркана, Dota Plus, сет на любимого героя…), в
начале сезона АДМИН нажимает «Разыграть» — сервер выбирает один взвешенно
(сид от сезона + SECRET_KEY: повтор нажатия в тот же сезон дал бы тот же
приз, но повтора и нет — розыгрыш на сезон один, unique). До финала все
видят только «🎁 ???» и подсказки, которые открываются по неделям:
1-я с 8-го числа, 2-я с 15-го, 3-я с 22-го (по МСК). Финал сезона
раскрывает приз вместе с чемпионом. Дарит хозяин руками — приложение
только выбирает и объявляет.
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone

from sqlalchemy import select

from app.config import settings
from app.models import SeasonPrize, SeasonPrizeDraw, User
from app.compendium.engine import current_season, to_msk

HINT_DAYS = (8, 15, 22)


def _hints_of(d: SeasonPrizeDraw) -> list[str]:
    return [h for h in (d.hint1, d.hint2, d.hint3) if h]


def hints_unlocked(season: str, now: datetime | None = None) -> int:
    """Сколько подсказок уже открыто для сезона. Прошлый сезон — все."""
    now = now or datetime.now(timezone.utc)
    if season < current_season(now):
        return len(HINT_DAYS)
    if season > current_season(now):
        return 0
    day = to_msk(now).day
    return sum(1 for d in HINT_DAYS if day >= d)


async def get_draw(db, season: str) -> SeasonPrizeDraw | None:
    return (await db.execute(select(SeasonPrizeDraw).where(SeasonPrizeDraw.season == season))).scalar_one_or_none()


async def teaser(db, season: str | None = None, now: datetime | None = None) -> dict:
    """Что видят все: разыгран ли приз, открытые подсказки, до какого числа
    ждать следующую; после финала — название и кому достался. Плюс
    последний раскрытый приз (прошлого сезона) для строки «в прошлый раз»."""
    now = now or datetime.now(timezone.utc)
    season = season or current_season(now)
    d = await get_draw(db, season)
    out: dict = {"season": season, "drawn": d is not None, "revealed": False,
                 "hints": [], "hints_total": 0, "next_hint_day": None, "title": None, "winner": None}
    if d:
        hints = _hints_of(d)
        n = hints_unlocked(season, now)
        out["hints"] = hints[:n]
        out["hints_total"] = len(hints)
        remaining = [day for i, day in enumerate(HINT_DAYS) if i >= n and i < len(hints)]
        out["next_hint_day"] = remaining[0] if remaining and season == current_season(now) else None
        if d.revealed:
            out["revealed"] = True
            out["title"] = d.title
            out["winner"] = d.winner_username
    last = (await db.execute(
        select(SeasonPrizeDraw).where(SeasonPrizeDraw.revealed.is_(True), SeasonPrizeDraw.season != season)
        .order_by(SeasonPrizeDraw.season.desc()).limit(1)
    )).scalar_one_or_none()
    out["last"] = {"season": last.season, "title": last.title, "winner": last.winner_username} if last else None
    return out


class DrawError(Exception):
    pass


async def draw(db, admin: User, season: str | None = None) -> SeasonPrizeDraw:
    """Разыграть приз на сезон. Взвешенный выбор из активных, детерминирован
    сидом сезона. Не коммитит."""
    season = season or current_season()
    if await get_draw(db, season):
        raise DrawError("Приз на этот сезон уже разыгран")
    pool = (await db.execute(
        select(SeasonPrize).where(SeasonPrize.active.is_(True), SeasonPrize.weight > 0).order_by(SeasonPrize.id)
    )).scalars().all()
    if not pool:
        raise DrawError("Пул призов пуст — сначала добавь хотя бы один")
    seed = hashlib.sha256(f"{season}:{settings.SECRET_KEY}".encode()).hexdigest()
    rng = random.Random(seed)
    prize = rng.choices(pool, weights=[p.weight for p in pool], k=1)[0]
    d = SeasonPrizeDraw(
        season=season, prize_id=prize.id, title=prize.title,
        hint1=prize.hint1, hint2=prize.hint2, hint3=prize.hint3,
        drawn_by=admin.id, drawn_at=datetime.now(timezone.utc),
    )
    db.add(d)
    await db.flush()
    return d


async def reveal(db, season: str, winner_user_id: int, winner_username: str) -> SeasonPrizeDraw | None:
    """Финал сезона: раскрыть приз и записать чемпиона. Не коммитит.
    Идемпотентно — повторный финал того же сезона ничего не меняет."""
    d = await get_draw(db, season)
    if not d:
        return None
    if not d.revealed:
        d.revealed = True
        d.winner_user_id = winner_user_id
        d.winner_username = winner_username
    return d


def prize_dict(p: SeasonPrize) -> dict:
    return {"id": p.id, "title": p.title, "hint1": p.hint1, "hint2": p.hint2, "hint3": p.hint3,
            "weight": p.weight, "active": p.active}
