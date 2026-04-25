"""Pure poker primitives — Card, Deck, hand evaluator. No DB, no I/O."""
from dataclasses import dataclass
from typing import Iterable
import random

SUITS = ("s", "h", "d", "c")  # spades, hearts, diamonds, clubs
RANKS = ("2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A")
RANK_VALUE = {r: i for i, r in enumerate(RANKS, start=2)}  # "2"->2 ... "A"->14


@dataclass(frozen=True)
class Card:
    rank: str  # one of RANKS
    suit: str  # one of SUITS

    def __str__(self) -> str:
        return f"{self.rank}{self.suit}"

    @property
    def value(self) -> int:
        return RANK_VALUE[self.rank]


def build_deck() -> list[Card]:
    return [Card(r, s) for r in RANKS for s in SUITS]


def shuffled_deck(rng: random.Random | None = None) -> list[Card]:
    deck = build_deck()
    (rng or random).shuffle(deck)
    return deck


# Hand categories (higher = stronger). Same scale Texas Hold'em standard.
HAND_HIGH_CARD = 1
HAND_PAIR = 2
HAND_TWO_PAIR = 3
HAND_TRIPS = 4
HAND_STRAIGHT = 5
HAND_FLUSH = 6
HAND_FULL_HOUSE = 7
HAND_QUADS = 8
HAND_STRAIGHT_FLUSH = 9


def evaluate_5(cards: tuple[Card, ...]) -> tuple[int, ...]:
    """Score a single 5-card hand. Larger tuple compares as a stronger hand.

    Returns (category, *kickers) so plain tuple comparison works as ranking.
    """
    assert len(cards) == 5
    values = sorted((c.value for c in cards), reverse=True)
    suits = [c.suit for c in cards]

    is_flush = len(set(suits)) == 1
    # Straight: 5 distinct consecutive values, plus the wheel (A-2-3-4-5).
    distinct = sorted(set(values), reverse=True)
    is_straight = False
    straight_high = 0
    if len(distinct) == 5 and distinct[0] - distinct[4] == 4:
        is_straight = True
        straight_high = distinct[0]
    elif set(distinct) == {14, 5, 4, 3, 2}:
        is_straight = True
        straight_high = 5

    if is_straight and is_flush:
        return (HAND_STRAIGHT_FLUSH, straight_high)

    # Group by rank multiplicity
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    groups = sorted(counts.items(), key=lambda kv: (-kv[1], -kv[0]))

    if groups[0][1] == 4:
        # Four of a kind
        kicker = max(v for v in values if v != groups[0][0])
        return (HAND_QUADS, groups[0][0], kicker)
    if groups[0][1] == 3 and len(groups) > 1 and groups[1][1] >= 2:
        return (HAND_FULL_HOUSE, groups[0][0], groups[1][0])
    if is_flush:
        return (HAND_FLUSH, *values)
    if is_straight:
        return (HAND_STRAIGHT, straight_high)
    if groups[0][1] == 3:
        kickers = sorted((v for v in values if v != groups[0][0]), reverse=True)
        return (HAND_TRIPS, groups[0][0], *kickers)
    if groups[0][1] == 2 and len(groups) > 1 and groups[1][1] == 2:
        high_pair = max(groups[0][0], groups[1][0])
        low_pair = min(groups[0][0], groups[1][0])
        kicker = max(v for v in values if v != high_pair and v != low_pair)
        return (HAND_TWO_PAIR, high_pair, low_pair, kicker)
    if groups[0][1] == 2:
        kickers = sorted((v for v in values if v != groups[0][0]), reverse=True)
        return (HAND_PAIR, groups[0][0], *kickers)
    return (HAND_HIGH_CARD, *values)


def best_of_seven(cards: Iterable[Card]) -> tuple[int, ...]:
    """Pick the best 5-card hand from 7 cards (2 hole + 5 community)."""
    cards = tuple(cards)
    assert len(cards) >= 5
    best: tuple[int, ...] | None = None
    n = len(cards)
    # iterate combinations of size 5 manually (faster than itertools for size 7)
    indexes = range(n)
    for i in indexes:
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                for l in range(k + 1, n):
                    for m in range(l + 1, n):
                        score = evaluate_5((cards[i], cards[j], cards[k], cards[l], cards[m]))
                        if best is None or score > best:
                            best = score
    assert best is not None
    return best


HAND_NAMES_RU = {
    HAND_HIGH_CARD: "старшая карта",
    HAND_PAIR: "пара",
    HAND_TWO_PAIR: "две пары",
    HAND_TRIPS: "сет",
    HAND_STRAIGHT: "стрит",
    HAND_FLUSH: "флеш",
    HAND_FULL_HOUSE: "фулл-хаус",
    HAND_QUADS: "каре",
    HAND_STRAIGHT_FLUSH: "стрит-флеш",
}


def describe(score: tuple[int, ...]) -> str:
    cat = score[0]
    return HAND_NAMES_RU.get(cat, "?")
