import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  UserOut, compendiumApi, CompendiumMe, CompendiumCosmetics, CompendiumQuest, CompendiumSeasonRow, CompendiumTrophy,
} from "../services/api";
import { wsService } from "../services/ws";
import { useTheme } from "../services/theme";
import DotaRankBadge from "./DotaRankBadge";
import { frameClass, frameStyle } from "./cosmetics";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const BLOOD = "#ff6a5e";
const GOLD = "#ffd24a";
// Тизер: по умолчанию крутится при КАЖДОМ заходе в Гандолиум (по
// многочисленным просьбам трудящихся), по кругу — пока не нажали
// «Пропустить». Чек-бокс «отключить заставку» (на оверлее и в строке
// вкладок) убирает её насовсем — и так же возвращает. Файл раздаёт сервер;
// если его вдруг нет — оверлей молча закрывается.
const INTRO_URL = `${BASE_URL}/uploads/compendium/intro.mp4`;
const INTRO_OFF_KEY = "gandolium.introOff";

function readIntroOff(): boolean {
  try { return localStorage.getItem(INTRO_OFF_KEY) === "1"; } catch { return false; }
}

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
  const [tab, setTab] = useState<"quests" | "season" | "trophies" | "cosmetics">("quests");
  const [seasonRows, setSeasonRows] = useState<CompendiumSeasonRow[] | null>(null);
  const [seasonError, setSeasonError] = useState(false);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [userTrophies, setUserTrophies] = useState<Record<number, CompendiumTrophy[]>>({});
  const [resetLeft, setResetLeft] = useState(msToDailyReset());
  const [error, setError] = useState("");
  const [introOff, setIntroOffState] = useState(readIntroOff);
  const [showIntro, setShowIntro] = useState(() => !readIntroOff());
  const introRef = useRef<HTMLVideoElement>(null);

  function introDone() {
    setShowIntro(false);
  }

  function setIntroOff(off: boolean) {
    setIntroOffState(off);
    try {
      if (off) localStorage.setItem(INTRO_OFF_KEY, "1");
      else localStorage.removeItem(INTRO_OFF_KEY);
    } catch { /* приватный режим — переживём */ }
  }

  // Автоплей со звуком: клик по пункту меню даёт user activation, но если
  // браузер всё же запретит — повторяем без звука; совсем не вышло — закрываем.
  useEffect(() => {
    if (!showIntro) return;
    const v = introRef.current;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => setShowIntro(false));
    });
  }, [showIntro]);

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
      setSeasonError(false);
    } catch {
      // Старые строки не трогаем — покажем их с пометкой «не обновилось».
      // Раньше неудачная загрузка выглядела как «никто не привязал Steam»
      // и пугала народ пустой таблицей.
      setSeasonError(true);
    }
  }

  useEffect(() => {
    load();
    loadSeason();
    // Живое обновление: карточка задания в чате = что-то засчитали
    const onMsg = (m: any) => {
      if (typeof m?.content === "string" && m.content.startsWith("/quest_card")) {
        load();
        loadSeason();
        // Развёрнутые полки трофеев в таблице сезона могли устареть
        setUserTrophies({});
      }
    };
    wsService.on("message", onMsg);
    // Тик раз в 30с: обновляем обратный отсчёт, а в полночь МСК (сутки
    // сменились) перезагружаем и сами ежедневки — иначе на открытом экране
    // висел бы вчерашний список под новым таймером.
    let lastDay = new Date(Date.now() + 3 * 3600_000).getUTCDate();
    const t = setInterval(() => {
      setResetLeft(msToDailyReset());
      const day = new Date(Date.now() + 3 * 3600_000).getUTCDate();
      if (day !== lastDay) {
        lastDay = day;
        load();
        loadSeason();
      }
    }, 30_000);
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
      {showIntro && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 400, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          {/* Крутится по кругу — выход только по кнопке (по просьбе Гандолы) */}
          <video
            ref={introRef}
            src={INTRO_URL}
            playsInline
            loop
            onError={() => setShowIntro(false)}
            style={{ maxWidth: "100%", maxHeight: "82vh", outline: "none" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={introDone}
              style={{ ...mono, background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: isNeo ? 0 : 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer" }}
            >
              ПРОПУСТИТЬ →
            </button>
            <label style={{ ...mono, display: "flex", alignItems: "center", gap: 7, color: "rgba(255,255,255,0.75)", fontSize: 12, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={introOff}
                onChange={(e) => setIntroOff(e.target.checked)}
                style={{ accentColor: "var(--accent)", width: 14, height: 14, cursor: "pointer" }}
              />
              больше не показывать
            </label>
          </div>
        </div>
      )}
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
            <div style={{ display: "flex", gap: 6, margin: "18px 0 14px", flexWrap: "wrap" }}>
              {([["quests", "ЗАДАНИЯ"], ["season", "СЕЗОН"], ["trophies", "ТРОФЕИ"], ["cosmetics", "КОСМЕТИКА"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key);
                    // Клик по вкладке заодно освежает данные — дешёвый способ
                    // восстановиться после неудачной загрузки
                    if (key === "season") loadSeason();
                    else load();
                  }}
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
              <label
                title="Заставка при входе в Гандолиум"
                style={{ ...mono, display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", color: "var(--text-muted)", fontSize: 11.5, cursor: "pointer", userSelect: "none" }}
              >
                <input
                  type="checkbox"
                  checked={introOff}
                  onChange={(e) => setIntroOff(e.target.checked)}
                  style={{ accentColor: "var(--accent)", width: 13, height: 13, cursor: "pointer" }}
                />
                🎬 отключить заставку
              </label>
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
                {seasonError && (
                  <p style={{ ...mono, color: BLOOD, fontSize: 12, margin: "0 0 10px" }}>
                    ⚠ Не удалось обновить таблицу — показываю что есть, тыкни вкладку ещё раз
                  </p>
                )}
                {!seasonRows && !seasonError && (
                  <p style={{ ...mono, color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                    Загружаю таблицу…
                  </p>
                )}
                {seasonRows && !seasonRows.length && (
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
                        <img src={r.avatar_url.startsWith("http") ? r.avatar_url : `${BASE_URL}${r.avatar_url}`} className={frameClass({ comp_frame: r.comp_frame })} style={{ width: 28, height: 28, borderRadius: isNeo ? 0 : "50%", objectFit: "cover", ...frameStyle({ comp_frame: r.comp_frame }) }} alt="" />
                      ) : (
                        <div className={frameClass({ comp_frame: r.comp_frame })} style={{ width: 28, height: 28, borderRadius: isNeo ? 0 : "50%", background: "var(--bg-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-muted)", ...frameStyle({ comp_frame: r.comp_frame }) }}>
                          {r.username[0]?.toUpperCase()}
                        </div>
                      )}
                      <span style={{ ...mono, flex: 1, fontWeight: 700, fontSize: 13.5, color: r.comp_color || "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.username}{r.comp_badge ? " ⛽" : ""}{r.user_id === currentUser.id ? " (ты)" : ""}
                        {r.comp_title && <span style={{ color: GOLD, fontWeight: 500, fontSize: 11, marginLeft: 6 }}>«{r.comp_title}»</span>}
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

            {tab === "cosmetics" && data.cosmetics && (
              <CosmeticsTab
                isNeo={isNeo}
                cos={data.cosmetics}
                onSaved={(c) => setData((prev) => (prev ? { ...prev, cosmetics: c } : prev))}
              />
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

function CosmeticsTab({ isNeo, cos, onSaved }: {
  isNeo: boolean;
  cos: CompendiumCosmetics;
  onSaved: (c: CompendiumCosmetics) => void;
}) {
  const mono = { fontFamily: "var(--font-mono)" };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const lvl = cos.max_level;
  const U = cos.unlocks;

  async function save(patch: { badge?: boolean; title?: string; color?: string; frame?: string }) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await compendiumApi.updateCosmetics(patch);
      onSaved(res.data);
    } catch (e: any) {
      setErr(e.response?.data?.detail || "Не получилось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean, locked: boolean): React.CSSProperties => ({
    ...mono,
    background: active ? "var(--accent)" : "var(--bg-tertiary)",
    color: active ? "var(--accent-text)" : locked ? "var(--text-muted)" : "var(--text-primary)",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    borderRadius: isNeo ? 0 : 6,
    padding: "6px 12px", fontSize: 12, fontWeight: 700,
    cursor: locked ? "not-allowed" : "pointer",
    opacity: locked ? 0.55 : 1,
  });

  function Row({ need, name, desc, children }: { need: number; name: string; desc: string; children?: React.ReactNode }) {
    const locked = lvl < need;
    return (
      <div style={{ display: "flex", gap: 14, padding: "13px 14px", borderBottom: "1px solid var(--border)", alignItems: "flex-start", opacity: locked ? 0.75 : 1 }}>
        <span style={{ ...mono, fontSize: 11, fontWeight: 800, minWidth: 44, color: locked ? "var(--text-muted)" : "var(--accent)", paddingTop: 3 }}>
          {locked ? `🔒 ${need}` : `ур.${need}`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...mono, fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{name}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 8px" }}>
            {locked ? `Откроется на уровне ${need} · ${desc}` : desc}
          </div>
          {!locked && children}
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: isNeo ? 0 : 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span style={{ ...mono, fontWeight: 800, fontSize: 12.5, letterSpacing: "0.08em", color: "var(--accent)" }}>// КОСМЕТИКА</span>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
          открыто уровнем {lvl} · уровни не сгорают между сезонами
        </span>
      </div>

      <Row need={U.badge ?? 2} name="Значок ⛽ у ника" desc="Виден в чате, списке участников и профиле">
        <div style={{ display: "flex", gap: 6 }}>
          <button style={chip(cos.badge, false)} onClick={() => save({ badge: !cos.badge })} disabled={busy}>
            {cos.badge ? (isNeo ? "[ВКЛ]" : "Вкл") : (isNeo ? "[ВЫКЛ]" : "Выкл")}
          </button>
        </div>
      </Row>

      <Row need={U.title ?? 4} name="Титул под ником" desc="Из заработанных — прожарочные тоже считаются">
        {cos.earned_titles.length === 0 ? (
          <span style={{ ...mono, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
            Пока ни одного титула — закрывай громкие задания
          </span>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={chip(!cos.title, false)} onClick={() => save({ title: "" })} disabled={busy}>без титула</button>
            {cos.earned_titles.map((t) => (
              <button key={t} style={chip(cos.title === t, false)} onClick={() => save({ title: t })} disabled={busy}>
                «{t}»
              </button>
            ))}
          </div>
        )}
      </Row>

      <Row need={U.color ?? 6} name="Цвет ника" desc="Палитра Гандолы — виден всем в чате">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button style={chip(!cos.color, false)} onClick={() => save({ color: "" })} disabled={busy}>обычный</button>
          {cos.palette.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => save({ color: c })}
              disabled={busy}
              style={{
                width: 26, height: 26, background: c, cursor: "pointer",
                border: cos.color === c ? "2.5px solid var(--text-primary)" : "2px solid transparent",
                borderRadius: isNeo ? 0 : "50%",
              }}
            />
          ))}
        </div>
      </Row>

      <Row need={U.frame_lime ?? 8} name="Рамка аватарки" desc="Лаймовая — «ветеран сезона»">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={chip(!cos.frame, false)} onClick={() => save({ frame: "" })} disabled={busy}>без рамки</button>
          <button style={chip(cos.frame === "lime", false)} onClick={() => save({ frame: "lime" })} disabled={busy}>лаймовая</button>
          <button
            style={chip(cos.frame === "animated", lvl < (U.frame_animated ?? 12))}
            onClick={() => lvl >= (U.frame_animated ?? 12) && save({ frame: "animated" })}
            disabled={busy || lvl < (U.frame_animated ?? 12)}
            title={lvl < (U.frame_animated ?? 12) ? `Откроется на уровне ${U.frame_animated ?? 12}` : ""}
          >
            переливающаяся{lvl < (U.frame_animated ?? 12) ? ` 🔒${U.frame_animated ?? 12}` : ""}
          </button>
        </div>
      </Row>

      <Row need={U.dota_gold ?? 10} name="Золотой /dota" desc="Твой зов «Газуем в дотан» — с короной и золотой рамкой. Включается сам.">
        <span style={{ ...mono, fontSize: 12, color: GOLD }}>👑 активен — просто напиши /dota</span>
      </Row>

      {err && <p style={{ ...mono, color: BLOOD, fontSize: 12, padding: "10px 14px", margin: 0 }}>{err}</p>}
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
