import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppBar } from "../../components/AppBar";
import { Avatar } from "../../components/Avatar";
import { ChevronLeftIcon } from "../../components/icons";
import { IconBtn } from "../../components/IconBtn";
import { ScreenContainer } from "../../components/ScreenContainer";
import { ChatsStackParamList } from "../../navigation/types";
import {
  apiErrorMessage,
  PokerGameView,
  PokerHistory,
  PokerHistoryHand,
  PokerPlayerView,
  pokerApi,
  PokerTableOut,
  PokerTableSettings,
} from "../../services/api";
import { useAuth } from "../../services/AuthContext";
import { wsService } from "../../services/ws";
import { useTheme } from "../../theme";

type Props = NativeStackScreenProps<ChatsStackParamList, "Poker">;
type ThemeT = ReturnType<typeof useTheme>;

const PALETTE = ["#ef5350", "#7c4dff", "#ffa726", "#26a69a", "#ec407a", "#5c6bc0", "#ff7043", "#3949ab", "#66bb6a"];
const colorFor = (id: number) => PALETTE[id % PALETTE.length];

export function PokerScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const { user } = useAuth();
  const { chatId, chatName } = route.params;
  const numericChatId = Number(chatId);

  const [tables, setTables] = useState<PokerTableOut[]>([]);
  const [activeTable, setActiveTable] = useState<PokerTableOut | null>(null);
  const [gameState, setGameState] = useState<PokerGameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Настройки стола (создание / правка в лобби), история раздач, пауза докупки
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PokerHistory | null>(null);
  const [graceLeft, setGraceLeft] = useState<number | null>(null);
  const prevMyTurn = useRef(false);

  useEffect(() => {
    pokerApi
      .list(numericChatId)
      .then((res) => setTables(res.data))
      .catch((e) => setError(apiErrorMessage(e)));
  }, [numericChatId]);

  // Ask the server to push current game state when we open a playing table.
  useEffect(() => {
    if (activeTable && activeTable.status === "playing") {
      wsService.send({ type: "poker_request_state", table_id: activeTable.id });
    }
  }, [activeTable?.id, activeTable?.status]);

  // Haptic nudge when it becomes my turn.
  useEffect(() => {
    const myTurn = !!gameState?.players.find((p) => p.user_id === user?.id)?.is_my_turn;
    if (myTurn && !prevMyTurn.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    prevMyTurn.current = myTurn;
  }, [gameState, user?.id]);

  // WS subscriptions.
  useEffect(() => {
    const onCreated = (d: Record<string, unknown>) => {
      const t = d.table as PokerTableOut | undefined;
      if (!t || t.chat_id !== numericChatId) return;
      setTables((prev) => (prev.find((x) => x.id === t.id) ? prev : [t, ...prev]));
    };
    const onUpdated = (d: Record<string, unknown>) => {
      const t = d.table as PokerTableOut | undefined;
      if (!t || t.chat_id !== numericChatId) return;
      setTables((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setActiveTable((cur) => (cur && cur.id === t.id ? t : cur));
    };
    const onRemoved = (d: Record<string, unknown>) => {
      const id = d.table_id as number;
      setTables((prev) => prev.filter((x) => x.id !== id));
      setActiveTable((cur) => (cur && cur.id === id ? null : cur));
    };
    const onState = (d: Record<string, unknown>) => {
      const tableId = d.table_id as number;
      setActiveTable((cur) => {
        if (cur && cur.id === tableId) setGameState(d.state as PokerGameView);
        return cur;
      });
    };
    const onError = (d: Record<string, unknown>) => {
      setError((d.message as string) || "Ошибка");
      setTimeout(() => setError(null), 3000);
    };
    wsService.on("poker_table_created", onCreated);
    wsService.on("poker_table_updated", onUpdated);
    wsService.on("poker_table_removed", onRemoved);
    wsService.on("poker_game_state", onState);
    wsService.on("poker_error", onError);
    return () => {
      wsService.off("poker_table_created", onCreated);
      wsService.off("poker_table_updated", onUpdated);
      wsService.off("poker_table_removed", onRemoved);
      wsService.off("poker_game_state", onState);
      wsService.off("poker_error", onError);
    };
  }, [numericChatId]);

  const createTable = async (settings: PokerTableSettings) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pokerApi.create(numericChatId, settings);
      setShowCreate(false);
      setActiveTable(res.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (tableId: number, settings: PokerTableSettings) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pokerApi.settings(tableId, settings);
      setShowSettings(false);
      setActiveTable(res.data);
      setTables((prev) => prev.map((t) => (t.id === tableId ? res.data : t)));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Докупка в режиме «за газ»: вылетел → энтри ещё раз → стартовый стек.
  const reentry = async (tableId: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pokerApi.reentry(tableId);
      setActiveTable(res.data);
    } catch (e) {
      setError(apiErrorMessage(e));
      setTimeout(() => setError(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  // «Сыграть ещё»: новый стол с теми же настройками и людьми; старый
  // сервер удаляет (poker_table_removed придёт раньше ответа и обнулит
  // activeTable — поэтому ответ ставим поверх).
  const restartTable = async (tableId: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pokerApi.restart(tableId);
      setGameState(null);
      setHistory(null);
      setShowHistory(false);
      setActiveTable(res.data);
      setTables((prev) => [res.data, ...prev.filter((t) => t.id !== tableId && t.id !== res.data.id)]);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async (tableId: number) => {
    try {
      const res = await pokerApi.history(tableId);
      setHistory(res.data);
    } catch {
      setHistory({ table_id: tableId, names: {}, hands: [] });
    }
  };

  // Открытая история подтягивает свежие раздачи по мере игры.
  useEffect(() => {
    if (!showHistory || !activeTable) return;
    loadHistory(activeTable.id);
  }, [showHistory, activeTable?.id, gameState?.history_len]);

  // Секунды до конца паузы «докупись или всё» (режим за газ).
  useEffect(() => {
    const until = gameState?.reentry_open_until;
    if (!until) {
      setGraceLeft(null);
      return;
    }
    const tick = () => setGraceLeft(Math.max(0, Math.round(until - Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameState?.reentry_open_until]);

  const joinTable = async (tableId: number) => {
    // Дабл-тап «Сесть» слал два join — сервер теперь второй отбивает, но
    // ошибку «Already seated» человеку показывать незачем
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await pokerApi.join(tableId);
      setTables((prev) => prev.map((t) => (t.id === tableId ? res.data : t)));
      setActiveTable(res.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const startGame = async (tableId: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pokerApi.start(tableId);
      setActiveTable(res.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const leaveTable = async (tableId: number) => {
    setError(null);
    try {
      const res = await pokerApi.leave(tableId);
      if (res.data) {
        setTables((prev) => prev.map((t) => (t.id === tableId ? res.data! : t)));
        setActiveTable(res.data);
      } else {
        setTables((prev) => prev.filter((t) => t.id !== tableId));
        setActiveTable(null);
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const closeTable = async (tableId: number) => {
    setBusy(true);
    setError(null);
    try {
      await pokerApi.close(tableId);
      setActiveTable(null);
      setGameState(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendAction = (action: "fold" | "check" | "call" | "raise", amount = 0) => {
    if (!activeTable) return;
    const ok = wsService.send({ type: "poker_action", table_id: activeTable.id, action, amount });
    if (!ok) {
      setError("Соединение прервано — попробуй ещё раз");
      setTimeout(() => setError(null), 4000);
    }
  };

  // ===== Lobby (no active table) =====
  if (!activeTable) {
    return (
      <ScreenContainer>
        <AppBar
          title={theme.decorate ? `// ПОКЕР · ${chatName}` : `Покер · ${chatName}`}
          left={
            <IconBtn onPress={() => navigation.goBack()}>
              <ChevronLeftIcon color={theme.colors.ink} />
            </IconBtn>
          }
          right={
            <Pressable
              onPress={() => setShowCreate(true)}
              disabled={busy}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText }}>
                {theme.decorate ? "[+ СТОЛ]" : "+ Стол"}
              </Text>
            </Pressable>
          }
        />
        {error ? (
          <Text style={{ fontFamily: theme.fonts.mono, color: theme.colors.danger, fontSize: 12, padding: 12 }}>
            {theme.decorate ? `! ${error}` : error}
          </Text>
        ) : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
          {tables.length === 0 ? (
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                color: theme.colors.inkMuted,
                fontSize: 13,
                textAlign: "center",
                paddingVertical: 50,
              }}
            >
              {theme.decorate ? "// нет активных столов. создай первый" : "Нет активных столов. Создай первый!"}
            </Text>
          ) : null}
          {tables.map((t) => {
            const mySeat = t.seats.find((s) => s.user_id === user?.id);
            return (
              <View
                key={t.id}
                style={{
                  backgroundColor: theme.colors.bgElev,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  padding: 14,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 15, fontWeight: "700", color: theme.colors.ink }}>
                    {theme.decorate ? `// СТОЛ #${t.id}` : `Стол #${t.id}`}
                  </Text>
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: 10,
                      fontWeight: "700",
                      color: "#fff",
                      backgroundColor: t.status === "lobby" ? theme.colors.online : theme.colors.amber,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: theme.radius.sm,
                      overflow: "hidden",
                    }}
                  >
                    {t.status === "lobby" ? "ЛОББИ" : t.status === "playing" ? "ИДЁТ" : "ФИНИШ"}
                  </Text>
                </View>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, marginBottom: t.mode === "gas" ? 4 : 10 }}>
                  {t.seats.length}/{t.max_seats} · стек {t.starting_stack.toLocaleString()} · блайнды{" "}
                  {t.starting_small_blind}/{t.starting_big_blind} · +1,5× / {t.blind_increase_minutes} мин
                </Text>
                {t.mode === "gas" ? (
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "700", color: theme.colors.accent, marginBottom: 10 }}>
                    ⛽ За газ · энтри {t.entry_gas} · котёл {t.gas_pot} · докупок {t.max_reentries}
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {t.seats.map((s) => (
                    <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Avatar letter={(s.username[0] ?? "?").toUpperCase()} size={22} bg={colorFor(s.user_id)} uri={s.avatar_url} />
                      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim }}>{s.username}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setActiveTable(t)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.sm, backgroundColor: theme.colors.bgElevH }}
                  >
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink }}>
                      {theme.decorate ? "[открыть]" : "Открыть"}
                    </Text>
                  </Pressable>
                  {!mySeat && t.status === "lobby" && t.seats.length < t.max_seats ? (
                    <Pressable
                      onPress={() => joinTable(t.id)}
                      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.sm, backgroundColor: theme.colors.accent }}
                    >
                      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: theme.colors.accentText }}>
                        {theme.decorate ? "[сесть]" : "Сесть"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
        {showCreate ? (
          <SettingsSheet
            theme={theme}
            busy={busy}
            title={theme.decorate ? "// НОВЫЙ СТОЛ" : "Новый стол"}
            initial={{ max_seats: 6, starting_stack: 30000, starting_small_blind: 100, blind_increase_minutes: 7, mode: "chips", entry_gas: 50, max_reentries: 2, reentry_until_level: 3 }}
            onSubmit={createTable}
            onCancel={() => setShowCreate(false)}
          />
        ) : null}
      </ScreenContainer>
    );
  }

  // ===== Single table =====
  const t = activeTable;
  const mySeat = t.seats.find((s) => s.user_id === user?.id);
  const live = gameState && gameState.table_id === t.id ? gameState : null;
  const myPlayer = live?.players.find((p) => p.user_id === user?.id);
  const myTurn = !!myPlayer?.is_my_turn;

  return (
    <ScreenContainer>
      <AppBar
        title={theme.decorate ? `// СТОЛ #${t.id}` : `Стол #${t.id}`}
        sub={live ? `блайнды ${live.small_blind}/${live.big_blind}${live.hand ? ` · раздача #${live.hand.hand_no}` : ""}` : undefined}
        left={
          <IconBtn onPress={() => setActiveTable(null)}>
            <ChevronLeftIcon color={theme.colors.ink} />
          </IconBtn>
        }
      />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 10 }}>
        {!mySeat && t.status === "lobby" && t.seats.length < t.max_seats ? (
          <TableBtn theme={theme} label={theme.decorate ? "[сесть]" : "Сесть"} primary onPress={() => joinTable(t.id)} disabled={busy} />
        ) : null}
        {t.status === "lobby" && t.created_by === user?.id ? (
          <TableBtn theme={theme} label={theme.decorate ? "[настройки]" : "⚙ Настройки"} onPress={() => setShowSettings(true)} disabled={busy} />
        ) : null}
        {live ? (
          <TableBtn theme={theme} label={theme.decorate ? `[история ${live.history_len}]` : `История (${live.history_len})`} onPress={() => setShowHistory(true)} />
        ) : null}
        {live && myPlayer?.can_reenter ? (
          <TableBtn
            theme={theme}
            primary
            label={`⛽ Докупиться за ${live.entry_gas} (${Math.max(0, live.max_reentries - myPlayer.reentries)}/${live.max_reentries})`}
            onPress={() => reentry(t.id)}
            disabled={busy}
          />
        ) : null}
        {(t.status === "finished" || live?.finished) && t.created_by === user?.id ? (
          <TableBtn theme={theme} primary label={theme.decorate ? "[сыграть ещё]" : "🔁 Сыграть ещё"} onPress={() => restartTable(t.id)} disabled={busy} />
        ) : null}
        {t.status === "lobby" && t.created_by === user?.id && t.seats.length >= 2 ? (
          <TableBtn theme={theme} label={theme.decorate ? "[начать]" : "▶ Начать"} primary onPress={() => startGame(t.id)} disabled={busy} />
        ) : null}
        {mySeat ? <TableBtn theme={theme} label={theme.decorate ? "[встать]" : "Встать"} danger onPress={() => leaveTable(t.id)} /> : null}
        {t.created_by === user?.id && t.status !== "finished" && !live?.finished ? (
          <TableBtn theme={theme} label={theme.decorate ? "[закрыть]" : "✕ Закрыть"} danger solid onPress={() => closeTable(t.id)} disabled={busy} />
        ) : null}
      </View>

      {error ? (
        <Text style={{ fontFamily: theme.fonts.mono, color: theme.colors.danger, fontSize: 12, paddingHorizontal: 12 }}>
          {theme.decorate ? `! ${error}` : error}
        </Text>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        <PokerTable theme={theme} table={t} game={live} currentUserId={user?.id ?? -1} />
        {live?.last_summary && live.hand?.street === "done" ? (
          <HandSummary theme={theme} summary={live.last_summary} players={live.players} />
        ) : null}
        {live && !live.finished && live.reentry_open_until ? (
          <View style={{ marginTop: 12, padding: 10, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.amber }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.amber, textAlign: "center" }}>
              ⏳ Фишки остались у одного — ждём докупку{graceLeft != null ? ` ещё ${graceLeft} с` : ""}.
              {myPlayer?.can_reenter ? " Кнопка «Докупиться» сверху." : " Никто не докупится — турнир окончен."}
            </Text>
          </View>
        ) : null}
        {live?.finished ? (
          <View style={{ marginTop: 16, alignItems: "center", gap: 4 }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 14, fontWeight: "700", color: theme.colors.accent, textAlign: "center" }}>
              🏆 Турнир окончен — победил {t.seats.find((s) => s.user_id === live.winner_user_id)?.username ?? "?"}
            </Text>
            {t.mode === "gas" && live.gas_pot > 0 ? (
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink, textAlign: "center" }}>
                забирает котёл {live.gas_pot} ⛽
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {showSettings ? (
        <SettingsSheet
          theme={theme}
          busy={busy}
          title={theme.decorate ? `// НАСТРОЙКИ #${t.id}` : `Настройки стола #${t.id}`}
          initial={{
            max_seats: t.max_seats, starting_stack: t.starting_stack, starting_small_blind: t.starting_small_blind,
            blind_increase_minutes: t.blind_increase_minutes, mode: t.mode, entry_gas: t.entry_gas || 50,
            max_reentries: t.max_reentries, reentry_until_level: t.reentry_until_level,
          }}
          lockMoney={t.seats.length > 0}
          onSubmit={(st) => saveSettings(t.id, st)}
          onCancel={() => setShowSettings(false)}
        />
      ) : null}
      {showHistory ? (
        <HistorySheet theme={theme} history={history} table={t} onClose={() => setShowHistory(false)} />
      ) : null}

      {live && myTurn && myPlayer && !myPlayer.has_folded && !myPlayer.is_all_in ? (
        <ActionBar theme={theme} game={live} me={myPlayer} onAction={sendAction} />
      ) : null}
    </ScreenContainer>
  );
}

// ---- Настройки стола (шторка) ---------------------------------------------

const PRESETS: Array<{ key: string; label: string; s: PokerTableSettings }> = [
  { key: "fast", label: "Быстрый", s: { starting_stack: 10000, starting_small_blind: 100, blind_increase_minutes: 4 } },
  { key: "normal", label: "Обычный", s: { starting_stack: 30000, starting_small_blind: 100, blind_increase_minutes: 7 } },
  { key: "marathon", label: "Марафон", s: { starting_stack: 50000, starting_small_blind: 50, blind_increase_minutes: 12 } },
];

function NumField({ theme, label, value, onChange, hint }: { theme: ThemeT; label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <View style={{ minWidth: 100, flexGrow: 1 }}>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted, marginBottom: 4 }}>{label}</Text>
      <TextInput
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={(txt) => onChange(Number(txt.replace(/[^0-9]/g, "")) || 0)}
        style={{ fontFamily: theme.fonts.mono, fontSize: 14, color: theme.colors.ink, backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 8 }}
      />
      {hint ? <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted, marginTop: 3 }}>{hint}</Text> : null}
    </View>
  );
}

function Chip({ theme, label, active, onPress, disabled }: { theme: ThemeT; label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: active ? theme.colors.accent : theme.colors.border, backgroundColor: active ? theme.colors.accent : "transparent", opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color: active ? theme.colors.accentText : theme.colors.ink }}>{label}</Text>
    </Pressable>
  );
}

function SettingsSheet({ theme, busy, title, initial, lockMoney, onSubmit, onCancel }: {
  theme: ThemeT;
  busy: boolean;
  title: string;
  initial: Required<PokerTableSettings>;
  lockMoney?: boolean;
  onSubmit: (s: PokerTableSettings) => void;
  onCancel: () => void;
}) {
  const [st, setSt] = useState<Required<PokerTableSettings>>(initial);
  const set = (patch: Partial<PokerTableSettings>) => setSt((cur) => ({ ...cur, ...patch }));
  const activePreset = PRESETS.find((p) => p.s.starting_stack === st.starting_stack && p.s.starting_small_blind === st.starting_small_blind && p.s.blind_increase_minutes === st.blind_increase_minutes)?.key;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: theme.colors.bgElev, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, borderColor: theme.colors.border, padding: 16, paddingBottom: 28, gap: 12 }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "800", color: theme.decorate ? theme.colors.accent : theme.colors.ink }}>{title}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {PRESETS.map((p) => <Chip key={p.key} theme={theme} label={p.label} active={activePreset === p.key} onPress={() => set(p.s)} />)}
          </View>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <NumField theme={theme} label="Стек" value={st.starting_stack} onChange={(v) => set({ starting_stack: v })} />
            <NumField theme={theme} label="Малый блайнд" value={st.starting_small_blind} onChange={(v) => set({ starting_small_blind: v })} hint={`большой = ${st.starting_small_blind * 2}`} />
            <NumField theme={theme} label="Рост блайндов, мин" value={st.blind_increase_minutes} onChange={(v) => set({ blind_increase_minutes: v })} hint="×1,5 каждый интервал" />
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>Мест</Text>
            {[2, 3, 4, 5, 6].map((n) => <Chip key={n} theme={theme} label={String(n)} active={st.max_seats === n} onPress={() => set({ max_seats: n })} />)}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10 }}>
            <Chip theme={theme} label="Обычный" active={st.mode === "chips"} disabled={!!lockMoney} onPress={() => set({ mode: "chips" })} />
            <Chip theme={theme} label="⛽ За газ" active={st.mode === "gas"} disabled={!!lockMoney} onPress={() => set({ mode: "gas" })} />
            {lockMoney ? <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.inkMuted }}>за столом уже сидят — режим и цена заморожены</Text> : null}
          </View>
          {st.mode === "gas" ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <NumField theme={theme} label="Энтри, ⛽" value={st.entry_gas} onChange={(v) => set({ entry_gas: v })} />
                <NumField theme={theme} label="Докупок на человека" value={st.max_reentries} onChange={(v) => set({ max_reentries: v })} />
                <NumField theme={theme} label="Докупка до повышения №" value={st.reentry_until_level} onChange={(v) => set({ reentry_until_level: v })} />
              </View>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>
                Все платят энтри при посадке, вылетевшие докупаются за ту же цену, победитель забирает весь котёл. Закрыл стол до финала — газ всем вернётся.
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <TableBtn theme={theme} label={theme.decorate ? "[отмена]" : "Отмена"} onPress={onCancel} />
            <TableBtn theme={theme} label={theme.decorate ? "[готово]" : "Готово"} primary onPress={() => onSubmit(st)} disabled={busy} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---- История раздач (шторка) ------------------------------------------------

const ACTION_RU: Record<string, string> = { fold: "фолд", check: "чек", call: "колл", raise: "рейз до" };
const STREET_RU: Record<string, string> = { preflop: "Префлоп", flop: "Флоп", turn: "Тёрн", river: "Ривер" };

function HistorySheet({ theme, history, table, onClose }: { theme: ThemeT; history: PokerHistory | null; table: PokerTableOut; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const name = (uid: number) => history?.names?.[String(uid)] ?? table.seats.find((s) => s.user_id === uid)?.username ?? `#${uid}`;
  const hands: PokerHistoryHand[] = history?.hands ?? [];
  const cards = (codes: string[]) => (
    <View style={{ flexDirection: "row", gap: 3 }}>
      {codes.map((c, i) => <CardView key={i} code={c} theme={theme} small />)}
    </View>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <AppBar
          title={theme.decorate ? "// ИСТОРИЯ РАЗДАЧ" : "История раздач"}
          sub={hands.length ? `${hands.length} шт., свежие сверху` : "пока пусто"}
          left={<IconBtn onPress={onClose}><ChevronLeftIcon color={theme.colors.ink} /></IconBtn>}
        />
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          {hands.map((h) => {
            const isOpen = open === h.hand_no;
            return (
              <Pressable key={h.hand_no} onPress={() => setOpen(isOpen ? null : h.hand_no)} style={{ backgroundColor: theme.colors.bgElev, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: 10, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted }}>#{h.hand_no} · {h.blinds[0]}/{h.blinds[1]}</Text>
                  {cards(h.community)}
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "800", color: theme.colors.accent }}>{h.pot.toLocaleString()}</Text>
                </View>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink }}>
                  🏆 {h.winners.map(name).join(", ")}{h.winning_hand ? ` · ${h.winning_hand}` : ""}{h.reason === "all_others_folded" ? " · все сложили" : ""}
                </Text>
                {isOpen ? (
                  <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 6 }}>
                    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: theme.colors.inkMuted }}>
                      Стеки: {h.players.map((p) => `${name(p.user_id)} ${p.stack.toLocaleString()}`).join(" · ")}
                    </Text>
                    {h.streets.map((st, i) => (
                      <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted, minWidth: 58 }}>{STREET_RU[st.street] ?? st.street}</Text>
                        {st.community.length ? cards(st.community) : null}
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim, flexShrink: 1 }}>
                          {st.actions.length === 0 ? "—" : st.actions.map((a) => `${name(a.user_id)}: ${ACTION_RU[a.action] ?? a.action}${a.action === "raise" || a.action === "call" ? ` ${a.to.toLocaleString()}` : ""}${a.all_in ? " (all-in)" : ""}`).join(" · ")}
                        </Text>
                      </View>
                    ))}
                    {h.showdown.map((sd) => (
                      <View key={sd.user_id} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.ink }}>{name(sd.user_id)}</Text>
                        {cards(sd.hole)}
                        {sd.hand ? <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkMuted }}>{sd.hand}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

function TableBtn({
  theme,
  label,
  onPress,
  primary,
  danger,
  solid,
  disabled,
}: {
  theme: ThemeT;
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  solid?: boolean;
  disabled?: boolean;
}) {
  const bg = solid && danger ? theme.colors.danger : primary ? theme.colors.accent : "transparent";
  const color = solid && danger ? "#fff" : primary ? theme.colors.accentText : danger ? theme.colors.danger : theme.colors.ink;
  const borderColor = danger ? theme.colors.danger : theme.colors.border;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: theme.radius.sm,
        backgroundColor: bg,
        borderWidth: bg === "transparent" ? 1 : 0,
        borderColor,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, fontWeight: "700", color }}>{label}</Text>
    </Pressable>
  );
}

function PokerTable({
  theme,
  table,
  game,
  currentUserId,
}: {
  theme: ThemeT;
  table: PokerTableOut;
  game: PokerGameView | null;
  currentUserId: number;
}) {
  const N = table.max_seats;
  const myPlayer = game?.players.find((p) => p.user_id === currentUserId);
  const mySeatIndex = myPlayer?.seat_index ?? table.seats.find((s) => s.user_id === currentUserId)?.seat_index ?? 0;
  const playersBySeat = new Map((game?.players ?? []).map((p) => [p.seat_index, p]));
  const seatsBySeat = new Map(table.seats.map((s) => [s.seat_index, s]));
  const community = game?.hand?.community ?? [];

  return (
    <View
      style={{
        width: "100%",
        aspectRatio: 0.72,
        maxWidth: 460,
        alignSelf: "center",
        backgroundColor: theme.id === "neo" ? "#0a1410" : "#13402a",
        borderRadius: theme.id === "neo" ? 0 : 200,
        borderWidth: 2,
        borderColor: theme.id === "neo" ? theme.colors.accent : "#5a3220",
        position: "relative",
        marginVertical: 8,
      }}
    >
      {/* Center: community + pot */}
      <View style={{ position: "absolute", left: 0, right: 0, top: "42%", alignItems: "center" }}>
        <View style={{ flexDirection: "row", gap: 4, justifyContent: "center", flexWrap: "wrap", paddingHorizontal: 8 }}>
          {community.map((c, i) => (
            <CardView key={i} code={c} theme={theme} />
          ))}
          {Array.from({ length: Math.max(0, 5 - community.length) }).map((_, i) => (
            <CardView key={`b${i}`} code={null} theme={theme} />
          ))}
        </View>
        <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: theme.colors.accent, marginTop: 10 }}>
          {theme.decorate ? "// БАНК · " : "Банк · "}
          {(game?.hand?.pot ?? 0).toLocaleString()}
        </Text>
      </View>

      {/* Seats */}
      {Array.from({ length: N }).map((_, idx) => {
        const angle = ((idx - mySeatIndex) / N) * Math.PI * 2 + Math.PI / 2;
        const x = 50 + 40 * Math.cos(angle);
        const y = 50 + 42 * Math.sin(angle);
        const player = playersBySeat.get(idx);
        const seat = seatsBySeat.get(idx);
        const isToAct = game?.hand?.to_act_seat === idx;
        const isButton = game?.hand?.button_seat === idx;
        return (
          <View
            key={idx}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              transform: [{ translateX: -40 }, { translateY: -34 }],
              width: 80,
              alignItems: "center",
            }}
          >
            {player || seat ? (
              <View
                style={{
                  alignItems: "center",
                  opacity: player?.has_folded ? 0.4 : 1,
                  borderWidth: 2,
                  borderColor: isToAct ? (theme.id === "neo" ? theme.colors.accent : "#ffd24a") : "transparent",
                  borderRadius: theme.radius.sm,
                  padding: 3,
                }}
              >
                {player ? (
                  <View style={{ flexDirection: "row", gap: 2, marginBottom: 2 }}>
                    {player.hole.map((c, i) => (
                      <CardView key={i} code={c === "?" ? null : c} theme={theme} small />
                    ))}
                  </View>
                ) : null}
                <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: "#fff", maxWidth: 76 }}>
                  {seat?.username ?? "?"}
                  {isButton ? " Ⓓ" : ""}
                </Text>
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "700", color: theme.id === "neo" ? theme.colors.accent : "#ffd24a" }}>
                  {(player?.stack ?? seat?.stack ?? 0).toLocaleString()}
                </Text>
                {player && player.bet > 0 ? (
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: "#fff" }}>ставка {player.bet.toLocaleString()}</Text>
                ) : null}
                {player?.is_all_in ? (
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 8, fontWeight: "700", color: "#fff", backgroundColor: theme.colors.danger, paddingHorizontal: 4, borderRadius: 4, overflow: "hidden", marginTop: 1 }}>
                    ALL-IN
                  </Text>
                ) : null}
              </View>
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.id === "neo" ? 0 : 22,
                  borderWidth: 2,
                  borderStyle: "dashed",
                  borderColor: theme.id === "neo" ? theme.colors.accent : "rgba(255,255,255,0.25)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: theme.id === "neo" ? theme.colors.accent : "rgba(255,255,255,0.4)", fontSize: 18 }}>+</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function CardView({ code, theme, small }: { code: string | null; theme: ThemeT; small?: boolean }) {
  // Подросли на ~15% по просьбе Гандолы («увеличить карты немного»)
  const w = small ? 30 : 40;
  const h = small ? 42 : 56;
  if (!code) {
    return (
      <View
        style={{
          width: w,
          height: h,
          borderRadius: theme.id === "neo" ? 0 : 4,
          backgroundColor: theme.id === "neo" ? "transparent" : "#3a45a5",
          borderWidth: 1,
          borderStyle: theme.id === "neo" ? "dashed" : "solid",
          borderColor: theme.id === "neo" ? theme.colors.accent : "rgba(255,255,255,0.3)",
          opacity: 0.5,
        }}
      />
    );
  }
  // Движок хранит десятку как "T" — людям привычнее «10»
  const rawRank = code.slice(0, code.length - 1);
  const rank = rawRank === "T" ? "10" : rawRank;
  const suit = code.slice(-1);
  const isRed = suit === "h" || suit === "d";
  const suitChar = ({ s: "♠", h: "♥", d: "♦", c: "♣" } as Record<string, string>)[suit] ?? "?";
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: theme.id === "neo" ? 0 : 4,
        backgroundColor: theme.id === "neo" ? "#0a0a0a" : "#fff",
        borderWidth: 1,
        borderColor: theme.id === "neo" ? theme.colors.accent : "#d6d6d6",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontWeight: "700",
          fontSize: small ? 12 : 16,
          color: theme.id === "neo" ? (isRed ? "#ff7777" : theme.colors.accent) : isRed ? "#d33" : "#222",
        }}
      >
        {rank}
      </Text>
      <Text
        style={{
          fontSize: small ? 11 : 14,
          color: theme.id === "neo" ? (isRed ? "#ff7777" : theme.colors.accent) : isRed ? "#d33" : "#222",
        }}
      >
        {suitChar}
      </Text>
    </View>
  );
}

function HandSummary({
  theme,
  summary,
  players,
}: {
  theme: ThemeT;
  summary: NonNullable<PokerGameView["last_summary"]>;
  players: PokerPlayerView[];
}) {
  const winnerNames = summary.winner_user_ids
    .map((uid) => {
      const p = players.find((x) => x.user_id === uid);
      return p ? `#${p.seat_index + 1}` : "#?";
    })
    .join(", ");
  return (
    <View
      style={{
        marginTop: 14,
        padding: 10,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.bgElev,
      }}
    >
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.ink, textAlign: "center" }}>
        🏆 Победитель: {winnerNames} · Банк {summary.pot.toLocaleString()}
        {summary.winning_hand ? ` · ${summary.winning_hand}` : ""}
        {summary.reason === "all_others_folded" ? " (все сложили)" : ""}
      </Text>
    </View>
  );
}

function ActionBar({
  theme,
  game,
  me,
  onAction,
}: {
  theme: ThemeT;
  game: PokerGameView;
  me: PokerPlayerView;
  onAction: (a: "fold" | "check" | "call" | "raise", amount?: number) => void;
}) {
  const hand = game.hand!;
  const toCall = Math.max(0, hand.current_bet - me.bet);
  const minRaise = hand.current_bet + hand.min_raise;
  const maxRaise = me.bet + me.stack;
  const [raise, setRaise] = useState(Math.min(maxRaise, Math.max(minRaise, hand.current_bet * 2 || game.big_blind * 2)));

  useEffect(() => {
    setRaise(Math.min(maxRaise, Math.max(minRaise, hand.current_bet * 2 || game.big_blind * 2)));
  }, [hand.current_bet, hand.min_raise, me.stack]);

  const clamp = (v: number) => Math.max(Math.min(minRaise, maxRaise), Math.min(maxRaise, v));
  const canRaise = maxRaise > toCall && maxRaise >= minRaise;

  const btn = {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
  } as const;

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bgElev, padding: 10, gap: 8 }}>
      {canRaise ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={() => setRaise((v) => clamp(v - game.big_blind))}
            style={{ width: 38, height: 38, borderRadius: theme.radius.sm, backgroundColor: theme.colors.bgElevH, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "700" }}>−</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 16, fontWeight: "700", color: theme.colors.ink }}>
              {raise.toLocaleString()}
            </Text>
          </View>
          <Pressable
            onPress={() => setRaise((v) => clamp(v + game.big_blind))}
            style={{ width: 38, height: 38, borderRadius: theme.radius.sm, backgroundColor: theme.colors.bgElevH, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "700" }}>+</Text>
          </Pressable>
          <Pressable
            onPress={() => setRaise(clamp(minRaise))}
            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim }}>мин</Text>
          </Pressable>
          <Pressable
            onPress={() => setRaise(clamp(hand.pot))}
            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.inkDim }}>банк</Text>
          </Pressable>
        </View>
      ) : null}
      {canRaise ? (
        // Доля банка: рейз ДО current_bet + pct × (банк после колла), шаг 10 фишек
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[10, 15, 25, 50, 75].map((pct) => {
            const potAfterCall = hand.pot + toCall;
            const amt = clamp(hand.current_bet + Math.round((pct / 100) * potAfterCall / 10) * 10);
            const active = raise === amt;
            return (
              <Pressable
                key={pct}
                onPress={() => setRaise(amt)}
                style={{ flex: 1, paddingVertical: 6, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: active ? theme.colors.accent : theme.colors.border, backgroundColor: active ? theme.colors.accent : "transparent", alignItems: "center" }}
              >
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, fontWeight: "700", color: active ? theme.colors.accentText : theme.colors.inkDim }}>{pct}%</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => onAction("fold")} style={{ ...btn, flex: 1, backgroundColor: theme.colors.danger }}>
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: "#fff", textAlign: "center" }}>
            {theme.decorate ? "FOLD" : "Сброс"}
          </Text>
        </Pressable>
        {toCall === 0 ? (
          <Pressable onPress={() => onAction("check")} style={{ ...btn, flex: 1, backgroundColor: theme.colors.bgElevH }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: theme.colors.ink, textAlign: "center" }}>
              {theme.decorate ? "CHECK" : "Чек"}
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => onAction("call")} style={{ ...btn, flex: 1, backgroundColor: theme.colors.bgElevH }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: theme.colors.ink, textAlign: "center" }}>
              {theme.decorate ? `CALL ${toCall}` : `Колл ${toCall.toLocaleString()}`}
            </Text>
          </Pressable>
        )}
        {canRaise ? (
          <Pressable onPress={() => onAction("raise", raise)} style={{ ...btn, flex: 1, backgroundColor: theme.colors.accent }}>
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: theme.colors.accentText, textAlign: "center" }}>
              {theme.decorate ? "RAISE" : "Рейз"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onAction("raise", maxRaise)}
          disabled={maxRaise <= toCall}
          style={{ ...btn, flex: 1, borderWidth: 1, borderColor: theme.colors.accent, opacity: maxRaise <= toCall ? 0.4 : 1 }}
        >
          <Text style={{ fontFamily: theme.fonts.mono, fontSize: 13, fontWeight: "700", color: theme.colors.accent, textAlign: "center" }}>
            ALL-IN
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
