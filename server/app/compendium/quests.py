"""Гандолиум: все 70 заданий сезона, 1-в-1 по утверждённой концепции.

Каждое задание — предикат над строкой DotaMatch (`m`) и контекстом игрока
(`ctx`, см. engine.UserCtx). Категории:

  daily   — пул 16, активны 3/день (детерминированная ротация по дате МСК)
  weekly  — пул 14, активны 3/неделю (ротация по ISO-неделе, сброс в Пн)
  season  — 10 марафонов, висят весь месяц (progress → (current, target))
  team    — 8 командных, проверяются при совпадении match_id у 2+ из чата
  anti    — 10 анти-ачивок, выдаются сами (полный прожарочный режим)
  secret  — 12 пасхалок, в UI скрыты до выполнения

`repeat` задаёт period_key для уникальности выполнения:
  period — дефолт: daily→дата, weekly→неделя, остальные→сезон
  match  — можно повторять, ключ = match_id (рампага каждый раз — карточка)
  day    — не чаще раза в день (прожарки за фид)
  week   — не чаще раза в неделю (жирные пасхалки, чтобы не фармили)

Условности детекции (честные допущения, обсуждены в концепции):
  саппорт = 5+ вардов за игру (📼), кор = 120+ ластхитов.
Баланс газа черновой — крутится здесь в одном месте.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable, Optional

GAS_PER_LEVEL = 100
DAILY_ACTIVE = 3
WEEKLY_ACTIVE = 3

# Item ids (OpenDota/dotaconstants): Divine Rapier
ITEM_RAPIER = 133


# ---------- role helpers (по строке DotaMatch) ----------
def kda(m) -> float:
    return (m.kills + m.assists) / max(m.deaths, 1)


def is_support_game(m) -> bool:
    """Сыграл как саппорт: 5+ вардов (нужен парс — до парса wards=0)."""
    return m.is_parsed and m.wards_placed >= 5


def is_core_game(m) -> bool:
    return m.last_hits >= 120


def _hour_msk(m) -> int:
    # started_at хранится в UTC; сдвиг на МСК делает engine при записи? Нет —
    # честно считаем тут: +3 часа без DST.
    from datetime import timedelta
    return (m.started_at + timedelta(hours=3)).hour


def _items(m) -> list[int]:
    import json
    try:
        d = json.loads(m.data or "{}")
        return [int(x) for x in (d.get("items") or [])]
    except Exception:
        return []


def _extra(m, key, default=0):
    import json
    try:
        d = json.loads(m.data or "{}")
        return d.get(key, default)
    except Exception:
        return default


@dataclass(frozen=True)
class Quest:
    id: str
    num: int                      # номер из концепции (01–70)
    category: str                 # daily|weekly|season|team|anti|secret
    name: str
    desc: str
    gas: int
    needs_parse: bool = False
    check: Optional[Callable] = None       # fn(m, ctx) -> bool
    progress: Optional[Callable] = None    # fn(ctx) -> (current, target) — марафоны
    team_check: Optional[Callable] = None  # fn(tc) -> bool — командные (TeamCtx)
    repeat: str = "period"
    special: Optional[str] = None          # rampage|fullstack — особая карточка + пуш
    title: Optional[str] = None            # титул позора/славы (для полки трофеев)


QUESTS: list[Quest] = [
    # ================= ЕЖЕДНЕВКИ (01–16) =================
    Quest("d01", 1, "daily", "Победная", "Выиграй рейтинговую катку", 15,
          check=lambda m, ctx: m.is_win),
    Quest("d02", 2, "daily", "Двойная доза", "Две победы за один день", 25,
          check=lambda m, ctx: sum(1 for r in ctx.day_rows(m) if r.is_win) >= 2),
    Quest("d03", 3, "daily", "Бессмертный", "Победа с ≤1 смертью", 20,
          check=lambda m, ctx: m.is_win and m.deaths <= 1),
    Quest("d04", 4, "daily", "Фармила", "GPM 600+ за игру", 15,
          check=lambda m, ctx: m.gpm >= 600),
    Quest("d05", 5, "daily", "Мудрец", "XPM 700+ за игру", 15,
          check=lambda m, ctx: m.xpm >= 700),
    Quest("d06", 6, "daily", "Крипоед", "300+ ластхитов за игру", 20,
          check=lambda m, ctx: m.last_hits >= 300),
    Quest("d07", 7, "daily", "Жадина", "20+ денаев за игру", 15,
          check=lambda m, ctx: m.denies >= 20),
    Quest("d08", 8, "daily", "Терминатор", "10+ убийств за игру", 15,
          check=lambda m, ctx: m.kills >= 10),
    Quest("d09", 9, "daily", "Дирижёр", "20+ ассистов за игру", 15,
          check=lambda m, ctx: m.assists >= 20),
    Quest("d10", 10, "daily", "KDA-машина", "KDA ≥ 10 за игру", 20,
          check=lambda m, ctx: kda(m) >= 10),
    Quest("d11", 11, "daily", "Разрушитель", "8 000+ урона по строениям", 15,
          check=lambda m, ctx: m.tower_damage >= 8000),
    Quest("d12", 12, "daily", "Медбрат", "5 000+ лечения союзников", 15,
          check=lambda m, ctx: m.hero_healing >= 5000),
    Quest("d13", 13, "daily", "Глаза команды", "10+ вардов (обсы + сентри) за игру", 15,
          needs_parse=True, check=lambda m, ctx: m.is_parsed and m.wards_placed >= 10),
    Quest("d14", 14, "daily", "Лесник", "6+ стаков лагерей за игру", 20,
          needs_parse=True, check=lambda m, ctx: m.is_parsed and m.camps_stacked >= 6),
    Quest("d15", 15, "daily", "Бегущий по рунам", "6+ подобранных рун за игру", 10,
          needs_parse=True, check=lambda m, ctx: m.is_parsed and m.runes_picked >= 6),
    Quest("d16", 16, "daily", "Скромный герой", "Победа с ≤3 убийствами, но 15+ ассистов", 20,
          check=lambda m, ctx: m.is_win and m.kills <= 3 and m.assists >= 15),

    # ================= ЕЖЕНЕДЕЛЬКИ (17–30) =================
    Quest("w17", 17, "weekly", "Серийник", "Винстрик 3 рейтинговых подряд", 60,
          check=lambda m, ctx: ctx.win_streak_ending_at(m) >= 3),
    Quest("w18", 18, "weekly", "Работяга", "7 рейтинговых за неделю", 50,
          check=lambda m, ctx: len(ctx.week_rows(m)) >= 7),
    Quest("w19", 19, "weekly", "Пятидневка", "Сыграй в 5 разных дней недели", 60,
          check=lambda m, ctx: len({ctx.day_key(r) for r in ctx.week_rows(m)}) >= 5),
    Quest("w20", 20, "weekly", "Гроссмейстер пула", "Победы на 5 разных героях за неделю", 70,
          check=lambda m, ctx: len({r.hero_id for r in ctx.week_rows(m) if r.is_win}) >= 5),
    Quest("w21", 21, "weekly", "Мясник", "Трипл-килл или лучше", 60,
          needs_parse=True, check=lambda m, ctx: m.multi_kill_max >= 3),
    Quest("w22", 22, "weekly", "Доминатор", "Серия из 8+ убийств без смерти", 70,
          needs_parse=True, check=lambda m, ctx: m.kill_streak_max >= 8),
    Quest("w23", 23, "weekly", "Спидраннер", "Победа за 25 минут или быстрее", 50,
          check=lambda m, ctx: m.is_win and m.duration <= 25 * 60),
    Quest("w24", 24, "weekly", "Осада века", "Победа в игре длиной 60+ минут", 60,
          check=lambda m, ctx: m.is_win and m.duration >= 60 * 60),
    Quest("w25", 25, "weekly", "Тонна урона", "40 000+ урона по героям в одной игре", 50,
          check=lambda m, ctx: m.hero_damage >= 40000),
    Quest("w26", 26, "weekly", "Первая кровь", "Забери фёрстблад", 40,
          needs_parse=True, check=lambda m, ctx: m.firstblood),
    Quest("w27", 27, "weekly", "Стабильность", "3 игры подряд с положительным KDA", 50,
          check=lambda m, ctx: ctx.positive_kda_streak_ending_at(m) >= 3),
    Quest("w28", 28, "weekly", "Два лица", "За неделю: победа на коре И победа на саппорте", 70,
          needs_parse=True,
          check=lambda m, ctx: any(r.is_win and is_core_game(r) for r in ctx.week_rows(m))
          and any(r.is_win and is_support_game(r) for r in ctx.week_rows(m))),
    Quest("w29", 29, "weekly", "Рошан наш", "Команда забрала 2+ Рошанов, и вы победили", 50,
          needs_parse=True, check=lambda m, ctx: m.is_win and _extra(m, "team_roshans", 0) >= 2),
    Quest("w30", 30, "weekly", "Уровень эго", "Достигни 25 уровня героя в победной игре", 40,
          check=lambda m, ctx: m.is_win and m.hero_level >= 25),

    # ================= МАРАФОНЫ СЕЗОНА (31–40) =================
    Quest("s31", 31, "season", "Марафонец", "30 рейтинговых за сезон", 200,
          progress=lambda ctx: (len(ctx.rows), 30)),
    Quest("s32", 32, "season", "Двадцаточка", "20 побед за сезон", 250,
          progress=lambda ctx: (sum(1 for r in ctx.rows if r.is_win), 20)),
    Quest("s33", 33, "season", "Коллекционер", "Победы на 12 разных героях за сезон", 200,
          progress=lambda ctx: (len({r.hero_id for r in ctx.rows if r.is_win}), 12)),
    Quest("s34", 34, "season", "Универсал", "Победы на коре, на миде и на саппорте за сезон", 300,
          needs_parse=True,
          progress=lambda ctx: (
              sum([
                  any(r.is_win and r.lane_role == 2 for r in ctx.rows),
                  any(r.is_win and r.lane_role in (1, 3) and is_core_game(r) for r in ctx.rows),
                  any(r.is_win and is_support_game(r) for r in ctx.rows),
              ]), 3)),
    Quest("s35", 35, "season", "Комбайн", "5 000 ластхитов суммарно за сезон", 150,
          progress=lambda ctx: (sum(r.last_hits for r in ctx.rows), 5000)),
    Quest("s36", 36, "season", "Жнец", "300 убийств суммарно за сезон", 200,
          progress=lambda ctx: (sum(r.kills for r in ctx.rows), 300)),
    Quest("s37", 37, "season", "Смотрящий", "200 вардов суммарно за сезон", 200,
          needs_parse=True,
          progress=lambda ctx: (sum(r.wards_placed for r in ctx.rows), 200)),
    # s38 «Восхождение» проверяется не по матчу, а при обновлении звания (poller).
    Quest("s38", 38, "season", "Восхождение", "Подними медаль за сезон (ранк-тир вырос)", 400),
    Quest("s39", 39, "season", "Стахановец", "Закрой 20 ежедневок за сезон", 150,
          progress=lambda ctx: (ctx.daily_completions_count(), 20)),
    Quest("s40", 40, "season", "Отбились от мег", "Победа в игре, где у вас снесли все бараки", 300,
          check=lambda m, ctx: m.is_win and _extra(m, "own_rax_lost", 0) >= 6),

    # ================= КОМАНДНЫЕ (41–48) =================
    Quest("t41", 41, "team", "Дуо-катка", "Победа вдвоём из чата в одной команде", 40,
          team_check=lambda tc: tc.size >= 2 and tc.m.is_win),
    Quest("t42", 42, "team", "Трио", "Победа втроём из чата", 60,
          team_check=lambda tc: tc.size >= 3 and tc.m.is_win),
    Quest("t43", 43, "team", "ФУЛЛ СТАК", "Победа полным стаком 5/5 из чата", 150,
          special="fullstack",
          team_check=lambda tc: tc.size >= 5 and tc.m.is_win),
    Quest("t44", 44, "team", "Дружба крепче ММР", "5 совместных побед (от двоих) за сезон", 100,
          team_check=lambda tc: tc.joint_wins_season() >= 5),
    Quest("t45", 45, "team", "Спина к спине", "Две победы подряд одним и тем же составом", 80,
          team_check=lambda tc: tc.m.is_win and tc.lineup_prev_result() is True),
    Quest("t46", 46, "team", "Караван", "Стак 3+ выигрывает катку за ≤30 минут", 90,
          team_check=lambda tc: tc.size >= 3 and tc.m.is_win and tc.m.duration <= 30 * 60),
    Quest("t47", 47, "team", "Реванш-машина", "Стак проиграл — и тем же составом взял следующую", 120,
          team_check=lambda tc: tc.m.is_win and tc.lineup_prev_result() is False),
    Quest("t48", 48, "team", "Ночная смена", "Совместная победа в катке, начатой после полуночи", 50,
          team_check=lambda tc: tc.m.is_win and 0 <= _hour_msk(tc.m) < 6),

    # ================= АНТИ-АЧИВКИ (49–58) =================
    # a49 «Дно недели» и a58 «Якорь сезона» вешает еженедельная джоба (poller).
    Quest("a49", 49, "anti", "Дно недели", "Худший винрейт недели среди активных (мин. 5 игр)", 30,
          title="💀 Дно недели"),
    Quest("a50", 50, "anti", "Курьер бронзы", "0–1 убийств и 10+ смертей за игру", 10,
          repeat="day", title="Курьер",
          check=lambda m, ctx: m.kills <= 1 and m.deaths >= 10),
    Quest("a51", 51, "anti", "Донор крови", "15+ смертей за одну игру", 15,
          repeat="day", check=lambda m, ctx: m.deaths >= 15),
    Quest("a52", 52, "anti", "Спонсор вражеского кэрри", "3 поражения подряд", 20,
          repeat="match", check=lambda m, ctx: ctx.lose_streak_ending_at(m) == 3),
    Quest("a53", 53, "anti", "Слепой саппорт", "Игра на саппорте с 0 вардов", 10,
          needs_parse=True, repeat="day", title="Гринч",
          check=lambda m, ctx: m.is_parsed and m.duration >= 25 * 60 and m.wards_placed == 0
          and (m.lane_role == 4 or (m.last_hits < 60 and m.gpm < 350))),
    Quest("a54", 54, "anti", "Фармил, пока базу сносили", "GPM 700+ и поражение", 15,
          repeat="day", check=lambda m, ctx: m.gpm >= 700 and not m.is_win),
    Quest("a55", 55, "anti", "Пацифист поневоле", "Меньше 8 000 урона по героям за 40+ минут", 10,
          repeat="day", check=lambda m, ctx: m.duration >= 40 * 60 and m.hero_damage < 8000),
    Quest("a56", 56, "anti", "Проклятый", "Лузстрик 5 — чат обязан нажать F", 40,
          repeat="match", title="Проклятый",
          check=lambda m, ctx: ctx.lose_streak_ending_at(m) == 5),
    Quest("a57", 57, "anti", "Так близко", "Поражение в игре длиной 55+ минут", 15,
          repeat="day", check=lambda m, ctx: not m.is_win and m.duration >= 55 * 60),
    Quest("a58", 58, "anti", "Якорь сезона", "Стал «Дном недели» дважды за сезон", 50,
          title="Якорь сезона"),

    # ================= ПАСХАЛКИ (59–70) =================
    Quest("x59", 59, "secret", "РАМПАГА", "Пентакилл!", 200,
          needs_parse=True, repeat="match", special="rampage",
          check=lambda m, ctx: m.multi_kill_max >= 5),
    Quest("x60", 60, "secret", "Ультра", "Ультра-килл (4 подряд)", 100,
          needs_parse=True, repeat="match",
          check=lambda m, ctx: m.multi_kill_max == 4),
    Quest("x61", 61, "secret", "Рыцарь рапиры", "Закончил игру с Divine Rapier — и проиграл", 50,
          repeat="match", check=lambda m, ctx: not m.is_win and ITEM_RAPIER in _items(m)),
    Quest("x62", 62, "secret", "Рапира победы", "Закончил победную игру с Divine Rapier", 100,
          repeat="match", check=lambda m, ctx: m.is_win and ITEM_RAPIER in _items(m)),
    Quest("x63", 63, "secret", "Безупречный", "10+ убийств, 0 смертей, победа", 150,
          repeat="match", check=lambda m, ctx: m.is_win and m.kills >= 10 and m.deaths == 0),
    Quest("x64", 64, "secret", "Юбилейная", "Твоя сотая рейтинговая с момента привязки", 100,
          check=lambda m, ctx: ctx.total_matches_all_time == 100),
    Quest("x65", 65, "secret", "Сова", "Победа в катке, начатой после трёх ночи", 50,
          repeat="week", check=lambda m, ctx: m.is_win and 3 <= _hour_msk(m) < 7),
    Quest("x66", 66, "secret", "Однолюб", "3 победы подряд на одном герое", 80,
          repeat="week",
          check=lambda m, ctx: m.is_win and ctx.same_hero_win_streak_ending_at(m) >= 3),
    Quest("x67", 67, "secret", "С возвращением", "Первая катка после перерыва 7+ дней", 30,
          repeat="match", check=lambda m, ctx: ctx.gap_before_days(m) >= 7),
    Quest("x68", 68, "secret", "Царь горы", "Лично подобрал 2+ Аегиса за игру", 100,
          needs_parse=True, repeat="match",
          check=lambda m, ctx: _extra(m, "aegis_picks", 0) >= 2),
    Quest("x69", 69, "secret", "Олигарх", "Нетворс 40 000+ за игру", 60,
          repeat="week", check=lambda m, ctx: m.net_worth >= 40000),
    Quest("x70", 70, "secret", "Смурф?", "KDA 20+ за игру", 100,
          repeat="week", check=lambda m, ctx: kda(m) >= 20),
]

BY_ID: dict[str, Quest] = {q.id: q for q in QUESTS}
DAILY_POOL = [q.id for q in QUESTS if q.category == "daily"]
WEEKLY_POOL = [q.id for q in QUESTS if q.category == "weekly"]
SEASON_IDS = [q.id for q in QUESTS if q.category == "season"]
TEAM_IDS = [q.id for q in QUESTS if q.category == "team"]
ANTI_IDS = [q.id for q in QUESTS if q.category == "anti"]
SECRET_IDS = [q.id for q in QUESTS if q.category == "secret"]


def daily_rotation(day_key: str) -> list[str]:
    """Детерминированные 3 ежедневки на дату — переживают рестарты сервера."""
    rnd = random.Random(f"gandolium:daily:{day_key}")
    return sorted(rnd.sample(DAILY_POOL, DAILY_ACTIVE))


def weekly_rotation(week_key: str) -> list[str]:
    rnd = random.Random(f"gandolium:weekly:{week_key}")
    return sorted(rnd.sample(WEEKLY_POOL, WEEKLY_ACTIVE))
