import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { DotaRankBadge } from "../../components/DotaRankBadge";
import { ScreenContainer } from "../../components/ScreenContainer";
import {
  apiErrorMessage, compendiumApi, CompendiumCosmetics, CompendiumMe, CompendiumQuest,
  CompendiumSeasonRow, CompendiumTrophy,
} from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

type ThemeT = ReturnType<typeof useTheme>;
type TabKey = "quests" | "season" | "trophies" | "cosmetics";

const BLOOD = "#ff6a5e";
const GOLD = "#ffd24a";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export function CompendiumScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const [data, setData] = useState<CompendiumMe | null>(null);
  const [rows, setRows] = useState<CompendiumSeasonRow[] | null>(null);
  const [seasonErr, setSeasonErr] = useState(false);
  const [tab, setTab] = useState<TabKey>("quests");
  const [refreshing, setRefreshing] = useState(false);
  // Раскрытых полок может быть несколько — удобно сравнивать людей.
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [userTrophies, setUserTrophies] = useState<Record<number, CompendiumTrophy[]>>({});

  const load = useCallback(async () => {
    try {
      const res = await compendiumApi.me();
      setData(res.data);
    } catch {
      /* держим прошлые данные; pull-to-refresh дотянет */
    }
    try {
      const res = await compendiumApi.season();
      setRows(res.data.rows);
      setSeasonErr(false);
    } catch {
      setSeasonErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    // Карточка задания в чате = что-то засчитали — обновляем экран живьём
    const onMsg = (m: { content?: string }) => {
      if (typeof m?.content === "string" && m.content.startsWith("/quest_card")) {
        load();
        setUserTrophies({});
      }
    };
    wsService.on("message", onMsg);
    return () => wsService.off("message", onMsg);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const seasonTitle = useMemo(() => {
    if (!data?.season) return "";
    const [y, m] = data.season.split("-");
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }, [data?.season]);

  const toggleUser = async (uid: number) => {
    if (expandedUsers.has(uid)) {
      setExpandedUsers((prev) => {
        const n = new Set(prev);
        n.delete(uid);
        return n;
      });
      return;
    }
    setExpandedUsers((prev) => new Set(prev).add(uid));
    if (!userTrophies[uid]) {
      try {
        const res = await compendiumApi.user(uid);
        setUserTrophies((prev) => ({ ...prev, [uid]: res.data.trophies }));
      } catch {
        /* полка просто не раскроется */
      }
    }
  };

  return (
    <ScreenContainer>
      <AppBar title={theme.decorate ? "// ГАНДОЛИУМ ⛽" : "⛽ Гандолиум"} />
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
      >
        {!data ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : !data.linked ? (
          <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
            <Text style={{ fontSize: 40 }}>⛽</Text>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 15, fontWeight: "700", color: theme.colors.ink, textAlign: "center" }}>
              Steam ещё не привязан
            </Text>
            <Text style={{ fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.inkDim, textAlign: "center", lineHeight: 19 }}>
              Привяжи Steam во вкладке «Я» — рейтинговые катки начнут засчитываться, газ закапает, а чат увидит твои подвиги (и позор).
            </Text>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, textAlign: "center" }}>
              Я → DOTA 2 → Привязать
            </Text>
          </View>
        ) : (
          <>
            {/* Шапка прогресса */}
            <View style={{ margin: 14, padding: 14, backgroundColor: theme.colors.bgElev, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted, letterSpacing: 1 }}>
                  СЕЗОН · {seasonTitle.toUpperCase()}
                </Text>
                <DotaRankBadge rankTier={data.rank_tier} leaderboardRank={data.leaderboard_rank} small />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted, letterSpacing: 1 }}>УРОВЕНЬ</Text>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 30, fontWeight: "800", color: theme.colors.accent, lineHeight: 34 }}>
                    {data.level}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.ink }}>⛽ {data.gas} газа</Text>
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
                      {data.level_progress}/{data.level_target}
                    </Text>
                  </View>
                  <View style={{ height: 7, backgroundColor: theme.colors.bgInput, borderRadius: 4, overflow: "hidden" }}>
                    <View
                      style={{
                        height: "100%",
                        width: `${Math.min(100, ((data.level_progress ?? 0) / (data.level_target ?? 100)) * 100)}%`,
                        backgroundColor: theme.colors.accent,
                      }}
                    />
                  </View>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
                    каток: {data.matches ?? 0} · побед: {data.wins ?? 0}
                  </Text>
                </View>
              </View>
            </View>

            {/* Вкладки */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 14, gap: 6 }}>
              {(
                [
                  ["quests", "ЗАДАНИЯ"],
                  ["season", "СЕЗОН"],
                  ["trophies", "ТРОФЕИ"],
                  ["cosmetics", "КОСМЕТИКА"],
                ] as [TabKey, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    setTab(key);
                    load();
                  }}
                  style={{
                    paddingHorizontal: 13,
                    paddingVertical: 7,
                    borderRadius: theme.radius.sm,
                    backgroundColor: tab === key ? theme.colors.accent : theme.colors.bgElev,
                    borderWidth: 1,
                    borderColor: tab === key ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, fontWeight: "700", color: tab === key ? theme.colors.accentText : theme.colors.inkDim, letterSpacing: 0.5 }}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ padding: 14, gap: 14 }}>
              {tab === "quests" && (
                <>
                  <QuestGroup theme={theme} title="ЕЖЕДНЕВКИ" meta="ротация в полночь МСК" quests={data.daily ?? []} pool={data.daily_pool} />
                  <QuestGroup theme={theme} title="ЕЖЕНЕДЕЛЬКИ" meta="сброс в понедельник" quests={data.weekly ?? []} pool={data.weekly_pool} />
                  <QuestGroup theme={theme} title="МАРАФОНЫ СЕЗОНА" meta="весь месяц" quests={data.season_quests ?? []} />
                  <QuestGroup theme={theme} title="КОМАНДНЫЕ" meta="катки с людьми из чата" quests={data.team ?? []} accent />
                  <QuestGroup theme={theme} title="АНТИ-АЧИВКИ" meta="выдаются сами" quests={data.anti ?? []} blood />
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted, lineHeight: 15 }}>
                    📼 — нужен парс реплея (доезжает чуть позже катки) · ещё есть 12 скрытых пасхалок — узнаешь, когда триггернёшь 🔒
                  </Text>
                </>
              )}

              {tab === "season" && (
                <View style={{ gap: 2 }}>
                  {seasonErr ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: BLOOD, marginBottom: 6 }}>
                      ⚠ Не удалось обновить — потяни вниз
                    </Text>
                  ) : null}
                  {!rows ? (
                    <ActivityIndicator color={theme.colors.accent} />
                  ) : rows.length === 0 ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkMuted }}>
                      Пока никто не привязал Steam
                    </Text>
                  ) : (
                    rows.map((r, i) => (
                      <View key={r.user_id}>
                        <Pressable
                          onPress={() => toggleUser(r.user_id)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 9,
                            paddingVertical: 9,
                            paddingHorizontal: 8,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.border,
                            backgroundColor: r.user_id === auth.user?.id ? `${theme.colors.accent}14` : "transparent",
                            borderRadius: theme.radius.sm,
                          }}
                        >
                          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "800", width: 26, color: i === 0 ? GOLD : i <= 2 ? theme.colors.accent : theme.colors.inkMuted }}>
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                          </Text>
                          <Avatar letter={(r.username[0] ?? "?").toUpperCase()} size={28} bg="#5865f2" uri={r.avatar_url} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: r.comp_color || theme.colors.ink }}>
                              {r.username}{r.comp_badge ? " ⛽" : ""}{r.user_id === auth.user?.id ? " (ты)" : ""}
                            </Text>
                            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted }}>
                              ур.{r.level} · ✓{r.quests_done}{r.anti_count ? ` · 💀${r.anti_count}` : ""}{r.comp_title ? ` · «${r.comp_title}»` : ""}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "800", color: theme.colors.accent }}>
                            {r.gas} ⛽
                          </Text>
                        </Pressable>
                        {expandedUsers.has(r.user_id) ? (
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, paddingVertical: 8, paddingLeft: 34 }}>
                            {!userTrophies[r.user_id]?.length ? (
                              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>Полка пока пустая</Text>
                            ) : (
                              userTrophies[r.user_id].map((t, j) => <TrophyChip key={j} theme={theme} t={t} />)
                            )}
                          </View>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>
              )}

              {tab === "trophies" && (
                <View style={{ gap: 6 }}>
                  {!data.trophies?.length ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkMuted }}>
                      Пока пусто. Иди катай — газ сам себя не заработает ⛽
                    </Text>
                  ) : (
                    data.trophies.map((t, i) => (
                      <View
                        key={i}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 9,
                          padding: 10,
                          backgroundColor: theme.colors.bgElev,
                          borderRadius: theme.radius.sm,
                          borderLeftWidth: 3,
                          borderLeftColor: t.cat === "anti" ? BLOOD : t.cat === "secret" ? GOLD : theme.colors.accent,
                        }}
                      >
                        <Text style={{ fontSize: 15 }}>{t.cat === "anti" ? "💀" : t.cat === "secret" ? "🔓" : t.cat === "team" ? "🤝" : "⛽"}</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12.5, fontWeight: "700", color: t.cat === "anti" ? BLOOD : theme.colors.ink }}>
                            {t.name}
                            {t.title ? <Text style={{ color: GOLD, fontSize: 10.5 }}>  титул «{t.title}»</Text> : null}
                          </Text>
                          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted }}>
                            {new Date(t.completed_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "800", color: t.cat === "anti" ? BLOOD : theme.colors.accent }}>
                          +{t.gas} ⛽
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              )}

              {tab === "cosmetics" && data.cosmetics && (
                <CosmeticsTab
                  theme={theme}
                  cos={data.cosmetics}
                  onSaved={(c) => setData((prev) => (prev ? { ...prev, cosmetics: c } : prev))}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function QuestGroup({ theme, title, meta, quests, pool, blood, accent }: {
  theme: ThemeT;
  title: string;
  meta: string;
  quests: CompendiumQuest[];
  pool?: CompendiumQuest[];
  blood?: boolean;
  accent?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!quests.length) return null;
  const hasPool = !!pool?.length && pool.length > quests.length;
  const items = hasPool && expanded ? pool! : quests;
  const edge = blood ? BLOOD : theme.colors.accent;
  return (
    <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderLeftWidth: blood || accent ? 3 : 1, borderLeftColor: blood || accent ? edge : theme.colors.border, borderRadius: theme.radius.md, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 10, backgroundColor: theme.colors.bgElev, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 8 }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, color: blood ? BLOOD : theme.colors.accent }}>
          // {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.inkMuted, flexShrink: 1 }}>{meta}</Text>
          {hasPool ? (
            <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "700", color: theme.colors.accent }}>
                {expanded ? "свернуть ▴" : `пул (${pool!.length}) ▾`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {items.map((q) => {
        const inactive = expanded && hasPool && q.active === false;
        return (
          <View key={q.id} style={{ flexDirection: "row", gap: 9, padding: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, opacity: inactive ? 0.45 : q.done ? 0.7 : 1 }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, width: 18, color: q.done ? theme.colors.accent : theme.colors.inkMuted }}>
              {q.done ? "✓" : String(q.num).padStart(2, "0")}
            </Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12.5, fontWeight: "700", color: theme.colors.ink, textDecorationLine: q.done ? "line-through" : "none" }}>
                {q.name}
                {q.needs_parse ? " 📼" : ""}
                {q.title ? <Text style={{ color: GOLD, fontSize: 10 }}>  титул</Text> : null}
                {expanded && hasPool && q.active && !q.done ? <Text style={{ color: theme.colors.accent, fontSize: 9.5 }}>  ● активно</Text> : null}
                {inactive ? <Text style={{ color: theme.colors.inkMuted, fontSize: 9.5 }}>  не в ротации</Text> : null}
              </Text>
              <Text style={{ fontFamily: theme.fonts.body, fontSize: 11.5, color: theme.colors.inkDim, marginTop: 1 }}>{q.desc}</Text>
              {typeof q.progress === "number" && typeof q.target === "number" && !q.done ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 }}>
                  <View style={{ flex: 1, maxWidth: 170, height: 4, backgroundColor: theme.colors.bgInput, borderRadius: 3, overflow: "hidden" }}>
                    <View style={{ height: "100%", width: `${Math.min(100, (q.progress / q.target) * 100)}%`, backgroundColor: theme.colors.accent }} />
                  </View>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted }}>
                    {q.progress}/{q.target}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, fontWeight: "800", color: blood ? BLOOD : theme.colors.accent }}>
              {blood ? "+" : ""}{q.gas} ⛽
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function TrophyChip({ theme, t }: { theme: ThemeT; t: CompendiumTrophy }) {
  const bad = t.cat === "anti";
  const c = bad ? BLOOD : theme.colors.accent;
  return (
    <Pressable
      // Тап по ачивке — короткое описание (у тайных сервер шлёт «???»).
      onPress={() => Alert.alert(`${bad ? "💀 " : ""}${t.name}`, t.desc || "")}
      style={{ paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: c, borderRadius: theme.radius.sm, backgroundColor: `${c}14` }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "700", color: c }}>
        {bad ? "💀 " : ""}{t.name}
      </Text>
    </Pressable>
  );
}

function CosmeticsTab({ theme, cos, onSaved }: {
  theme: ThemeT;
  cos: CompendiumCosmetics;
  onSaved: (c: CompendiumCosmetics) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lvl = cos.max_level;
  const U = cos.unlocks;

  const save = async (patch: { badge?: boolean; title?: string; color?: string; frame?: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await compendiumApi.updateCosmetics(patch);
      onSaved(res.data);
    } catch (e) {
      Alert.alert("Не получилось", apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean, locked = false) =>
    ({
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: theme.radius.sm,
      backgroundColor: active ? theme.colors.accent : theme.colors.bgElev,
      borderWidth: 1,
      borderColor: active ? theme.colors.accent : theme.colors.border,
      opacity: locked ? 0.5 : busy ? 0.7 : 1,
    }) as const;
  const chipText = (active: boolean) =>
    ({
      fontFamily: theme.fonts.mono,
      fontSize: 11.5,
      fontWeight: "700",
      color: active ? theme.colors.accentText : theme.colors.ink,
    }) as const;

  const Row = ({ need, name, desc, children }: { need: number; name: string; desc: string; children?: React.ReactNode }) => {
    const locked = lvl < need;
    return (
      <View style={{ gap: 7, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.border, opacity: locked ? 0.65 : 1 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "800", color: locked ? theme.colors.inkMuted : theme.colors.accent, minWidth: 38 }}>
            {locked ? `🔒 ${need}` : `ур.${need}`}
          </Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12.5, fontWeight: "700", color: theme.colors.ink }}>{name}</Text>
        </View>
        <Text style={{ fontFamily: theme.fonts.body, fontSize: 11, color: theme.colors.inkMuted, paddingLeft: 46 }}>
          {locked ? `Откроется на уровне ${need} · ${desc}` : desc}
        </Text>
        {!locked ? <View style={{ paddingLeft: 46 }}>{children}</View> : null}
      </View>
    );
  };

  return (
    <View>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted, marginBottom: 4 }}>
        открыто уровнем {lvl} · уровни не сгорают между сезонами
      </Text>

      <Row need={U.badge ?? 2} name="Значок ⛽ у ника" desc="Виден в чате и списках">
        <Pressable onPress={() => save({ badge: !cos.badge })} disabled={busy} style={chip(cos.badge)}>
          <Text style={chipText(cos.badge)}>{cos.badge ? "Вкл" : "Выкл"}</Text>
        </Pressable>
      </Row>

      <Row need={U.title ?? 4} name="Титул под ником" desc="Из заработанных — прожарочные тоже считаются">
        {cos.earned_titles.length === 0 ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, fontStyle: "italic" }}>
            Пока ни одного — закрывай громкие задания
          </Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Pressable onPress={() => save({ title: "" })} disabled={busy} style={chip(!cos.title)}>
              <Text style={chipText(!cos.title)}>без титула</Text>
            </Pressable>
            {cos.earned_titles.map((t) => (
              <Pressable key={t} onPress={() => save({ title: t })} disabled={busy} style={chip(cos.title === t)}>
                <Text style={chipText(cos.title === t)}>«{t}»</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Row>

      <Row need={U.color ?? 6} name="Цвет ника" desc="Палитра Гандолы — виден всем в чате">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Pressable onPress={() => save({ color: "" })} disabled={busy} style={chip(!cos.color)}>
            <Text style={chipText(!cos.color)}>обычный</Text>
          </Pressable>
          {cos.palette.map((c) => (
            <Pressable
              key={c}
              onPress={() => save({ color: c })}
              disabled={busy}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: c,
                borderWidth: cos.color === c ? 3 : 1,
                borderColor: cos.color === c ? theme.colors.ink : theme.colors.border,
              }}
            />
          ))}
        </View>
      </Row>

      <Row need={U.frame_lime ?? 8} name="Рамка аватарки" desc="Лаймовая — «ветеран сезона»">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Pressable onPress={() => save({ frame: "" })} disabled={busy} style={chip(!cos.frame)}>
            <Text style={chipText(!cos.frame)}>без рамки</Text>
          </Pressable>
          <Pressable onPress={() => save({ frame: "lime" })} disabled={busy} style={chip(cos.frame === "lime")}>
            <Text style={chipText(cos.frame === "lime")}>лаймовая</Text>
          </Pressable>
          <Pressable
            onPress={() => lvl >= (U.frame_animated ?? 12) && save({ frame: "animated" })}
            disabled={busy || lvl < (U.frame_animated ?? 12)}
            style={chip(cos.frame === "animated", lvl < (U.frame_animated ?? 12))}
          >
            <Text style={chipText(cos.frame === "animated")}>
              переливающаяся{lvl < (U.frame_animated ?? 12) ? ` 🔒${U.frame_animated ?? 12}` : ""}
            </Text>
          </Pressable>
        </View>
      </Row>

      <Row need={U.dota_gold ?? 10} name="Золотой /dota" desc="Твой зов «Газуем в дотан» — с короной. Включается сам.">
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: GOLD }}>👑 активен — просто напиши /dota</Text>
      </Row>
    </View>
  );
}
