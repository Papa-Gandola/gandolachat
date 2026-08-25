// Pure poker math for the in-game assistant: hand evaluation, outs counting
// with the 4-and-2 rule, pot odds, and Chen preflop hand strength.
// No React here — this module is unit-testable with plain node.

export interface EvalResult {
  category: number;      // 0 high card … 9 royal flush
  name: string;          // Russian name for the UI
  used: string[];        // the 5 cards forming the best hand
}

export interface OutsGroup {
  category: number;      // category the outs upgrade to
  name: string;          // "Флеш", "Стрит", …
  cards: string[];       // the actual out cards, e.g. ["Ah","Kh",…]
}

export interface OutsResult {
  groups: OutsGroup[];      // strong outs — count toward the headline %
  weakGroups: OutsGroup[];  // e.g. high card -> mere pair; shown but not counted
  total: number;            // unique strong out cards
  improvePct: number;       // rule of 4-and-2 (×4 on flop, ×2 on turn), capped
}

const RANK_ORDER = "23456789TJQKA";
export const CATEGORY_NAMES: string[] = [
  "Старшая карта",
  "Пара",
  "Две пары",
  "Сет (тройка)",
  "Стрит",
  "Флеш",
  "Фулл-хаус",
  "Каре",
  "Стрит-флеш",
  "Роял-флеш",
];

function rankOf(code: string): number {
  return RANK_ORDER.indexOf(code[0]) + 2; // 2..14
}
function suitOf(code: string): string {
  return code[code.length - 1];
}

// Score a 5-card hand: [category, tiebreak ranks…] lexicographically comparable.
function score5(cards: string[]): number[] {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  // Straight (wheel A-2-3-4-5 counts, ace low)
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[1] - uniq[4] === 3) straightHigh = 5; // wheel
  }

  // Rank counts, sorted by (count desc, rank desc)
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = grouped.map(([, c]) => c);
  const order = grouped.map(([r]) => r);

  if (isFlush && straightHigh === 14) return [9];
  if (isFlush && straightHigh) return [8, straightHigh];
  if (shape[0] === 4) return [7, order[0], order[1]];
  if (shape[0] === 3 && shape[1] === 2) return [6, order[0], order[1]];
  if (isFlush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (shape[0] === 3) return [3, order[0], order[1], order[2]];
  if (shape[0] === 2 && shape[1] === 2) return [2, order[0], order[1], order[2]];
  if (shape[0] === 2) return [1, order[0], order[1], order[2], order[3]];
  return [0, ...ranks];
}

function cmpScore(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Best 5-card hand from 2–7 cards. With <5 cards, evaluates what's there
 *  (pair/high card only — enough for preflop/flop "current combination"). */
export function evaluateBest(cards: string[]): EvalResult {
  const clean = cards.filter((c) => c && c !== "?");
  if (clean.length < 5) {
    // Degenerate: rank pairs among available cards
    const s = score5Partial(clean);
    return s;
  }
  let best: number[] | null = null;
  let bestCards: string[] = [];
  const idx = [...clean.keys()];
  // all 5-card combos (max C(7,5)=21)
  for (let a = 0; a < idx.length; a++)
    for (let b = a + 1; b < idx.length; b++)
      for (let c = b + 1; c < idx.length; c++)
        for (let d = c + 1; d < idx.length; d++)
          for (let e = d + 1; e < idx.length; e++) {
            const hand = [clean[a], clean[b], clean[c], clean[d], clean[e]];
            const s = score5(hand);
            if (!best || cmpScore(s, best) > 0) { best = s; bestCards = hand; }
          }
  return { category: best![0], name: CATEGORY_NAMES[best![0]], used: bestCards };
}

function score5Partial(cards: string[]): EvalResult {
  const counts = new Map<number, string[]>();
  for (const c of cards) {
    const r = rankOf(c);
    counts.set(r, [...(counts.get(r) || []), c]);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  if (groups[0] && groups[0][1].length >= 3) return { category: 3, name: CATEGORY_NAMES[3], used: groups[0][1].slice(0, 3) };
  const pairs = groups.filter(([, cs]) => cs.length === 2);
  if (pairs.length >= 2) return { category: 2, name: CATEGORY_NAMES[2], used: [...pairs[0][1], ...pairs[1][1]] };
  if (pairs.length === 1) return { category: 1, name: CATEGORY_NAMES[1], used: pairs[0][1] };
  const top = cards.slice().sort((a, b) => rankOf(b) - rankOf(a))[0];
  return { category: 0, name: CATEGORY_NAMES[0], used: top ? [top] : [] };
}

const ALL_CARDS: string[] = (() => {
  const out: string[] = [];
  for (const r of RANK_ORDER) for (const s of "shdc") out.push(r + s);
  return out;
})();

/**
 * Count outs: unseen cards that upgrade my hand CATEGORY where the upgraded
 * best-5 actually uses the new card AND at least one of my hole cards (so
 * board-only "improvements" that help everyone equally don't count).
 * Rule of 4-and-2: outs×4 with two streets to come (flop), ×2 with one (turn).
 */
export function computeOuts(hole: string[], community: string[]): OutsResult {
  const myHole = hole.filter((c) => c && c !== "?");
  const board = community.filter((c) => c && c !== "?");
  if (myHole.length < 2 || board.length < 3 || board.length >= 5) {
    return { groups: [], weakGroups: [], total: 0, improvePct: 0 };
  }
  const seen = new Set([...myHole, ...board]);
  const base = evaluateBest([...myHole, ...board]);
  const byCat = new Map<number, string[]>();
  for (const c of ALL_CARDS) {
    if (seen.has(c)) continue;
    const ev = evaluateBest([...myHole, ...board, c]);
    if (ev.category <= base.category) continue;
    if (!ev.used.includes(c)) continue;
    if (!ev.used.some((u) => myHole.includes(u))) continue;
    byCat.set(ev.category, [...(byCat.get(ev.category) || []), c]);
  }
  const toGroups = (entries: [number, string[]][]) => entries
    .sort((a, b) => b[0] - a[0])
    .map(([cat, cards]) => ({ category: cat, name: CATEGORY_NAMES[cat], cards }));
  // "Dirty" outs — pairing an overcard (high card -> mere pair) — are what
  // poker schools tell you NOT to count: the pair often isn't good enough to
  // win. Show them separately, exclude from the headline number, so a flush
  // draw reads as the classic 9 outs / 36%, not 23 outs / 92%.
  const all = [...byCat.entries()];
  const strong = toGroups(all.filter(([cat]) => cat >= 2));
  const weak = toGroups(all.filter(([cat]) => cat < 2));
  const total = new Set(strong.flatMap((g) => g.cards)).size;
  const streetsToCome = board.length === 3 ? 2 : 1;
  const improvePct = Math.min(95, total * (streetsToCome === 2 ? 4 : 2));
  return { groups: strong, weakGroups: weak, total, improvePct };
}

/** Pot odds: share of the final pot you must invest to call. */
export function potOddsPct(pot: number, toCall: number): number {
  if (toCall <= 0) return 0;
  return Math.round((toCall / (pot + toCall)) * 1000) / 10;
}

export interface ChenResult {
  score: number;
  label: string;   // "AKs", "T9o", "77"
  tier: string;    // human tier
}

/** Chen formula for preflop starting-hand strength. */
export function chenScore(hole: string[]): ChenResult | null {
  const h = hole.filter((c) => c && c !== "?");
  if (h.length !== 2) return null;
  const [c1, c2] = h.slice().sort((a, b) => rankOf(b) - rankOf(a));
  const r1 = rankOf(c1), r2 = rankOf(c2);
  const suited = suitOf(c1) === suitOf(c2);
  const hp = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score: number;
  if (r1 === r2) {
    score = Math.max(5, hp(r1) * 2);
  } else {
    score = hp(r1);
    if (suited) score += 2;
    const gap = r1 - r2 - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && r1 < 12) score += 1; // connector bonus below Q
  }
  score = Math.ceil(score);
  const rc = (r: number) => RANK_ORDER[r - 2];
  const label = r1 === r2 ? `${rc(r1)}${rc(r2)}` : `${rc(r1)}${rc(r2)}${suited ? "s" : "o"}`;
  const tier =
    score >= 12 ? "топ-рука" :
    score >= 9 ? "сильная" :
    score >= 7 ? "хорошая" :
    score >= 5 ? "средняя" : "слабая";
  return { score, label, tier };
}
