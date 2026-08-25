import React, { useMemo, useState } from "react";
import { evaluateBest, computeOuts, potOddsPct, chenScore, CATEGORY_NAMES } from "./pokerAssist";

// Sidebar next to the felt: a hand-rankings cheat sheet for beginners (toggle)
// and a pot-odds / outs helper (toggle, persisted). Pure client-side — uses
// only the viewer's own hole cards, so it gives nobody an unfair edge beyond
// arithmetic anyone could do on paper.

const ODDS_LS_KEY = "poker.oddsHelper";

interface Props {
  myHole: string[] | null;
  community: string[];
  pot: number;
  toCall: number;
  street: string | null; // preflop | flop | turn | river | showdown | done | null
  isNeo: boolean;
}

// Example hands for the cheat sheet, strongest first.
const COMBOS: { cat: number; cards: string[]; note: string }[] = [
  { cat: 9, cards: ["As", "Ks", "Qs", "Js", "Ts"], note: "Десятка–туз одной масти" },
  { cat: 8, cards: ["9h", "8h", "7h", "6h", "5h"], note: "Пять подряд одной масти" },
  { cat: 7, cards: ["Kd", "Kh", "Ks", "Kc", "2s"], note: "Четыре одинаковых" },
  { cat: 6, cards: ["Qd", "Qh", "Qs", "7c", "7s"], note: "Тройка + пара" },
  { cat: 5, cards: ["Ad", "Jd", "8d", "6d", "3d"], note: "Пять одной масти" },
  { cat: 4, cards: ["8d", "7h", "6s", "5c", "4s"], note: "Пять по порядку" },
  { cat: 3, cards: ["Jd", "Jh", "Js", "7c", "2s"], note: "Три одинаковых" },
  { cat: 2, cards: ["Ad", "Ah", "9s", "9c", "2s"], note: "Пара + пара" },
  { cat: 1, cards: ["Kd", "Kh", "9s", "7c", "2s"], note: "Два одинаковых" },
  { cat: 0, cards: ["Ad", "Kh", "9s", "7c", "2s"], note: "Решает старшая карта" },
];

function MiniCard({ code, isNeo }: { code: string; isNeo: boolean }) {
  const suit = code[code.length - 1];
  const rank = code.slice(0, -1);
  const isRed = suit === "h" || suit === "d";
  const suitChar = ({ s: "♠", h: "♥", d: "♦", c: "♣" } as Record<string, string>)[suit] || "?";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 24, height: 32, fontSize: 10, fontWeight: 700, lineHeight: 1.1,
      flexDirection: "column",
      background: isNeo ? "#0a0a0a" : "#fff",
      border: isNeo ? "1px solid var(--accent)" : "1px solid #ccc",
      borderRadius: isNeo ? 0 : 3,
      color: isNeo ? (isRed ? "#ff7777" : "var(--accent)") : (isRed ? "#d33" : "#222"),
      fontFamily: isNeo ? "var(--font-mono)" : undefined,
    }}>
      <span>{rank}</span>
      <span style={{ fontSize: 11 }}>{suitChar}</span>
    </span>
  );
}

export default function PokerAssistPanel({ myHole, community, pot, toCall, street, isNeo }: Props) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [showCombos, setShowCombos] = useState(false);
  const [showOdds, setShowOdds] = useState<boolean>(() => {
    try { return localStorage.getItem(ODDS_LS_KEY) === "1"; } catch { return false; }
  });
  const toggleOdds = () => {
    setShowOdds((v) => {
      try { localStorage.setItem(ODDS_LS_KEY, v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  };

  const hole = (myHole || []).filter((c) => c && c !== "?");
  const board = (community || []).filter((c) => c && c !== "?");
  const inHand = hole.length === 2;

  const current = useMemo(
    () => (inHand ? evaluateBest([...hole, ...board]) : null),
    [hole.join(","), board.join(",")],
  );
  const outs = useMemo(
    () => (inHand ? computeOuts(hole, board) : null),
    [hole.join(","), board.join(",")],
  );
  const chen = useMemo(() => (inHand ? chenScore(hole) : null), [hole.join(",")]);
  const po = potOddsPct(pot, toCall);

  const isPreflop = street === "preflop";
  const canDraw = inHand && (street === "flop" || street === "turn");

  // Verdict: compare improvement odds vs pot odds. With a made hand (two pair
  // or better) improvement odds stop being the point — don't tell someone to
  // fold a set because it "only" has few outs.
  let verdict: { text: string; color: string } | null = null;
  if (showOdds && inHand && toCall > 0 && canDraw && outs && current) {
    if (current.category >= 2) {
      verdict = { text: "У тебя уже сильная рука", color: "#3ba55d" };
    } else if (outs.improvePct >= po + 3) {
      verdict = { text: "Колл выгоден", color: "#3ba55d" };
    } else if (outs.improvePct >= po - 3) {
      verdict = { text: "На грани — решай сам", color: "#faa61a" };
    } else {
      verdict = { text: "Колл невыгоден", color: "#ed4245" };
    }
  }

  const sectionStyle: React.CSSProperties = {
    background: isNeo ? "rgba(198,255,61,0.04)" : "var(--bg-secondary)",
    border: `1px solid ${isNeo ? "var(--border-strong)" : "var(--border)"}`,
    borderRadius: isNeo ? 0 : 8,
    padding: 10,
  };
  const toggleBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "7px 8px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    borderRadius: isNeo ? 0 : 6,
    border: `1px solid ${active ? "var(--accent)" : (isNeo ? "var(--border-strong)" : "var(--border)")}`,
    background: active ? (isNeo ? "rgba(198,255,61,0.15)" : "var(--accent)") : "transparent",
    color: active ? (isNeo ? "var(--accent)" : "var(--accent-text)") : "var(--text-muted)",
    letterSpacing: isNeo ? "0.04em" : undefined,
    ...mono,
  });

  return (
    <div style={{
      width: 264, minWidth: 264, alignSelf: "stretch",
      display: "flex", flexDirection: "column", gap: 10,
      overflowY: "auto", paddingRight: 2,
    }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setShowCombos((v) => !v)} style={toggleBtn(showCombos)} title="Шпаргалка комбинаций">
          {isNeo ? "[КОМБИНАЦИИ]" : "🂡 Комбинации"}
        </button>
        <button onClick={toggleOdds} style={toggleBtn(showOdds)} title="Шанс банка и ауты">
          {isNeo ? "[ШАНСЫ]" : "🎯 Шансы"}
        </button>
      </div>

      {showOdds && (
        <div style={sectionStyle}>
          <div style={{ ...mono, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.06em" }}>
            {isNeo ? "// ШАНС_БАНКА" : "ШАНС БАНКА"}
          </div>
          {!inHand ? (
            <div style={{ ...mono, fontSize: 12, color: "var(--text-muted)" }}>
              Сядь за стол и дождись раздачи — здесь появятся расчёты по твоим картам.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Pot odds — always relevant when facing a bet */}
              <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)" }}>
                {toCall > 0 ? (
                  <>Доплатить <b>{toCall.toLocaleString()}</b> в банк <b>{(pot + toCall).toLocaleString()}</b> → нужно <b>{po}%</b> побед</>
                ) : (
                  <>Ставки нет — <b>чек бесплатно</b></>
                )}
              </div>

              {isPreflop && chen && (
                <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)" }}>
                  Стартовая рука <b>{chen.label}</b> — {chen.tier}
                  <span style={{ color: "var(--text-muted)" }}> ({chen.score} очков по Чену)</span>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    Расчёт аутов появится на флопе.
                  </div>
                </div>
              )}

              {canDraw && current && outs && (
                <>
                  <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)" }}>
                    Сейчас у тебя: <b>{current.name}</b>
                  </div>
                  {outs.total > 0 ? (
                    <>
                      <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)" }}>
                        Шанс улучшить: <b>{outs.improvePct}%</b>
                        <span style={{ color: "var(--text-muted)" }}> ({outs.total} аутов × {street === "flop" ? 4 : 2})</span>
                      </div>
                      {outs.groups.map((g) => (
                        <div key={g.category} style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
                          → {g.name} ({g.cards.length}):{" "}
                          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 3, verticalAlign: "middle" }}>
                            {g.cards.map((c) => <MiniCard key={c} code={c} isNeo={isNeo} />)}
                          </span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
                      Сильных дро нет.
                    </div>
                  )}
                  {outs.weakGroups.length > 0 && (
                    <div style={{ ...mono, fontSize: 10.5, color: "var(--text-muted)", opacity: 0.8 }}>
                      Слабые ауты (не в счёт): {outs.weakGroups.map((g) => `${g.name.toLowerCase()} — ${g.cards.length}`).join(", ")}
                    </div>
                  )}
                </>
              )}

              {inHand && street === "river" && current && (
                <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)" }}>
                  Все карты открыты. У тебя: <b>{current.name}</b>
                </div>
              )}

              {verdict && (
                <div style={{
                  ...mono, textAlign: "center", fontSize: 12, fontWeight: 700,
                  padding: "6px 8px", borderRadius: isNeo ? 0 : 6,
                  border: `1px solid ${verdict.color}`, color: verdict.color,
                  background: `${verdict.color}18`,
                }}>
                  {verdict.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showCombos && (
        <div style={sectionStyle}>
          <div style={{ ...mono, fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.06em" }}>
            {isNeo ? "// ОТ_СИЛЬНОЙ_К_СЛАБОЙ" : "ОТ СИЛЬНОЙ К СЛАБОЙ"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {COMBOS.map((combo) => {
              const isMine = inHand && current != null && current.category === combo.cat;
              return (
                <div key={combo.cat} style={{
                  padding: 6,
                  borderRadius: isNeo ? 0 : 6,
                  border: `1px solid ${isMine ? "var(--accent)" : "transparent"}`,
                  background: isMine ? (isNeo ? "rgba(198,255,61,0.10)" : "rgba(88,101,242,0.12)") : "transparent",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: isMine ? "var(--accent)" : "var(--text-primary)" }}>
                      {CATEGORY_NAMES[combo.cat]}
                    </span>
                    {isMine && (
                      <span style={{ ...mono, fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>
                        {isNeo ? "<- у_тебя" : "← у тебя"}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {combo.cards.map((c) => <MiniCard key={c} code={c} isNeo={isNeo} />)}
                  </div>
                  <div style={{ ...mono, fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                    {combo.note}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
