"""Поллер Гандолиума: фоновые джобы, которые крутят весь компендиум.

  poll_matches   — каждые DOTA_POLL_MINUTES: новые рейтинговые катки
                   привязанных игроков → строки DotaMatch → движок заданий →
                   газ → карточки в чаты с включённым компендиумом.
  recheck_parses — каждые 20 минут: дотягиваем реплей-парс (варды, мультикиллы,
                   роли) и допрогоняем 📼-задания по уже записанным каткам.
  refresh_ranks  — раз в час: звание/медаль в профиле + марафон «Восхождение».
  weekly_roast   — по понедельникам (03:25 МСК): «Дно недели» и «Якорь сезона».

Всё best-effort: любая ошибка по одному игроку логируется и не роняет цикл.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func, cast, Integer

from app.database import AsyncSessionLocal
from app.config import settings
from app.models import (
    User, Chat, Message, chat_members,
    DotaMatch, CompendiumProfile, QuestCompletion,
)
from app import opendota
from app.compendium import engine
from app.compendium.engine import (
    UserCtx, TeamCtx, Completion,
    season_of, day_key_of, week_key_of, current_season, level_for_gas, to_msk, MSK,
)
from app.compendium.quests import BY_ID, QUESTS
from app.ws.manager import manager

QUEST_CARD_MARKER = "/quest_card"
MAX_NEW_MATCHES_PER_CYCLE = 5
PARSE_MAX_ATTEMPTS = 8
PARSE_WINDOW_HOURS = 36
ROWS_WINDOW_DAYS = 60

# Все джобы компендиума ходят в одни и те же таблицы (газ — read-modify-write,
# выполнения — уникальные ключи). Интервалы 15/20/60 минут кратны и пересекаются
# каждый час; без сериализации это lost update по газу и IntegrityError на
# дублях. Джобы живут в одном event loop — asyncio.Lock решает всё разом.
_JOB_LOCK = asyncio.Lock()


def _log(msg: str) -> None:
    print(f"[compendium] {msg}")


# ---------------------------------------------------------------- helpers
async def _linked_users(db) -> list[User]:
    res = await db.execute(select(User).where(User.dota_account_id.is_not(None)))
    return list(res.scalars().all())


async def _get_or_create_profile(db, user_id: int, season: str) -> CompendiumProfile:
    res = await db.execute(
        select(CompendiumProfile).where(
            CompendiumProfile.user_id == user_id, CompendiumProfile.season == season
        )
    )
    prof = res.scalar_one_or_none()
    if prof is None:
        prof = CompendiumProfile(user_id=user_id, season=season, gas=0)
        db.add(prof)
        await db.flush()
    return prof


async def _build_ctx(db, user: User, season: str) -> UserCtx:
    cutoff = datetime.now(timezone.utc) - timedelta(days=ROWS_WINDOW_DAYS)
    rows_res = await db.execute(
        select(DotaMatch).where(DotaMatch.user_id == user.id, DotaMatch.started_at >= cutoff)
    )
    rows = list(rows_res.scalars().all())

    prev_res = await db.execute(
        select(func.max(DotaMatch.started_at)).where(
            DotaMatch.user_id == user.id, DotaMatch.started_at < cutoff
        )
    )
    prev_before = prev_res.scalar()

    total_res = await db.execute(
        select(func.count(DotaMatch.id)).where(DotaMatch.user_id == user.id)
    )
    total = int(total_res.scalar() or 0)

    comp_res = await db.execute(
        select(QuestCompletion.quest_id, QuestCompletion.period_key, QuestCompletion.season).where(
            QuestCompletion.user_id == user.id
        )
    )
    keys: set[tuple[str, str]] = set()
    daily_done = 0
    for qid, pk, cseason in comp_res.all():
        keys.add((qid, pk))
        q = BY_ID.get(qid)
        if q and q.category == "daily" and cseason == season:
            daily_done += 1

    return UserCtx(
        season=season,
        all_rows=rows,
        completion_keys=keys,
        total_matches_all_time=total,
        prev_before_window=prev_before,
        daily_done_count=daily_done,
    )


async def _compendium_chats_for(db, user_id: int) -> list[Chat]:
    res = await db.execute(
        select(Chat)
        .join(chat_members, chat_members.c.chat_id == Chat.id)
        .where(chat_members.c.user_id == user_id, Chat.compendium_enabled.is_(True))
    )
    return list(res.scalars().all())


async def _post_card(db, chat: Chat, sender: User, payload: dict,
                     push_title: str | None = None, push_body: str | None = None) -> None:
    """Карточка = обычное сообщение с маркером /quest_card + JSON. Клиенты
    рендерят её красиво; старые — как текст. Живёт по обычному TTL чата."""
    content = f"{QUEST_CARD_MARKER} {json.dumps(payload, ensure_ascii=False)}"
    msg = Message(
        chat_id=chat.id,
        sender_id=sender.id,
        content=content,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.MESSAGE_TTL_DAYS),
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    await manager.broadcast_to_chat(chat.id, {
        "type": "message",
        "id": msg.id,
        "chat_id": chat.id,
        "sender_id": sender.id,
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
        "reactions": [],
    })

    if push_title:
        try:
            from app.push import send_push
            member_res = await db.execute(
                select(chat_members.c.user_id).where(chat_members.c.chat_id == chat.id)
            )
            recipients = [r[0] for r in member_res.all()]
            await send_push(
                db, recipients,
                title=push_title, body=push_body or "",
                data={"type": "message", "chat_id": chat.id, "message_id": msg.id,
                      "is_group": chat.is_group, "chat_name": chat.name,
                      "notification_tag": f"compendium-{chat.id}"},
                channel_id="messages", priority="high",
            )
        except Exception as e:
            _log(f"push failed: {type(e).__name__}: {e}")


async def _apply_and_announce(db, user: User, comps: list[Completion], season: str) -> None:
    """Записать выполнения, начислить газ сезона, раскидать карточки по чатам."""
    if not comps:
        return

    for c in comps:
        db.add(QuestCompletion(
            user_id=user.id, season=season, quest_id=c.quest_id,
            period_key=c.period_key, gas=c.gas, match_id=c.match_id,
        ))
    prof = await _get_or_create_profile(db, user.id, season)
    level_before = level_for_gas(prof.gas)
    prof.gas += sum(c.gas for c in comps)
    level_after = level_for_gas(prof.gas)
    gas_total = prof.gas
    # Разблокировки косметики — по высшему уровню за всё время
    if level_after > (user.comp_max_level or 0):
        user.comp_max_level = level_after
    await db.commit()

    # 2) карточки: обычные+пасхалки одной, анти — отдельной (прожарка),
    #    командные шлёт _handle_team отдельно
    regular = [c for c in comps if BY_ID[c.quest_id].category in ("daily", "weekly", "season", "secret")]
    anti = [c for c in comps if BY_ID[c.quest_id].category == "anti"]
    chats = await _compendium_chats_for(db, user.id)
    if not chats:
        return

    def items_of(lst: list[Completion]) -> list[dict]:
        out = []
        for c in lst:
            q = BY_ID[c.quest_id]
            item = {"name": q.name, "gas": c.gas, "cat": q.category}
            if q.title:
                item["title"] = q.title
            out.append(item)
        return out

    special = next((BY_ID[c.quest_id].special for c in regular if BY_ID[c.quest_id].special), None)
    leveled = level_before is not None and level_after is not None and level_after > level_before

    for chat in chats:
        if regular:
            payload = {
                "v": 1, "kind": "quest",
                "user_id": user.id, "username": user.username,
                "items": items_of(regular),
                "gas_total": gas_total, "level": level_after or None,
            }
            if special:
                payload["special"] = special
            if leveled:
                payload["new_level"] = level_after
            push_title = push_body = None
            if special == "rampage":
                push_title, push_body = "🚨 РАМПАГА!", f"{user.username} оформил пентакилл"
            await _post_card(db, chat, user, payload, push_title, push_body)
        if anti:
            payload = {
                "v": 1, "kind": "anti",
                "user_id": user.id, "username": user.username,
                "items": items_of(anti),
                "gas_total": gas_total, "level": level_after or None,
            }
            await _post_card(db, chat, user, payload)


async def _handle_team(db, row: DotaMatch, user: User) -> None:
    """Собрать группу по match_id (одна сторона), проставить team_key/size и
    прогнать командные задания для каждого участника."""
    res = await db.execute(
        select(DotaMatch)
        .where(DotaMatch.match_id == row.match_id, DotaMatch.is_radiant == row.is_radiant)
    )
    group = list(res.scalars().all())
    if len(group) < 2:
        return

    ids = sorted({r.user_id for r in group})
    lineup = "-".join(str(i) for i in ids)
    changed = False
    for r in group:
        if r.team_key != lineup or r.team_size != len(ids):
            r.team_key = lineup
            r.team_size = len(ids)
            changed = True
    if changed:
        await db.commit()

    users_res = await db.execute(select(User).where(User.id.in_(ids)))
    # Отвязавшиеся в командных не участвуют: их строки могли остаться от
    # старой привязки, и начислять им газ/светить в карточках нельзя.
    users = {u.id: u for u in users_res.scalars().all() if u.dota_account_id is not None}
    if len(users) < 2:
        return
    names = [users[i].username for i in ids if i in users]

    # Каждому участнику — свои командные выполнения (у кого-то дуо уже закрыто)
    per_user_comps: dict[int, list[Completion]] = {}
    for r in group:
        u = users.get(r.user_id)
        if not u:
            continue
        ctx = await _build_ctx(db, u, r.season)
        tc = TeamCtx(m=r, size=len(users), lineup_key=lineup, ctx=ctx)
        comps = engine.evaluate_team(tc)
        if comps:
            per_user_comps[u.id] = comps

    if not per_user_comps:
        return

    # газ + строки — каждому своё. Сезон берём у самой катки (а не «сейчас»),
    # чтобы на стыке месяца ключ периода и сезон начисления не разъехались.
    season = row.season
    for uid, comps in per_user_comps.items():
        for c in comps:
            db.add(QuestCompletion(
                user_id=uid, season=season, quest_id=c.quest_id,
                period_key=c.period_key, gas=c.gas, match_id=c.match_id,
            ))
        prof = await _get_or_create_profile(db, uid, season)
        prof.gas += sum(c.gas for c in comps)
        lvl = level_for_gas(prof.gas)
        member = users.get(uid)
        if member is not None and lvl > (member.comp_max_level or 0):
            member.comp_max_level = lvl
    await db.commit()

    # Карточка одна на квест (с именами всех, кто его сейчас закрыл),
    # постим в компендиум-чаты инициатора группы.
    by_quest: dict[str, list[str]] = {}
    for uid, comps in per_user_comps.items():
        for c in comps:
            by_quest.setdefault(c.quest_id, []).append(users[uid].username)

    chats = await _compendium_chats_for(db, user.id)
    for chat in chats:
        for qid, who in by_quest.items():
            q = BY_ID[qid]
            payload = {
                "v": 1, "kind": "team",
                "user_id": user.id, "username": user.username,
                "names": names, "who": who,
                "items": [{"name": q.name, "gas": q.gas, "cat": "team"}],
            }
            push_title = push_body = None
            if q.special == "fullstack":
                payload["special"] = "fullstack"
                push_title, push_body = "🏆 СТАК ПОБЕДИЛ", " + ".join(names)
            await _post_card(db, chat, user, payload, push_title, push_body)


async def _process_new_match(db, user: User, match_id: int) -> bool:
    """Скачать полный матч, записать строку, прогнать задания. True = записан."""
    # Без привязки матчить не по чему: account_id=None сравнялся бы с
    # анонимными игроками матча (account_id: null).
    if user.dota_account_id is None:
        return False
    match = await opendota.get_match(match_id)
    players = match.get("players") or []
    player = next((p for p in players if p.get("account_id") == user.dota_account_id), None)
    if player is None:
        return False

    facts = engine.extract_player_facts(match, player)
    row = DotaMatch(
        match_id=match_id,
        user_id=user.id,
        season=season_of(facts["started_at"]),
        **facts,
    )
    db.add(row)
    await db.commit()

    if not row.is_parsed:
        await opendota.request_parse(match_id)

    ctx = await _build_ctx(db, user, row.season)
    comps = engine.evaluate_match(row, ctx)
    await _apply_and_announce(db, user, comps, row.season)
    await _handle_team(db, row, user)
    return True


async def poll_matches() -> None:
    """Основной цикл: новые рейтинговые катки всех привязанных игроков.

    ORM-объекты здесь нарочно не переживают границы try: rollback экспайрит
    всю сессию, и обращение к атрибуту протухшего объекта в async-контексте
    роняет MissingGreenlet (в т.ч. внутри except при формировании лога).
    Поэтому цикл ходит по снапшоту простых значений, а User перечитывается
    свежим select-ом перед каждой каткой."""
    async with _JOB_LOCK:
        async with AsyncSessionLocal() as db:
            users = await _linked_users(db)
            snapshot = [
                (u.id, u.username, u.dota_account_id, u.dota_linked_at)
                for u in users
            ]

        async with AsyncSessionLocal() as db:
            for uid, uname, account_id, linked_at in snapshot:
                try:
                    recent = await opendota.get_recent_matches(account_id)
                except Exception as e:
                    _log(f"recentMatches failed for {uname}: {type(e).__name__}")
                    continue

                linked_at = linked_at or datetime.now(timezone.utc)
                candidates = []
                for rm in recent:
                    if rm.get("lobby_type") != 7:
                        continue
                    st = datetime.fromtimestamp(int(rm.get("start_time") or 0), tz=timezone.utc)
                    if st < linked_at:
                        continue
                    candidates.append((int(rm["match_id"]), st))
                if not candidates:
                    continue

                existing_res = await db.execute(
                    select(DotaMatch.match_id).where(
                        DotaMatch.user_id == uid,
                        DotaMatch.match_id.in_([mid for mid, _ in candidates]),
                    )
                )
                known = {r[0] for r in existing_res.all()}
                fresh = sorted(
                    [(mid, st) for mid, st in candidates if mid not in known],
                    key=lambda x: x[1],
                )[:MAX_NEW_MATCHES_PER_CYCLE]

                for mid, _st in fresh:
                    try:
                        user = (
                            await db.execute(select(User).where(User.id == uid))
                        ).scalar_one_or_none()
                        if user is None or user.dota_account_id != account_id:
                            break  # отвязался/перепривязался прямо во время цикла
                        await _process_new_match(db, user, mid)
                    except Exception as e:
                        _log(f"match {mid} failed for {uname}: {type(e).__name__}: {e}")
                        await db.rollback()
                    await asyncio.sleep(1.0)  # бережём лимиты OpenDota
                await asyncio.sleep(0.5)


async def recheck_parses() -> None:
    """Дотянуть реплей-парс по свежим строкам и допрогнать 📼-задания.

    Как и в poll_matches — снапшоты вместо долгоживущих ORM-объектов:
    один rollback иначе экспайрит всё, и следующая итерация падает.
    Отвязанные пользователи отфильтрованы сразу — иначе их account_id=None
    сматчился бы с анонимными игроками матча (account_id: null) и чужие
    цифры затёрли бы строку."""
    async with _JOB_LOCK:
        async with AsyncSessionLocal() as db:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=PARSE_WINDOW_HOURS)
            res = await db.execute(
                select(DotaMatch.id, DotaMatch.match_id, DotaMatch.user_id).where(
                    DotaMatch.is_parsed.is_(False),
                    DotaMatch.parse_attempts < PARSE_MAX_ATTEMPTS,
                    DotaMatch.started_at >= cutoff,
                )
            )
            pending = res.all()
            if not pending:
                return

            users_res = await db.execute(
                select(User.id, User.username, User.dota_account_id).where(
                    User.id.in_({p.user_id for p in pending}),
                    User.dota_account_id.is_not(None),
                )
            )
            accounts = {uid: (uname, acc) for uid, uname, acc in users_res.all()}

        # Один матч могли записать несколько игроков — качаем его один раз.
        by_match: dict[int, list[tuple[int, int]]] = {}  # match_id -> [(row_id, user_id)]
        for p in pending:
            by_match.setdefault(p.match_id, []).append((p.id, p.user_id))

        async with AsyncSessionLocal() as db:
            for mid, row_refs in by_match.items():
                try:
                    match = await opendota.get_match(mid)
                except Exception:
                    continue
                parsed = match.get("version") is not None
                players = match.get("players") or []

                for row_id, row_uid in row_refs:
                    uname, account_id = accounts.get(row_uid, (None, None))
                    if account_id is None:
                        continue  # отвязался — строку не трогаем
                    try:
                        r = (
                            await db.execute(select(DotaMatch).where(DotaMatch.id == row_id))
                        ).scalar_one_or_none()
                        if r is None:
                            continue
                        r.parse_attempts += 1
                        if parsed:
                            player = next(
                                (p for p in players if p.get("account_id") == account_id), None
                            )
                            if player is not None:
                                facts = engine.extract_player_facts(match, player)
                                for k, v in facts.items():
                                    setattr(r, k, v)
                        await db.commit()

                        if parsed:
                            user = (
                                await db.execute(select(User).where(User.id == row_uid))
                            ).scalar_one_or_none()
                            if user is None or user.dota_account_id != account_id:
                                continue
                            ctx = await _build_ctx(db, user, r.season)
                            comps = engine.evaluate_match(r, ctx)
                            await _apply_and_announce(db, user, comps, r.season)
                    except Exception as e:
                        _log(f"re-eval after parse failed for {uname}: {type(e).__name__}: {e}")
                        await db.rollback()
                await asyncio.sleep(1.0)


async def refresh_ranks() -> None:
    """Обновить звание всех привязанных + марафон «Восхождение»."""
    async with _JOB_LOCK:
        async with AsyncSessionLocal() as db:
            snapshot = [
                (u.id, u.username, u.dota_account_id)
                for u in await _linked_users(db)
            ]

        async with AsyncSessionLocal() as db:
            season = current_season()
            for uid, uname, account_id in snapshot:
                try:
                    player = await opendota.get_player(account_id)
                except Exception:
                    continue
                try:
                    rank_tier, lb = opendota.extract_rank(player)
                    user = (
                        await db.execute(select(User).where(User.id == uid))
                    ).scalar_one_or_none()
                    if user is None or user.dota_account_id != account_id:
                        continue
                    # Пустой rank_tier (профиль скрыли/АПИ мигнул) не затирает
                    # уже известное звание — лучше слегка устаревшая медаль,
                    # чем мигающая.
                    if rank_tier is not None:
                        user.dota_rank_tier = rank_tier
                        user.dota_leaderboard_rank = lb
                    user.dota_rank_updated_at = datetime.now(timezone.utc)

                    prof = await _get_or_create_profile(db, user.id, season)
                    if prof.start_rank_tier is None and rank_tier is not None:
                        prof.start_rank_tier = rank_tier
                    await db.commit()

                    # «Восхождение»: выросла именно МЕДАЛЬ (десятки rank_tier),
                    # +1 звезда в рамках медали марафон не закрывает.
                    if (
                        rank_tier is not None
                        and prof.start_rank_tier is not None
                        and rank_tier // 10 > prof.start_rank_tier // 10
                    ):
                        exists = await db.execute(
                            select(QuestCompletion.id).where(
                                QuestCompletion.user_id == user.id,
                                QuestCompletion.quest_id == "s38",
                                QuestCompletion.period_key == season,
                            )
                        )
                        if exists.scalar_one_or_none() is None:
                            q = BY_ID["s38"]
                            await _apply_and_announce(
                                db, user, [Completion("s38", season, q.gas, None)], season
                            )
                except Exception as e:
                    _log(f"rank refresh failed for {uname}: {type(e).__name__}: {e}")
                    await db.rollback()
                await asyncio.sleep(0.5)


async def weekly_roast() -> None:
    """Понедельничный трибунал: «Дно недели» за прошлую неделю (мин. 5 игр)
    и «Якорь сезона» за рецидив. Идемпотентно — можно дёргать сколько угодно."""
    now_msk = to_msk(datetime.now(timezone.utc))
    if now_msk.weekday() != 0:  # 0 = понедельник
        return
    # Границы прошлой недели в МСК → UTC
    week_start_msk = (now_msk - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_msk -= timedelta(days=week_start_msk.weekday())
    week_end_msk = week_start_msk + timedelta(days=7)
    prev_week = week_key_of(week_start_msk.astimezone(timezone.utc))
    season = season_of((week_end_msk - timedelta(seconds=1)).astimezone(timezone.utc))

    async with _JOB_LOCK, AsyncSessionLocal() as db:
        res = await db.execute(
            select(DotaMatch.user_id, func.count(DotaMatch.id), func.sum(cast(DotaMatch.is_win, Integer)))
            .join(User, User.id == DotaMatch.user_id)
            .where(
                DotaMatch.started_at >= week_start_msk.astimezone(timezone.utc),
                DotaMatch.started_at < week_end_msk.astimezone(timezone.utc),
                # Отвязавшиеся в трибунале не участвуют
                User.dota_account_id.is_not(None),
            )
            .group_by(DotaMatch.user_id)
        )
        stats = [(uid, int(games), int(wins or 0)) for uid, games, wins in res.all()]
        eligible = [(uid, games, wins) for uid, games, wins in stats if games >= 5]
        if not eligible:
            return
        # Худший винрейт; при равенстве — больше поражений
        eligible.sort(key=lambda t: (t[2] / t[1], -(t[1] - t[2])))
        loser_id, games, wins = eligible[0]

        exists = await db.execute(
            select(QuestCompletion.id).where(
                QuestCompletion.user_id == loser_id,
                QuestCompletion.quest_id == "a49",
                QuestCompletion.period_key == prev_week,
            )
        )
        if exists.scalar_one_or_none() is not None:
            return

        user = (await db.execute(select(User).where(User.id == loser_id))).scalar_one_or_none()
        if user is None:
            return

        comps = [Completion("a49", prev_week, BY_ID["a49"].gas, None)]

        # Рецидив за сезон → «Якорь сезона»
        a49_count = await db.execute(
            select(func.count(QuestCompletion.id)).where(
                QuestCompletion.user_id == loser_id,
                QuestCompletion.quest_id == "a49",
                QuestCompletion.season == season,
            )
        )
        anchor_exists = await db.execute(
            select(QuestCompletion.id).where(
                QuestCompletion.user_id == loser_id,
                QuestCompletion.quest_id == "a58",
                QuestCompletion.period_key == season,
            )
        )
        if int(a49_count.scalar() or 0) >= 1 and anchor_exists.scalar_one_or_none() is None:
            comps.append(Completion("a58", season, BY_ID["a58"].gas, None))

        await _apply_and_announce(db, user, comps, season)
        _log(f"weekly roast: {user.username} — {wins}/{games} за {prev_week}")
