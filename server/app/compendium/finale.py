"""Финал сезона Гандолиума.

Джоба 1-го числа в 04:10 МСК закрывает ПРОШЛЫЙ месяц: снапшот финальной
таблицы в season_results (идемпотентно — повторный запуск ничего не
дублирует), карточка `/quest_card kind=season_final` с подиумом 🥇🥈🥉 во
все компендиум-чаты + пуш всем. Время выбрано с зазором: ночной поллер
успевает дозасчитать катки, доигранные под самую полночь.

Закрываем не только «вчерашний» месяц, а ВСЕ незакрытые прошлые сезоны с
активностью: даунтайм дольше misfire_grace (20ч) иначе оставил бы месяц
без финала навсегда — следующий запуск догонит пачкой.

Награды НЕ пишутся в колонки — они выводятся из season_results запросами:
рамки gold/silver/bronze открыты тем, у кого есть место 1/2/3 в любом
сезоне, титул «Чемпион <месяца>» — у победителей (валидация и выдача в
api/compendium.py).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, func

from app.database import AsyncSessionLocal
from app.models import User, Chat, CompendiumProfile, QuestCompletion, SeasonResult
from app.compendium.engine import current_season, level_for_gas
from app.compendium.quests import BY_ID

# Родительный падеж для титулов и заголовков: «Чемпион сентября».
MONTHS_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
]


def month_gen(season: str) -> str:
    try:
        return MONTHS_GEN[int(season.split("-")[1]) - 1]
    except (IndexError, ValueError):
        return season


def prev_season(now: datetime | None = None) -> str:
    cur = current_season(now)
    y, m = int(cur[:4]), int(cur[5:7])
    m -= 1
    if m == 0:
        y, m = y - 1, 12
    return f"{y:04d}-{m:02d}"


async def _standings(db, season: str) -> list[dict]:
    """Финальная таблица сезона: газ из профилей + счётчики выполнений.
    Только реально игравшие (gas > 0)."""
    prof_res = await db.execute(
        select(CompendiumProfile.user_id, CompendiumProfile.gas)
        .where(CompendiumProfile.season == season, CompendiumProfile.gas > 0)
    )
    gas_by_user = {uid: gas for uid, gas in prof_res.all()}
    if not gas_by_user:
        return []
    users_res = await db.execute(select(User).where(User.id.in_(gas_by_user.keys())))
    users = {u.id: u for u in users_res.scalars().all()}

    counts_res = await db.execute(
        select(QuestCompletion.user_id, QuestCompletion.quest_id, func.count(QuestCompletion.id))
        .where(QuestCompletion.season == season, QuestCompletion.user_id.in_(gas_by_user.keys()))
        .group_by(QuestCompletion.user_id, QuestCompletion.quest_id)
    )
    done: dict[int, int] = {}
    anti: dict[int, int] = {}
    for uid, qid, cnt in counts_res.all():
        q = BY_ID.get(qid)
        if not q:
            continue
        if q.category == "anti":
            anti[uid] = anti.get(uid, 0) + int(cnt)
        else:
            done[uid] = done.get(uid, 0) + int(cnt)

    rows = []
    for uid, gas in gas_by_user.items():
        u = users.get(uid)
        if not u:
            continue  # юзер удалён — из истории выпадает, места сдвигаются
        rows.append({
            "user_id": uid,
            "username": u.username,
            "gas": gas,
            "level": level_for_gas(gas),
            "quests_done": done.get(uid, 0),
            "anti_count": anti.get(uid, 0),
        })
    rows.sort(key=lambda r: (-r["gas"], r["username"].lower()))
    for i, r in enumerate(rows):
        r["place"] = i + 1
    return rows


async def _finalize_one(db, season: str) -> None:
    """Закрыть один сезон: снапшот таблицы + карточка-подиум + пуш."""
    rows = await _standings(db, season)
    if not rows:
        print(f"[finale] сезон {season}: играть никто не играл — закрывать нечего")
        return
    for r in rows:
        db.add(SeasonResult(
            season=season, user_id=r["user_id"], place=r["place"],
            username=r["username"], gas=r["gas"], level=r["level"],
            quests_done=r["quests_done"], anti_count=r["anti_count"],
        ))
    await db.commit()
    print(f"[finale] сезон {season} закрыт: {len(rows)} игроков, чемпион — {rows[0]['username']} ({rows[0]['gas']}⛽)")

    # Карточка-подиум во все компендиум-чаты. Отправитель — чемпион: его
    # сообщение, его звёздный час. Цикл — по снапшоту id, Chat/User
    # перечитываются свежими на каждой итерации: ошибка одного чата
    # роллбэчится и НЕ травит остальные (грабля №2 — rollback экспайрит
    # ранее загруженные объекты).
    payload = {
        "kind": "season_final",
        "season": season,
        "season_name": month_gen(season),
        "players": len(rows),
        "podium": [
            {k: r[k] for k in ("place", "user_id", "username", "gas", "level", "quests_done")}
            for r in rows[:3]
        ],
    }
    champ_id = rows[0]["user_id"]
    push_title = f"🏆 Итоги сезона — {month_gen(season)}"
    push_body = f"Чемпион: {rows[0]['username']} ({rows[0]['gas']}⛽)! Подиум в чате."

    chats_res = await db.execute(
        select(Chat.id).where(Chat.compendium_enabled.is_(True), Chat.is_group.is_(True))
    )
    chat_ids = [cid for (cid,) in chats_res.all()]

    from app.compendium.poller import _post_card
    for cid in chat_ids:
        try:
            chat = (await db.execute(select(Chat).where(Chat.id == cid))).scalar_one_or_none()
            champion = (await db.execute(select(User).where(User.id == champ_id))).scalar_one_or_none()
            if not chat or not champion:
                continue
            await _post_card(db, chat, champion, payload,
                             push_title=push_title, push_body=push_body)
        except Exception as e:
            try:
                await db.rollback()
            except Exception:
                pass
            print(f"[finale] карточка в чат {cid} не ушла: {type(e).__name__}: {e}")


async def finalize_season() -> None:
    """Джоба: закрыть все прошлые сезоны, которые ещё не закрыты."""
    # Общий лок компендиум-джоб: не снапшотить таблицу, пока поллер
    # дозачисляет газ, и не толкаться коммитами в одной сессии.
    from app.compendium.poller import _JOB_LOCK
    async with _JOB_LOCK, AsyncSessionLocal() as db:
        cur = current_season()
        # "YYYY-MM" сравнивается лексикографически == хронологически
        seas_res = await db.execute(
            select(CompendiumProfile.season)
            .where(CompendiumProfile.season < cur, CompendiumProfile.gas > 0)
            .distinct()
        )
        closed_res = await db.execute(select(SeasonResult.season).distinct())
        closed = {s for (s,) in closed_res.all()}
        pending = sorted(s for (s,) in seas_res.all() if s not in closed)
        for season in pending:
            await _finalize_one(db, season)
