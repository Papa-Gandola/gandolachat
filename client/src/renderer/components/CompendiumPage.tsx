import React, { useEffect, useMemo, useState } from "react";
import {
  UserOut, compendiumApi, CompendiumMe, CompendiumQuest, CompendiumSeasonRow, CompendiumTrophy,
} from "../services/api";
import { wsService } from "../services/ws";
import { useTheme } from "../services/theme";
import DotaRankBadge from "./DotaRankBadge";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const BLOOD = "#ff6a5e";
const GOLD = "#ffd24a";

// До полуночи по МСК (UTC+3) — момент ротации ежедневок
function msToDailyReset(): number {
  const now = new Date();
  const mskNow = new Date(now.getTime() + 3 * 3600_000);
  const next = new Date(Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate() + 1));
  return next.getTime() - mskNow.getTime();
}

function fmtLeft(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

export default function CompendiumPage({ currentUser, onClose, onOpenProfile }: {
  currentUser: UserOut;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = { fontFamily: "var(--font-mono)" };
  const [data, setData] = useState<CompendiumMe | null>(null);
  const [tab, setTab] = useState<"quests" | "season" | "trophies">("quests");
  const [seasonRows, setSeasonRows] = useState<CompendiumSeasonRow[] | null>(null);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [userTrophies, setUserTrophies] = useState<Record<number, CompendiumTrophy[]>>({});
  const [resetLeft, setResetLeft] = useState(msToDailyReset());
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await compendiumApi.me();
      setData(res.data);
      setError("");
    } catch {
      setError("Не удалось загрузить компендиум");
    }
  }

  async function loadSeason() {
    try {
      const res = await compendiumApi.season();
      setSeasonRows(res.data.rows);
    } catch { /* таблица просто не обновится */ }
  }

  useEffect(() => {
    load();
    loadSeason();
    // Живое обновление: карточка задания в чате = что-то засчитали
    const onMsg = (m: any) => {
      if (typeof m?.content === "string" && m.content.startsWith("/quest_card")) {
        load();
        loadSeason();
      }
    };
    wsService.on("message", onMsg);
    const t = setInterval(() => setResetLeft(msToDailyReset()), 30_000);
    return () => {
      wsService.off("message", onMsg);
      clearInterval(t);
    };
  }, []);

  async function toggleUser(uid: number) {
    if (expandedUser === uid) { setExpandedUser(null); return; }
    setExpandedUser(uid);
    if (!userTrophies[uid]) {
      try {
        const res = await compendiumApi.user(uid);
        setUserTrophies((prev) => ({ ...prev, [uid]: res.data.trophies }));
      } catch { /* ignore */ }
    }
  }

  const accentText = isNeo ? "var(--accent)" : "var(--text-header)";
  const seasonTitle = useMemo(() => {
    if (!data?.season) return "";
    const [y, m] = data.season.split("-");
    const months = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
    return `${months[Number(m) - 1]} ${y}`;
  }, [data?.season]);

  return (
    <div style={s.root}>
      <div style={{ ...s.header, ...(isNeo ? { borderBottomColor: "var(--accent)" } : {}) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ ...s.title, ...mono, color: "var(--accent)", letterSpacing: "0.1em" }}>
            {isNeo ? "// ГАНДОЛИУМ" : "⛽ ГАНДОЛИУМ"}
          </span>
          <span style={{ ...mono, color: "var(--text-muted)", fontSize: 12 }}>сезон · {seasonTitle}</span>
        </div>
        <button style={{ ...s.closeBtn, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={onClose}>✕</button>
      </div>

      <div style={s.content}>
        {error && <p style={{ ...mono, color: BLOOD }}>{error}</p>}

        {data && !data.linked && (
          <div style={{ ...s.panel(isNeo), textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⛽</div>
            <h3 style={{ ...mono, color: accentText, margin: "0 0 8px", letterSpacing: "0.05em" }}>
              Steam ещё не привязан
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: 13.5, margin: "0 0 16px", lineHeight: 1.5 }}>
              Привяжи Steam в профиле — рейтинговые катки начнут засчитываться,<br />
              газ закапает, а чат увидит твои подвиги (и позор).
            </p>
            <button
              style={{ background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: isNeo ? 0 : 6, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", ...mono }}
              onClick={onOpenProfile}
            >
              {isNeo ? "[ОТКРЫТЬ ПРОФИЛЬ]" : "Открыть профиль"}
            </button>
          </div>
        )}

        {data && data.linked && (
          <>
            {/* --- шапка прогресса --- */}
            <div style={{ ...s.panel(isNeo), display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 90 }}>
                <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em" }}>УРОВЕНЬ</span>
                <span style={{ ...mono, fontSize: 30, fontWeight: 800, color: "var(--accent)", lineHeight: 1 }}>{data.level}</span>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ ...mono, fontSize: 12, color: "var(--text-secondary)" }}>⛽ {data.gas} газа</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
                    {data.level_progress}/{data.level_target} до уровня {(data.level || 0) + 1}
                  </span>
                </div>
                <div style={{ height: 8, background: "var(--bg-tertiary)", borderRadius: isNeo ? 0 : 4, overflow: "hidden", border: isNeo ? "1px solid var(--border)" : "none" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, ((data.level_progress || 0) / (data.level_target || 100)) * 100)}%`, background: "var(--accent)" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <Stat mono={mono} label="КАТОК" value={String(data.matches ?? 0)} />
                <Stat mono={mono} label="ПОБЕД" value={String(data.wins ?? 0)} />
                <DotaRankBadge rankTier={data.rank_tier} leaderboardRank={data.leaderboard_rank} isNeo={isNeo} />
              </div>
            </div>

            {/* --- вкладки --- */}
            <div style={{ display: "flex", gap: 6, margin: "18px 0 14px" }}>
              {([["quests", "ЗАДАНИЯ"], ["season", "СЕЗОН"], ["trophies", "ТРОФЕИ"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    ...mono,
                    background: tab === key ? "var(--accent)" : "var(--bg-secondary)",
                    color: tab === key ? "var(--accent-text)" : "var(--text-secondary)",
                    border: isNeo ? `1px solid ${tab === key ? "var(--accent)" : "var(--border)"}` : "none",
                    borderRadius: isNeo ? 0 : 6,
                    padding: "8px 16px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "quests" && (
              <>
                <QuestGroup isNeo={isNeo} title="ЕЖЕДНЕВКИ" meta={`ротация через ${fmtLeft(resetLeft)}`} quests={data.daily || []} />
                <QuestGroup isNeo={isNeo} title="ЕЖЕНЕДЕЛЬКИ" meta="сброс в понедельник" quests={data.weekly || []} />
                <QuestGroup isNeo={isNeo} title="МАРАФОНЫ СЕЗОНА" meta="висят весь месяц" quests={data.season_quests || []} />
                <QuestGroup isNeo={isNeo} title="КОМАНДНЫЕ" meta="катки с людьми из чата — газ всем" quests={data.team || []} accent />
                <QuestGroup isNeo={isNeo} title="АНТИ-АЧИВКИ" meta="выдаются сами, отказаться нельзя" quests={data.anti || []} blood />
                <p style={{ ...mono, color: "var(--text-muted)", fontSize: 11.5, marginTop: 16 }}>
                  📼 — нужен парс реплея (доезжает через пару минут после катки) ·
                  ещё есть 12 скрытых пасхалок — узнаешь, когда триггернёшь 🔒
                </p>
              </>
            )}

            {tab === "season" && (
              <div style={s.panel(isNeo)}>
                {!seasonRows?.length && (
                  <p style={{ ...mono, color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                    Пока никто не привязал Steam — таблица пустая
                  </p>
                )}
                {seasonRows?.map((r, i) => (
                  <React.Fragment key={r.user_id}>
                    <div
                      onClick={() => toggleUser(r.user_id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer",
                        background: r.user_id === currentUser.id ? (isNeo ? "rgba(198,255,61,0.07)" : "var(--bg-active)") : "transparent",
                        borderRadius: isNeo ? 0 : 6,
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span style={{ ...mono, width: 28, color: i === 0 ? GOLD : i <= 2 ? "var(--accent)" : "var(--text-muted)", fontWeight: 800, fontSize: 14 }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                      </span>
                      {r.avatar_url ? (
                        <img src={r.avatar_url.startsWith("http") ? r.avatar_url : `${BASE_URL}${r.avatar_url}`} style={{ width: 28, height: 28, borderRadius: isNeo ? 0 : "50%", objectFit: "cover" }} alt="" />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: isNeo ? 0 : "50%", background: "var(--bg-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-muted)" }}>
                          {r.username[0]?.toUpperCase()}
                        </div>
                      )}
                      <span style={{ ...mono, flex: 1, fontWeight: 700, fontSize: 13.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.username}{r.user_id === currentUser.id ? " (ты)" : ""}
                      </span>
                      <DotaRankBadge rankTier={r.rank_tier} leaderboardRank={r.leaderboard_rank} isNeo={isNeo} size="sm" />
                      <span title="Заданий закрыто" style={{ ...mono, fontSize: 11.5, color: "var(--text-muted)" }}>✓{r.quests_done}</span>
                      {r.anti_count > 0 && (
                        <span title="Анти-ачивки" style={{ ...mono, fontSize: 11.5, color: BLOOD }}>💀{r.anti_count}</span>
                      )}
                      <span style={{ ...mono, fontSize: 11.5, color: "var(--text-muted)" }}>ур. {r.level}</span>
                      <span style={{ ...mono, fontWeight: 800, fontSize: 13.5, color: "var(--accent)", minWidth: 70, textAlign: "right" }}>
                        {r.gas} ⛽
                      </span>
                    </div>
                    {expandedUser === r.user_id && (
                      <div style={{ padding: "8px 12px 14px 52px", borderBottom: "1px solid var(--border)" }}>
                        {!userTrophies[r.user_id]?.length ? (
                          <span style={{ ...mono, fontSize: 12, color: "var(--text-muted)" }}>Полка пока пустая</span>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {userTrophies[r.user_id].map((t, j) => (
                              <TrophyChip key={j} t={t} isNeo={isNeo} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                ))}
                <p style={{ ...mono, color: "var(--text-muted)", fontSize: 11.5, margin: "12px 12px 4px" }}>
                  Итоги — в последний день месяца: 🥇 золотая рамка + чат покупает шаурму,
                  последнее место (от 10 игр) — аватарка на 3 дня голосованием чата 💀
                </p>
              </div>
            )}

            {tab === "trophies" && (
              <div style={s.panel(isNeo)}>
                {!data.trophies?.length ? (
                  <p style={{ ...mono, color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                    Пока пусто. Иди катай — газ сам себя не заработает ⛽
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {data.trophies.map((t, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg-tertiary)", borderRadius: isNeo ? 0 : 6, borderLeft: `3px solid ${t.cat === "anti" ? BLOOD : t.cat === "secret" ? GOLD : "var(--accent)"}` }}>
                        <span style={{ fontSize: 16 }}>
                          {t.cat === "anti" ? "💀" : t.cat === "secret" ? "🔓" : t.cat === "team" ? "🤝" : "⛽"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...mono, fontWeight: 700, fontSize: 13, color: t.cat === "anti" ? BLOOD : "var(--text-primary)" }}>
                            {t.name}
                            {t.title && <span style={{ color: GOLD, marginLeft: 8, fontSize: 11.5 }}>титул «{t.title}»</span>}
                          </div>
                          <div style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
                            {new Date(t.completed_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        <span style={{ ...mono, fontWeight: 800, fontSize: 13, color: t.cat === "anti" ? BLOOD : "var(--accent)" }}>
                          +{t.gas} ⛽
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ mono, label, value }: { mono: React.CSSProperties; label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ ...mono, fontSize: 18, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function TrophyChip({ t, isNeo }: { t: CompendiumTrophy; isNeo: boolean }) {
  const bad = t.cat === "anti";
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, padding: "3px 8px",
      color: bad ? BLOOD : "var(--accent)",
      border: `1px solid ${bad ? BLOOD : "var(--accent)"}`,
      background: bad ? "rgba(255,106,94,0.08)" : "rgba(198,255,61,0.08)",
      borderRadius: isNeo ? 0 : 999, whiteSpace: "nowrap",
    }}>
      {bad ? "💀 " : ""}{t.name}
    </span>
  );
}

function QuestGroup({ isNeo, title, meta, quests, blood, accent }: {
  isNeo: boolean;
  title: string;
  meta: string;
  quests: CompendiumQuest[];
  blood?: boolean;
  accent?: boolean;
}) {
  const mono = { fontFamily: "var(--font-mono)" };
  const edge = blood ? BLOOD : "var(--accent)";
  if (!quests.length) return null;
  return (
    <div style={{
      border: "1px solid var(--border)", marginBottom: 18,
      borderLeft: (blood || accent) ? `3px solid ${edge}` : "1px solid var(--border)",
      borderRadius: isNeo ? 0 : 8, overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 14px", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...mono, fontWeight: 800, fontSize: 12.5, letterSpacing: "0.08em", color: blood ? BLOOD : "var(--accent)" }}>
          // {title}
        </span>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>{meta}</span>
      </div>
      {quests.map((q) => (
        <div key={q.id} style={{ display: "flex", gap: 12, padding: "9px 14px", borderBottom: "1px solid var(--border)", alignItems: "baseline", opacity: q.done ? 0.75 : 1 }}>
          <span style={{ ...mono, fontSize: 12, width: 18, color: q.done ? "var(--accent)" : "var(--text-muted)" }}>
            {q.done ? "✓" : String(q.num).padStart(2, "0")}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...mono, fontWeight: 700, fontSize: 13, color: "var(--text-primary)", textDecoration: q.done ? "line-through" : "none" }}>
              {q.name}{q.needs_parse ? <span style={{ fontSize: 10.5, marginLeft: 6, opacity: 0.7 }}>📼</span> : null}
              {q.title && <span style={{ color: GOLD, marginLeft: 8, fontSize: 11 }}>титул</span>}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>{q.desc}</div>
            {typeof q.progress === "number" && typeof q.target === "number" && !q.done && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                <div style={{ flex: 1, maxWidth: 220, height: 5, background: "var(--bg-tertiary)", borderRadius: isNeo ? 0 : 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (q.progress / q.target) * 100)}%`, background: "var(--accent)" }} />
                </div>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--text-muted)" }}>{q.progress}/{q.target}</span>
              </div>
            )}
          </div>
          <span style={{ ...mono, fontWeight: 800, fontSize: 12.5, color: blood ? BLOOD : "var(--accent)", whiteSpace: "nowrap" }}>
            {blood ? "+" : ""}{q.gas} ⛽
          </span>
        </div>
      ))}
    </div>
  );
}

const s = {
  root: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)", height: "100%" } as React.CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 } as React.CSSProperties,
  title: { fontWeight: 800, fontSize: 16 } as React.CSSProperties,
  closeBtn: { background: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", padding: 4, border: "none" } as React.CSSProperties,
  content: { padding: "20px 24px 40px", maxWidth: 780, width: "100%", margin: "0 auto", overflowY: "auto", boxSizing: "border-box" } as React.CSSProperties,
  panel: (isNeo: boolean): React.CSSProperties => ({
    background: "var(--bg-secondary)", border: "1px solid var(--border)",
    borderRadius: isNeo ? 0 : 8, padding: 16,
  }),
};
