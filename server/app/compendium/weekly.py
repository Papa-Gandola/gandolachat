"""«Итоги недели» — воскресная карточка Гандолиума.

Вс 21:00 МСК (18:00 UTC): топ-3 по газу за неделю, винрейт недели (от
3 каток), «Граммар-наци недели» (наибольший недельный прирост счётчика
grammar_errors — база срезается тут же, users.grammar_wk_base). Карточка
`/quest_card kind=week_recap` во все компендиум-чаты + пуш.

Неделя = с понедельника 00:00 МСК по момент джобы. Идемпотентность не
нужна: cron стреляет раз в неделю, рестарт после выстрела просто ждёт
следующего воскресенья (пропущенное воскресенье не догоняем — некритично
для развлекательной карточки). Совсем пустая неделя — карточки нет.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func, update

from app.database import AsyncSessionLocal
from app.models import User, Chat, chat_members, DotaMatch, QuestCompletion
from app.compendium.finale import MONTHS_GEN

MIN_GAMES_FOR_WINRATE = 3


def _week_label(mon, sun) -> str:
    m1, m2 = MONTHS_GEN[mon.month - 1], MONTHS_GEN[sun.month - 1]
    if mon.month == sun.month:
        return f"{mon.day}–{sun.day} {m2}"
    return f"{mon.day} {m1} — {sun.day} {m2}"


async def week_recap() -> None:
    from app.compendium.poller import _JOB_LOCK, _post_card
    async with _JOB_LOCK, AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        now_msk = now + timedelta(hours=3)
        monday_msk = (now_msk - timedelta(days=now_msk.weekday())).date()
        week_start = datetime(monday_msk.year, monday_msk.month, monday_msk.day,
                              tzinfo=timezone.utc) - timedelta(hours=3)
        sunday_msk = monday_msk + timedelta(days=6)

        gas_res = await db.execute(
            select(QuestCompletion.user_id, func.sum(QuestCompletion.gas))
            .where(QuestCompletion.completed_at >= week_start, QuestCompletion.gas > 0)
            .group_by(QuestCompletion.user_id)
            .order_by(func.sum(QuestCompletion.gas).desc())
        )
        gas_rows = gas_res.all()

        # Винрейт считаем поштучно: sum(bool) капризен между диалектами
        m_res = await db.execute(
            select(DotaMatch.user_id, DotaMatch.is_win)
            .where(DotaMatch.started_at >= week_start)
        )
        games: dict[int, list[bool]] = {}
        for uid, w in m_res.all():
            games.setdefault(uid, []).append(bool(w))

        g_res = await db.execute(
            select(User.id, User.username, User.grammar_errors, User.grammar_wk_base)
        )
        users_all = g_res.all()
        names = {uid: uname for uid, uname, _, _ in users_all}
        grammar_deltas = [
            (uid, (ge or 0) - (base or 0))
            for uid, _, ge, base in users_all
            if (ge or 0) - (base or 0) > 0
        ]
        grammar_deltas.sort(key=lambda x: -x[1])

        top_gas = [
            {"username": names.get(uid, "?"), "gas": int(g)}
            for uid, g in gas_rows[:3] if names.get(uid)
        ]
        winrate = sorted(
            (
                {"username": names.get(uid, "?"), "games": len(ws),
                 "wins": sum(ws), "pct": round(100 * sum(ws) / len(ws))}
                for uid, ws in games.items()
                if len(ws) >= MIN_GAMES_FOR_WINRATE and names.get(uid)
            ),
            key=lambda r: (-r["pct"], -r["games"]),
        )[:3]
        grammar = None
        if grammar_deltas:
            uid, delta = grammar_deltas[0]
            grammar = {"username": names.get(uid, "?"), "errors": delta}

        # Срезаем базу ВСЕМ (и тем, кто без ошибок — база догоняет счётчик)
        await db.execute(update(User).values(grammar_wk_base=User.grammar_errors))
        await db.commit()

        if not top_gas and not winrate and not grammar:
            print("[weekly] неделя пустая — карточки не будет")
            return

        payload = {
            "kind": "week_recap",
            "week_label": _week_label(monday_msk, sunday_msk),
            "top_gas": top_gas,
            "winrate": winrate,
            "grammar": grammar,
        }
        push_body = (
            f"Топ по газу: {top_gas[0]['username']} ({top_gas[0]['gas']}⛽)"
            if top_gas else
            (f"Граммар-наци недели отмечает: {grammar['username']}" if grammar else "Смотри карточку в чате")
        )

        # По чатам: отправитель — топ-газ участник чата, фолбэк — создатель.
        gas_order = [uid for uid, _ in gas_rows]
        chats_res = await db.execute(
            select(Chat.id).where(Chat.compendium_enabled.is_(True), Chat.is_group.is_(True))
        )
        for (cid,) in chats_res.all():
            try:
                chat = (await db.execute(select(Chat).where(Chat.id == cid))).scalar_one_or_none()
                if not chat:
                    continue
                mem_res = await db.execute(
                    select(chat_members.c.user_id).where(chat_members.c.chat_id == cid)
                )
                member_ids = {r[0] for r in mem_res.all()}
                sender_id = next((uid for uid in gas_order if uid in member_ids), chat.created_by)
                sender = (await db.execute(select(User).where(User.id == sender_id))).scalar_one_or_none()
                if not sender:
                    continue
                await _post_card(db, chat, sender, payload,
                                 push_title="📅 Итоги недели", push_body=push_body)
            except Exception as e:
                try:
                    await db.rollback()
                except Exception:
                    pass
                print(f"[weekly] карточка в чат {cid} не ушла: {type(e).__name__}: {e}")
