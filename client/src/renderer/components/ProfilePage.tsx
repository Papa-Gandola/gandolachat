import React, { useEffect, useState, useRef } from "react";
import { UserOut, userApi } from "../services/api";
import { useTheme } from "../services/theme";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
      userApi.me().then((res) => setUser(res.data)).catch(() => {});
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
                style={{ ...s.avatar, ...neoAvatarWrap }} alt={user.username} />
            ) : (
              <div style={{ ...s.avatarFallback, ...neoAvatarWrap, background: isNeo ? "#0a0a0a" : bg, color: isNeo ? "var(--accent)" : "#fff", fontFamily: isNeo ? "var(--font-mono)" : undefined }}>
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
      </div>
    </div>
  );
}

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
  value: { color: "var(--text-primary)", fontSize: 15, display: "block" as const },
  valueRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", borderRadius: 6, padding: "10px 14px" },
  editRow: { display: "flex", gap: 6, alignItems: "center" },
  input: { flex: 1, background: "var(--bg-tertiary)", border: "1px solid var(--accent)", borderRadius: 4, padding: "8px 12px", fontSize: 14, color: "var(--text-primary)" },
  editBtn: { background: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", padding: 4 },
  saveBtn: { background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: 4, padding: "8px 12px", fontSize: 14, cursor: "pointer" },
  cancelBtn: { background: "var(--bg-tertiary)", color: "var(--text-muted)", border: "none", borderRadius: 4, padding: "8px 12px", fontSize: 14, cursor: "pointer" },
  error: { color: "#ed4245", fontSize: 12, marginTop: 4, display: "block" as const },
};
