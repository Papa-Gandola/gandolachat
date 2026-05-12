import React, { useEffect, useRef, useState } from "react";
import { ChatOut, ChatStats, UserOut, chatApi } from "../services/api";
import { useTheme } from "../services/theme";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  onClose: () => void;
  onOpenSearch: () => void;
  onAddMember: () => void;
  onOpenUserProfile: (user: UserOut) => void;
}

export default function GroupInfoPage({ chat, currentUser, onClose, onOpenSearch, onAddMember, onOpenUserProfile }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};

  const isOwner = chat.created_by === currentUser.id;
  const admins = chat.admin_ids || [];
  const isAdmin = isOwner || admins.includes(currentUser.id);
  const memberCount = chat.members.length;
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<ChatStats>({ media_count: 0, link_count: 0, file_count: 0 });
  const [muted, setMuted] = useState(() => JSON.parse(localStorage.getItem("mutedChats") || "[]").includes(chat.id));
  const [banMode, setBanMode] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState(chat.description || "");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(chat.name || "");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatApi.stats(chat.id).then((res) => setStats(res.data)).catch(() => {});
    chatApi.getOnlineUsers().then((res) => setOnlineIds(new Set(res.data.online_user_ids))).catch(() => {});
  }, [chat.id]);

  const onlineCount = chat.members.filter((m) => onlineIds.has(m.id)).length;

  function toggleMute() {
    const list: number[] = JSON.parse(localStorage.getItem("mutedChats") || "[]");
    const next = muted ? list.filter((id) => id !== chat.id) : [...list, chat.id];
    localStorage.setItem("mutedChats", JSON.stringify(next));
    setMuted(!muted);
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await chatApi.uploadGroupAvatar(chat.id, f);
    } catch {}
    e.target.value = "";
  }

  async function saveDescription() {
    try {
      await chatApi.update(chat.id, { description: descDraft.trim() });
    } catch {}
    setEditingDescription(false);
  }

  async function saveName() {
    if (!nameDraft.trim()) { setEditingName(false); return; }
    try {
      await chatApi.update(chat.id, { name: nameDraft.trim() });
    } catch {}
    setEditingName(false);
  }

  async function kickMember(userId: number) {
    if (userId === chat.created_by) { alert("Нельзя удалить создателя"); return; }
    if (!confirm(`Удалить участника из группы?`)) return;
    try {
      await chatApi.kickMember(chat.id, userId);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Не удалось");
    }
  }

  async function toggleAdmin(userId: number) {
    if (!isOwner) return;
    const current = new Set(admins);
    if (current.has(userId)) current.delete(userId);
    else current.add(userId);
    try {
      await chatApi.update(chat.id, { admin_ids: Array.from(current) });
    } catch {}
  }

  const palette = isNeo ? {
    bg: "var(--bg-primary)",
    text: "var(--text-primary)",
    label: "var(--accent)",
    muted: "var(--text-muted)",
    border: "var(--border)",
    accent: "var(--accent)",
    accentText: "var(--accent-text)",
    radius: 0 as const,
  } : {
    bg: "var(--bg-primary)",
    text: "var(--text-primary)",
    label: "var(--text-muted)",
    muted: "var(--text-muted)",
    border: "var(--border)",
    accent: "var(--accent)",
    accentText: "var(--accent-text)",
    radius: 8 as const,
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: palette.bg, height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${palette.border}` }}>
        <button onClick={onClose} title="Назад" style={{ background: "none", color: palette.text, fontSize: 22, padding: 4, cursor: "pointer" }}>‹</button>
        <span style={{ ...mono, marginLeft: 8, flex: 1, color: isNeo ? palette.accent : palette.text, letterSpacing: isNeo ? "0.08em" : undefined, fontWeight: 700 }}>
          {isNeo ? "// ИНФО_О_ЧАТЕ" : "Информация о чате"}
        </span>
      </div>

      <div style={{ padding: 24, maxWidth: 600, width: "100%", margin: "0 auto" }}>
        {/* Avatar */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <label style={{ position: "relative", cursor: isOwner ? "pointer" : "default" }}>
            {chat.avatar_url ? (
              <img
                src={chat.avatar_url.startsWith("http") ? chat.avatar_url : `${BASE_URL}${chat.avatar_url}`}
                style={{
                  width: 140, height: 140,
                  borderRadius: isNeo ? 12 : "50%",
                  border: isNeo ? "3px solid var(--accent)" : "none",
                  boxShadow: isNeo ? "0 0 20px rgba(198,255,61,0.35)" : undefined,
                  objectFit: "cover" as const,
                }}
              />
            ) : (
              <div style={{
                width: 140, height: 140,
                borderRadius: isNeo ? 12 : "50%",
                background: isNeo ? "#3a2914" : "#5865f2",
                border: isNeo ? "3px solid var(--accent)" : "none",
                boxShadow: isNeo ? "0 0 20px rgba(198,255,61,0.35)" : undefined,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 64, fontWeight: 700, color: isNeo ? "var(--accent)" : "#fff",
                fontFamily: isNeo ? "var(--font-mono)" : undefined,
              }}>#</div>
            )}
            {isOwner && <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadAvatar} />}
          </label>
        </div>

        {/* Name (editable for owner) */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          {editingName ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                autoFocus
                maxLength={100}
                style={{ ...mono, fontSize: 22, fontWeight: 700, background: "var(--bg-tertiary)", color: palette.text, border: `1px solid ${palette.accent}`, padding: "6px 10px", borderRadius: palette.radius, textAlign: "center" as const }}
              />
              <button onClick={saveName} style={{ ...mono, background: palette.accent, color: palette.accentText, border: "none", padding: "6px 12px", borderRadius: palette.radius, cursor: "pointer" }}>✓</button>
            </div>
          ) : (
            <h2
              onClick={() => isOwner && setEditingName(true)}
              style={{
                ...mono,
                fontSize: 24, fontWeight: 700, color: palette.text, letterSpacing: isNeo ? "0.02em" : undefined,
                cursor: isOwner ? "pointer" : "default",
              }}
              title={isOwner ? "Изменить" : ""}
            >{chat.name || "Без названия"}</h2>
          )}
          <div style={{ ...mono, color: palette.muted, fontSize: 13, marginTop: 4 }}>
            {isNeo ? `// ${memberCount} участников · ${onlineCount} в сети` : `${memberCount} участников · ${onlineCount} в сети`}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, marginBottom: 20 }}>
          <ActionBtn isNeo={isNeo} icon={muted ? "🔕" : "🔔"} label="MUTE" active={muted} onClick={toggleMute} />
          <ActionBtn isNeo={isNeo} icon="🔍" label="SEARCH" onClick={onOpenSearch} />
          <ActionBtn isNeo={isNeo} icon="↗" label="ADD" onClick={onAddMember} disabled={!isAdmin || memberCount >= 7} />
          {isAdmin && (
            <ActionBtn isNeo={isNeo} icon="⚠" label="BAN" active={banMode} onClick={() => setBanMode((v) => !v)} />
          )}
        </div>

        {/* Description */}
        <SectionLabel isNeo={isNeo}>ОПИСАНИЕ</SectionLabel>
        {editingDescription ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              maxLength={1000}
              autoFocus
              rows={3}
              style={{ ...mono, padding: "8px 12px", background: "var(--bg-tertiary)", color: palette.text, border: `1px solid ${palette.accent}`, borderRadius: palette.radius, resize: "vertical" as const, fontSize: 13 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveDescription} style={{ ...mono, background: palette.accent, color: palette.accentText, border: "none", padding: "6px 14px", borderRadius: palette.radius, cursor: "pointer", fontSize: 13 }}>{isNeo ? "[СОХРАНИТЬ]" : "Сохранить"}</button>
              <button onClick={() => { setEditingDescription(false); setDescDraft(chat.description || ""); }} style={{ ...mono, background: "var(--bg-hover)", color: palette.text, border: "none", padding: "6px 14px", borderRadius: palette.radius, cursor: "pointer", fontSize: 13 }}>{isNeo ? "[ОТМЕНА]" : "Отмена"}</button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => isOwner && setEditingDescription(true)}
            style={{ ...mono, color: chat.description ? palette.text : palette.muted, marginBottom: 16, fontSize: 14, lineHeight: 1.5, cursor: isOwner ? "pointer" : "default", fontStyle: chat.description ? "normal" as const : "italic" as const }}
            title={isOwner ? "Изменить описание" : ""}
          >
            {chat.description || (isOwner ? "Добавь описание группы…" : "Описание не задано")}
          </p>
        )}

        {/* Stats */}
        <SectionLabel isNeo={isNeo}>МЕДИА · ССЫЛКИ · ФАЙЛЫ</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
          <StatCard isNeo={isNeo} value={stats.media_count} label="МЕДИА" />
          <StatCard isNeo={isNeo} value={stats.link_count} label="ССЫЛОК" />
          <StatCard isNeo={isNeo} value={stats.file_count} label="ФАЙЛОВ" />
        </div>

        {/* Members */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <SectionLabel isNeo={isNeo}>{`УЧАСТНИКИ · ${memberCount}`}</SectionLabel>
          {isAdmin && memberCount < 7 && (
            <button
              onClick={onAddMember}
              style={{ ...mono, background: "none", color: palette.accent, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: isNeo ? "0.05em" : undefined }}
            >
              {isNeo ? "+ ДОБАВИТЬ" : "+ Добавить"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {chat.members.map((m) => {
            const role = m.id === chat.created_by ? "OWNER" : admins.includes(m.id) ? "ADMIN" : null;
            const isOnline = onlineIds.has(m.id);
            return (
              <div
                key={m.id}
                onClick={() => {
                  if (banMode && m.id !== chat.created_by && m.id !== currentUser.id) {
                    kickMember(m.id);
                  } else {
                    onOpenUserProfile(m);
                  }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 6px",
                  borderRadius: palette.radius,
                  cursor: "pointer",
                  background: "transparent",
                  border: banMode && m.id !== chat.created_by && m.id !== currentUser.id
                    ? "1px solid var(--danger)" : "1px solid transparent",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <MemberAvatar user={m} online={isOnline} isNeo={isNeo} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...mono, color: palette.text, fontSize: 14, fontWeight: 600 }}>{m.username}</div>
                  <div style={{ ...mono, color: isOnline ? "var(--success)" : palette.muted, fontSize: 11, marginTop: 1 }}>
                    {isOnline ? (isNeo ? "● в сети" : "● в сети") : (isNeo ? "// оффлайн" : "оффлайн")}
                  </div>
                </div>
                {role && (
                  <span style={{
                    ...mono,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                    padding: "3px 8px",
                    border: `1px solid ${palette.border}`,
                    borderRadius: isNeo ? 0 : 4,
                    color: role === "OWNER" ? palette.accent : palette.text,
                  }}>{role}</span>
                )}
                {isOwner && m.id !== chat.created_by && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleAdmin(m.id); }}
                    title={admins.includes(m.id) ? "Снять админа" : "Сделать админом"}
                    style={{
                      ...mono, background: "none", color: palette.muted,
                      border: `1px solid ${palette.border}`,
                      borderRadius: isNeo ? 0 : 4, padding: "2px 6px",
                      fontSize: 10, cursor: "pointer",
                    }}
                  >
                    {admins.includes(m.id) ? "−" : "+"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, isNeo }: { children: React.ReactNode; isNeo: boolean }) {
  return (
    <div style={{
      fontFamily: isNeo ? "var(--font-mono)" : undefined,
      color: isNeo ? "var(--accent)" : "var(--text-muted)",
      fontSize: 11, fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase" as const,
      marginBottom: 6,
      marginTop: 6,
    }}>
      {isNeo ? `// ${children}` : children}
    </div>
  );
}

function StatCard({ value, label, isNeo }: { value: number; label: string; isNeo: boolean }) {
  return (
    <div style={{
      padding: "12px 14px",
      background: isNeo ? "transparent" : "var(--bg-secondary)",
      border: `1px solid ${isNeo ? "var(--accent)" : "var(--border)"}`,
      borderRadius: isNeo ? 0 : 8,
      textAlign: "left" as const,
      fontFamily: isNeo ? "var(--font-mono)" : undefined,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-header)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, active, disabled, isNeo }: {
  icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; isNeo: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 64, height: 64,
        background: active
          ? (isNeo ? "rgba(198,255,61,0.15)" : "rgba(88,101,242,0.18)")
          : (isNeo ? "transparent" : "var(--bg-secondary)"),
        border: `1px solid ${active ? "var(--accent)" : (isNeo ? "var(--border-strong)" : "var(--border)")}`,
        borderRadius: isNeo ? 0 : 8,
        color: active ? "var(--accent)" : "var(--text-primary)",
        fontFamily: isNeo ? "var(--font-mono)" : undefined,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 10, letterSpacing: 1, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

function MemberAvatar({ user, online, isNeo }: { user: UserOut; online: boolean; isNeo: boolean }) {
  const size = 36;
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let h = 0;
  for (let i = 0; i < user.username.length; i++) h = user.username.charCodeAt(i) + ((h << 5) - h);
  const bg = isNeo ? "#0a0a0a" : colors[Math.abs(h) % colors.length];
  const radius = isNeo ? 6 : "50%";
  return (
    <div style={{ position: "relative" as const, flexShrink: 0 }}>
      {user.avatar_url ? (
        <img
          src={user.avatar_url.startsWith("http") ? user.avatar_url : `${BASE_URL}${user.avatar_url}`}
          style={{ width: size, height: size, borderRadius: radius as any, objectFit: "cover" as const }}
        />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: radius as any, background: bg,
          color: isNeo ? "var(--accent)" : "#fff", fontWeight: 700, fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: isNeo ? "1px solid var(--accent)" : undefined,
          fontFamily: isNeo ? "var(--font-mono)" : undefined,
        }}>{user.username.charAt(0).toUpperCase()}</div>
      )}
      {online && (
        <div style={{
          position: "absolute", bottom: -1, right: -1,
          width: 10, height: 10, borderRadius: isNeo ? 0 : "50%",
          background: "var(--success)",
          boxShadow: `0 0 0 2px var(--bg-primary)${isNeo ? ", 0 0 4px var(--success)" : ""}`,
        }} />
      )}
    </div>
  );
}
