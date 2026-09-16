import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import * as SecureStore from "../../services/secureStorage";
import { CATEGORY_NAMES, chenScore, computeOuts, evaluateBest, potOddsPct } from "../../services/pokerAssist";
import { useTheme } from "../../theme";

// Помощник за столом (порт десктопного PokerAssistPanel): шпаргалка
// комбинаций с подсветкой текущей и «шанс банка» — pot odds + ауты по
// правилу 4-и-2 + вердикт. Считает только по СВОИМ картам — это та же
// арифметика, что на бумажке, никому чужого преимущества не даёт.
// Живёт в ленте под столом (сайдбара на телефоне нет), тумблер «Шансы»
// помнится между запусками.

type ThemeT = ReturnType<typeof useTheme>;

const ODDS_KEY = "poker.oddsHelper";

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

function MiniCard({ code, theme }: { code: string; theme: ThemeT }) {
  const suit = code[code.length - 1];
  const rawRank = code.slice(0, -1);
  const rank = rawRank === "T" ? "10" : rawRank;
  const isRed = suit === "h" || suit === "d";
  const suitChar = ({ s: "♠", h: "♥", d: "♦", c: "♣" } as Record<string, string>)[suit] ?? "?";
  const neo = theme.id === "neo";
  const color = neo ? (isRed ? "#ff7777" : theme.colors.accent) : isRed ? "#d33" : "#222";
  return (
    <View
      style={{
        width: 24,
        height: 32,
        borderRadius: neo ? 0 : 3,
        backgroundColor: neo ? "#0a0a0a" : "#fff",
        borderWidth: 1,
        borderColor: neo ? theme.colors.accent : "#ccc",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "700", color, lineHeight: 12 }}>{rank}</Text>
      <Text style={{ fontSize: 11, color, lineHeight: 13 }}>{suitChar}</Text>
    </View>
  );
}

function Toggle({ theme, label, active, onPress }: { theme: ThemeT; label: string; active: boolean; onPress: () => void }) {
  const neo = theme.id === "neo";
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        backgroundColor: active ? (neo ? "rgba(198,255,61,0.15)" : theme.colors.accent) : "transparent",
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 12,
          fontWeight: "700",
          color: active ? (neo ? theme.colors.accent : theme.colors.accentText) : theme.colors.inkMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function PokerAssist({
  myHole,
  community,
  pot,
  toCall,
  street,
}: {
  myHole: string[] | null;
  community: string[];
  pot: number;
  toCall: number;
  street: string | null; // preflop | flop | turn | river | showdown | done | null
}) {
  const theme = useTheme();
  const neo = theme.id === "neo";
  const [showCombos, setShowCombos] = useState(false);
  const [showOdds, setShowOdds] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(ODDS_KEY)
      .then((v) => setShowOdds(v === "1"))
      .catch(() => {});
  }, []);
  const toggleOdds = () => {
    setShowOdds((v) => {
      SecureStore.setItemAsync(ODDS_KEY, v ? "0" : "1").catch(() => {});
      return !v;
    });
  };

  const hole = (myHole ?? []).filter((c) => c && c !== "?");
  const board = (community ?? []).filter((c) => c && c !== "?");
  const inHand = hole.length === 2;
  const holeKey = hole.join(",");
  const boardKey = board.join(",");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const current = useMemo(() => (inHand ? evaluateBest([...hole, ...board]) : null), [holeKey, boardKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outs = useMemo(() => (inHand ? computeOuts(hole, board) : null), [holeKey, boardKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chen = useMemo(() => (inHand ? chenScore(hole) : null), [holeKey]);
  const po = potOddsPct(pot, toCall);
  const isPreflop = street === "preflop";
  const canDraw = inHand && (street === "flop" || street === "turn");

  // Вердикт: шанс улучшиться против доли банка. С готовой рукой (две пары
  // и выше) ауты уже не главное — не советуем сбрасывать сет за «мало аутов».
  let verdict: { text: string; color: string } | null = null;
  if (showOdds && inHand && toCall > 0 && canDraw && outs && current) {
    if (current.category >= 2) verdict = { text: "У тебя уже сильная рука", color: theme.colors.online };
    else if (outs.improvePct >= po + 3) verdict = { text: "Колл выгоден", color: theme.colors.online };
    else if (outs.improvePct >= po - 3) verdict = { text: "На грани — решай сам", color: theme.colors.amber };
    else verdict = { text: "Колл невыгоден", color: theme.colors.danger };
  }

  const section = {
    marginTop: 10,
    padding: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: neo ? "rgba(198,255,61,0.04)" : theme.colors.bgElev,
    gap: 8,
  } as const;
  const head = { fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "700" as const, color: theme.colors.inkMuted, letterSpacing: 1 };
  const line = { fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink, lineHeight: 18 };
  const dim = { fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, lineHeight: 16 };

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Toggle theme={theme} label={theme.decorate ? "[комбинации]" : "🂡 Комбинации"} active={showCombos} onPress={() => setShowCombos((v) => !v)} />
        <Toggle theme={theme} label={theme.decorate ? "[шансы]" : "🎯 Шансы"} active={showOdds} onPress={toggleOdds} />
      </View>

      {showOdds && (
        <View style={section}>
          <Text style={head}>{theme.decorate ? "// ШАНС_БАНКА" : "ШАНС БАНКА"}</Text>
          {!inHand ? (
            <Text style={dim}>Сядь за стол и дождись раздачи — здесь появятся расчёты по твоим картам.</Text>
          ) : (
            <>
              <Text style={line}>
                {toCall > 0 ? (
                  <>
                    Доплатить <Text style={{ fontWeight: "700" }}>{toCall.toLocaleString()}</Text> в банк{" "}
                    <Text style={{ fontWeight: "700" }}>{(pot + toCall).toLocaleString()}</Text> → нужно{" "}
                    <Text style={{ fontWeight: "700" }}>{po}%</Text> побед
                  </>
                ) : (
                  <>Ставки нет — <Text style={{ fontWeight: "700" }}>чек бесплатно</Text></>
                )}
              </Text>

              {isPreflop && chen ? (
                <View>
                  <Text style={line}>
                    Стартовая рука <Text style={{ fontWeight: "700" }}>{chen.label}</Text> — {chen.tier}
                    <Text style={{ color: theme.colors.inkMuted }}> ({chen.score} очков по Чену)</Text>
                  </Text>
                  <Text style={dim}>Расчёт аутов появится на флопе.</Text>
                </View>
              ) : null}

              {canDraw && current && outs ? (
                <View style={{ gap: 6 }}>
                  <Text style={line}>
                    Сейчас у тебя: <Text style={{ fontWeight: "700" }}>{current.name}</Text>
                  </Text>
                  {outs.total > 0 ? (
                    <>
                      <Text style={line}>
                        Шанс улучшить: <Text style={{ fontWeight: "700" }}>{outs.improvePct}%</Text>
                        <Text style={{ color: theme.colors.inkMuted }}>
                          {" "}({outs.total} аутов × {street === "flop" ? 4 : 2})
                        </Text>
                      </Text>
                      {outs.groups.map((g) => (
                        <View key={g.category} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 3 }}>
                          <Text style={[dim, { marginRight: 3 }]}>
                            → {g.name} ({g.cards.length}):
                          </Text>
                          {g.cards.map((c) => (
                            <MiniCard key={c} code={c} theme={theme} />
                          ))}
                        </View>
                      ))}
                    </>
                  ) : (
                    <Text style={dim}>Сильных дро нет.</Text>
                  )}
                  {outs.weakGroups.length > 0 ? (
                    <Text style={[dim, { opacity: 0.8, fontSize: 10.5 }]}>
                      Слабые ауты (не в счёт): {outs.weakGroups.map((g) => `${g.name.toLowerCase()} — ${g.cards.length}`).join(", ")}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {street === "river" && current ? (
                <Text style={line}>
                  Все карты открыты. У тебя: <Text style={{ fontWeight: "700" }}>{current.name}</Text>
                </Text>
              ) : null}

              {verdict ? (
                <View
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    borderRadius: theme.radius.sm,
                    borderWidth: 1,
                    borderColor: verdict.color,
                    backgroundColor: `${verdict.color}22`,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: verdict.color }}>{verdict.text}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      )}

      {showCombos && (
        <View style={section}>
          <Text style={head}>{theme.decorate ? "// ОТ_СИЛЬНОЙ_К_СЛАБОЙ" : "ОТ СИЛЬНОЙ К СЛАБОЙ"}</Text>
          {COMBOS.map((combo) => {
            const isMine = inHand && current != null && current.category === combo.cat;
            return (
              <View
                key={combo.cat}
                style={{
                  padding: 6,
                  borderRadius: theme.radius.sm,
                  borderWidth: 1,
                  borderColor: isMine ? theme.colors.accent : "transparent",
                  backgroundColor: isMine ? (neo ? "rgba(198,255,61,0.10)" : `${theme.colors.accent}22`) : "transparent",
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: isMine ? theme.colors.accent : theme.colors.ink }}>
                    {CATEGORY_NAMES[combo.cat]}
                  </Text>
                  {isMine ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "700", color: theme.colors.accent }}>
                      {theme.decorate ? "<- у_тебя" : "← у тебя"}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {combo.cards.map((c) => (
                    <MiniCard key={c} code={c} theme={theme} />
                  ))}
                </View>
                <Text style={dim}>{combo.note}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
