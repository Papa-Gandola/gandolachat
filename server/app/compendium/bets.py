"""Ставки Гандолиума: ⛽ на катки — свои и друзей.

Смысл (по хозяину): селф-челленджи «сделаю 10+ убийств / KDA 4+ / выиграю
3 подряд» + ставки за/против друзей. ГЛАВНОЕ — никакой мотивации руинить:

- рынка «смерти» НЕТ вообще (некуда фидить);
- на СЕБЯ можно ставить только «за успех» (win/over/streak) — заработать
  на собственном сливе нельзя;
- ставка на ДРУГОГО аннулируется с возвратом, если ставивший сам оказался
  в этой катке (любая сторона) — нельзя грифить Васю из его же игры;
- линии kills/KDA считает СЕРВЕР от средних самого игрока (последние
  MATCHES_FOR_LINE каток) — «у меня будет 1+ убийств» не поставить.

Экономика: газ списывается при ставке (эскроу) атомарным UPDATE с
проверкой остатка; выплата ×2 (стрик ×2^K) и возвраты — атомарным
UPSERT в профиль СЕЗОНА КАТКИ. Разрешает поллер: первая рейтинговая
катка цели с started_at > placed_at (streak — серия таких каток).
Рошаны требуют парса — такая ставка «прилипает» к катке (match_id) и
ждёт recheck_parses. Возвраты по TTL: обычные 24ч без катки, streak
7 дней, прилипшая без парса 48ч.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models import User, Bet, DotaMatch, CompendiumProfile
from app.compendium.engine import season_of, current_season, level_for_gas

MARKETS = ("match", "kills", "kda", "roshan", "streak")
STAKE_MIN = 10
STAKE_MAX = 100          # match/kills/kda/roshan
STREAK_STAKE_MAX = {2: 50, 3: 30, 5: 10}  # выплата ×4/×8/×32 — джекпот ≤ 320⛽
ROSHAN_LINE = 2
MATCHES_FOR_LINE = 20
BET_TTL_H = 24
STREAK_TTL_D = 7
STUCK_PARSE_TTL_H = 48

MARKET_NAMES = {
    "match": "исход катки", "kills": "убийства", "kda": "KDA",
    "roshan": "рошаны", "streak": "винстрик",
}


def payout_mult(bet: Bet) -> int:
    return 2 ** bet.line if bet.market == "streak" else 2


def describe(bet_or: dict) -> str:
    """Короткая подпись ставки для карточки/пуша. Принимает dict полей."""
    m, side, line = bet_or["market"], bet_or["side"], bet_or["line"]
    if m == "match":
        return "победа" if side == "win" else "поражение"
    if m == "kills":
        return f"убийств {'≥' if side == 'over' else '<'} {line}"
    if m == "kda":
        return f"KDA {'≥' if side == 'over' else '<'} {line / 10:g}"
    if m == "roshan":
        return f"рошанов {'≥' if side == 'over' else '<'} {line}"
    if m == "streak":
        return f"{line} побед подряд"
    return m


async def lines_for(db, user_id: int) -> dict:
    """Персональные линии: средние последних MATCHES_FOR_LINE рейтинговых.
    Нет истории — дефолты (новичок без каток всё равно скоро их наберёт)."""
    res = await db.execute(
        select(DotaMatch.kills, DotaMatch.deaths, DotaMatch.assists)
        .where(DotaMatch.user_id == user_id)
        .order_by(DotaMatch.started_at.desc())
        .limit(MATCHES_FOR_LINE)
    )
    rows = res.all()
    if not rows:
        return {"kills": 5, "kda": 30}
    kills = [r[0] for r in rows]
    kdas = [((r[0] + r[2]) / max(r[1], 1)) for r in rows]
    kills_line = max(1, round(sum(kills) / len(kills)))
    kda_line = max(5, round(10 * sum(kdas) / len(kdas)))  # KDA×10
    return {"kills": kills_line, "kda": kda_line}


async def _credit(db, user_id: int, season: str, amount: int) -> None:
    """Атомарное зачисление газа в профиль сезона (создаёт при отсутствии) +
    подтяжка вечного comp_max_level. Не коммитит — это дело вызывающего."""
    now = datetime.now(timezone.utc)
    stmt = pg_insert(CompendiumProfile).values(
        user_id=user_id, season=season, gas=amount, updated_at=now,
    ).on_conflict_do_update(
        constraint="uq_compendium_user_season",
        set_={"gas": CompendiumProfile.gas + amount, "updated_at": now},
    )
    await db.execute(stmt)
    gas_res = await db.execute(
        select(CompendiumProfile.gas).where(
            CompendiumProfile.user_id == user_id, CompendiumProfile.season == season
        )
    )
    gas = gas_res.scalar_one_or_none() or 0
    lvl = level_for_gas(gas)
    await db.execute(
        update(User)
        .where(User.id == user_id, (User.comp_max_level.is_(None)) | (User.comp_max_level < lvl))
        .values(comp_max_level=lvl)
    )


async def try_debit(db, user_id: int, season: str, amount: int) -> bool:
    """Списание эскроу: атомарно, только если газа хватает."""
    res = await db.execute(
        update(CompendiumProfile)
        .where(
            CompendiumProfile.user_id == user_id,
            CompendiumProfile.season == season,
            CompendiumProfile.gas >= amount,
        )
        .values(gas=CompendiumProfile.gas - amount, updated_at=datetime.now(timezone.utc))
    )
    return res.rowcount > 0


async def _push_bettor(db, bettor_id: int, title: str, body: str) -> None:
    try:
        from app.push import send_push
        await send_push(db, [bettor_id], title=title, body=body,
                        data={"type": "bet"}, channel_id="messages", priority="high")
    except Exception as e:
        print(f"[bets] push failed: {type(e).__name__}: {e}")


def _roshans_of(row: DotaMatch) -> int:
    try:
        return int((json.loads(row.data or "{}")).get("team_roshans") or 0)
    except Exception:
        return 0


def _kda_x10(row: DotaMatch) -> int:
    return round(10 * (row.kills + row.assists) / max(row.deaths, 1))


async def _finish(db, bet: Bet, won: bool, match_season: str) -> dict:
    """Закрыть ставку выплатой/списанием. Возвращает item для карточки."""
    bet.status = "won" if won else "lost"
    bet.resolved_at = datetime.now(timezone.utc)
    delta = -bet.stake
    if won:
        bet.payout = bet.stake * payout_mult(bet)
        await _credit(db, bet.bettor_id, match_season, bet.payout)
        delta = bet.payout - bet.stake
    return {"outcome": bet.status, "delta": delta}


async def _void(db, bet: Bet, reason: str) -> dict:
    """Аннулировать с возвратом (сам в катке / TTL / нет парса)."""
    bet.status = "refunded"
    bet.resolved_at = datetime.now(timezone.utc)
    bet.payout = bet.stake
    await _credit(db, bet.bettor_id, current_season(), bet.stake)
    return {"outcome": "refunded", "reason": reason, "delta": 0}


def _resolve_simple(bet: Bet, row: DotaMatch) -> bool | None:
    """Исход ставки по строке катки; None = ещё не решается этой каткой."""
    if bet.market == "match":
        return row.is_win if bet.side == "win" else (not row.is_win)
    if bet.market == "kills":
        hit = row.kills >= bet.line
        return hit if bet.side == "over" else (not hit)
    if bet.market == "kda":
        hit = _kda_x10(row) >= bet.line
        return hit if bet.side == "over" else (not hit)
    if bet.market == "roshan":
        if not row.is_parsed:
            return None  # ждём парс
        hit = _roshans_of(row) >= bet.line
        return hit if bet.side == "over" else (not hit)
    return None


async def settle_for_match(db, target: User, row: DotaMatch,
                           participant_accounts: set[int]) -> None:
    """Разрешить открытые ставки на target свежезаписанной каткой row.
    Вызывается из _process_new_match ПОСЛЕ коммита строки. Сам коммитит."""
    bets_res = await db.execute(
        select(Bet).where(Bet.target_id == target.id, Bet.status == "open")
    )
    bets = list(bets_res.scalars().all())
    if not bets:
        return

    bettors_res = await db.execute(
        select(User.id, User.username, User.dota_account_id)
        .where(User.id.in_({b.bettor_id for b in bets}))
    )
    bettors = {uid: (uname, acc) for uid, uname, acc in bettors_res.all()}
    match_season = row.season
    items: list[dict] = []
    pushes: list[tuple[int, str, str]] = []  # шлём ПОСЛЕ коммита — упавший
    # коммит не должен оставить «фантомный» пуш при неразрешённой ставке

    for bet in bets:
        if bet.placed_at >= row.started_at:
            continue  # катка началась до ставки — не считается
        if bet.market == "roshan" and bet.match_id and bet.match_id != row.match_id:
            continue  # прилипла к другой катке, ждёт её парса
        uname, acc = bettors.get(bet.bettor_id, (None, None))
        if uname is None:
            continue

        # Анти-руин: ставка на ДРУГОГО + ставивший сам в этой катке → возврат
        if bet.bettor_id != target.id and acc is not None and acc in participant_accounts:
            item = await _void(db, bet, "сам в катке")
            items.append({**item, "bettor": uname, "market": bet.market,
                          "side": bet.side, "line": bet.line, "stake": bet.stake,
                          "label": describe(bet.__dict__)})
            pushes.append((bet.bettor_id, "🎲 Ставка аннулирована",
                           f"Ты сам был в катке {target.username} — {bet.stake}⛽ вернулись"))
            continue

        if bet.market == "streak":
            if bet.progress_at and row.started_at <= bet.progress_at:
                continue  # катка приехала задним числом — не путаем серию
            if row.is_win:
                bet.progress += 1
                bet.progress_at = row.started_at
                if bet.progress >= bet.line:
                    item = await _finish(db, bet, True, match_season)
                else:
                    continue  # серия продолжается, карточку не спамим
            else:
                item = await _finish(db, bet, False, match_season)
        else:
            verdict = _resolve_simple(bet, row)
            if verdict is None:
                if bet.market == "roshan" and bet.match_id is None:
                    bet.match_id = row.match_id  # прилипаем, ждём парс
                continue
            item = await _finish(db, bet, verdict, match_season)

        items.append({**item, "bettor": uname, "market": bet.market,
                      "side": bet.side, "line": bet.line, "stake": bet.stake,
                      "label": describe(bet.__dict__)})
        emoji = "✅" if item["outcome"] == "won" else "❌"
        won_txt = (f"+{bet.payout - bet.stake}⛽" if item["outcome"] == "won"
                   else f"-{bet.stake}⛽")
        pushes.append((bet.bettor_id, f"🎲 Ставка сыграла {emoji}",
                       f"{target.username}: {describe(bet.__dict__)} — {won_txt}"))

    await db.commit()
    for uid, title, body in pushes:
        await _push_bettor(db, uid, title, body)
    if items:
        await _post_bet_card(db, target, row, items)


async def settle_after_parse(db, target: User, row: DotaMatch,
                             participant_accounts: set[int]) -> None:
    """Рошан-ставки, прилипшие к катке row, — парс доехал. Сам коммитит."""
    bets_res = await db.execute(
        select(Bet).where(
            Bet.target_id == target.id, Bet.status == "open",
            Bet.market == "roshan", Bet.match_id == row.match_id,
        )
    )
    bets = list(bets_res.scalars().all())
    if not bets or not row.is_parsed:
        return
    bettors_res = await db.execute(
        select(User.id, User.username, User.dota_account_id)
        .where(User.id.in_({b.bettor_id for b in bets}))
    )
    bettors = {uid: (uname, acc) for uid, uname, acc in bettors_res.all()}
    items: list[dict] = []
    pushes: list[tuple[int, str, str]] = []
    for bet in bets:
        uname, acc = bettors.get(bet.bettor_id, (None, None))
        if uname is None:
            continue
        if bet.bettor_id != target.id and acc is not None and acc in participant_accounts:
            item = await _void(db, bet, "сам в катке")
        else:
            hit = _roshans_of(row) >= bet.line
            verdict = hit if bet.side == "over" else (not hit)
            item = await _finish(db, bet, verdict, row.season)
        items.append({**item, "bettor": uname, "market": bet.market,
                      "side": bet.side, "line": bet.line, "stake": bet.stake,
                      "label": describe(bet.__dict__)})
        if item["outcome"] != "refunded":
            emoji = "✅" if item["outcome"] == "won" else "❌"
            won_txt = (f"+{bet.payout - bet.stake}⛽" if item["outcome"] == "won"
                       else f"-{bet.stake}⛽")
            pushes.append((bet.bettor_id, f"🎲 Ставка сыграла {emoji}",
                           f"{target.username}: {describe(bet.__dict__)} — {won_txt}"))
    await db.commit()
    for uid, title, body in pushes:
        await _push_bettor(db, uid, title, body)
    if items:
        await _post_bet_card(db, target, row, items)


async def _post_bet_card(db, target: User, row: DotaMatch, items: list[dict]) -> None:
    """Одна карточка на катку со всеми рассуженными ставками — в
    компендиум-чаты цели. Отправитель — сама цель (это её катка)."""
    from app.compendium.poller import _compendium_chats_for, _post_card
    payload = {
        "kind": "bet_result",
        "target_id": target.id,
        "target": target.username,
        "match": {"is_win": row.is_win, "kills": row.kills, "deaths": row.deaths,
                  "assists": row.assists, "duration": row.duration},
        "items": items,
    }
    try:
        chats = await _compendium_chats_for(db, target.id)
        for chat in chats:
            await _post_card(db, chat, target, payload)
    except Exception as e:
        print(f"[bets] card failed: {type(e).__name__}: {e}")


async def sweep_expired(db) -> None:
    """TTL-возвраты: катка не случилась / стрик завис / парс не доехал.
    Сам коммитит. Зовётся из poll_matches под общим локом."""
    now = datetime.now(timezone.utc)
    refunded: list[tuple[int, int]] = []
    res = await db.execute(select(Bet).where(Bet.status == "open"))
    for bet in res.scalars().all():
        age_h = (now - bet.placed_at).total_seconds() / 3600
        expired = (
            (bet.market == "streak" and age_h > STREAK_TTL_D * 24)
            or (bet.market != "streak" and bet.match_id is None and age_h > BET_TTL_H)
            or (bet.match_id is not None and age_h > STUCK_PARSE_TTL_H)
        )
        if not expired:
            continue
        await _void(db, bet, "катка не случилась")
        refunded.append((bet.bettor_id, bet.stake))
    await db.commit()
    for uid, stake in refunded:
        await _push_bettor(db, uid, "🎲 Ставка отменена",
                           f"Катка так и не случилась — {stake}⛽ вернулись")
