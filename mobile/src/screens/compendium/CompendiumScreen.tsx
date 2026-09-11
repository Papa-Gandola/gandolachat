import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { DotaRankBadge } from "../../components/DotaRankBadge";
import { ScreenContainer } from "../../components/ScreenContainer";
import {
  apiErrorMessage, compendiumApi, CompendiumCosmetics, CompendiumMe, CompendiumQuest,
  CompendiumSeasonRow, CompendiumTrophy, SeasonArchive, BetsOverview, BetOut,
} from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { useDotaPlaying } from "../../services/dotaPresence";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

type ThemeT = ReturnType<typeof useTheme>;
type TabKey = "quests" | "season" | "bets" | "archive" | "trophies" | "cosmetics";

const BLOOD = "#ff6a5e";
const GOLD = "#ffd24a";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export function CompendiumScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const [data, setData] = useState<CompendiumMe | null>(null);
  const [rows, setRows] = useState<CompendiumSeasonRow[] | null>(null);
  const [seasonErr, setSeasonErr] = useState(false);
  const [archive, setArchive] = useState<SeasonArchive[] | null>(null);
  const [archiveErr, setArchiveErr] = useState(false);
  const [betsTick, setBetsTick] = useState(0);
  const dotaPlaying = useDotaPlaying();
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

  const loadArchive = useCallback(async () => {
    try {
      const res = await compendiumApi.seasons();
      setArchive(res.data);
      setArchiveErr(false);
    } catch {
      setArchiveErr(true);
    }
  }, []);

  useEffect(() => {
    load();
    // Карточка задания в чате = что-то засчитали — обновляем экран живьём
    const onMsg = (m: { content?: string }) => {
      if (typeof m?.content === "string" && m.content.startsWith("/quest_card")) {
        load();
        // Карточка финала = архив пополнился
        if (m.content.includes("season_final")) loadArchive();
        // Ставки рассудились — открытая вкладка обновится
        if (m.content.includes("bet_result")) setBetsTick((t) => t + 1);
        setUserTrophies({});
      }
    };
    wsService.on("message", onMsg);
    return () => wsService.off("message", onMsg);
  }, [load, loadArchive]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // На вкладке АРХИВ свайп обновляет архив, на СТАВКАХ — ставки
    await (tab === "archive" ? loadArchive() : load());
    if (tab === "bets") setBetsTick((t) => t + 1);
    setRefreshing(false);
  }, [load, loadArchive, tab]);

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
                  ["bets", "СТАВКИ"],
                  ["archive", "АРХИВ"],
                  ["trophies", "ТРОФЕИ"],
                  ["cosmetics", "КОСМЕТИКА"],
                ] as [TabKey, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    setTab(key);
                    if (key === "archive") loadArchive();
                    else if (key === "bets") setBetsTick((t) => t + 1);
                    else load();
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
                              {r.username}{r.comp_badge ? " ⛽" : ""}{dotaPlaying.has(r.user_id) ? " 🎮" : ""}{r.user_id === auth.user?.id ? " (ты)" : ""}
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

              {tab === "bets" && (
                <BetsTab theme={theme} refreshTick={betsTick} myId={auth.user?.id ?? 0} />
              )}

              {tab === "archive" && (
                <View style={{ gap: 14 }}>
                  {archiveErr ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: BLOOD }}>
                      ⚠ Не удалось загрузить архив — тыкни вкладку ещё раз
                    </Text>
                  ) : null}
                  {!archive && !archiveErr ? <ActivityIndicator color={theme.colors.accent} /> : null}
                  {archive && archive.length === 0 && !archiveErr ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.inkMuted, lineHeight: 18 }}>
                      Архив пуст — первый сезон ещё не закрыт. Финал случается сам в ночь на 1-е число 🏁
                    </Text>
                  ) : null}
                  {archive?.map((arc) => (
                    <View key={arc.season} style={{ backgroundColor: theme.colors.bgElev, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, overflow: "hidden" }}>
                      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "800", color: theme.colors.accent, letterSpacing: 1, padding: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                        СЕЗОН {arc.season_name.toUpperCase()} · {arc.season.slice(0, 4)}
                      </Text>
                      {arc.rows.map((r) => (
                        <View
                          key={r.user_id}
                          style={{
                            flexDirection: "row", alignItems: "center", gap: 9,
                            paddingVertical: 8, paddingHorizontal: 11,
                            borderBottomWidth: 1, borderBottomColor: theme.colors.border,
                            backgroundColor: r.user_id === auth.user?.id ? `${theme.colors.accent}14` : "transparent",
                          }}
                        >
                          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "800", width: 26, color: r.place === 1 ? GOLD : r.place === 2 ? "#c0c6cf" : r.place === 3 ? "#cd7f32" : theme.colors.inkMuted }}>
                            {r.place === 1 ? "🥇" : r.place === 2 ? "🥈" : r.place === 3 ? "🥉" : r.place}
                          </Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 12.5, fontWeight: "700", color: theme.colors.ink }}>
                              {r.username}{r.user_id === auth.user?.id ? " (ты)" : ""}
                            </Text>
                            <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: r.place === 1 ? GOLD : theme.colors.inkMuted }}>
                              {r.place === 1 ? `«Чемпион ${arc.season_name}» · ` : ""}ур.{r.level} · ✓{r.quests_done}{r.anti_count ? ` · 💀${r.anti_count}` : ""}
                            </Text>
                          </View>
                          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12.5, fontWeight: "800", color: theme.colors.accent }}>
                            {r.gas} ⛽
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                  {archive && archive.length > 0 ? (
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
                      Ники — на момент закрытия сезона. Рамки подиума — в КОСМЕТИКЕ.
                    </Text>
                  ) : null}
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
      // В вебе RN-овский Alert — пустышка, поэтому window.alert.
      onPress={() => {
        const title = `${bad ? "💀 " : ""}${t.name}`;
        if (Platform.OS === "web") window.alert(`${title}\n\n${t.desc || ""}`);
        else Alert.alert(title, t.desc || "");
      }}
      style={{ paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: c, borderRadius: theme.radius.sm, backgroundColor: `${c}14` }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "700", color: c }}>
        {bad ? "💀 " : ""}{t.name}
      </Text>
    </Pressable>
  );
}

const BET_MARKETS: Array<{ key: string; name: string; sides: Array<[string, string]> }> = [
  { key: "match", name: "ИСХОД", sides: [["win", "победа"], ["lose", "поражение"]] },
  { key: "kills", name: "УБИЙСТВА", sides: [["over", "больше"], ["under", "меньше"]] },
  { key: "kda", name: "KDA", sides: [["over", "больше"], ["under", "меньше"]] },
  { key: "roshan", name: "РОШАНЫ", sides: [["over", "возьмут"], ["under", "не возьмут"]] },
  { key: "streak", name: "ВИНСТРИК", sides: [["win", "подряд"]] },
];

function BetsTab({ theme, refreshTick, myId }: { theme: ThemeT; refreshTick: number; myId: number }) {
  const [ov, setOv] = useState<BetsOverview | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [targetId, setTargetId] = useState(0);
  const [market, setMarket] = useState("match");
  const [side, setSide] = useState("win");
  const [streakLen, setStreakLen] = useState(2);
  const [stake, setStake] = useState("20");
  const [busy, setBusy] = useState(false);
  const [placeErr, setPlaceErr] = useState("");
  const [placedOk, setPlacedOk] = useState("");

  useEffect(() => {
    let alive = true;
    compendiumApi.bets()
      .then((res) => { if (alive) { setOv(res.data); setLoadErr(false); } })
      .catch(() => { if (alive) setLoadErr(true); });
    return () => { alive = false; };
  }, [refreshTick]);

  if (loadErr) {
    return <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: BLOOD }}>⚠ Не удалось загрузить — потяни вниз</Text>;
  }
  if (!ov) return <ActivityIndicator color={theme.colors.accent} />;

  const target = ov.targets.find((t) => t.user_id === targetId) || null;
  const onSelf = target?.is_me ?? false;
  const marketDef = BET_MARKETS.find((m) => m.key === market)!;
  const sides = onSelf ? marketDef.sides.filter(([k]) => k === "win" || k === "over") : marketDef.sides;
  const effSide = sides.some(([k]) => k === side) ? side : sides[0][0];
  const cap = market === "streak" ? (ov.streak_stake_max[String(streakLen)] ?? 10) : ov.stake_max;
  const mult = market === "streak" ? 2 ** streakLen : 2;
  const lineText = !target ? "" :
    market === "kills" ? `линия: ${target.kills_line} (средняя)` :
    market === "kda" ? `линия: ${(target.kda_line / 10).toFixed(1)} (средняя)` :
    market === "roshan" ? `линия: ${target.roshan_line} рошана (нужен парс 📼)` :
    market === "streak" ? "победы строго подряд" : "следующая рейтинговая";

  const chip = (active: boolean) => ({
    paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: theme.radius.sm,
    backgroundColor: active ? theme.colors.accent : theme.colors.bgElev,
    borderWidth: 1, borderColor: active ? theme.colors.accent : theme.colors.border,
    opacity: busy ? 0.7 : 1,
  }) as const;
  const chipText = (active: boolean) => ({
    fontFamily: theme.fonts.mono, fontSize: 11.5, fontWeight: "700",
    color: active ? theme.colors.accentText : theme.colors.ink,
  }) as const;

  const place = async () => {
    if (!target || busy) return;
    setBusy(true);
    setPlaceErr("");
    setPlacedOk("");
    try {
      const res = await compendiumApi.placeBet({
        target_id: target.user_id, market, side: effSide,
        ...(market === "streak" ? { line: streakLen } : {}),
        stake: Math.round(Number(stake) || 0),
      });
      setOv((prev) => prev ? { ...prev, my_gas: res.data.my_gas, open: [res.data.bet, ...prev.open] } : prev);
      setPlacedOk(`Принято! ${res.data.bet.label} · ${res.data.bet.stake}⛽ (×${mult})`);
    } catch (e) {
      setPlaceErr(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const outcome = (b: BetOut) =>
    b.status === "won" ? { t: `✅ +${b.payout - b.stake}⛽`, c: "#57f287" }
      : b.status === "lost" ? { t: `❌ -${b.stake}⛽`, c: BLOOD }
      : b.status === "refunded" ? { t: "↩ возврат", c: theme.colors.inkMuted }
      : { t: `${b.stake}⛽`, c: theme.colors.accent };

  const betRow = (b: BetOut, showOutcome: boolean) => (
    <View key={b.id} style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, fontWeight: "700", color: b.bettor_id === myId ? theme.colors.accent : theme.colors.ink }}>
        {b.bettor_id === myId ? "ты" : b.bettor}
      </Text>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>
        → {b.target_id === b.bettor_id ? "себя" : b.target}: {b.label}
        {b.market === "streak" && b.status === "open" ? ` · ${b.progress}/${b.line}` : ""}
        {b.pending_parse ? " · 📼" : ""}
      </Text>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, fontWeight: "800", color: showOutcome ? outcome(b).c : theme.colors.accent }}>
        {showOutcome ? outcome(b).t : `${b.stake}⛽`}
      </Text>
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      <View style={{ backgroundColor: theme.colors.bgElev, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "800", letterSpacing: 1, color: theme.colors.accent }}>НОВАЯ СТАВКА</Text>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted }}>твой газ: <Text style={{ color: theme.colors.accent, fontWeight: "800" }}>{ov.my_gas} ⛽</Text></Text>
        </View>
        {!ov.linked ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, color: theme.colors.inkMuted, lineHeight: 17 }}>
            Ставки — только для привязанных к Dota (вкладка «Я»). Чужие видно и так 👇
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {ov.targets.map((t) => (
                <Pressable key={t.user_id} onPress={() => { setTargetId(t.user_id); setPlacedOk(""); }} style={chip(targetId === t.user_id)}>
                  <Text style={chipText(targetId === t.user_id)}>{t.is_me ? "на себя 💪" : t.username}</Text>
                </Pressable>
              ))}
            </View>
            {target ? (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {BET_MARKETS.map((m) => (
                    <Pressable key={m.key} onPress={() => { setMarket(m.key); setPlacedOk(""); }} style={chip(market === m.key)}>
                      <Text style={chipText(market === m.key)}>{m.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {market === "streak" ? (
                    [2, 3, 5].map((k) => (
                      <Pressable key={k} onPress={() => setStreakLen(k)} style={chip(streakLen === k)}>
                        <Text style={chipText(streakLen === k)}>{k} побед ×{2 ** k}</Text>
                      </Pressable>
                    ))
                  ) : (
                    sides.map(([k, label]) => (
                      <Pressable key={k} onPress={() => setSide(k)} style={chip(effSide === k)}>
                        <Text style={chipText(effSide === k)}>{label}</Text>
                      </Pressable>
                    ))
                  )}
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>{lineText}</Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <TextInput
                    value={stake}
                    onChangeText={setStake}
                    keyboardType="number-pad"
                    style={{
                      fontFamily: theme.fonts.mono, width: 74, paddingHorizontal: 10, paddingVertical: 7,
                      backgroundColor: theme.colors.bg, color: theme.colors.ink, fontSize: 13,
                      borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm,
                    }}
                  />
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
                    {ov.stake_min}–{cap}⛽ · выплата ×{mult}
                  </Text>
                  <Pressable onPress={place} disabled={busy} style={{ backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingHorizontal: 16, paddingVertical: 9, opacity: busy ? 0.6 : 1 }}>
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11.5, fontWeight: "800", color: theme.colors.accentText }}>ПОСТАВИТЬ</Text>
                  </Pressable>
                </View>
                {onSelf ? (
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>
                    На себя — только за успех: селф-челлендж. Руин не оплачивается 🙂
                  </Text>
                ) : null}
                {placeErr ? <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: BLOOD }}>{placeErr}</Text> : null}
                {placedOk ? <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: "#57f287" }}>{placedOk}</Text> : null}
              </>
            ) : (
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>Выбери, на кого ставишь 👆</Text>
            )}
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.inkMuted, lineHeight: 14 }}>
              Газ списывается сразу. Рассудит поллер по следующей катке; сам в катке цели — ставка
              аннулируется (анти-руин). Нет катки 24ч (стрик — 7 дней) — газ вернётся.
            </Text>
          </>
        )}
      </View>

      <View style={{ backgroundColor: theme.colors.bgElev, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12 }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "800", letterSpacing: 1, color: theme.colors.accent, marginBottom: 4 }}>
          ОТКРЫТЫЕ · {ov.open.length}
        </Text>
        {!ov.open.length ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted }}>Пока тихо — стол ждёт смелых ⛽</Text>
        ) : ov.open.map((b) => betRow(b, false))}
      </View>

      <View style={{ backgroundColor: theme.colors.bgElev, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: 12 }}>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "800", letterSpacing: 1, color: theme.colors.accent, marginBottom: 4 }}>
          МОИ ПОСЛЕДНИЕ
        </Text>
        {!ov.my_recent.length ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted }}>История пуста — сделай первую ставку</Text>
        ) : ov.my_recent.map((b) => betRow(b, true))}
      </View>
    </View>
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

  // trophy: разблокировка не уровнем, а местом в финале — замки́ на кнопках
  const Row = ({ need, name, desc, children, trophy }: { need: number; name: string; desc: string; children?: React.ReactNode; trophy?: boolean }) => {
    const locked = !trophy && lvl < need;
    return (
      <View style={{ gap: 7, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.border, opacity: locked ? 0.65 : 1 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "baseline" }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, fontWeight: "800", color: locked ? theme.colors.inkMuted : theme.colors.accent, minWidth: 38 }}>
            {trophy ? "🏆" : locked ? `🔒 ${need}` : `ур.${need}`}
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

      <Row need={U.title ?? 4} trophy={lvl < (U.title ?? 4) && !!cos.podium_frames?.gold} name="Титул под ником" desc="Из заработанных — прожарочные тоже считаются">
        {cos.earned_titles.length === 0 ? (
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, fontStyle: "italic" }}>
            Пока ни одного — закрывай громкие задания
          </Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Pressable onPress={() => save({ title: "" })} disabled={busy} style={chip(!cos.title)}>
              <Text style={chipText(!cos.title)}>без титула</Text>
            </Pressable>
            {cos.earned_titles.filter((t) => lvl >= (U.title ?? 4) || t.startsWith("Чемпион ")).map((t) => (
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

      <Row trophy need={0} name="Рамки подиума" desc="За место в финале сезона — остаются навсегда">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {(cos.podium_frames?.gold || cos.podium_frames?.silver || cos.podium_frames?.bronze) ? (
            <Pressable onPress={() => save({ frame: "" })} disabled={busy} style={chip(!cos.frame)}>
              <Text style={chipText(!cos.frame)}>без рамки</Text>
            </Pressable>
          ) : null}
          {(["gold", "silver", "bronze"] as const).map((f) => {
            const pf = cos.podium_frames || { gold: false, silver: false, bronze: false };
            const has = pf[f];
            const label = f === "gold" ? "🥇 золотая" : f === "silver" ? "🥈 серебряная" : "🥉 бронзовая";
            return (
              <Pressable key={f} onPress={() => has && save({ frame: f })} disabled={busy || !has} style={chip(cos.frame === f, !has)}>
                <Text style={chipText(cos.frame === f)}>{label}{has ? "" : " 🔒"}</Text>
              </Pressable>
            );
          })}
        </View>
      </Row>

      <Row need={U.dota_gold ?? 10} name="Золотой /dota" desc="Твой зов «Газуем в дотан» — с короной. Включается сам.">
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: GOLD }}>👑 активен — просто напиши /dota</Text>
      </Row>
    </View>
  );
}
