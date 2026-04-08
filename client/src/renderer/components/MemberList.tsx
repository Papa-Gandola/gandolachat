import React, { useState } from "react";
import { ChatOut, UserOut, userApi, chatApi } from "../services/api";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  onChatUpdate: (chat: ChatOut) => void;
  onDeleteChat?: () => void;
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function MemberList({ chat, currentUser, onChatUpdate, onDeleteChat }: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserOut[]>([]);

  if (!chat.is_group) return null;

  async function searchUsers(q: string) {
    setSearch(q);
    if (q.length < 2) { setResults([]); return; }
    const res = await userApi.search(q);
    setResults(res.data.filter((u) => !chat.members.find((m) => m.id === u.id)));
  }

  async function addMember(user: UserOut) {
    await chatApi.addMember(chat.id, user.id);
    onChatUpdate({ ...chat, members: [...chat.members, user] });
    setSearch(""); setResults([]);
  }

  return (
    <div style={s.root}>
      <div style={s.header}>УЧАСТНИКИ — {chat.members.length}/7</div>

      <div style={s.list}>
        {chat.members.map((m) => (
          <div key={m.id} style={s.member}>
            <Avatar name={m.username} url={m.avatar_url} />
            <span style={s.name}>{m.username}{m.id === currentUser.id ? " (вы)" : ""}</span>
          </div>
        ))}
      </div>

      {onDeleteChat && (
        <button style={s.deleteBtn} onClick={onDeleteChat}>Удалить группу</button>
      )}

      {chat.members.length < 7 && (
        <div style={s.addSection}>
          <input
            style={s.input}
            placeholder="Добавить участника..."
            value={search}
            onChange={(e) => searchUsers(e.target.value)}
          />
          {results.map((u) => (
            <div key={u.id} style={s.result} onClick={() => addMember(u)}>
              <Avatar name={u.username} url={u.avatar_url} />
              <span style={s.name}>{u.username}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const bg = colors[Math.abs(hash) % colors.length];

  return url ? (
    <img src={url.startsWith("http") ? url : `${BASE_URL}${url}`}
      style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} alt={name} />
  ) : (
    <div style={{ width: 32, height: 32, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { width: 200, background: "var(--bg-secondary)", display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)" },
  header: { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.05em", padding: "16px 12px 8px" },
  list: { flex: 1, overflowY: "auto", padding: "0 8px" },
  member: { display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderRadius: 4 },
  name: { color: "var(--text-primary)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  addSection: { padding: "8px" },
  input: { width: "100%", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: 12, color: "var(--text-primary)" },
  result: { display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", cursor: "pointer", borderRadius: 4 },
  deleteBtn: { margin: "8px", padding: "8px", background: "#ed4245", color: "#fff", borderRadius: 4, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" },
};
