"""Движок Гандолиума: контекст игрока, оценка заданий, газ и уровни.

Чистая логика без I/O — на вход строки DotaMatch + уже известные выполнения,
на выход список новых выполнений. Всю запись в БД и карточки делает poller.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.compendium.quests import (
    BY_ID, QUESTS, GAS_PER_LEVEL,
    daily_rotation, weekly_rotation,
)

# МСК (UTC+3, без переходов) — все "дни" и "недели" сезона считаются по нему.
MSK = timezone(timedelta(hours=3))


def to_msk(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MSK)


def season_of(dt: datetime) -> str:
    d = to_msk(dt)
    return f"{d.year:04d}-{d.month:02d}"


def day_key_of(dt: datetime) -> str:
    return to_msk(dt).strftime("%Y-%m-%d")


def week_key_of(dt: datetime) -> str:
    iso = to_msk(dt).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def current_season(now: datetime | None = None) -> str:
    return season_of(now or datetime.now(timezone.utc))


def level_for_gas(gas: int) -> int:
    return gas // GAS_PER_LEVEL + 1


class UserCtx:
    """Контекст одного игрока для предикатов заданий.

    all_rows — матчи за последние ~60 дней (покрывает сезон + хвост прошлой
    недели для стриков), отсортированы по started_at. completions — ключи
    (quest_id, period_key) уже выполненного в текущем сезоне."""

    def __init__(
        self,
        season: str,
        all_rows: list,
        completion_keys: set[tuple[str, str]],
        total_matches_all_time: int,
        prev_before_window: datetime | None = None,
        daily_done_count: int = 0,
    ):
        self.season = season
        self.all_rows = sorted(all_rows, key=lambda r: r.started_at)
        self.rows = [r for r in self.all_rows if r.season == season]
        self.completion_keys = completion_keys
        self.total_matches_all_time = total_matches_all_time
        self.prev_before_window = prev_before_window
        self._daily_done = daily_done_count

    # --- ключи периодов ---
    def day_key(self, m) -> str:
        return day_key_of(m.started_at)

    def week_key(self, m) -> str:
        return week_key_of(m.started_at)

    # --- срезы ---
    def day_rows(self, m) -> list:
        dk = self.day_key(m)
        return [r for r in self.all_rows if day_key_of(r.started_at) == dk]

    def week_rows(self, m) -> list:
        wk = self.week_key(m)
        return [r for r in self.all_rows if week_key_of(r.started_at) == wk]

    # --- стрики (по всей последовательности, границы сезона не рвут серию) ---
    def _rows_up_to(self, m) -> list:
        return [r for r in self.all_rows if r.started_at <= m.started_at]

    def _streak(self, m, pred) -> int:
        n = 0
        for r in reversed(self._rows_up_to(m)):
            if pred(r):
                n += 1
            else:
                break
        return n

    def win_streak_ending_at(self, m) -> int:
        return self._streak(m, lambda r: r.is_win)

    def lose_streak_ending_at(self, m) -> int:
        return self._streak(m, lambda r: not r.is_win)

    def positive_kda_streak_ending_at(self, m) -> int:
        return self._streak(m, lambda r: (r.kills + r.assists) > r.deaths)

    def same_hero_win_streak_ending_at(self, m) -> int:
        return self._streak(m, lambda r: r.is_win and r.hero_id == m.hero_id)

    def gap_before_days(self, m) -> float:
        """Сколько дней прошло с предыдущей катки до этой. 0 — если это
        первая записанная (привязка не считается «возвращением»)."""
        prev = None
        for r in self.all_rows:
            if r.started_at < m.started_at:
                prev = r.started_at
        if prev is None:
            prev = self.prev_before_window
        if prev is None:
            return 0.0
        return (m.started_at - prev).total_seconds() / 86400.0

    def daily_completions_count(self) -> int:
        return self._daily_done


@dataclass
class TeamCtx:
    """Контекст командной проверки для одного участника группы."""
    m: object            # строка DotaMatch этого игрока (team_key уже проставлен)
    size: int            # сколько из чата было в этой команде
    lineup_key: str      # "3-7-12"
    ctx: UserCtx

    def joint_wins_season(self) -> int:
        return sum(1 for r in self.ctx.rows if r.is_win and (r.team_size or 0) >= 2)

    def lineup_prev_result(self) -> bool | None:
        """Результат предыдущей катки ЭТОГО ЖЕ состава (None — её не было)."""
        prev = None
        for r in self.ctx.all_rows:
            if r.team_key == self.lineup_key and r.started_at < self.m.started_at:
                prev = r
        return prev.is_win if prev is not None else None


@dataclass
class Completion:
    quest_id: str
    period_key: str
    gas: int
    match_id: int | None


def _period_key(q, m, season: str) -> str:
    if q.repeat == "match":
        return str(m.match_id)
    if q.repeat == "day":
        return day_key_of(m.started_at)
    if q.repeat == "week":
        return week_key_of(m.started_at)
    # repeat == "period": по категории
    if q.category == "daily":
        return day_key_of(m.started_at)
    if q.category == "weekly":
        return week_key_of(m.started_at)
    return season


def evaluate_match(m, ctx: UserCtx) -> list[Completion]:
    """Прогнать один матч по всем активным заданиям. Возвращает только НОВЫЕ
    выполнения (уже известные отфильтрованы по ctx.completion_keys)."""
    season = m.season
    active: list = []
    active += [BY_ID[qid] for qid in daily_rotation(day_key_of(m.started_at))]
    active += [BY_ID[qid] for qid in weekly_rotation(week_key_of(m.started_at))]
    active += [q for q in QUESTS if q.category in ("season", "anti", "secret") and q.check]

    out: list[Completion] = []
    for q in active:
        if q.check is None:
            continue
        pk = _period_key(q, m, season)
        if (q.id, pk) in ctx.completion_keys:
            continue
        try:
            ok = bool(q.check(m, ctx))
        except Exception:
            ok = False
        if ok:
            out.append(Completion(q.id, pk, q.gas, m.match_id))
            ctx.completion_keys.add((q.id, pk))

    # Марафоны с прогрессом — после матчевых (Стахановец видит свежие ежедневки)
    ctx._daily_done += sum(1 for c in out if BY_ID[c.quest_id].category == "daily")
    for q in QUESTS:
        if q.progress is None:
            continue
        if (q.id, season) in ctx.completion_keys:
            continue
        try:
            cur, target = q.progress(ctx)
        except Exception:
            continue
        if cur >= target:
            out.append(Completion(q.id, season, q.gas, m.match_id))
            ctx.completion_keys.add((q.id, season))
    return out


def evaluate_team(tc: TeamCtx) -> list[Completion]:
    """Командные задания для одного участника сформировавшейся группы."""
    out: list[Completion] = []
    for q in QUESTS:
        if q.team_check is None:
            continue
        pk = tc.m.season  # командные — раз в сезон
        if (q.id, pk) in tc.ctx.completion_keys:
            continue
        try:
            ok = bool(q.team_check(tc))
        except Exception:
            ok = False
        if ok:
            out.append(Completion(q.id, pk, q.gas, tc.m.match_id))
            tc.ctx.completion_keys.add((q.id, pk))
    return out


# ---------- разбор матча OpenDota → поля строки DotaMatch ----------
def _popcount6(mask) -> int:
    try:
        return bin(int(mask) & 0b111111).count("1")
    except Exception:
        return 6


def extract_player_facts(match: dict, player: dict) -> dict:
    """Вытащить всё нужное из /matches/{id} для одного игрока. Работает и для
    непарсенного матча (парс-поля тогда нулевые, is_parsed=False)."""
    import json as _json

    parsed = match.get("version") is not None
    slot = player.get("player_slot") or 0
    is_radiant = slot < 128
    radiant_win = bool(match.get("radiant_win"))
    is_win = radiant_win == is_radiant

    multi = player.get("multi_kills") or {}
    try:
        multi_max = max((int(k) for k, v in multi.items() if v), default=0)
    except Exception:
        multi_max = 0
    streaks = player.get("kill_streaks") or {}
    try:
        streak_max = max((int(k) for k, v in streaks.items() if v), default=0)
    except Exception:
        streak_max = 0
    runes = player.get("runes") or {}
    try:
        runes_total = sum(int(v) for v in runes.values())
    except Exception:
        runes_total = 0

    # Свои бараки: маска стоящих — 0 бит = снесён. own_rax_lost=6 → мегакрипы.
    own_rax_mask = match.get("barracks_status_radiant") if is_radiant else match.get("barracks_status_dire")
    own_rax_lost = 6 - _popcount6(own_rax_mask) if own_rax_mask is not None else 0

    # Рошаны своей команды + личные подборы Аегиса (парс: objectives)
    team_roshans = 0
    aegis_picks = 0
    for obj in match.get("objectives") or []:
        t = obj.get("type")
        if t == "CHAT_MESSAGE_ROSHAN_KILL":
            team = obj.get("team")  # 2 = radiant, 3 = dire
            if (team == 2 and is_radiant) or (team == 3 and not is_radiant):
                team_roshans += 1
        elif t == "CHAT_MESSAGE_AEGIS" and obj.get("player_slot") == slot:
            aegis_picks += 1

    items = [player.get(f"item_{i}") or 0 for i in range(6)]
    items += [player.get(f"backpack_{i}") or 0 for i in range(3)]

    extra = {
        "items": items,
        "own_rax_lost": own_rax_lost,
        "team_roshans": team_roshans,
        "aegis_picks": aegis_picks,
        "party_id": player.get("party_id"),
        "party_size": player.get("party_size"),
    }

    return {
        "started_at": datetime.fromtimestamp(int(match.get("start_time") or 0), tz=timezone.utc),
        "duration": int(match.get("duration") or 0),
        "hero_id": int(player.get("hero_id") or 0),
        "is_win": is_win,
        "is_radiant": is_radiant,
        "kills": int(player.get("kills") or 0),
        "deaths": int(player.get("deaths") or 0),
        "assists": int(player.get("assists") or 0),
        "gpm": int(player.get("gold_per_min") or 0),
        "xpm": int(player.get("xp_per_min") or 0),
        "last_hits": int(player.get("last_hits") or 0),
        "denies": int(player.get("denies") or 0),
        "hero_damage": int(player.get("hero_damage") or 0),
        "tower_damage": int(player.get("tower_damage") or 0),
        "hero_healing": int(player.get("hero_healing") or 0),
        "hero_level": int(player.get("level") or 0),
        "net_worth": int(player.get("net_worth") or player.get("total_gold") or 0),
        "wards_placed": int(player.get("obs_placed") or 0) + int(player.get("sen_placed") or 0),
        "camps_stacked": int(player.get("camps_stacked") or 0),
        "runes_picked": runes_total,
        "multi_kill_max": multi_max,
        "kill_streak_max": streak_max,
        "firstblood": bool(player.get("firstblood_claimed")),
        "lane_role": player.get("lane_role"),
        "is_parsed": parsed,
        "data": _json.dumps(extra, ensure_ascii=False),
    }
