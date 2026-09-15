import React, { useEffect, useRef, useState } from "react";
import { ChatOut, UserOut, PokerTableOut, PokerSeatOut, PokerGameView, PokerTableSettings, PokerHistory, PokerHistoryHand, pokerApi } from "../services/api";
import { wsService } from "../services/ws";
import { useTheme } from "../services/theme";
import { playCardSound, playChipSound, playTurnSound } from "../services/sounds";
import PokerAssistPanel from "./PokerAssistPanel";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
}

export default function Poker({ chat, currentUser }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [tables, setTables] = useState<PokerTableOut[]>([]);
  const [activeTable, setActiveTable] = useState<PokerTableOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<PokerGameView | null>(null);
  // Настройки стола (создание / правка в лобби), история раздач, пауза докупки
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PokerHistory | null>(null);
  const [graceLeft, setGraceLeft] = useState<number | null>(null);
  // Track previous game state to detect transitions worth a sound
  const prevHandNoRef = useRef<number | null>(null);
  const prevCommunityCountRef = useRef<number>(0);
  const prevLastActionRef = useRef<string | null>(null);
  const prevMyTurnRef = useRef<boolean>(false);

  // Load tables for this chat
  useEffect(() => {
    setActiveTable(null);
    setTables([]);
    setError(null);
    pokerApi.list(chat.id).then((res) => setTables(res.data)).catch((e) => {
      setError(e.response?.data?.detail || "Не удалось загрузить столы");
    });
  }, [chat.id]);

  // Play sound effects on meaningful game-state transitions.
  useEffect(() => {
    if (!gameState || !gameState.hand) {
      prevHandNoRef.current = null;
      prevCommunityCountRef.current = 0;
      prevLastActionRef.current = null;
      prevMyTurnRef.current = false;
      return;
    }
    const handNo = gameState.hand.hand_no;
    const communityCount = gameState.hand.community.length;
    const lastActionKey = gameState.hand.last_action
      ? `${gameState.hand.last_action.user_id}:${gameState.hand.last_action.action}:${gameState.hand.last_action.amount}`
      : null;
    const me = gameState.players.find((p) => p.user_id === currentUser.id);
    const myTurnNow = !!me?.is_my_turn;

    // New hand started — deal sound (hole cards)
    if (prevHandNoRef.current != null && handNo !== prevHandNoRef.current) {
      playCardSound();
    }
    // More community cards on the felt — flop/turn/river reveal
    if (communityCount > prevCommunityCountRef.current) {
      playCardSound();
    }
    // Someone made a bet-class action
    if (lastActionKey && lastActionKey !== prevLastActionRef.current) {
      const action = gameState.hand.last_action!.action;
      if (action === "call" || action === "raise") {
        playChipSound();
      }
    }
    // It just became my turn
    if (myTurnNow && !prevMyTurnRef.current) {
      playTurnSound();
    }

    prevHandNoRef.current = handNo;
    prevCommunityCountRef.current = communityCount;
    prevLastActionRef.current = lastActionKey;
    prevMyTurnRef.current = myTurnNow;
  }, [gameState, currentUser.id]);

  // When we open a table that's already playing, ask the server to push us the
  // current game state (we may have lost it when remounting after a mode switch).
  useEffect(() => {
    if (activeTable && activeTable.status === "playing") {
      wsService.send({ type: "poker_request_state", table_id: activeTable.id });
    }
  }, [activeTable?.id, activeTable?.status]);

  // Auto-open + auto-sit when an invite card requests a specific table for this chat
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ chatId: number; tableId: number }>).detail;
      if (!detail || detail.chatId !== chat.id) return;
      // Need to wait one tick for the table list to load if it hasn't yet
      const tryOpen = (attempt = 0) => {
        const t = tables.find((x) => x.id === detail.tableId);
        if (t) {
          setActiveTable(t);
          if (!t.seats.find((s) => s.user_id === currentUser.id) && t.status === "lobby" && t.seats.length < t.max_seats) {
            joinTable(detail.tableId, true);
          }
        } else if (attempt < 8) {
          setTimeout(() => tryOpen(attempt + 1), 250);
        }
      };
      tryOpen();
    };
    window.addEventListener("open-poker-table", handler as EventListener);
    return () => window.removeEventListener("open-poker-table", handler as EventListener);
  }, [chat.id, tables, currentUser.id]);

  // WS subscriptions
  useEffect(() => {
    const onCreated = (data: any) => {
      if (data.table?.chat_id !== chat.id) return;
      setTables((prev) => {
        if (prev.find((t) => t.id === data.table.id)) return prev;
        return [data.table, ...prev];
      });
    };
    const onUpdated = (data: any) => {
      if (data.table?.chat_id !== chat.id) return;
      // Preserve any optimistic ghost seats (id < 0) that the server hasn't
      // confirmed yet — otherwise unrelated WS broadcasts wipe our local sit
      // before the HTTP join roundtrip completes.
      const mergeGhosts = (incoming: PokerTableOut, existing: PokerTableOut): PokerTableOut => {
        const ghosts = existing.seats.filter((s) => s.id < 0 && !incoming.seats.find((x) => x.user_id === s.user_id));
        if (!ghosts.length) return incoming;
        return { ...incoming, seats: [...incoming.seats, ...ghosts] };
      };
      setTables((prev) => prev.map((t) => {
        if (t.id !== data.table.id) return t;
        return mergeGhosts(data.table, t);
      }));
      setActiveTable((cur) => {
        if (!cur || cur.id !== data.table.id) return cur;
        return mergeGhosts(data.table, cur);
      });
    };
    const onRemoved = (data: any) => {
      setTables((prev) => prev.filter((t) => t.id !== data.table_id));
      setActiveTable((cur) => (cur && cur.id === data.table_id ? null : cur));
    };
    const onGameState = (data: any) => {
      // Only accept state for the table we're actually viewing — never let an
      // unrelated table's snapshot overwrite the active one.
      if (activeTable && data.table_id === activeTable.id) {
        setGameState(data.state);
      }
    };
    const onPokerError = (data: any) => {
      setError(data.message || "Ошибка");
      setTimeout(() => setError(null), 3000);
    };
    wsService.on("poker_table_created", onCreated);
    wsService.on("poker_table_updated", onUpdated);
    wsService.on("poker_table_removed", onRemoved);
    wsService.on("poker_game_state", onGameState);
    wsService.on("poker_error", onPokerError);
    return () => {
      wsService.off("poker_table_created", onCreated);
      wsService.off("poker_table_updated", onUpdated);
      wsService.off("poker_table_removed", onRemoved);
      wsService.off("poker_game_state", onGameState);
      wsService.off("poker_error", onPokerError);
    };
  }, [chat.id, activeTable?.id]);

  async function createTable(settings: PokerTableSettings) {
    setBusy(true); setError(null);
    try {
      const res = await pokerApi.create(chat.id, settings);
      setShowCreate(false);
      setActiveTable(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка создания стола");
    } finally { setBusy(false); }
  }

  async function saveSettings(tableId: number, settings: PokerTableSettings) {
    setBusy(true); setError(null);
    try {
      const res = await pokerApi.settings(tableId, settings);
      setShowSettings(false);
      setActiveTable(res.data);
      setTables((prev) => prev.map((t) => (t.id === tableId ? res.data : t)));
    } catch (e: any) {
      setError(e.response?.data?.detail || "Не удалось сохранить настройки");
    } finally { setBusy(false); }
  }

  // Докупка в режиме «за газ»: вылетел → энтри ещё раз → стартовый стек.
  async function reentry(tableId: number) {
    setBusy(true); setError(null);
    try {
      const res = await pokerApi.reentry(tableId);
      setActiveTable(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Не удалось докупиться");
      setTimeout(() => setError(null), 5000);
    } finally { setBusy(false); }
  }

  // «Сыграть ещё»: сервер создаёт новый стол с теми же настройками и людьми
  // и удаляет старый. poker_table_removed по старому прилетит раньше ответа
  // и обнулит activeTable — поэтому ответ ставим поверх, а не мержим.
  async function restartTable(tableId: number) {
    setBusy(true); setError(null);
    try {
      const res = await pokerApi.restart(tableId);
      setGameState(null);
      setHistory(null);
      setShowHistory(false);
      setActiveTable(res.data);
      setTables((prev) => [res.data, ...prev.filter((t) => t.id !== tableId && t.id !== res.data.id)]);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Не удалось открыть новую партию");
    } finally { setBusy(false); }
  }

  async function loadHistory(tableId: number) {
    try {
      const res = await pokerApi.history(tableId);
      setHistory(res.data);
    } catch {
      // история в памяти сервера — после рестарта её просто нет
      setHistory({ table_id: tableId, names: {}, hands: [] });
    }
  }

  // Открытая панель истории подтягивает свежие раздачи по мере игры.
  useEffect(() => {
    if (!showHistory || !activeTable) return;
    loadHistory(activeTable.id);
  }, [showHistory, activeTable?.id, gameState?.history_len]);

  // Секунды до конца паузы «докупись или всё» (режим за газ).
  useEffect(() => {
    const until = gameState?.reentry_open_until;
    if (!until) { setGraceLeft(null); return; }
    const tick = () => setGraceLeft(Math.max(0, Math.round(until - Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameState?.reentry_open_until]);

  async function joinTable(tableId: number, openAfter = false) {
    setError(null);
    const ghostId = -Date.now();
    function buildGhost(forTable: PokerTableOut): PokerSeatOut {
      const taken = new Set(forTable.seats.map((s) => s.seat_index));
      let freeIdx = 0;
      while (taken.has(freeIdx)) freeIdx++;
      return {
        id: ghostId,
        user_id: currentUser.id,
        username: currentUser.username,
        avatar_url: currentUser.avatar_url,
        seat_index: freeIdx,
        stack: forTable.starting_stack,
        is_active: true,
      };
    }
    // Update list optimistically
    setTables((prev) => prev.map((t) => {
      if (t.id !== tableId || t.seats.find((s) => s.user_id === currentUser.id)) return t;
      return { ...t, seats: [...t.seats, buildGhost(t)] };
    }));
    // Update single-view optimistically only if we're already viewing it
    // (or caller explicitly asked to open after seating)
    setActiveTable((cur) => {
      if (cur && cur.id === tableId) {
        if (cur.seats.find((s) => s.user_id === currentUser.id)) return cur;
        return { ...cur, seats: [...cur.seats, buildGhost(cur)] };
      }
      if (openAfter) {
        const t = tables.find((x) => x.id === tableId);
        if (!t) return cur;
        if (t.seats.find((s) => s.user_id === currentUser.id)) return t;
        return { ...t, seats: [...t.seats, buildGhost(t)] };
      }
      return cur;
    });
    try {
      const res = await pokerApi.join(tableId);
      // Always sync the row in the list — even if the user didn't open the table,
      // we want the count/avatars to match server truth.
      setTables((prev) => prev.map((t) => t.id === tableId ? res.data : t));
      setActiveTable((cur) => (cur && cur.id === tableId) || openAfter ? res.data : cur);
    } catch (e: any) {
      setTables((prev) => prev.map((t) => t.id !== tableId
        ? t
        : { ...t, seats: t.seats.filter((s) => s.id !== ghostId) }));
      setActiveTable((cur) => cur && cur.id === tableId
        ? { ...cur, seats: cur.seats.filter((s) => s.id !== ghostId) }
        : cur);
      setError(e.response?.data?.detail || "Не удалось сесть");
    }
  }

  async function startGame(tableId: number) {
    setBusy(true); setError(null);
    try {
      const res = await pokerApi.start(tableId);
      setActiveTable(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Не удалось начать игру");
    } finally { setBusy(false); }
  }

  function sendAction(action: "fold" | "check" | "call" | "raise", amount = 0) {
    if (!activeTable) return;
    const ok = wsService.send({ type: "poker_action", table_id: activeTable.id, action, amount });
    if (!ok) {
      setError("Соединение прервано — попробуй ещё раз");
      setTimeout(() => setError(null), 4000);
    }
  }

  async function closeTable(tableId: number) {
    if (!confirm("Закрыть стол досрочно? Игра будет завершена для всех.")) return;
    setBusy(true); setError(null);
    try {
      await pokerApi.close(tableId);
      setActiveTable(null);
      setGameState(null);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Не удалось закрыть стол");
    } finally { setBusy(false); }
  }

  async function leaveTable(tableId: number) {
    setError(null);
    // Optimistic: remove our seat immediately
    const myUid = currentUser.id;
    setTables((prev) => prev.map((t) => t.id !== tableId
      ? t
      : { ...t, seats: t.seats.filter((s) => s.user_id !== myUid) }));
    setActiveTable((cur) => cur && cur.id === tableId
      ? { ...cur, seats: cur.seats.filter((s) => s.user_id !== myUid) }
      : cur);
    try {
      const res = await pokerApi.leave(tableId);
      setActiveTable(res.data);
      if (res.data) {
        setTables((prev) => prev.map((t) => t.id === tableId ? res.data! : t));
      } else {
        // Table was emptied and deleted on the server
        setTables((prev) => prev.filter((t) => t.id !== tableId));
      }
    } catch (e: any) {
      // Reload from server to get authoritative state
      pokerApi.list(chat.id).then((r) => {
        setTables(r.data);
        setActiveTable((cur) => cur ? r.data.find((t) => t.id === cur.id) || null : cur);
      }).catch(() => {});
      setError(e.response?.data?.detail || "Не удалось встать");
    }
  }

  // === Table list view (no active table selected) ===
  if (!activeTable) {
    return (
      <div style={s.root}>
        <div style={{ ...s.header, ...mono }}>
          <span style={{ ...s.title, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.1em" } : {}) }}>
            {isNeo ? `// ПОКЕР · ${chat.is_group ? chat.name : "DM"}` : `Покер · ${chat.is_group ? chat.name : "DM"}`}
          </span>
          <button
            onClick={() => setShowCreate(true)}
            disabled={busy}
            style={{
              ...s.primaryBtn,
              ...mono,
              ...(isNeo ? { borderRadius: 0, letterSpacing: "0.05em" } : {}),
            }}
          >
            {isNeo ? "[+ НОВЫЙ СТОЛ]" : "+ Новый стол"}
          </button>
        </div>
        {error && <div style={{ ...s.error, ...mono }}>{error}</div>}
        {showCreate && (
          <TableSettingsForm
            isNeo={isNeo}
            busy={busy}
            title={isNeo ? "// НОВЫЙ СТОЛ" : "Новый стол"}
            initial={{ max_seats: 6, starting_stack: 30000, starting_small_blind: 100, blind_increase_minutes: 7, mode: "chips", entry_gas: 50, max_reentries: 2, reentry_until_level: 3 }}
            onSubmit={createTable}
            onCancel={() => setShowCreate(false)}
          />
        )}
        <div style={s.body}>
          {tables.length === 0 ? (
            <div style={{ ...s.empty, ...mono }}>
              {isNeo ? "// нет_активных_столов. создай_первый" : "Нет активных столов. Создай первый!"}
            </div>
          ) : (
            <div style={s.list}>
              {tables.map((t) => {
                const mySeat = t.seats.find((s) => s.user_id === currentUser.id);
                return (
                  <div key={t.id} style={{ ...s.tableCard, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--border)" } : {}) }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div>
                        <div style={{ ...s.tableTitle, ...mono }}>
                          {isNeo ? `// СТОЛ #${t.id}` : `Стол #${t.id}`}
                        </div>
                        <div style={{ ...s.tableMeta, ...mono }}>
                          {t.seats.length}/{t.max_seats} игроков · стек {t.starting_stack.toLocaleString()} · блайнды {t.starting_small_blind}/{t.starting_big_blind} · +1.5× каждые {t.blind_increase_minutes} мин
                        </div>
                        {t.mode === "gas" && (
                          <div style={{ ...s.tableMeta, ...mono, color: "var(--accent)", fontWeight: 700 }}>
                            ⛽ За газ · энтри {t.entry_gas} · котёл {t.gas_pot} · докупок {t.max_reentries} до {t.reentry_until_level}-го повышения блайндов
                          </div>
                        )}
                      </div>
                      <div style={{
                        padding: "4px 10px",
                        borderRadius: isNeo ? 0 : 12,
                        background: t.status === "lobby" ? "#3ba55d" : "#faa61a",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        ...mono,
                      }}>
                        {t.status === "lobby" ? (isNeo ? "ЛОББИ" : "Лобби") : t.status === "playing" ? (isNeo ? "ИДЁТ" : "Идёт") : (isNeo ? "ФИНИШ" : "Финиш")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                      {t.seats.map((s) => (
                        <span key={s.id} style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-tertiary)", padding: "4px 8px", borderRadius: isNeo ? 0 : 4, fontSize: 12 }}>
                          <SeatAvatar seat={s} small />
                          {s.username}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          setActiveTable(t);
                          // Belt-and-suspenders: pull fresh server truth in case
                          // local cache is stale (missed broadcast, etc.)
                          pokerApi.list(chat.id).then((r) => {
                            const fresh = r.data.find((x) => x.id === t.id);
                            if (fresh) {
                              setActiveTable((cur) => cur && cur.id === t.id ? fresh : cur);
                              setTables(r.data);
                            }
                          }).catch(() => {});
                        }}
                        style={{ ...s.secondaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
                      >
                        {isNeo ? "[ОТКРЫТЬ]" : "Открыть"}
                      </button>
                      {!mySeat && t.status === "lobby" && t.seats.length < t.max_seats && (
                        <button
                          onClick={() => joinTable(t.id)}
                          style={{ ...s.primaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
                        >
                          {isNeo ? "[СЕСТЬ]" : "Сесть за стол"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // === Single table view ===
  const t = activeTable;
  const mySeat = t.seats.find((sx) => sx.user_id === currentUser.id);
  const liveGame = gameState && gameState.table_id === t.id ? gameState : null;
  const myPlayer = liveGame?.players.find((p) => p.user_id === currentUser.id);
  const myTurn = !!myPlayer?.is_my_turn;

  return (
    <div style={s.root}>
      <div style={{ ...s.header, ...mono }}>
        <button
          onClick={() => setActiveTable(null)}
          style={{ ...s.secondaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
        >
          {isNeo ? "[← К СПИСКУ]" : "← К списку"}
        </button>
        <span style={{ ...s.title, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.1em" } : {}) }}>
          {isNeo ? `// СТОЛ #${t.id}` : `Стол #${t.id}`}
          {liveGame && (
            <span style={{ ...mono, marginLeft: 12, fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>
              · блайнды {liveGame.small_blind}/{liveGame.big_blind}
              {liveGame.hand && ` · раздача #${liveGame.hand.hand_no}`}
            </span>
          )}
          {t.mode === "gas" && (
            <span style={{ ...mono, marginLeft: 12, fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>
              ⛽ котёл {(liveGame?.gas_pot ?? t.gas_pot).toLocaleString()}
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {t.status === "lobby" && t.created_by === currentUser.id && (
            <button
              onClick={() => setShowSettings(true)}
              disabled={busy}
              title="Стек, блайнды, интервал, режим — пока игра не началась"
              style={{ ...s.secondaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
            >
              {isNeo ? "[НАСТРОЙКИ]" : "⚙ Настройки"}
            </button>
          )}
          {liveGame && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              title="История раздач этого стола"
              style={{ ...s.secondaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}), ...(showHistory ? { outline: "1px solid var(--accent)" } : {}) }}
            >
              {isNeo ? `[ИСТОРИЯ ${liveGame.history_len}]` : `История (${liveGame.history_len})`}
            </button>
          )}
          {liveGame && myPlayer?.can_reenter && (
            <button
              onClick={() => reentry(t.id)}
              disabled={busy}
              title={`Ещё ${Math.max(0, liveGame.max_reentries - myPlayer.reentries)} из ${liveGame.max_reentries} докупок`}
              style={{ ...s.primaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
            >
              {isNeo ? `[ДОКУПИТЬСЯ ${liveGame.entry_gas}⛽]` : `⛽ Докупиться за ${liveGame.entry_gas}`}
              {` (${Math.max(0, liveGame.max_reentries - myPlayer.reentries)}/${liveGame.max_reentries})`}
            </button>
          )}
          {t.status === "finished" && t.created_by === currentUser.id && (
            <button
              onClick={() => restartTable(t.id)}
              disabled={busy}
              title="Новый стол с теми же настройками и людьми"
              style={{ ...s.primaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}), background: "#3ba55d" }}
            >
              {isNeo ? "[СЫГРАТЬ ЕЩЁ]" : "🔁 Сыграть ещё"}
            </button>
          )}
          {!mySeat && t.status === "lobby" && t.seats.length < t.max_seats && (
            <button
              onClick={() => joinTable(t.id)}
              style={{ ...s.primaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
            >
              {isNeo ? "[СЕСТЬ]" : "Сесть"}
            </button>
          )}
          {t.status === "lobby" && t.created_by === currentUser.id && t.seats.length >= 2 && (
            <button
              onClick={() => startGame(t.id)}
              disabled={busy}
              style={{ ...s.primaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}), background: "#3ba55d" }}
            >
              {isNeo ? "[НАЧАТЬ ИГРУ]" : "▶ Начать игру"}
            </button>
          )}
          {mySeat && (
            <button
              onClick={() => leaveTable(t.id)}
              style={{
                background: "transparent", color: "#ed4245",
                border: "1px solid #ed4245", padding: "6px 12px",
                borderRadius: isNeo ? 0 : 4, cursor: "pointer", fontSize: 13,
                ...mono,
              }}
            >
              {isNeo ? "[ВСТАТЬ]" : "Встать"}
            </button>
          )}
          {t.created_by === currentUser.id && t.status !== "finished" && (
            <button
              onClick={() => closeTable(t.id)}
              disabled={busy}
              style={{
                background: "#ed4245", color: "#fff",
                border: "none", padding: "6px 12px",
                borderRadius: isNeo ? 0 : 4, cursor: "pointer", fontSize: 13, fontWeight: 700,
                ...mono,
                letterSpacing: isNeo ? "0.05em" : undefined,
              }}
              title="Только создатель может закрыть стол"
            >
              {isNeo ? "[ЗАКРЫТЬ СТОЛ]" : "✕ Закрыть стол"}
            </button>
          )}
        </div>
      </div>
      {error && <div style={{ ...s.error, ...mono }}>{error}</div>}
      {showSettings && (
        <TableSettingsForm
          isNeo={isNeo}
          busy={busy}
          title={isNeo ? `// НАСТРОЙКИ СТОЛА #${t.id}` : `Настройки стола #${t.id}`}
          initial={{
            max_seats: t.max_seats, starting_stack: t.starting_stack, starting_small_blind: t.starting_small_blind,
            blind_increase_minutes: t.blind_increase_minutes, mode: t.mode, entry_gas: t.entry_gas || 50,
            max_reentries: t.max_reentries, reentry_until_level: t.reentry_until_level,
          }}
          lockMoney={t.seats.some((sx) => sx.gas_paid > 0)}
          onSubmit={(st) => saveSettings(t.id, st)}
          onCancel={() => setShowSettings(false)}
        />
      )}
      {liveGame && liveGame.finished && (
        <div style={{ ...mono, padding: "10px 16px", background: isNeo ? "rgba(198,255,61,0.06)" : "var(--bg-secondary)", borderBottom: "1px solid var(--border)", fontSize: 13, textAlign: "center", color: "var(--text-primary)" }}>
          🏆 Турнир окончен — победил{" "}
          <b>{t.seats.find((sx) => sx.user_id === liveGame.winner_user_id)?.username ?? "?"}</b>
          {t.mode === "gas" && liveGame.gas_pot > 0 && <span style={{ color: "var(--accent)", fontWeight: 700 }}> · забирает котёл {liveGame.gas_pot} ⛽</span>}
          {t.created_by === currentUser.id && <span style={{ color: "var(--text-muted)" }}> · «Сыграть ещё» — новая партия с теми же людьми</span>}
        </div>
      )}
      {liveGame && !liveGame.finished && liveGame.reentry_open_until && (
        <div style={{ ...mono, padding: "10px 16px", background: isNeo ? "rgba(255,184,77,0.08)" : "rgba(250,166,26,0.12)", borderBottom: "1px solid var(--border)", fontSize: 13, textAlign: "center", color: "var(--warning)" }}>
          ⏳ Фишки остались у одного — ждём докупку{graceLeft != null ? ` ещё ${graceLeft} с` : ""}.
          {myPlayer?.can_reenter ? " Твой ход: кнопка «Докупиться» сверху." : " Если никто не докупится — турнир окончен."}
        </div>
      )}
      {showHistory && liveGame && (
        <HistoryPanel history={history} table={t} isNeo={isNeo} onClose={() => setShowHistory(false)} />
      )}
      {liveGame && liveGame.hand && liveGame.hand.street !== "done" && (() => {
        // Banner above the felt — who is currently to act.
        const actingSeat = liveGame.hand.to_act_seat;
        if (actingSeat == null) return null;
        const actingPlayer = liveGame.players.find((p) => p.seat_index === actingSeat);
        if (!actingPlayer) return null;
        const seatRow = t.seats.find((sx) => sx.seat_index === actingSeat);
        const name = actingPlayer.user_id === currentUser.id
          ? (isNeo ? "ВЫ" : "Вы")
          : (seatRow?.username || `Игрок #${actingSeat + 1}`);
        const isYou = actingPlayer.user_id === currentUser.id;
        return (
          <div style={{
            padding: "6px 14px",
            margin: "0 16px",
            background: isYou
              ? (isNeo ? "rgba(198,255,61,0.18)" : "rgba(88,101,242,0.18)")
              : (isNeo ? "transparent" : "var(--bg-secondary)"),
            border: `1px solid ${isYou ? "var(--accent)" : (isNeo ? "var(--border-strong)" : "var(--border)")}`,
            borderRadius: isNeo ? 0 : 6,
            color: isYou ? "var(--accent)" : "var(--text-primary)",
            fontFamily: isNeo ? "var(--font-mono)" : undefined,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: isNeo ? "0.05em" : undefined,
            textAlign: "center" as const,
            ...(isYou ? { animation: "neo-blink 1.2s infinite" } : {}),
          }}>
            {isNeo ? (isYou ? "> ТВОЙ_ХОД" : `> ходит ${name.toLowerCase()}`) : (isYou ? "🎯 Твой ход" : `Ходит ${name}`)}
          </div>
        );
      })()}
      <div style={{ ...s.tableArea, position: "relative", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {liveGame ? (
            <LiveTableLayout
              table={t}
              game={liveGame}
              currentUserId={currentUser.id}
              isNeo={isNeo}
            />
          ) : (
            <PokerTableLayout table={t} currentUserId={currentUser.id} isNeo={isNeo} />
          )}
        </div>
        <PokerAssistPanel
          myHole={myPlayer?.hole ?? null}
          community={liveGame?.hand?.community ?? []}
          pot={liveGame?.hand?.pot ?? 0}
          toCall={liveGame?.hand && myPlayer ? Math.max(0, liveGame.hand.current_bet - myPlayer.bet) : 0}
          street={liveGame?.hand?.street ?? null}
          isNeo={isNeo}
        />
      </div>
      {liveGame && liveGame.last_summary && liveGame.hand?.street === "done" && (
        <HandSummaryBar summary={liveGame.last_summary} players={liveGame.players} isNeo={isNeo} />
      )}
      {liveGame && myTurn && myPlayer && !myPlayer.has_folded && !myPlayer.is_all_in && (
        <ActionBar
          game={liveGame}
          me={myPlayer}
          isNeo={isNeo}
          onAction={sendAction}
        />
      )}
    </div>
  );
}

function HandSummaryBar({ summary, players, isNeo }: { summary: any; players: any[]; isNeo: boolean }) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const winnerNames = summary.winner_user_ids.map((uid: number) => {
    const p = players.find((x) => x.user_id === uid);
    return p ? `#${p.seat_index + 1}` : `#?`;
  }).join(", ");
  return (
    <div style={{
      padding: "10px 16px",
      borderTop: `1px solid ${isNeo ? "var(--accent)" : "var(--border)"}`,
      background: isNeo ? "transparent" : "var(--bg-secondary)",
      color: isNeo ? "var(--accent)" : "var(--text-primary)",
      ...mono,
      fontSize: 13,
      letterSpacing: isNeo ? "0.04em" : undefined,
      textAlign: "center",
    }}>
      🏆 Победитель: {winnerNames} · Банк {summary.pot.toLocaleString()}
      {summary.winning_hand ? ` · ${summary.winning_hand}` : ""}
      {summary.reason === "all_others_folded" && " (все сложили)"}
      {" · следующая раздача через 5 сек"}
    </div>
  );
}

function ActionBar({ game, me, isNeo, onAction }: {
  game: PokerGameView;
  me: any;
  isNeo: boolean;
  onAction: (a: "fold" | "check" | "call" | "raise", amount?: number) => void;
}) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const hand = game.hand!;
  const toCall = Math.max(0, hand.current_bet - me.bet);
  const minRaise = hand.current_bet + hand.min_raise;
  const maxRaise = me.bet + me.stack;
  const [raiseAmount, setRaiseAmount] = useState(Math.min(maxRaise, Math.max(minRaise, hand.current_bet * 2 || game.big_blind * 2)));
  useEffect(() => {
    setRaiseAmount(Math.min(maxRaise, Math.max(minRaise, hand.current_bet * 2 || game.big_blind * 2)));
  }, [hand.current_bet, hand.min_raise, me.stack]);

  const btnBase: React.CSSProperties = {
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 700,
    border: "none",
    cursor: "pointer",
    borderRadius: isNeo ? 0 : 6,
    letterSpacing: isNeo ? "0.05em" : undefined,
    ...mono,
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "12px 16px",
      borderTop: `1px solid ${isNeo ? "var(--accent)" : "var(--border)"}`,
      background: isNeo ? "rgba(198,255,61,0.04)" : "var(--bg-secondary)",
      flexWrap: "wrap",
    }}>
      <button onClick={() => onAction("fold")} style={{ ...btnBase, background: "#ed4245", color: "#fff" }}>
        {isNeo ? "[FOLD]" : "Сбросить"}
      </button>
      {toCall === 0 ? (
        <button onClick={() => onAction("check")} style={{ ...btnBase, background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
          {isNeo ? "[CHECK]" : "Чек"}
        </button>
      ) : (
        <button onClick={() => onAction("call")} style={{ ...btnBase, background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
          {isNeo ? `[CALL ${toCall}]` : `Колл ${toCall.toLocaleString()}`}
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220 }}>
        {/* Размер ставки долей банка: рейз ДО current_bet + pct × (банк после колла),
            округлённый до 10 фишек и зажатый в [мин. рейз, all-in]. */}
        <div style={{ display: "flex", gap: 4 }}>
          {[10, 15, 25, 50, 75].map((pct) => {
            const potAfterCall = hand.pot + toCall;
            const raw = hand.current_bet + Math.round((pct / 100) * potAfterCall / 10) * 10;
            const amt = Math.min(maxRaise, Math.max(minRaise, raw));
            const disabled = maxRaise <= toCall || maxRaise < minRaise;
            return (
              <button
                key={pct}
                onClick={() => setRaiseAmount(amt)}
                disabled={disabled}
                title={`Рейз до ${amt.toLocaleString()}`}
                style={{
                  ...btnBase, padding: "6px 8px", fontSize: 11.5,
                  background: raiseAmount === amt ? "var(--accent)" : "transparent",
                  color: raiseAmount === amt ? "var(--accent-text)" : "var(--text-muted)",
                  border: `1px solid ${raiseAmount === amt ? "var(--accent)" : "var(--border)"}`,
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                {pct}%
              </button>
            );
          })}
        </div>
        <input
          type="range"
          min={Math.min(minRaise, maxRaise)}
          max={maxRaise}
          step={game.big_blind}
          value={raiseAmount}
          onChange={(e) => setRaiseAmount(Number(e.target.value))}
          disabled={maxRaise <= toCall}
          style={{ flex: 1, accentColor: "var(--accent)" }}
        />
        <span style={{ ...mono, fontSize: 13, minWidth: 70, textAlign: "right", color: "var(--text-primary)" }}>
          {raiseAmount.toLocaleString()}
        </span>
      </div>
      <button
        onClick={() => onAction("raise", raiseAmount)}
        disabled={raiseAmount < minRaise || raiseAmount > maxRaise}
        style={{ ...btnBase, background: "var(--accent)", color: "var(--accent-text)" }}
      >
        {isNeo ? `[RAISE]` : `Рейз ${raiseAmount.toLocaleString()}`}
      </button>
      <button
        onClick={() => onAction("raise", maxRaise)}
        disabled={maxRaise <= toCall}
        style={{ ...btnBase, background: "transparent", color: "var(--text-primary)", border: `1px solid ${isNeo ? "var(--accent)" : "var(--border)"}` }}
      >
        {isNeo ? "[ALL-IN]" : "All-in"}
      </button>
    </div>
  );
}

function LiveTableLayout({ table, game, currentUserId, isNeo }: {
  table: PokerTableOut;
  game: PokerGameView;
  currentUserId: number;
  isNeo: boolean;
}) {
  const N = table.max_seats;
  const myPlayer = game.players.find((p) => p.user_id === currentUserId);
  const mySeatIndex = myPlayer?.seat_index ?? 0;
  const slotPositions: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const angle = ((i - mySeatIndex) / N) * Math.PI * 2 + Math.PI / 2;
    const a = 38, b = 38;
    slotPositions.push({ x: 50 + a * Math.cos(angle), y: 50 + b * Math.sin(angle) });
  }
  const playersBySeat = new Map(game.players.map((p) => [p.seat_index, p]));

  return (
    <div style={{
      position: "relative",
      // Scale to whatever space the parent flex offers, keeping 16:10 felt aspect ratio.
      width: "100%",
      maxWidth: "min(100%, calc((100vh - 200px) * 1.6))",
      maxHeight: "100%",
      aspectRatio: "16/10",
      background: isNeo
        ? "linear-gradient(180deg, #0a1410 0%, #050a08 100%)"
        : "radial-gradient(ellipse at center, #1a4a2e 0%, #0e2a18 100%)",
      borderRadius: isNeo ? 0 : "50%/40%",
      border: isNeo ? "1.5px solid var(--accent)" : "8px solid #5a3220",
      boxShadow: isNeo ? "inset 0 0 40px rgba(198,255,61,0.12)" : "inset 0 0 60px rgba(0,0,0,0.5)",
      overflow: "hidden",
    }}>
      {/* Center: pot + community */}
      <div style={{
        position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        textAlign: "center", color: isNeo ? "var(--accent)" : "#fff",
        fontFamily: isNeo ? "var(--font-mono)" : undefined,
      }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
          {(game.hand?.community || []).map((c, i) => <CardView key={i} code={c} isNeo={isNeo} large />)}
          {Array.from({ length: 5 - (game.hand?.community.length || 0) }).map((_, i) => (
            <CardView key={`b${i}`} code={null} isNeo={isNeo} large />
          ))}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
          {isNeo ? "// БАНК · " : "Банк · "}{(game.hand?.pot ?? 0).toLocaleString()}
        </div>
      </div>

      {/* Seats */}
      {Array.from({ length: N }).map((_, idx) => {
        const player = playersBySeat.get(idx);
        const tableSeat = table.seats.find((sx) => sx.seat_index === idx);
        const pos = slotPositions[idx];
        const isToAct = game.hand?.to_act_seat === idx;
        const isButton = game.hand?.button_seat === idx;
        return (
          <div key={idx} style={{
            position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`,
            transform: "translate(-50%, -50%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            minWidth: 96,
          }}>
            {player ? (
              <div style={{
                opacity: player.has_folded ? 0.35 : 1,
                border: isToAct ? `2px solid ${isNeo ? "var(--accent)" : "#ffd24a"}` : "2px solid transparent",
                borderRadius: isNeo ? 0 : 8,
                padding: 4,
                transition: "border-color 0.2s",
                position: "relative",
              }}>
                <div style={{ display: "flex", gap: 3, justifyContent: "center", marginBottom: 4, height: 60 }}>
                  {player.hole.map((c, i) => <CardView key={i} code={c === "?" ? null : c} isNeo={isNeo} small />)}
                </div>
                <div style={{ textAlign: "center", color: "#fff", fontSize: 12, fontFamily: isNeo ? "var(--font-mono)" : undefined }}>
                  {tableSeat?.username || "?"}
                  {isButton && <span style={{ background: "#fff", color: "#000", borderRadius: "50%", padding: "0 5px", fontSize: 9, marginLeft: 4, fontWeight: 700 }}>D</span>}
                </div>
                <div style={{ textAlign: "center", color: isNeo ? "var(--accent)" : "#ffd24a", fontSize: 12, fontFamily: isNeo ? "var(--font-mono)" : undefined, fontWeight: 700 }}>
                  {player.stack.toLocaleString()}
                </div>
                {player.bet > 0 && (
                  <div style={{ textAlign: "center", color: "#fff", fontSize: 10, fontFamily: isNeo ? "var(--font-mono)" : undefined, opacity: 0.85, marginTop: 2 }}>
                    ставка {player.bet.toLocaleString()}
                  </div>
                )}
                {player.is_all_in && (
                  <div style={{ position: "absolute", top: -6, right: -6, background: "#ed4245", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: isNeo ? 0 : 8, fontFamily: isNeo ? "var(--font-mono)" : undefined, fontWeight: 700 }}>
                    ALL-IN
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                width: 56, height: 56,
                borderRadius: isNeo ? 0 : "50%",
                border: `2px dashed ${isNeo ? "var(--accent)" : "rgba(255,255,255,0.25)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: isNeo ? "var(--accent)" : "rgba(255,255,255,0.4)",
                fontSize: 22,
              }}>+</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CardView({ code, isNeo, small, large }: { code: string | null; isNeo: boolean; small?: boolean; large?: boolean }) {
  // Three size buckets. small = player hole cards in tile, normal = pre-game placeholder,
  // large = community cards on the felt where suits need to be clearly visible.
  // Подросли на ~15% по просьбе Гандолы («увеличить карты немного»)
  const w = large ? 72 : small ? 46 : 56;
  const h = large ? 104 : small ? 66 : 80;
  const rankSize = large ? 24 : small ? 16 : 20;
  const suitSize = large ? 30 : small ? 20 : 24;
  if (!code) {
    return (
      <div style={{
        width: w, height: h,
        borderRadius: isNeo ? 0 : 5,
        background: isNeo ? "transparent" : "linear-gradient(135deg, #5865f2 0%, #3a45a5 100%)",
        border: isNeo ? "1px dashed var(--accent)" : "1px solid rgba(255,255,255,0.3)",
        opacity: 0.5,
      }}/>
    );
  }
  // Движок хранит десятку как "T" — людям привычнее «10»
  const rawRank = code.slice(0, code.length - 1);
  const rank = rawRank === "T" ? "10" : rawRank;
  const suit = code.slice(-1);
  const isRed = suit === "h" || suit === "d";
  const suitChar = { s: "♠", h: "♥", d: "♦", c: "♣" }[suit] || "?";
  return (
    <div style={{
      width: w, height: h,
      borderRadius: isNeo ? 0 : 5,
      background: isNeo ? "#0a0a0a" : "#fff",
      border: isNeo ? "1px solid var(--accent)" : "1px solid #d6d6d6",
      boxShadow: isNeo ? "0 0 4px rgba(198,255,61,0.18)" : "0 1px 3px rgba(0,0,0,0.25)",
      color: isNeo ? (isRed ? "#ff7777" : "var(--accent)") : (isRed ? "#d33" : "#222"),
      fontFamily: isNeo ? "var(--font-mono)" : "Inter, sans-serif",
      fontWeight: 700,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
      fontSize: rankSize,
      gap: large ? 6 : 3,
    }}>
      <span>{rank}</span>
      <span style={{ fontSize: suitSize }}>{suitChar}</span>
    </div>
  );
}

// ---- Настройки стола ------------------------------------------------------

const PRESETS: Array<{ key: string; label: string; s: PokerTableSettings }> = [
  { key: "fast", label: "Быстрый", s: { starting_stack: 10000, starting_small_blind: 100, blind_increase_minutes: 4 } },
  { key: "normal", label: "Обычный", s: { starting_stack: 30000, starting_small_blind: 100, blind_increase_minutes: 7 } },
  { key: "marathon", label: "Марафон", s: { starting_stack: 50000, starting_small_blind: 50, blind_increase_minutes: 12 } },
];

function TableSettingsForm({ isNeo, busy, title, initial, lockMoney, onSubmit, onCancel }: {
  isNeo: boolean;
  busy: boolean;
  title: string;
  initial: Required<PokerTableSettings>;
  /** Кто-то уже заплатил энтри — режим и цену менять нельзя */
  lockMoney?: boolean;
  onSubmit: (s: PokerTableSettings) => void;
  onCancel: () => void;
}) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [st, setSt] = useState<Required<PokerTableSettings>>(initial);
  const set = (patch: Partial<PokerTableSettings>) => setSt((cur) => ({ ...cur, ...patch }));
  const field: React.CSSProperties = {
    ...mono, background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)",
    borderRadius: isNeo ? 0 : 4, padding: "6px 8px", fontSize: 13, width: 110,
  };
  const label: React.CSSProperties = { ...mono, fontSize: 11.5, color: "var(--text-muted)", display: "block", marginBottom: 4 };
  const row: React.CSSProperties = { display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 };
  const activePreset = PRESETS.find((p) => p.s.starting_stack === st.starting_stack && p.s.starting_small_blind === st.starting_small_blind && p.s.blind_increase_minutes === st.blind_increase_minutes)?.key;
  const gas = st.mode === "gas";
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-modal)", border: "1px solid var(--border)", borderRadius: isNeo ? 0 : 10, padding: 20, width: 520, maxWidth: "94vw", boxShadow: "var(--shadow)" }}>
        <div style={{ ...mono, fontWeight: 800, fontSize: 14, marginBottom: 14, color: isNeo ? "var(--accent)" : "var(--text-header)", letterSpacing: isNeo ? "0.08em" : undefined }}>{title}</div>

        <div style={{ ...row, alignItems: "center" }}>
          <span style={label}>Пресет</span>
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => set(p.s)} style={{
              ...mono, padding: "5px 10px", fontSize: 12, cursor: "pointer", borderRadius: isNeo ? 0 : 999,
              background: activePreset === p.key ? "var(--accent)" : "transparent",
              color: activePreset === p.key ? "var(--accent-text)" : "var(--text-primary)",
              border: `1px solid ${activePreset === p.key ? "var(--accent)" : "var(--border)"}`,
            }}>{p.label}</button>
          ))}
        </div>

        <div style={row}>
          <div><span style={label}>Стек</span><input type="number" min={1000} max={1000000} step={1000} value={st.starting_stack} onChange={(e) => set({ starting_stack: Number(e.target.value) })} style={field} /></div>
          <div><span style={label}>Малый блайнд</span><input type="number" min={10} max={10000} step={10} value={st.starting_small_blind} onChange={(e) => set({ starting_small_blind: Number(e.target.value) })} style={field} /><div style={{ ...label, marginTop: 3 }}>большой = {st.starting_small_blind * 2}</div></div>
          <div><span style={label}>Рост блайндов, мин</span><input type="number" min={1} max={60} value={st.blind_increase_minutes} onChange={(e) => set({ blind_increase_minutes: Number(e.target.value) })} style={field} /><div style={{ ...label, marginTop: 3 }}>×1,5 каждый интервал</div></div>
          <div><span style={label}>Мест</span>
            <select value={st.max_seats} onChange={(e) => set({ max_seats: Number(e.target.value) })} style={{ ...field, width: 70 }}>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div style={{ ...row, alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <span style={label}>Режим</span>
          {(["chips", "gas"] as const).map((m) => (
            <button key={m} disabled={!!lockMoney} onClick={() => set({ mode: m })} style={{
              ...mono, padding: "5px 12px", fontSize: 12, cursor: lockMoney ? "not-allowed" : "pointer", borderRadius: isNeo ? 0 : 999,
              background: st.mode === m ? "var(--accent)" : "transparent",
              color: st.mode === m ? "var(--accent-text)" : "var(--text-primary)",
              border: `1px solid ${st.mode === m ? "var(--accent)" : "var(--border)"}`,
              opacity: lockMoney ? 0.6 : 1,
            }}>{m === "chips" ? "Обычный" : "⛽ За газ"}</button>
          ))}
          {lockMoney && <span style={{ ...label, marginBottom: 0 }}>кто-то уже заплатил энтри — режим заморожен</span>}
        </div>
        {gas && (
          <div style={row}>
            <div><span style={label}>Энтри, ⛽</span><input type="number" min={10} max={500} step={10} disabled={!!lockMoney} value={st.entry_gas} onChange={(e) => set({ entry_gas: Number(e.target.value) })} style={field} /></div>
            <div><span style={label}>Докупок на человека</span><input type="number" min={0} max={5} value={st.max_reentries} onChange={(e) => set({ max_reentries: Number(e.target.value) })} style={field} /></div>
            <div><span style={label}>Докупка открыта до повышения №</span><input type="number" min={0} max={10} value={st.reentry_until_level} onChange={(e) => set({ reentry_until_level: Number(e.target.value) })} style={field} /></div>
            <div style={{ ...label, flexBasis: "100%", marginTop: -4 }}>
              Все платят энтри при посадке, вылетевшие докупаются за ту же цену, победитель забирает весь котёл.
              Не хватило газа — за стол не сесть. Закрыл стол до финала — газ всем вернётся.
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button onClick={onCancel} style={{ ...mono, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", padding: "8px 14px", borderRadius: isNeo ? 0 : 4, cursor: "pointer", fontSize: 13 }}>
            {isNeo ? "[ОТМЕНА]" : "Отмена"}
          </button>
          <button disabled={busy} onClick={() => onSubmit(st)} style={{ ...mono, background: "var(--accent)", color: "var(--accent-text)", border: "none", padding: "8px 16px", borderRadius: isNeo ? 0 : 4, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            {isNeo ? "[ГОТОВО]" : "Готово"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- История раздач --------------------------------------------------------

const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
function prettyCard(code: string): { text: string; red: boolean } {
  const rank = code[0] === "T" ? "10" : code[0];
  const suit = code[1] || "";
  return { text: `${rank}${SUIT_GLYPH[suit] ?? suit}`, red: suit === "h" || suit === "d" };
}
function CardsInline({ cards }: { cards: string[] }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {cards.map((c, i) => {
        const p = prettyCard(c);
        return <span key={i} style={{ padding: "0 4px", borderRadius: 3, background: "#fff", color: p.red ? "#d0302f" : "#1a1a1a", fontWeight: 700, fontSize: 11.5, lineHeight: "17px" }}>{p.text}</span>;
      })}
    </span>
  );
}

const ACTION_RU: Record<string, string> = { fold: "фолд", check: "чек", call: "колл", raise: "рейз до" };
const STREET_RU: Record<string, string> = { preflop: "Префлоп", flop: "Флоп", turn: "Тёрн", river: "Ривер" };

function HistoryPanel({ history, table, isNeo, onClose }: { history: PokerHistory | null; table: PokerTableOut; isNeo: boolean; onClose: () => void }) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [open, setOpen] = useState<number | null>(null);
  const name = (uid: number) => history?.names?.[String(uid)] ?? table.seats.find((s) => s.user_id === uid)?.username ?? `#${uid}`;
  const hands: PokerHistoryHand[] = history?.hands ?? [];
  return (
    <div style={{ ...mono, borderBottom: "1px solid var(--border)", background: isNeo ? "rgba(255,255,255,0.02)" : "var(--bg-secondary)", maxHeight: 260, overflowY: "auto", fontSize: 12.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", position: "sticky", top: 0, background: isNeo ? "var(--bg-primary)" : "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 800, color: isNeo ? "var(--accent)" : "var(--text-header)", letterSpacing: isNeo ? "0.06em" : undefined }}>
          {isNeo ? "// ИСТОРИЯ РАЗДАЧ" : "История раздач"}
          <span style={{ color: "var(--text-muted)", fontWeight: 400, marginLeft: 8 }}>{hands.length ? `${hands.length} шт., свежие сверху` : "пока пусто"}</span>
        </span>
        <button onClick={onClose} style={{ ...mono, background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>{isNeo ? "[СКРЫТЬ]" : "скрыть ▴"}</button>
      </div>
      {hands.map((h) => {
        const winners = h.winners.map(name).join(", ");
        const isOpen = open === h.hand_no;
        return (
          <div key={h.hand_no} style={{ borderBottom: "1px solid var(--border)" }}>
            <div onClick={() => setOpen(isOpen ? null : h.hand_no)} style={{ display: "flex", gap: 12, alignItems: "center", padding: "7px 16px", cursor: "pointer" }}>
              <span style={{ color: "var(--text-muted)", width: 34 }}>#{h.hand_no}</span>
              <span style={{ color: "var(--text-muted)" }}>{h.blinds[0]}/{h.blinds[1]}</span>
              <CardsInline cards={h.community} />
              <span style={{ flex: 1 }} />
              <span>🏆 <b>{winners}</b>{h.winning_hand ? ` · ${h.winning_hand}` : ""}{h.reason === "all_others_folded" ? " · все сложили" : ""}</span>
              <span style={{ color: "var(--accent)", fontWeight: 700, minWidth: 70, textAlign: "right" }}>{h.pot.toLocaleString()}</span>
              <span style={{ color: "var(--text-muted)" }}>{isOpen ? "▴" : "▾"}</span>
            </div>
            {isOpen && (
              <div style={{ padding: "4px 16px 10px 62px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ color: "var(--text-muted)" }}>
                  Стеки на входе: {h.players.map((p) => `${name(p.user_id)} ${p.stack.toLocaleString()}`).join(" · ")}
                </div>
                {h.streets.map((st, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: "var(--text-muted)", minWidth: 64 }}>{STREET_RU[st.street] ?? st.street}</span>
                    {st.community.length > 0 && <CardsInline cards={st.community} />}
                    {st.actions.length === 0 ? (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    ) : st.actions.map((a, j) => (
                      <span key={j}>
                        {name(a.user_id)}: {ACTION_RU[a.action] ?? a.action}{a.action === "raise" || a.action === "call" ? ` ${a.to.toLocaleString()}` : ""}{a.all_in ? " (all-in)" : ""}
                        {j < st.actions.length - 1 ? " · " : ""}
                      </span>
                    ))}
                  </div>
                ))}
                {h.showdown.length > 0 && (
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: "var(--text-muted)", minWidth: 64 }}>Вскрытие</span>
                    {h.showdown.map((sd) => (
                      <span key={sd.user_id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {name(sd.user_id)} <CardsInline cards={sd.hole} /> {sd.hand && <span style={{ color: "var(--text-muted)" }}>{sd.hand}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeatAvatar({ seat, small }: { seat: PokerSeatOut; small?: boolean }) {
  const isNeo = typeof document !== "undefined" && document.body.classList.contains("theme-neo");
  const size = small ? 20 : 56;
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let h = 0;
  for (let i = 0; i < seat.username.length; i++) h = seat.username.charCodeAt(i) + ((h << 5) - h);
  const bg = isNeo ? "#0a0a0a" : colors[Math.abs(h) % colors.length];
  const radius = isNeo ? (size * 0.18) : "50%";
  return seat.avatar_url ? (
    <img
      src={seat.avatar_url.startsWith("http") ? seat.avatar_url : `${BASE_URL}${seat.avatar_url}`}
      style={{ width: size, height: size, borderRadius: radius, objectFit: "cover" as const, border: isNeo ? "1px solid var(--accent)" : undefined }}
      alt={seat.username}
    />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: radius, background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: isNeo ? "var(--accent)" : "#fff", fontWeight: 700,
      fontSize: size * 0.42, border: isNeo ? "1px solid var(--accent)" : undefined,
      fontFamily: isNeo ? "var(--font-mono)" : undefined,
    }}>
      {seat.username.charAt(0).toUpperCase()}
    </div>
  );
}

function PokerTableLayout({ table, currentUserId, isNeo }: { table: PokerTableOut; currentUserId: number; isNeo: boolean }) {
  const seats = table.seats;
  const N = table.max_seats;
  // Place N seat slots evenly around an oval. Reserve index 0 for current user (bottom).
  // We rotate the wheel so the local player's seat (if seated) is at the bottom.
  const mySeatIndex = seats.find((s) => s.user_id === currentUserId)?.seat_index ?? 0;
  const slotPositions: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    // Local seat at angle 90deg (bottom). Others spread around.
    const angle = ((i - mySeatIndex) / N) * Math.PI * 2 + Math.PI / 2;
    // Oval: radii a (horizontal) and b (vertical) in % of container
    const a = 38, b = 36;
    slotPositions.push({
      x: 50 + a * Math.cos(angle),
      y: 50 + b * Math.sin(angle),
    });
  }
  const seatsByIdx = new Map<number, PokerSeatOut>();
  seats.forEach((s) => seatsByIdx.set(s.seat_index, s));

  return (
    <div style={{
      position: "relative",
      width: "100%",
      maxWidth: "min(100%, calc((100vh - 200px) * 1.6))",
      maxHeight: "100%",
      aspectRatio: "16/10",
      background: isNeo
        ? "linear-gradient(180deg, #0a1410 0%, #050a08 100%)"
        : "radial-gradient(ellipse at center, #1a4a2e 0%, #0e2a18 100%)",
      borderRadius: isNeo ? 0 : "50%/40%",
      border: isNeo ? "1.5px solid var(--accent)" : "8px solid #5a3220",
      boxShadow: isNeo ? "inset 0 0 40px rgba(198,255,61,0.12)" : "inset 0 0 60px rgba(0,0,0,0.5)",
      overflow: "hidden",
    }}>
      {/* Pot / center area placeholder */}
      <div style={{
        position: "absolute",
        left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        textAlign: "center", color: isNeo ? "var(--accent)" : "rgba(255,255,255,0.5)",
        fontFamily: isNeo ? "var(--font-mono)" : undefined,
        fontSize: 14, letterSpacing: 1,
      }}>
        {isNeo ? "// БАНК · 0" : "Банк · 0"}
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
          {isNeo ? "ожидание_игроков..." : "Ожидание игроков..."}
        </div>
      </div>
      {/* Seats */}
      {Array.from({ length: N }).map((_, idx) => {
        const seat = seatsByIdx.get(idx);
        const pos = slotPositions[idx];
        return (
          <div key={idx} style={{
            position: "absolute",
            left: `${pos.x}%`, top: `${pos.y}%`,
            transform: "translate(-50%, -50%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            minWidth: 84,
          }}>
            {seat ? (
              <>
                <SeatAvatar seat={seat} />
                <div style={{ color: "#fff", fontSize: 12, fontFamily: isNeo ? "var(--font-mono)" : undefined, textAlign: "center" }}>
                  {seat.user_id === currentUserId
                    ? (isNeo ? `@вы` : "Вы")
                    : seat.username}
                </div>
                <div style={{ color: isNeo ? "var(--accent)" : "#ffd24a", fontSize: 11, fontFamily: isNeo ? "var(--font-mono)" : undefined, fontWeight: 700 }}>
                  {seat.stack > 0 ? seat.stack.toLocaleString() : "—"}
                </div>
              </>
            ) : (
              <div style={{
                width: 56, height: 56,
                borderRadius: isNeo ? 0 : "50%",
                border: `2px dashed ${isNeo ? "var(--accent)" : "rgba(255,255,255,0.25)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: isNeo ? "var(--accent)" : "rgba(255,255,255,0.4)",
                fontSize: 22, fontFamily: isNeo ? "var(--font-mono)" : undefined,
              }}>
                +
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)", height: "100%" },
  header: { display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)" },
  title: { color: "var(--text-header)", fontWeight: 700, fontSize: 16 },
  body: { flex: 1, overflowY: "auto", padding: 20 },
  empty: { color: "var(--text-muted)", textAlign: "center" as const, padding: "60px 20px", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  tableCard: { background: "var(--bg-secondary)", borderRadius: 8, padding: 14 },
  tableTitle: { color: "var(--text-header)", fontWeight: 700, fontSize: 15 },
  tableMeta: { color: "var(--text-muted)", fontSize: 12, marginTop: 4 },
  tableArea: { flex: 1, padding: 16, overflow: "hidden" as const, display: "flex", alignItems: "center", justifyContent: "center" },
  primaryBtn: { background: "var(--accent)", color: "var(--accent-text)", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  secondaryBtn: { background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13 },
  error: { padding: "8px 16px", color: "var(--danger)", fontSize: 12 },
};
