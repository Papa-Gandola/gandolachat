import React, { useEffect, useState, useRef } from "react";
import { UserOut, userApi, chatApi } from "../services/api";
import { useTheme } from "../services/theme";
import DotaRankBadge from "./DotaRankBadge";
import { CompBadge, CompTitle, frameStyle, frameClass } from "./cosmetics";
import QRCode from "qrcode";

const BASE_URL = import.meta.env.VITE_API_URL || "https://2-26-117-77.sslip.io";

// QR ведёт на НАШ сервер: /apk зеркалирует свежий APK из релиза
// mobile-latest (GitHub-CDN у местных провайдеров виснет на хвосте
// закачки). Ссылка вечная — содержимое подменяет сам сервер.
const APK_URL = `${BASE_URL}/apk`;

interface Props {
  user: UserOut;
  currentUser: UserOut;
  onClose: () => void;
  onUpdate: (user: UserOut) => void;
}

export default function ProfilePage({ user: initialUser, currentUser, onClose, onUpdate }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [user, setUser] = useState<UserOut>(initialUser);
  const [editingName, setEditingName] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingAbout, setEditingAbout] = useState(false);
  const [nameVal, setNameVal] = useState(user.username);
  const [statusVal, setStatusVal] = useState(user.status || "");
  const [aboutVal, setAboutVal] = useState(user.about || "");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const isOwn = user.id === currentUser.id;

  useEffect(() => {
    // Re-fetch user from server
    if (user.id !== currentUser.id) {
      userApi.getUser(user.id).then((res) => setUser(res.data)).catch(() => {});
    } else {
      userApi.me().then((res) => setUser(res.data.user)).catch(() => {});
    }
  }, [initialUser.id]);

  async function saveName() {
    if (!nameVal.trim() || nameVal === user.username) { setEditingName(false); return; }
    try {
      const res = await userApi.updateProfile({ username: nameVal.trim() });
      setUser(res.data);
      onUpdate(res.data);
      setEditingName(false);
      setError("");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Ошибка");
    }
  }

  async function saveStatus() {
    try {
      const res = await userApi.updateProfile({ status: statusVal });
      setUser(res.data);
      onUpdate(res.data);
      setEditingStatus(false);
    } catch {}
  }

  async function saveAbout() {
    try {
      const res = await userApi.updateProfile({ about: aboutVal });
      setUser(res.data);
      onUpdate(res.data);
      setEditingAbout(false);
    } catch {}
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await userApi.uploadAvatar(file);
    setUser(res.data);
    onUpdate(res.data);
  }

  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let hash = 0;
  for (let i = 0; i < user.username.length; i++) hash = user.username.charCodeAt(i) + ((hash << 5) - hash);
  const bg = colors[Math.abs(hash) % colors.length];

  const neoLabel = (txt: string) => isNeo ? `// ${txt}` : txt;
  const neoInput: React.CSSProperties = isNeo ? { borderRadius: 0, fontFamily: "var(--font-mono)", border: "1px solid var(--accent)" } : {};
  const neoValueRow: React.CSSProperties = isNeo ? { borderRadius: 0, border: "1px solid var(--border)", background: "#0a0a0a" } : {};
  const neoBtn: React.CSSProperties = isNeo ? { borderRadius: 0, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" } : {};
  const neoAvatarWrap: React.CSSProperties = isNeo ? {
    borderRadius: 0,
    border: "2px solid var(--accent)",
    boxShadow: "0 0 16px rgba(198,255,61,0.3)",
  } : { borderRadius: "50%" };

  return (
    <div style={s.root}>
      <div style={{ ...s.header, ...(isNeo ? { borderBottomColor: "var(--accent)" } : {}) }}>
        <span style={{ ...s.title, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.1em" } : {}) }}>
          {isNeo ? "// ПРОФИЛЬ" : "Профиль"}
        </span>
        <button style={{ ...s.closeBtn, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={onClose}>✕</button>
      </div>

      <div style={s.content}>
        <div style={s.avatarSection}>
          <label style={{ cursor: isOwn ? "pointer" : "default", position: "relative", display: "block" }}>
            {user.avatar_url ? (
              <img src={user.avatar_url.startsWith("http") ? user.avatar_url : `${BASE_URL}${user.avatar_url}`}
                className={frameClass(user)}
                style={{ ...s.avatar, ...neoAvatarWrap, ...frameStyle(user) }} alt={user.username} />
            ) : (
              <div className={frameClass(user)} style={{ ...s.avatarFallback, ...neoAvatarWrap, ...frameStyle(user), background: isNeo ? "#0a0a0a" : bg, color: isNeo ? "var(--accent)" : "#fff", fontFamily: isNeo ? "var(--font-mono)" : undefined }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
            {isOwn && (
              <>
                <input type="file" accept="image/*" ref={fileRef} style={{ display: "none" }} onChange={uploadAvatar} />
                <div style={{ ...s.avatarEdit, ...mono, ...(isNeo ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, background: "rgba(10,10,10,0.85)", color: "var(--accent)", letterSpacing: "0.08em" } : {}) }}>
                  {isNeo ? "[СМЕНИТЬ]" : "Сменить"}
                </div>
              </>
            )}
          </label>
        </div>
        {(user.comp_title || user.comp_badge) && (
          <div style={{ textAlign: "center", marginTop: -14, marginBottom: 18 }}>
            <span style={{ color: user.comp_color || "var(--text-primary)", fontWeight: 700, fontSize: 14, ...(isNeo ? { fontFamily: "var(--font-mono)" } : {}) }}>
              {user.username}<CompBadge user={user} />
            </span>
            <CompTitle user={user} size={12} center />
          </div>
        )}

        <div style={s.field}>
          <label style={{ ...s.label, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }}>{neoLabel("НИКНЕЙМ")}</label>
          {editingName && isOwn ? (
            <div style={s.editRow}>
              <input
                style={{ ...s.input, ...neoInput }}
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                autoFocus
                maxLength={50}
              />
              <button style={{ ...s.saveBtn, ...neoBtn }} onClick={saveName}>{isNeo ? "[✓]" : "✓"}</button>
              <button style={{ ...s.cancelBtn, ...neoBtn }} onClick={() => setEditingName(false)}>{isNeo ? "[✕]" : "✕"}</button>
            </div>
          ) : (
            <div style={{ ...s.valueRow, ...neoValueRow }}>
              <span style={{ ...s.value, ...mono }}>{isNeo ? `@${user.username}` : user.username}</span>
              {isOwn && <button style={{ ...s.editBtn, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={() => { setNameVal(user.username); setEditingName(true); }}>{isNeo ? "[edit]" : "✏️"}</button>}
            </div>
          )}
          {error && <span style={{ ...s.error, ...mono }}>{error}</span>}
        </div>

        <div style={s.field}>
          <label style={{ ...s.label, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }}>{neoLabel("СТАТУС")}</label>
          {editingStatus && isOwn ? (
            <div style={s.editRow}>
              <input
                style={{ ...s.input, ...neoInput }}
                value={statusVal}
                onChange={(e) => setStatusVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveStatus(); if (e.key === "Escape") setEditingStatus(false); }}
                autoFocus
                maxLength={50}
                placeholder={isNeo ? "> отдыхаю_нафиг" : "отдыхаю нафиг"}
              />
              <button style={{ ...s.saveBtn, ...neoBtn }} onClick={saveStatus}>{isNeo ? "[✓]" : "✓"}</button>
              <button style={{ ...s.cancelBtn, ...neoBtn }} onClick={() => setEditingStatus(false)}>{isNeo ? "[✕]" : "✕"}</button>
            </div>
          ) : (
            <div style={{ ...s.valueRow, ...neoValueRow }}>
              <span style={{ ...s.value, ...mono, fontStyle: user.status ? "normal" : "italic", color: user.status ? "var(--text-primary)" : "var(--text-muted)" }}>
                {user.status || (isNeo ? "// не_задан" : "не задан")}
              </span>
              {isOwn && <button style={{ ...s.editBtn, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={() => { setStatusVal(user.status || ""); setEditingStatus(true); }}>{isNeo ? "[edit]" : "✏️"}</button>}
            </div>
          )}
        </div>

        <div style={s.field}>
          <label style={{ ...s.label, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }}>{neoLabel("О СЕБЕ")}</label>
          {editingAbout && isOwn ? (
            <div style={{ ...s.editRow, alignItems: "flex-start" }}>
              <textarea
                style={{ ...s.input, ...neoInput, minHeight: 80, resize: "vertical" }}
                value={aboutVal}
                onChange={(e) => setAboutVal(e.target.value)}
                maxLength={500}
                placeholder={isNeo ? "> расскажи_о_себе..." : "Расскажи о себе..."}
                autoFocus
              />
              <button style={{ ...s.saveBtn, ...neoBtn }} onClick={saveAbout}>{isNeo ? "[✓]" : "✓"}</button>
              <button style={{ ...s.cancelBtn, ...neoBtn }} onClick={() => setEditingAbout(false)}>{isNeo ? "[✕]" : "✕"}</button>
            </div>
          ) : (
            <div style={{ ...s.valueRow, ...neoValueRow }}>
              <span style={{ ...s.value, ...mono, whiteSpace: "pre-wrap" as const, fontStyle: user.about ? "normal" : "italic", color: user.about ? "var(--text-primary)" : "var(--text-muted)" }}>
                {user.about || (isNeo ? "// ничего_не_заполнено" : "ничего не заполнено")}
              </span>
              {isOwn && <button style={{ ...s.editBtn, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }} onClick={() => { setAboutVal(user.about || ""); setEditingAbout(true); }}>{isNeo ? "[edit]" : "✏️"}</button>}
            </div>
          )}
        </div>

        <DotaSection
          user={user}
          isOwn={isOwn}
          isNeo={isNeo}
          onUser={(u) => { setUser(u); onUpdate(u); }}
        />

        {user.last_seen && (
          <div style={s.field}>
            <label style={{ ...s.label, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }}>{neoLabel("ПОСЛЕДНИЙ ВИЗИТ")}</label>
            <div style={{ ...s.value, ...mono }}>
              {(() => {
                const d = new Date(user.last_seen);
                const diff = Math.floor((Date.now() - d.getTime()) / 1000);
                if (diff < 60) return "только что";
                if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
                if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
                return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
              })()}
            </div>
          </div>
        )}

        <div style={s.field}>
          <label style={{ ...s.label, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }}>{neoLabel("РЕЙТИНГ ГРАМОТНОСТИ")}</label>
          <div style={{ ...s.value, ...mono }}>
            {(user.grammar_errors || 0) === 0 ? "✅ пока идеально" : `❌ ошибок: ${user.grammar_errors}`}
          </div>
        </div>

        {isOwn && <MobileAppSection isNeo={isNeo} />}

        {isOwn && user.is_admin && (
          <AdminCleanup isNeo={isNeo} />
        )}
      </div>
    </div>
  );
}

function QrImg({ text, alt }: { text: string; alt: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { width: 264, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [text]);
  if (!src) return <div style={{ width: 132, height: 132 }} />;
  return <img src={src} alt={alt} width={132} height={132} style={{ display: "block" }} />;
}

function MobileAppSection({ isNeo }: { isNeo: boolean }) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [apkInfo, setApkInfo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("https://api.github.com/repos/Papa-Gandola/gandolachat/releases/tags/mobile-latest")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rel) => {
        if (!alive) return;
        const when = rel?.assets?.[0]?.updated_at;
        const date = when ? new Date(when).toLocaleDateString("ru-RU") : "";
        const line = [rel?.name, date && `от ${date}`].filter(Boolean).join(" · ");
        if (line) setApkInfo(line);
      })
      .catch((code) => {
        if (alive && code === 404) setApkInfo("сборка ещё готовится — QR заработает чуть позже");
      });
    return () => { alive = false; };
  }, []);

  const card: React.CSSProperties = {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    background: "var(--bg-secondary)", borderRadius: isNeo ? 0 : 6, padding: "14px 12px",
    ...(isNeo ? { border: "1px solid var(--border)" } : {}),
  };
  // QR остаётся чёрным на белом в любой теме — иначе камеры его не читают.
  const qrBox: React.CSSProperties = { background: "#fff", padding: 8, borderRadius: isNeo ? 0 : 4 };
  const cardTitle: React.CSSProperties = { ...mono, color: "var(--text-primary)", fontSize: 13, fontWeight: 700 };
  const hint: React.CSSProperties = { ...mono, color: "var(--text-muted)", fontSize: 11, textAlign: "center", lineHeight: 1.5 };

  return (
    <div style={s.field}>
      <label style={{ ...s.label, ...mono, ...(isNeo ? { color: "var(--accent)" } : {}) }}>
        {isNeo ? "// МОБИЛЬНАЯ_ВЕРСИЯ" : "МОБИЛЬНАЯ ВЕРСИЯ"}
      </label>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        <div style={card}>
          <span style={cardTitle}>🤖 Андроид</span>
          <div style={qrBox}><QrImg text={APK_URL} alt="QR: скачать APK" /></div>
          <span style={hint}>Наведи камеру — скачается свежий APK.<br />Ставится поверх старого, ничего не сотрётся.<br />Если качается плохо — попробуй с включённым VPN.</span>
          {apkInfo && <span style={{ ...hint, opacity: 0.8 }}>{apkInfo}</span>}
        </div>
        <div style={card}>
          <span style={cardTitle}>🍏 Айфон</span>
          <div style={qrBox}><QrImg text={`${BASE_URL}/app/`} alt="QR: открыть веб-версию" /></div>
          <span style={hint}>Открой в Safari, дальше «Поделиться» → «На экран „Домой“».</span>
        </div>
      </div>
    </div>
  );
}

function DotaSection({ user, isOwn, isNeo, onUser }: {
  user: UserOut;
  isOwn: boolean;
  isNeo: boolean;
  onUser: (u: UserOut) => void;
}) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const linked = !!user.dota_account_id;

  async function link() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await userApi.linkSteam(input.trim());
      onUser(res.data);
      setInput("");
    } catch (e: any) {
      setErr(e.response?.data?.detail || "Не получилось — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await userApi.refreshSteam();
      onUser(res.data);
    } catch (e: any) {
      setErr(e.response?.data?.detail || "Не получилось обновить");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await userApi.unlinkSteam();
      onUser(res.data);
      setConfirmUnlink(false);
    } catch (e: any) {
      setErr(e.response?.data?.detail || "Не получилось отвязать");
    } finally {
      setBusy(false);
    }
  }

  // Чужой профиль без привязки — секцию не показываем вовсе
  if (!isOwn && !linked) return null;

  const btn: React.CSSProperties = {
    background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)",
    borderRadius: isNeo ? 0 : 4, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", ...mono,
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: "block", color: isNeo ? "var(--accent)" : "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6, ...mono }}>
        {isNeo ? "// DOTA 2" : "DOTA 2"}
      </label>

      {linked ? (
        <div style={{ background: "var(--bg-secondary)", borderRadius: isNeo ? 0 : 6, border: isNeo ? "1px solid var(--border)" : "none", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {user.dota_rank_tier ? (
              <DotaRankBadge rankTier={user.dota_rank_tier} leaderboardRank={user.dota_leaderboard_rank} isNeo={isNeo} />
            ) : (
              <span style={{ ...mono, color: "var(--text-muted)", fontSize: 13, fontStyle: "italic" }}>
                звание пока не видно
              </span>
            )}
            <span style={{ ...mono, color: "var(--text-muted)", fontSize: 11 }}>
              ID {user.dota_account_id}
            </span>
          </div>
          {isOwn && !user.dota_rank_tier && (
            <span style={{ ...mono, color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.5 }}>
              Проверь в Доте: Настройки → Приватность → «Сделать общедоступной статистику матчей»,
              сыграй катку и нажми «Обновить»
            </span>
          )}
          {isOwn && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn} onClick={refresh} disabled={busy}>
                {busy ? "..." : isNeo ? "[ОБНОВИТЬ]" : "🔄 Обновить"}
              </button>
              {!confirmUnlink ? (
                <button style={{ ...btn, color: "var(--text-muted)" }} onClick={() => setConfirmUnlink(true)} disabled={busy}>
                  {isNeo ? "[ОТВЯЗАТЬ]" : "Отвязать"}
                </button>
              ) : (
                <>
                  <button style={{ ...btn, color: "#ed4245", borderColor: "#ed4245" }} onClick={unlink} disabled={busy}>
                    {isNeo ? "[ТОЧНО ОТВЯЗАТЬ]" : "Точно отвязать"}
                  </button>
                  <button style={btn} onClick={() => setConfirmUnlink(false)}>
                    {isNeo ? "[ОТМЕНА]" : "Отмена"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "var(--bg-secondary)", borderRadius: isNeo ? 0 : 6, border: isNeo ? "1px solid var(--border)" : "none", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...mono, color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.5 }}>
            Привяжи Steam — в профиле появится звание, а катки начнут засчитываться в Гандолиум ⛽
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              style={{ flex: 1, background: "var(--bg-tertiary)", border: `1px solid ${isNeo ? "var(--accent)" : "var(--border)"}`, borderRadius: isNeo ? 0 : 4, padding: "8px 12px", fontSize: 13, color: "var(--text-primary)", ...mono }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") link(); }}
              placeholder={isNeo ? "> ссылка_на_профиль_или_friend_id" : "Ссылка на Steam-профиль или Friend ID"}
              disabled={busy}
            />
            <button
              style={{ background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: isNeo ? 0 : 4, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", ...mono }}
              onClick={link}
              disabled={busy}
            >
              {busy ? "..." : isNeo ? "[ПРИВЯЗАТЬ]" : "Привязать"}
            </button>
          </div>
          <span style={{ ...mono, color: "var(--text-muted)", fontSize: 11 }}>
            Подойдёт: steamcommunity.com/profiles/…, ссылка Dotabuff/OpenDota или Friend ID из Доты
          </span>
        </div>
      )}
      {err && <span style={{ color: "#ed4245", fontSize: 12, marginTop: 6, display: "block", ...mono }}>{err}</span>}
    </div>
  );
}


function AdminCleanup({ isNeo }: { isNeo: boolean }) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    setResult(null);
    try {
      const res = await chatApi.adminDeleteOldMessages({ beforeDate: date });
      setResult(`Удалено: ${res.data.deleted}`);
    } catch (e: any) {
      setResult(`Ошибка: ${e.response?.data?.detail || e.message}`);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div style={{ ...cs.field, marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
      <label style={{ display: "block", color: isNeo ? "var(--accent)" : "var(--danger)", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6, ...mono }}>
        {isNeo ? "// АДМИН: ОЧИСТКА СООБЩЕНИЙ" : "АДМИН: ОЧИСТКА СООБЩЕНИЙ"}
      </label>
      <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 10, ...mono }}>
        Удалит все сообщения, созданные <b>до</b> выбранной даты.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          style={{
            background: "var(--bg-tertiary)",
            border: `1px solid ${isNeo ? "var(--accent)" : "var(--border)"}`,
            borderRadius: isNeo ? 0 : 4,
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--text-primary)",
            ...mono,
          }}
        />
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            style={{
              background: "transparent",
              color: isNeo ? "#ff3d6b" : "var(--danger)",
              border: `1px solid ${isNeo ? "#ff3d6b" : "var(--danger)"}`,
              borderRadius: isNeo ? 0 : 4,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: isNeo ? "0.05em" : undefined,
              cursor: "pointer",
              ...mono,
            }}
          >
            {isNeo ? "[ПОЧИСТИТЬ]" : "🗑 Почистить"}
          </button>
        ) : (
          <>
            <button
              onClick={doDelete}
              disabled={busy}
              style={{
                background: isNeo ? "#ff3d6b" : "var(--danger)",
                color: "#fff",
                border: "none",
                borderRadius: isNeo ? 0 : 4,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                ...mono,
              }}
            >
              {busy ? "..." : (isNeo ? "[ПОДТВЕРДИТЬ]" : "Подтвердить")}
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                background: "var(--bg-hover)",
                color: "var(--text-primary)",
                border: "none",
                borderRadius: isNeo ? 0 : 4,
                padding: "8px 14px",
                fontSize: 13,
                cursor: "pointer",
                ...mono,
              }}
            >
              {isNeo ? "[ОТМЕНА]" : "Отмена"}
            </button>
          </>
        )}
      </div>
      {result && (
        <p style={{ marginTop: 10, fontSize: 13, color: result.startsWith("Ошибка") ? "var(--danger)" : "var(--accent)", ...mono }}>
          {result}
        </p>
      )}
    </div>
  );
}

const cs: Record<string, React.CSSProperties> = {
  field: { marginBottom: 20 },
};

const s: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)", height: "100%" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" },
  title: { color: "var(--text-header)", fontWeight: 700, fontSize: 18 },
  closeBtn: { background: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", padding: 4 },
  content: { padding: 32, maxWidth: 600, width: "100%", margin: "0 auto", overflowY: "auto" as const },
  avatarSection: { display: "flex", justifyContent: "center", marginBottom: 24 },
  avatar: { width: 120, height: 120, borderRadius: "50%", objectFit: "cover" as const, display: "block" },
  avatarFallback: { width: 120, height: 120, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 48, fontWeight: 700 },
  avatarEdit: { position: "absolute" as const, bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.6)", color: "#fff", textAlign: "center" as const, padding: "4px 0", fontSize: 11, borderBottomLeftRadius: 60, borderBottomRightRadius: 60 },
  field: { marginBottom: 20 },
  label: { display: "block", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 6 },
  value: { color: "var(--text-primary)", fontSize: 15, display: "block" as const, userSelect: "text" as const },
  valueRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", borderRadius: 6, padding: "10px 14px" },
  editRow: { display: "flex", gap: 6, alignItems: "center" },
  input: { flex: 1, background: "var(--bg-tertiary)", border: "1px solid var(--accent)", borderRadius: 4, padding: "8px 12px", fontSize: 14, color: "var(--text-primary)" },
  editBtn: { background: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", padding: 4 },
  saveBtn: { background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: 4, padding: "8px 12px", fontSize: 14, cursor: "pointer" },
  cancelBtn: { background: "var(--bg-tertiary)", color: "var(--text-muted)", border: "none", borderRadius: 4, padding: "8px 12px", fontSize: 14, cursor: "pointer" },
  error: { color: "#ed4245", fontSize: 12, marginTop: 4, display: "block" as const },
};
