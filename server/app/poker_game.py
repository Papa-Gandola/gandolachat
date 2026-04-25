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
             small_blind: int, big_blind: int, blind_increase_seconds: int) -> GameState:
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
    )


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
        # Everyone is all-in; deal remaining streets and showdown
        while hand.street != "showdown":
            _next_street(g)
        return _showdown(g)
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
    if cur_seat not in seats_in_play:
        # Current player went all-in or folded; pick next greater
        cur_seat = max([s for s in seats_in_play if s <= cur_seat], default=seats_in_play[-1])
    idx = seats_in_play.index(cur_seat) if cur_seat in seats_in_play else -1
    # Walk forward
    for offset in range(1, len(seats_in_play) + 1):
        next_seat = seats_in_play[(idx + offset) % len(seats_in_play)]
        next_player = g.seat_player(next_seat)
        if next_player and not next_player.has_acted:
            hand.to_act_seat = next_seat
            return
        if next_player and next_player.bet < hand.current_bet:
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
    return summary


def _showdown(g: GameState) -> dict:
    hand = g.hand
    assert hand
    contenders = g.players_in_hand()
    # Score each
    scored = []
    for p in contenders:
        score = best_of_seven(p.hole + hand.community)
        scored.append((score, p))
    scored.sort(key=lambda x: x[0], reverse=True)
    best_score = scored[0][0]
    winners = [p for sc, p in scored if sc == best_score]
    share = hand.pot // len(winners)
    remainder = hand.pot - share * len(winners)
    for w in winners:
        w.stack += share
    if remainder > 0 and winners:
        # Give odd chip to first winner clockwise from button
        winners[0].stack += remainder
    summary = {
        "type": "hand_end",
        "winner_user_ids": [w.user_id for w in winners],
        "winning_hand": describe(best_score),
        "pot": hand.pot,
        "reason": "showdown",
        "community": [str(c) for c in hand.community],
        "showdown": [
            {"user_id": p.user_id, "hole": [str(c) for c in p.hole], "hand": describe(score)}
            for score, p in scored
        ],
    }
    g.last_summary = summary
    hand.street = "done"
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
                "is_my_turn": hand is not None and hand.to_act_seat == p.seat_index,
                # Hole cards: only the viewer sees their own; show face-down placeholders for others
                "hole": (
                    [str(c) for c in p.hole]
                    if (p.user_id == viewer_user_id or (hand and hand.street == "showdown" and not p.has_folded))
                    else (["?", "?"] if p.hole else [])
                ),
            }
            for p in sorted(g.players.values(), key=lambda x: x.seat_index)
        ],
    }


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
