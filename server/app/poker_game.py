"""In-memory poker game state for sit-and-go tournaments.

One Game per active table. Holds the deck, hole cards, community cards,
betting round state, and a queue of action expectations. Persists nothing
itself — the API layer can snapshot stack values into PokerSeat between hands.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone
import random
import time

from app.poker_engine import Card, shuffled_deck, best_of_seven, describe


@dataclass
class PlayerState:
    user_id: int
    seat_index: int
    stack: int
    hole: list[Card] = field(default_factory=list)
    bet: int = 0          # amount put into the pot in the current betting round
    total_committed: int = 0  # total committed during this hand (across rounds)
    has_folded: bool = False
    is_all_in: bool = False
    has_acted: bool = False  # acted in current betting round


@dataclass
class HandState:
    hand_no: int
    button_seat: int           # seat index of the dealer button
    deck: list[Card]
    community: list[Card] = field(default_factory=list)
    pot: int = 0
    current_bet: int = 0       # max bet to match in this round
    min_raise: int = 0         # min raise increment
    last_aggressor_seat: Optional[int] = None
    to_act_seat: Optional[int] = None
    street: str = "preflop"   # preflop | flop | turn | river | showdown | done
    last_action: Optional[dict] = None  # for UI


@dataclass
class GameState:
    table_id: int
    chat_id: int
    players: dict[int, PlayerState]   # by user_id
    seat_order: list[int]             # user_ids in seat-index order at table start
    small_blind: int
    big_blind: int
    blind_increase_seconds: int
    started_at: float                  # epoch seconds
    next_blind_increase_at: float
    blind_level: int = 0               # how many times blinds have been raised
    hand: Optional[HandState] = None
    finished: bool = False
    winner_user_id: Optional[int] = None
    last_summary: Optional[dict] = None  # last showdown summary for UI
    # --- настройки стола, нужные движку (зеркало models.PokerTable) ---
    starting_stack: int = 0
    mode: str = "chips"            # chips | gas («за газ ⛽»)
    entry_gas: int = 0
    max_reentries: int = 2
    reentry_until_level: int = 3   # докупка открыта, пока blind_level < этого
    gas_pot: int = 0               # котёл: энтри + докупки, уходит победителю
    reentries: dict[int, int] = field(default_factory=dict)  # user_id → сколько раз докупался
    # Пауза «докупись или всё»: фишки остались у одного, но вылетевшие ещё
    # вправе докупиться — до дедлайна турнир не закрываем (WS-слой ждёт).
    reentry_open_until: Optional[float] = None
    # История раздач — в памяти, пока стол жив (хозяин: «потом пофиг»)
    hand_log: Optional[dict] = None
    history: list[dict] = field(default_factory=list)

    # ---- helpers -------------------------------------------------------
    def alive_players(self) -> list[PlayerState]:
        """Players still in the tournament (have chips OR are mid-hand)."""
        return [p for p in self.players.values() if p.stack > 0 or (self.hand and not p.has_folded and p.is_all_in)]

    def players_in_hand(self) -> list[PlayerState]:
        return [p for p in self.players.values() if not p.has_folded]

    def players_can_act(self) -> list[PlayerState]:
        return [p for p in self.players_in_hand() if not p.is_all_in]

    def seat_player(self, seat: int) -> Optional[PlayerState]:
        for p in self.players.values():
            if p.seat_index == seat:
                return p
        return None

    def next_seat_with_player(self, after_seat: int, predicate=None) -> Optional[int]:
        """Walk forward through seats looking for a player matching `predicate`."""
        if not self.seat_order:
            return None
        # Build seat -> user_id map for quick lookup
        seats = sorted(set(p.seat_index for p in self.players.values()))
        if not seats:
            return None
        # rotate seats so iteration starts after `after_seat`
        idx = next((i for i, s in enumerate(seats) if s > after_seat), 0)
        ordered = seats[idx:] + seats[:idx]
        for s in ordered:
            p = self.seat_player(s)
            if p and (predicate is None or predicate(p)):
                return s
        return None


def new_game(table_id: int, chat_id: int, players_in: list[tuple[int, int, int]],
             small_blind: int, big_blind: int, blind_increase_seconds: int,
             *, starting_stack: int = 0, mode: str = "chips", entry_gas: int = 0,
             max_reentries: int = 2, reentry_until_level: int = 3, gas_pot: int = 0,
             reentries: Optional[dict[int, int]] = None) -> GameState:
    """players_in: list of (user_id, seat_index, starting_stack)."""
    players = {uid: PlayerState(user_id=uid, seat_index=si, stack=stack) for uid, si, stack in players_in}
    seat_order = [uid for uid, _, _ in sorted(players_in, key=lambda x: x[1])]
    now = time.time()
    return GameState(
        table_id=table_id,
        chat_id=chat_id,
        players=players,
        seat_order=seat_order,
        small_blind=small_blind,
        big_blind=big_blind,
        blind_increase_seconds=blind_increase_seconds,
        started_at=now,
        next_blind_increase_at=now + blind_increase_seconds,
        starting_stack=starting_stack or (max((s for _, _, s in players_in), default=0)),
        mode=mode,
        entry_gas=entry_gas,
        max_reentries=max_reentries,
        reentry_until_level=reentry_until_level,
        gas_pot=gas_pot,
        reentries=dict(reentries or {}),
    )


def needs_fast_forward(g: GameState) -> bool:
    """True if the hand can't accept any more actions but isn't done yet —
    meaning every still-in player is all-in (or only one remains), and we should
    deal remaining streets through to showdown without waiting on player input."""
    if g.hand is None:
        return False
    if g.hand.street == "done":
        return False
    in_hand = [p for p in g.players.values() if not p.has_folded]
    if len(in_hand) <= 1:
        return False  # someone won uncalled; handled separately
    return all(p.is_all_in for p in in_hand)


def deal_next_street_or_finish(g: GameState) -> dict | None:
    """Deal one more street (flop/turn/river). After river, run showdown.
    Returns the showdown summary if hand finished, else None. Called by the
    WS layer in a paced loop while needs_fast_forward(g) is True."""
    hand = g.hand
    if hand is None or hand.street == "done":
        return None
    # Reset per-street betting state (purely cosmetic since no one can act, but keeps
    # current_bet/min_raise consistent for any inspector)
    for p in g.players.values():
        p.bet = 0
        p.has_acted = False
    hand.current_bet = 0
    hand.min_raise = g.big_blind
    if hand.street == "preflop":
        if hand.deck: hand.deck.pop()
        for _ in range(3):
            if hand.deck: hand.community.append(hand.deck.pop())
        hand.street = "flop"
    elif hand.street == "flop":
        if hand.deck: hand.deck.pop()
        if hand.deck: hand.community.append(hand.deck.pop())
        hand.street = "turn"
    elif hand.street == "turn":
        if hand.deck: hand.deck.pop()
        if hand.deck: hand.community.append(hand.deck.pop())
        hand.street = "river"
    elif hand.street == "river":
        hand.street = "showdown"
        return _showdown(g)
    _log_street(g, hand.street)
    return None


def maybe_escalate_blinds(g: GameState) -> bool:
    """Returns True if blinds were just raised. Caller can broadcast."""
    if time.time() < g.next_blind_increase_at:
        return False
    # 1.5x rounding up to nearest 50 chips for nicer numbers
    new_sb = round_chip(int(g.small_blind * 1.5))
    new_bb = round_chip(int(g.big_blind * 1.5))
    g.small_blind = max(g.small_blind + 50, new_sb)
    g.big_blind = max(g.big_blind + 100, new_bb)
    g.blind_level += 1
    g.next_blind_increase_at = time.time() + g.blind_increase_seconds
    return True


def round_chip(x: int) -> int:
    """Round to nearest 50 to keep blind numbers tidy."""
    return ((x + 25) // 50) * 50


def start_hand(g: GameState, button_seat: Optional[int] = None) -> HandState:
    """Start a new hand: pick button, post blinds, deal hole cards."""
    maybe_escalate_blinds(g)
    alive = [p for p in g.players.values() if p.stack > 0]
    if len(alive) < 2:
        # Tournament is over
        g.finished = True
        g.winner_user_id = alive[0].user_id if alive else None
        g.hand = None
        return HandState(hand_no=0, button_seat=0, deck=[])

    # Reset per-hand state
    for p in g.players.values():
        p.hole = []
        p.bet = 0
        p.total_committed = 0
        p.has_folded = False
        p.is_all_in = False
        p.has_acted = False
        if p.stack <= 0:
            p.has_folded = True  # busted players sit out

    # Determine button. If first hand, pick lowest seat among alive.
    alive_seats = sorted(p.seat_index for p in alive)
    if button_seat is None:
        if g.hand is not None:
            # Move button forward
            cur = g.hand.button_seat
            after = [s for s in alive_seats if s > cur]
            button_seat = after[0] if after else alive_seats[0]
        else:
            button_seat = alive_seats[0]

    deck = shuffled_deck()
    hand = HandState(
        hand_no=(g.hand.hand_no + 1) if g.hand else 1,
        button_seat=button_seat,
        deck=deck,
    )

    # Determine SB and BB seats (heads-up special rule: button posts SB)
    if len(alive_seats) == 2:
        sb_seat = button_seat
        bb_seat = next(s for s in alive_seats if s != button_seat)
    else:
        idx = alive_seats.index(button_seat)
        sb_seat = alive_seats[(idx + 1) % len(alive_seats)]
        bb_seat = alive_seats[(idx + 2) % len(alive_seats)]

    sb_player = g.seat_player(sb_seat)
    bb_player = g.seat_player(bb_seat)
    assert sb_player and bb_player
    _post(sb_player, g.small_blind, hand)
    _post(bb_player, g.big_blind, hand)
    hand.current_bet = g.big_blind
    hand.min_raise = g.big_blind
    hand.last_aggressor_seat = bb_seat

    # Deal 2 hole cards to each alive player, starting left of button
    for _round in range(2):
        s = sb_seat
        idx_local = alive_seats.index(sb_seat)
        for _ in range(len(alive_seats)):
            player = g.seat_player(alive_seats[idx_local])
            if player and not player.has_folded:
                player.hole.append(hand.deck.pop())
            idx_local = (idx_local + 1) % len(alive_seats)

    # First to act preflop: heads-up = SB (button); else next after BB
    if len(alive_seats) == 2:
        hand.to_act_seat = sb_seat
    else:
        idx = alive_seats.index(bb_seat)
        hand.to_act_seat = alive_seats[(idx + 1) % len(alive_seats)]

    g.hand = hand
    # Новая запись истории: стеки на входе (блайнды уже сняты — вернём их в
    # цифру), улицы копятся по ходу раздачи, итог допишет _finalize_log.
    g.hand_log = {
        "hand_no": hand.hand_no,
        "started_at": time.time(),
        "button_seat": button_seat,
        "blinds": [g.small_blind, g.big_blind],
        "players": [
            {"user_id": p.user_id, "seat": p.seat_index, "stack": p.stack + p.bet}
            for p in sorted(g.players.values(), key=lambda x: x.seat_index) if not p.has_folded
        ],
        "streets": [{"street": "preflop", "community": [], "actions": []}],
    }
    return hand


def _post(player: PlayerState, amount: int, hand: HandState):
    paid = min(amount, player.stack)
    player.stack -= paid
    player.bet += paid
    player.total_committed += paid
    hand.pot += paid
    if player.stack == 0:
        player.is_all_in = True


# ---- Action API -------------------------------------------------------

class ActionError(Exception):
    pass


def apply_action(g: GameState, user_id: int, action: str, amount: int = 0) -> dict:
    """Apply a player's action. Returns a dict describing the resulting state event."""
    if g.hand is None or g.hand.street == "done":
        raise ActionError("Раздача не активна")
    hand = g.hand
    player = g.players.get(user_id)
    if player is None:
        raise ActionError("Игрок не найден")
    if player.has_folded:
        raise ActionError("Уже сложил карты")
    if player.is_all_in:
        raise ActionError("Уже all-in")
    if player.seat_index != hand.to_act_seat:
        raise ActionError("Не твой ход")

    if action == "fold":
        player.has_folded = True
        player.has_acted = True
    elif action == "check":
        if player.bet < hand.current_bet:
            raise ActionError("Нельзя CHECK — есть ставка")
        player.has_acted = True
    elif action == "call":
        need = hand.current_bet - player.bet
        if need <= 0:
            raise ActionError("Нечего колировать — используй CHECK")
        paid = min(need, player.stack)
        player.stack -= paid
        player.bet += paid
        player.total_committed += paid
        hand.pot += paid
        if player.stack == 0:
            player.is_all_in = True
        player.has_acted = True
    elif action == "raise":
        if amount <= hand.current_bet:
            raise ActionError("Рейз должен быть выше текущей ставки")
        increase = amount - hand.current_bet
        if increase < hand.min_raise and amount - player.bet < player.stack:
            # All-in less than min raise is allowed but doesn't reopen action;
            # otherwise must be at least min_raise increment.
            raise ActionError(f"Минимальный рейз {hand.current_bet + hand.min_raise}")
        need = amount - player.bet
        if need > player.stack:
            # Treat as all-in for whatever stack remains
            need = player.stack
            amount = player.bet + need
        player.stack -= need
        player.bet += need
        player.total_committed += need
        hand.pot += need
        if player.stack == 0:
            player.is_all_in = True
        # New aggressor; reset has_acted for everyone else still in hand
        if amount - hand.current_bet >= hand.min_raise:
            hand.min_raise = amount - hand.current_bet
            for p in g.players_can_act():
                if p.user_id != player.user_id:
                    p.has_acted = False
        hand.current_bet = amount
        hand.last_aggressor_seat = player.seat_index
        player.has_acted = True
    else:
        raise ActionError(f"Неизвестное действие: {action}")

    hand.last_action = {"user_id": user_id, "action": action, "amount": amount}
    _log_action(g, player, action)

    # Auto-end hand if only one player left
    in_hand = g.players_in_hand()
    if len(in_hand) == 1:
        return _award_uncalled_pot(g, in_hand[0])

    # Advance turn or street
    _advance(g)
    return {"type": "action", "action": action, "user_id": user_id, "amount": amount}


def _advance(g: GameState):
    hand = g.hand
    assert hand
    # Find next player who needs to act
    can_act = g.players_can_act()
    if not can_act:
        # Everyone in the hand is all-in or folded — no more betting possible.
        # We do NOT loop to showdown here so the caller can deal remaining streets
        # one at a time with a visual pause between them (handled in the WS layer).
        # Just keep to_act_seat where it is; UI will hide action controls naturally.
        return
    # Players who haven't acted OR who haven't matched current bet still need to act
    needs_action = [p for p in can_act if not p.has_acted or p.bet < hand.current_bet]
    if not needs_action:
        # End of betting round
        _next_street(g)
        if hand.street == "showdown":
            return _showdown(g)
        return
    # Otherwise pick next clockwise from current to_act
    cur_seat = hand.to_act_seat
    seats_in_play = sorted(set(p.seat_index for p in can_act))
    # Find a starting index from which to walk forward. If the current actor
    # already left the action set (folded / went all-in), start from the seat just
    # after them in the original seating, then wrap.
    if cur_seat in seats_in_play:
        start_idx = seats_in_play.index(cur_seat)
    else:
        # First seat strictly greater than cur_seat — if none, wrap to 0
        higher = [i for i, s in enumerate(seats_in_play) if s > (cur_seat or -1)]
        # We start "before" that seat, so the +1 below lands on it
        start_idx = (higher[0] - 1) if higher else (len(seats_in_play) - 1)
    for offset in range(1, len(seats_in_play) + 1):
        next_seat = seats_in_play[(start_idx + offset) % len(seats_in_play)]
        next_player = g.seat_player(next_seat)
        if not next_player:
            continue
        if not next_player.has_acted or next_player.bet < hand.current_bet:
            hand.to_act_seat = next_seat
            return
    # No one needs to act
    _next_street(g)
    if hand.street == "showdown":
        _showdown(g)


def _next_street(g: GameState):
    hand = g.hand
    assert hand
    # Reset per-street state
    for p in g.players.values():
        p.bet = 0
        p.has_acted = False
    hand.current_bet = 0
    hand.min_raise = g.big_blind
    if hand.street == "preflop":
        # burn 1 + 3 to flop
        if hand.deck:
            hand.deck.pop()
        for _ in range(3):
            if hand.deck:
                hand.community.append(hand.deck.pop())
        hand.street = "flop"
    elif hand.street == "flop":
        if hand.deck:
            hand.deck.pop()
        if hand.deck:
            hand.community.append(hand.deck.pop())
        hand.street = "turn"
    elif hand.street == "turn":
        if hand.deck:
            hand.deck.pop()
        if hand.deck:
            hand.community.append(hand.deck.pop())
        hand.street = "river"
    elif hand.street == "river":
        hand.street = "showdown"
        return
    _log_street(g, hand.street)
    # Post-flop: first to act is first player left of button who's still in hand
    can_act = g.players_can_act()
    if not can_act:
        return
    seats_can_act = sorted(p.seat_index for p in can_act)
    button = hand.button_seat
    for s in seats_can_act:
        if s > button:
            hand.to_act_seat = s
            return
    hand.to_act_seat = seats_can_act[0]


def _award_uncalled_pot(g: GameState, winner: PlayerState) -> dict:
    hand = g.hand
    assert hand
    winner.stack += hand.pot
    summary = {
        "type": "hand_end",
        "winner_user_ids": [winner.user_id],
        "pot": hand.pot,
        "reason": "all_others_folded",
        "community": [str(c) for c in hand.community],
        "showdown": [],
    }
    g.last_summary = summary
    hand.street = "done"
    _finalize_log(g, summary)
    return summary


def _showdown(g: GameState) -> dict:
    """Pay out the pot, splitting into side pots so an all-in short stack only
    wins what it could possibly contest, never more."""
    hand = g.hand
    assert hand
    # Everyone who put money in this hand (folded or not) — needed for side-pot accounting,
    # because a folded player's chips still feed pots that survivors compete for.
    all_committed = [p for p in g.players.values() if p.total_committed > 0]
    if not all_committed:
        # No money in pot (shouldn't really happen) — no-op
        hand.street = "done"
        return {"type": "hand_end", "winner_user_ids": [], "pot": 0, "reason": "showdown",
                "community": [str(c) for c in hand.community], "showdown": []}

    contenders = g.players_in_hand()
    # Pre-score each non-folded player; folded players are eligible for nothing.
    scored: dict[int, tuple[int, ...]] = {}
    for p in contenders:
        scored[p.user_id] = best_of_seven(p.hole + hand.community)

    # Build side pots by ascending commitment levels
    levels = sorted({p.total_committed for p in all_committed})
    pots: list[tuple[int, list[int]]] = []  # (pot_chips, eligible_user_ids)
    prev_level = 0
    for level in levels:
        diff = level - prev_level
        # Everyone who put in at least this level contributes `diff` to this layer
        contributors = [p for p in all_committed if p.total_committed >= level]
        pot_size = diff * len(contributors)
        if pot_size <= 0:
            prev_level = level
            continue
        # Eligibility: only non-folded players who reached this level can win it
        eligible = [p.user_id for p in contributors if not p.has_folded]
        pots.append((pot_size, eligible))
        prev_level = level

    # Now distribute each pot to the best hand among its eligible players
    winners_summary: list[dict] = []
    awarded_total = 0
    overall_winner_uids: set[int] = set()
    overall_best_score: tuple[int, ...] | None = None

    for pot_size, eligible_uids in pots:
        if not eligible_uids:
            # Everyone in this layer folded — chips would normally stay (impossible here
            # since we ensured at least one survivor reached this level via contender list)
            continue
        eligible_scored = [(scored[uid], uid) for uid in eligible_uids if uid in scored]
        if not eligible_scored:
            continue
        eligible_scored.sort(key=lambda x: x[0], reverse=True)
        best = eligible_scored[0][0]
        wins = [uid for sc, uid in eligible_scored if sc == best]
        share = pot_size // len(wins)
        remainder = pot_size - share * len(wins)
        for uid in wins:
            g.players[uid].stack += share
        if remainder > 0:
            # Odd chip → first winner clockwise from button
            ordered = sorted(wins, key=lambda u: g.players[u].seat_index)
            for u in ordered:
                if u >= 0:
                    g.players[u].stack += remainder
                    break
        winners_summary.append({
            "pot": pot_size,
            "winner_user_ids": wins,
            "winning_hand": describe(best),
        })
        awarded_total += pot_size
        if overall_best_score is None or best > overall_best_score:
            overall_best_score = best
            overall_winner_uids = set(wins)
        elif best == overall_best_score:
            overall_winner_uids.update(wins)

    summary = {
        "type": "hand_end",
        "winner_user_ids": list(overall_winner_uids),
        "winning_hand": describe(overall_best_score) if overall_best_score else None,
        "pot": awarded_total,
        "side_pots": winners_summary,
        "reason": "showdown",
        "community": [str(c) for c in hand.community],
        "showdown": [
            {"user_id": p.user_id, "hole": [str(c) for c in p.hole], "hand": describe(scored[p.user_id])}
            for p in contenders
        ],
    }
    g.last_summary = summary
    hand.street = "done"
    _finalize_log(g, summary)
    return summary


def public_view(g: GameState, viewer_user_id: int) -> dict:
    """Snapshot the game from one player's perspective. Hide other players' hole cards."""
    hand = g.hand
    return {
        "table_id": g.table_id,
        "small_blind": g.small_blind,
        "big_blind": g.big_blind,
        "blind_level": g.blind_level,
        "next_blind_at": g.next_blind_increase_at,
        "finished": g.finished,
        "winner_user_id": g.winner_user_id,
        "last_summary": g.last_summary,
        "starting_stack": g.starting_stack,
        "mode": g.mode,
        "entry_gas": g.entry_gas,
        "gas_pot": g.gas_pot,
        "max_reentries": g.max_reentries,
        "reentry_until_level": g.reentry_until_level,
        "reentry_open_until": g.reentry_open_until,
        "history_len": len(g.history),
        "hand": (
            None if hand is None else {
                "hand_no": hand.hand_no,
                "button_seat": hand.button_seat,
                "community": [str(c) for c in hand.community],
                "pot": hand.pot,
                "current_bet": hand.current_bet,
                "min_raise": hand.min_raise,
                "to_act_seat": hand.to_act_seat,
                "street": hand.street,
                "last_action": hand.last_action,
            }
        ),
        "players": [
            {
                "user_id": p.user_id,
                "seat_index": p.seat_index,
                "stack": p.stack,
                "bet": p.bet,
                "has_folded": p.has_folded,
                "is_all_in": p.is_all_in,
                "reentries": g.reentries.get(p.user_id, 0),
                "can_reenter": can_reenter(g, p.user_id)[0],
                "is_my_turn": hand is not None and hand.to_act_seat == p.seat_index,
                # Hole cards: own cards always visible. Reveal everyone else's only at
                # showdown — when the hand ended via real card comparison (g.last_summary
                # has reason="showdown") AND that player didn't fold.
                "hole": (
                    [str(c) for c in p.hole]
                    if p.user_id == viewer_user_id
                    else (
                        [str(c) for c in p.hole]
                        if (hand and hand.street == "done"
                            and g.last_summary is not None
                            and g.last_summary.get("reason") == "showdown"
                            and not p.has_folded
                            and p.hole)
                        else (["?", "?"] if p.hole else [])
                    )
                ),
            }
            for p in sorted(g.players.values(), key=lambda x: x.seat_index)
        ],
    }


# ---- История раздач ---------------------------------------------------

HISTORY_CAP = 200


def _log_street(g: GameState, name: str) -> None:
    log = g.hand_log
    if not log or not g.hand:
        return
    log["streets"].append({
        "street": name,
        "community": [str(c) for c in g.hand.community],
        "actions": [],
    })


def _log_action(g: GameState, player: PlayerState, action: str) -> None:
    """Записать действие в текущую улицу. Сумма — сколько игрок ВСЕГО
    поставил в этом круге (`bet`): для call/raise это понятнее, чем
    «докинул N», и по ней восстанавливается ход торговли."""
    log = g.hand_log
    if not log or not log["streets"]:
        return
    log["streets"][-1]["actions"].append({
        "user_id": player.user_id,
        "action": action,
        "to": player.bet if action in ("call", "raise") else 0,
        "all_in": player.is_all_in,
    })


def _finalize_log(g: GameState, summary: dict) -> None:
    """Дописать итог и переложить запись в историю. Карты — только те, что
    реально вскрылись (showdown); сброшенные не показываем никогда."""
    log = g.hand_log
    if not log:
        return
    log["pot"] = summary.get("pot", 0)
    log["reason"] = summary.get("reason")
    log["winners"] = list(summary.get("winner_user_ids", []))
    log["winning_hand"] = summary.get("winning_hand")
    log["community"] = list(summary.get("community", []))
    log["showdown"] = [
        {"user_id": s["user_id"], "hole": list(s["hole"]), "hand": s.get("hand")}
        for s in summary.get("showdown", [])
    ]
    log["ended_at"] = time.time()
    g.history.append(log)
    if len(g.history) > HISTORY_CAP:
        del g.history[: len(g.history) - HISTORY_CAP]
    g.hand_log = None


def history_view(g: GameState) -> list[dict]:
    """Свежие сверху."""
    return list(reversed(g.history))


# ---- Режим «за газ»: докупка --------------------------------------------

def can_reenter(g: GameState, user_id: int) -> tuple[bool, str]:
    """Можно ли этому игроку докупиться прямо сейчас (и почему нет)."""
    if g.mode != "gas" or g.entry_gas <= 0:
        return False, "На этом столе нет докупки"
    if g.finished:
        return False, "Турнир окончен"
    p = g.players.get(user_id)
    if p is None:
        return False, "Ты не за этим столом"
    if p.stack > 0:
        return False, "У тебя ещё есть фишки"
    # all-in без фишек в ЖИВОЙ раздаче — ещё не вылетел, ждём её конца
    if g.hand and g.hand.street != "done" and not p.has_folded and p.is_all_in:
        return False, "Раздача ещё идёт — дождись её конца"
    if g.blind_level >= g.reentry_until_level:
        return False, f"Докупка закрыта: блайнды уже выросли {g.blind_level} раз"
    if g.reentries.get(user_id, 0) >= g.max_reentries:
        return False, "Лимит докупок исчерпан"
    return True, ""


def reenter(g: GameState, user_id: int) -> None:
    """Вернуть игрока в турнир со стартовым стеком. Газ списывает API-слой
    (там же +к котлу); в текущую раздачу он не входит — сдадут со
    следующей: start_hand сам решает по stack > 0."""
    p = g.players[user_id]
    p.stack = g.starting_stack
    g.reentries[user_id] = g.reentries.get(user_id, 0) + 1
    g.gas_pot += g.entry_gas


def reentry_candidates(g: GameState) -> list[int]:
    return [uid for uid in g.players if can_reenter(g, uid)[0]]


# ---- Singleton store --------------------------------------------------

class GameStore:
    def __init__(self):
        self._games: dict[int, GameState] = {}

    def get(self, table_id: int) -> Optional[GameState]:
        return self._games.get(table_id)

    def put(self, g: GameState):
        self._games[g.table_id] = g

    def remove(self, table_id: int):
        self._games.pop(table_id, None)


game_store = GameStore()
