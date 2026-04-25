import React, { useEffect, useState } from "react";
import { ChatOut, UserOut, PokerTableOut, PokerSeatOut, pokerApi } from "../services/api";
import { wsService } from "../services/ws";
import { useTheme } from "../services/theme";

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

  // Load tables for this chat
  useEffect(() => {
    setActiveTable(null);
    setTables([]);
    setError(null);
    pokerApi.list(chat.id).then((res) => setTables(res.data)).catch((e) => {
      setError(e.response?.data?.detail || "Не удалось загрузить столы");
    });
  }, [chat.id]);

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
            joinTable(detail.tableId);
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
      setTables((prev) => prev.map((t) => t.id === data.table.id ? data.table : t));
      setActiveTable((cur) => (cur && cur.id === data.table.id ? data.table : cur));
    };
    const onRemoved = (data: any) => {
      setTables((prev) => prev.filter((t) => t.id !== data.table_id));
      setActiveTable((cur) => (cur && cur.id === data.table_id ? null : cur));
    };
    wsService.on("poker_table_created", onCreated);
    wsService.on("poker_table_updated", onUpdated);
    wsService.on("poker_table_removed", onRemoved);
    return () => {
      wsService.off("poker_table_created", onCreated);
      wsService.off("poker_table_updated", onUpdated);
      wsService.off("poker_table_removed", onRemoved);
    };
  }, [chat.id]);

  async function createTable() {
    setBusy(true); setError(null);
    try {
      const res = await pokerApi.create(chat.id, 6);
      setActiveTable(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Ошибка создания стола");
    } finally { setBusy(false); }
  }

  async function joinTable(tableId: number) {
    setError(null);
    // Optimistic: drop a "ghost" seat for the current user immediately so the UI
    // reacts on the same frame as the click. Server response (or WS broadcast) will
    // overwrite this with the authoritative state moments later.
    const ghostSeat: PokerSeatOut = {
      id: -Date.now(),
      user_id: currentUser.id,
      username: currentUser.username,
      avatar_url: currentUser.avatar_url,
      seat_index: -1,
      stack: 0,
      is_active: true,
    };
    setTables((prev) => prev.map((t) => {
      if (t.id !== tableId || t.seats.find((s) => s.user_id === currentUser.id)) return t;
      return { ...t, seats: [...t.seats, ghostSeat] };
    }));
    setActiveTable((cur) => {
      if (!cur || cur.id !== tableId) {
        const t = tables.find((x) => x.id === tableId);
        if (!t) return cur;
        return t.seats.find((s) => s.user_id === currentUser.id)
          ? t
          : { ...t, seats: [...t.seats, ghostSeat] };
      }
      if (cur.seats.find((s) => s.user_id === currentUser.id)) return cur;
      return { ...cur, seats: [...cur.seats, ghostSeat] };
    });
    try {
      const res = await pokerApi.join(tableId);
      setActiveTable(res.data);
    } catch (e: any) {
      // Revert optimistic seat
      setTables((prev) => prev.map((t) => t.id !== tableId
        ? t
        : { ...t, seats: t.seats.filter((s) => s.id !== ghostSeat.id) }));
      setActiveTable((cur) => cur && cur.id === tableId
        ? { ...cur, seats: cur.seats.filter((s) => s.id !== ghostSeat.id) }
        : cur);
      setError(e.response?.data?.detail || "Не удалось сесть");
    }
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
            onClick={createTable}
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
                        onClick={() => setActiveTable(t)}
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
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {!mySeat && t.status === "lobby" && t.seats.length < t.max_seats && (
            <button
              onClick={() => joinTable(t.id)}
              style={{ ...s.primaryBtn, ...mono, ...(isNeo ? { borderRadius: 0 } : {}) }}
            >
              {isNeo ? "[СЕСТЬ]" : "Сесть"}
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
        </div>
      </div>
      {error && <div style={{ ...s.error, ...mono }}>{error}</div>}
      <div style={{ ...s.tableArea, position: "relative" }}>
        <PokerTableLayout table={t} currentUserId={currentUser.id} isNeo={isNeo} />
        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center", color: "var(--text-muted)", fontSize: 12, ...mono }}>
          {isNeo
            ? "// раздача_карт_появится_в_следующей_фазе"
            : "Логика раздачи появится в следующей фазе. Пока можно собирать стол."}
        </div>
      </div>
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
      maxWidth: 760,
      margin: "0 auto",
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
  tableArea: { flex: 1, padding: 24, overflow: "auto" as const },
  primaryBtn: { background: "var(--accent)", color: "var(--accent-text)", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  secondaryBtn: { background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "none", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13 },
  error: { padding: "8px 16px", color: "var(--danger)", fontSize: 12 },
};
