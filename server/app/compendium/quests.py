"""Гандолиум: все задания сезона — 70 по утверждённой концепции + 38
октябрьского пополнения (хеллоуин, именные, штрафные анти; 30.09).

Каждое задание — предикат над строкой DotaMatch (`m`) и контекстом игрока
(`ctx`, см. engine.UserCtx). Категории:

  daily   — пул 27, активны 5/день (детерминированная ротация по дате МСК)
  weekly  — пул 22, активны 7/неделю (ротация по ISO-неделе, сброс в Пн)
  season  — 15: 14 марафонов с progress → (current, target) + разовые
            за сезон с check (s40, d82 «Яшка»), висят весь месяц
  team    — 8 командных, проверяются при совпадении match_id у 2+ из чата
  anti    — 16 анти-ачивок, выдаются сами (полный прожарочный режим);
            у двух самых жёстких gas < 0 — штраф (poller не уводит в минус)
  secret  — 20 пасхалок, в UI скрыты до выполнения

Сезонные «шкурки» названий (октябрь — хеллоуин) — halloween.py, сами
предикаты от них не зависят.

`repeat` задаёт period_key для уникальности выполнения:
  period — дефолт: daily→дата, weekly→неделя ВНУТРИ сезона ("2026-10-W40",
           engine.week_key_of: неделя на стыке месяцев начинается заново
           в новом сезоне), остальные→сезон
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
# С октября 2026 (решение хозяина 30.09): 5 ежедневок и 7 недельных
# одновременно — пулы выросли до 28 и 22, газ капает быстрее, кривая уровней
# в engine это учитывает (потолок 30).
DAILY_ACTIVE = 5
WEEKLY_ACTIVE = 7

# Item ids (OpenDota/dotaconstants): Divine Rapier
ITEM_RAPIER = 133

# ---------- пулы героев для тематических заданий ----------
# Нежить и прочая нечисть (хеллоуин, id героев OpenDota). Список утверждён
# хозяином 30.09.
UNDEAD_HEROES = frozenset({
    14,   # Pudge
    31,   # Lich
    36,   # Necrophos
    85,   # Undying
    42,   # Wraith King
    54,   # Lifestealer
    43,   # Death Prophet
    60,   # Night Stalker
    102,  # Abaddon
    92,   # Visage
    67,   # Spectre
    11,   # Shadow Fiend
    69,   # Doom
    3,    # Bane
    121,  # Grimstroke
    119,  # Dark Willow
    138,  # Muerta
    20,   # Vengeful Spirit
    109,  # Terrorblade
    45,   # Pugna
    30,   # Witch Doctor
})
# «Яшка в Тельняшке» (с 03.10): Снайпер на саппорте
HERO_SNIPER = 35
HERO_WINTER_WYVERN = 112


def is_undead(m) -> bool:
    return m.hero_id in UNDEAD_HEROES


def _night(m) -> bool:
    """Катка начата ночью по МСК (с полуночи до шести)."""
    return 0 <= _hour_msk(m) < 6


def _halloween_night(m) -> bool:
    """Вечер 31 октября по МСК, после 18:00."""
    from datetime import timedelta
    d = m.started_at + timedelta(hours=3)
    return d.month == 10 and d.day == 31 and d.hour >= 18


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
    # w17 переименован по просьбе хозяина (30.09): «Ban» — ник друга.
    Quest("w17", 17, "weekly", "МАРК епта, что ты делаешь", "Три победы подряд в рейтинге", 60,
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
          needs_parse=True, title="Доминатор",
          check=lambda m, ctx: m.kill_streak_max >= 8),
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
    Quest("s38", 38, "season", "Восхождение", "Подними медаль за сезон (ранк-тир вырос)", 400,
          title="Восходящий"),
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
          special="fullstack", title="Фулл-стак",
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
          needs_parse=True, repeat="match", special="rampage", title="Рампага",
          check=lambda m, ctx: m.multi_kill_max >= 5),
    Quest("x60", 60, "secret", "Ультра", "Ультра-килл (4 подряд)", 100,
          needs_parse=True, repeat="match",
          check=lambda m, ctx: m.multi_kill_max == 4),
    Quest("x61", 61, "secret", "Рыцарь рапиры", "Закончил игру с Divine Rapier — и проиграл", 50,
          repeat="match", check=lambda m, ctx: not m.is_win and ITEM_RAPIER in _items(m)),
    Quest("x62", 62, "secret", "Рапира победы", "Закончил победную игру с Divine Rapier", 100,
          repeat="match", check=lambda m, ctx: m.is_win and ITEM_RAPIER in _items(m)),
    Quest("x63", 63, "secret", "Безупречный", "10+ убийств, 0 смертей, победа", 150,
          repeat="match", title="Безупречный",
          check=lambda m, ctx: m.is_win and m.kills >= 10 and m.deaths == 0),
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

    # =====================================================================
    # ОКТЯБРЬСКОЕ ПОПОЛНЕНИЕ (71–108), утверждено хозяином 30.09: хеллоуин,
    # именные ачивки по друзьям, жёсткие анти со штрафом (gas < 0).
    # =====================================================================

    # ================= ЕЖЕДНЕВКИ (71–82) =================
    Quest("d71", 71, "daily", "Нежить", "Победа на герое-нежити (Pudge, Lich, Necro, WK, Undying, SF…)", 20,
          check=lambda m, ctx: m.is_win and is_undead(m)),
    Quest("d72", 72, "daily", "Чёртова дюжина", "Ровно 13 убийств за игру", 20,
          check=lambda m, ctx: m.kills == 13),
    Quest("d73", 73, "daily", "Полуночник", "Победа в катке, начатой между полуночью и тремя ночи", 20,
          check=lambda m, ctx: m.is_win and 0 <= _hour_msk(m) < 3),
    Quest("d74", 74, "daily", "Я тебе вакцину поставлю", "Первая кровь твоя — и победа", 20,
          needs_parse=True, check=lambda m, ctx: m.is_win and m.firstblood),
    Quest("d75", 75, "daily", "Кровавая луна", "Серия из 5+ убийств без смерти", 20,
          needs_parse=True, check=lambda m, ctx: m.kill_streak_max >= 5),
    Quest("d76", 76, "daily", "Гробовщик", "15+ убийств за игру", 25,
          check=lambda m, ctx: m.kills >= 15),
    Quest("d77", 77, "daily", "Живучий", "Поражение в игре 40+ минут, но не больше 3 смертей", 15,
          check=lambda m, ctx: not m.is_win and m.duration >= 40 * 60 and m.deaths <= 3),
    Quest("d78", 78, "daily", "Ведьмин котёл", "Победа с 5+ убийствами и 10+ ассистами", 15,
          check=lambda m, ctx: m.is_win and m.kills >= 5 and m.assists >= 10),
    Quest("d79", 79, "daily", "Разоритель", "12 000+ урона по строениям", 20,
          check=lambda m, ctx: m.tower_damage >= 12000),
    Quest("d80", 80, "daily", "Тьма сгущается", "Победа в игре длиной 50+ минут", 20,
          check=lambda m, ctx: m.is_win and m.duration >= 50 * 60),
    Quest("d81", 81, "daily", "Кальянщик", "Купил 3+ дыма за катку", 20,
          needs_parse=True, title="Кальянщик",
          check=lambda m, ctx: m.is_parsed and _extra(m, "smokes", 0) >= 3),
    # d82 «Яшка в Тельняшке» с 03.10 — сезонное, см. блок марафонов ниже.

    # ================= ЕЖЕНЕДЕЛЬКИ (83–90) =================
    Quest("w83", 83, "weekly", "СуперГимнаст", "Победа без единой смерти в игре 40+ минут", 80,
          check=lambda m, ctx: m.is_win and m.deaths == 0 and m.duration >= 40 * 60),
    Quest("w84", 84, "weekly", "Аня лечи меня, АНЯ!", "10 000+ лечения союзников за одну игру", 70,
          check=lambda m, ctx: m.hero_healing >= 10000),
    Quest("w85", 85, "weekly", "Некромант", "3 победы на нежити за неделю", 70, title="Некромант",
          check=lambda m, ctx: sum(1 for r in ctx.week_rows(m) if r.is_win and is_undead(r)) >= 3),
    Quest("w86", 86, "weekly", "Экзорцист", "Победа против 2+ героев-нежити в составе врага", 60,
          check=lambda m, ctx: m.is_win
          and sum(1 for h in _extra(m, "enemy_heroes", []) if h in UNDEAD_HEROES) >= 2),
    Quest("w87", 87, "weekly", "Голова с плеч", "10+ убийств на герое-нежити", 60,
          check=lambda m, ctx: is_undead(m) and m.kills >= 10),
    Quest("w88", 88, "weekly", "Восставший", "Победа сразу после 3+ поражений подряд", 60,
          check=lambda m, ctx: m.is_win and ctx.lose_streak_before(m) >= 3),
    Quest("w89", 89, "weekly", "Кладбищенский сторож", "15+ вардов за игру", 50,
          needs_parse=True, check=lambda m, ctx: m.is_parsed and m.wards_placed >= 15),
    Quest("w90", 90, "weekly", "Жатва", "40+ убийств суммарно за один день", 60,
          check=lambda m, ctx: sum(r.kills for r in ctx.day_rows(m)) >= 40),

    # ================= МАРАФОНЫ СЕЗОНА (91–94) =================
    Quest("s91", 91, "season", "Ваня Виверна", "10 каток на Winter Wyvern за сезон", 200, title="Виверна",
          progress=lambda ctx: (sum(1 for r in ctx.rows if r.hero_id == HERO_WINTER_WYVERN), 10)),
    Quest("s92", 92, "season", "Тыквенный марафон", "13 побед на нежити за сезон", 250,
          progress=lambda ctx: (sum(1 for r in ctx.rows if r.is_win and is_undead(r)), 13)),
    Quest("s93", 93, "season", "Ночной дозор", "10 каток, начатых после полуночи, за сезон", 150,
          progress=lambda ctx: (sum(1 for r in ctx.rows if _night(r)), 10)),
    Quest("s94", 94, "season", "Легион", "15 каток с людьми из чата за сезон", 200,
          progress=lambda ctx: (sum(1 for r in ctx.rows if (r.team_size or 0) >= 2), 15)),
    # «Яшка в Тельняшке» — переделано по просьбе хозяина 03.10: была ежедневка
    # «победа на морском герое», стало сезонное разовое (как s40): Снайпер на
    # позиции поддержки (4/5; детекция саппорта — 5+ вардов, нужен парс 📼) с
    # положительным KDA (K+A > D, как в «Стабильности»). id оставлен «d82»,
    # чтобы уже полученные выполнения не пропали с полок трофеев (поиск по
    # BY_ID; категория — поле, по префиксу id ничего не считается). Из пула
    # ежедневок выбыло → ротация дня деплоя перетасовалась один раз.
    Quest("d82", 82, "season", "Яшка в Тельняшке",
          "Снайпер на саппорте (4/5 позиция) с положительным KDA — раз за сезон", 60,
          needs_parse=True,
          check=lambda m, ctx: m.hero_id == HERO_SNIPER and is_support_game(m)
          and (m.kills + m.assists) > m.deaths),

    # ================= АНТИ-АЧИВКИ (95–100) =================
    # Две самые жёсткие — со ШТРАФОМ (gas < 0; poller не даёт уйти ниже нуля).
    Quest("a95", 95, "anti", "Чел, ну это жесть", "0–1 убийств и 15+ смертей. Я даже прибавить газа не могу тебе: −25", -25,
          repeat="day", title="Жесть",
          check=lambda m, ctx: m.kills <= 1 and m.deaths >= 15),
    Quest("a96", 96, "anti", "Ливер", "Бросил катку (abandon): −20 газа", -20,
          repeat="day", title="Ливер",
          check=lambda m, ctx: _extra(m, "leaver", 0) >= 2),
    Quest("a97", 97, "anti", "Зомби", "0 убийств и 0 ассистов за 30+ минут", 15,
          repeat="day", check=lambda m, ctx: m.duration >= 30 * 60 and m.kills == 0 and m.assists == 0),
    Quest("a98", 98, "anti", "Призрак", "GPM меньше 250 за 30+ минут", 10,
          repeat="day", check=lambda m, ctx: m.duration >= 30 * 60 and m.gpm < 250),
    Quest("a99", 99, "anti", "Пугало", "0 урона по строениям за 40+ минут", 10,
          repeat="day", check=lambda m, ctx: m.duration >= 40 * 60 and m.tower_damage == 0),
    Quest("a100", 100, "anti", "Тильт-машина", "4+ катки за день — и все проиграны", 25,
          repeat="day", title="Тильт",
          check=lambda m, ctx: len(ctx.day_rows(m)) >= 4 and not any(r.is_win for r in ctx.day_rows(m))),

    # ================= ПАСХАЛКИ (101–108) =================
    Quest("x101", 101, "secret", "Виверна, я тебя знаю", "25 каток на Winter Wyvern за сезон", 150,
          check=lambda m, ctx: sum(1 for r in ctx.season_rows_up_to(m) if r.hero_id == HERO_WINTER_WYVERN) == 25),
    Quest("x102", 102, "secret", "Хеллоуин", "Победа вечером 31 октября (после 18:00)", 66,
          repeat="week", check=lambda m, ctx: m.is_win and _halloween_night(m)),
    Quest("x103", 103, "secret", "Число зверя", "6 убийств, 6 смертей, 6 ассистов", 66,
          repeat="match", check=lambda m, ctx: m.kills == 6 and m.deaths == 6 and m.assists == 6),
    Quest("x104", 104, "secret", "Восставший из фида", "Победа с 12+ смертями", 50,
          repeat="week", title="Восставший из фида",
          check=lambda m, ctx: m.is_win and m.deaths >= 12),
    Quest("x105", 105, "secret", "Ночной кошмар", "3 победы за одну ночь (с полуночи до шести)", 100,
          repeat="week", check=lambda m, ctx: sum(1 for r in ctx.day_rows(m) if r.is_win and _night(r)) >= 3),
    Quest("x106", 106, "secret", "Тыквенный король", "5 побед подряд на нежити", 150,
          repeat="week", title="Тыквенный король",
          check=lambda m, ctx: m.is_win and is_undead(m) and ctx.undead_win_streak_ending_at(m) >= 5),
    Quest("x107", 107, "secret", "Кровавый след", "25+ убийств за игру", 100,
          repeat="match", check=lambda m, ctx: m.kills >= 25),
    Quest("x108", 108, "secret", "Дым и зеркала", "5+ дымов за катку", 60,
          needs_parse=True, repeat="week", check=lambda m, ctx: m.is_parsed and _extra(m, "smokes", 0) >= 5),
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
