import React, { useState } from "react";
import { ChatOut, UserOut, userApi, chatApi } from "../services/api";
import { useTheme } from "../services/theme";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  onChatUpdate: (chat: ChatOut) => void;
  onDeleteChat?: () => void;
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function MemberList({ chat, currentUser, onChatUpdate, onDeleteChat }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
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
      <div style={{ ...s.header, ...mono, ...(isNeo ? { color: "var(--accent)", letterSpacing: "0.08em" } : {}) }}>
        {isNeo ? `// УЧАСТНИКИ [${chat.members.length}/7]` : `УЧАСТНИКИ — ${chat.members.length}/7`}
      </div>

      <div style={s.list}>
        {chat.members.map((m) => (
          <div key={m.id} style={{ ...s.member, ...(isNeo ? { borderRadius: 0 } : {}) }}>
            <Avatar name={m.username} url={m.avatar_url} isNeo={isNeo} />
            <span style={{ ...s.name, ...mono }}>
              {isNeo ? `@${m.username}` : m.username}
              {m.id === currentUser.id ? (isNeo ? "_you" : " (вы)") : ""}
            </span>
          </div>
        ))}
      </div>

      <button
        style={{ ...s.leaveBtn, ...mono, ...(isNeo ? { borderRadius: 0, background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)", letterSpacing: "0.05em" } : {}) }}
        onClick={async () => { await chatApi.leaveChat(chat.id); window.location.reload(); }}
      >
        {isNeo ? "[ПОКИНУТЬ_ГРУППУ]" : "Покинуть группу"}
      </button>

      {onDeleteChat && (
        <button
          style={{ ...s.deleteBtn, ...mono, ...(isNeo ? { borderRadius: 0, background: "transparent", border: "1px solid #ed4245", color: "#ed4245", letterSpacing: "0.05em" } : {}) }}
          onClick={onDeleteChat}
        >
          {isNeo ? "[УДАЛИТЬ_ГРУППУ]" : "Удалить группу"}
        </button>
      )}

      {chat.members.length < 7 && (
        <div style={s.addSection}>
          <input
            style={{ ...s.input, ...mono, ...(isNeo ? { borderRadius: 0, border: "1px solid var(--accent)" } : {}) }}
            placeholder={isNeo ? "> добавить_участника..." : "Добавить участника..."}
            value={search}
            onChange={(e) => searchUsers(e.target.value)}
          />
          {results.map((u) => (
            <div key={u.id} style={{ ...s.result, ...(isNeo ? { borderRadius: 0 } : {}) }} onClick={() => addMember(u)}>
              <Avatar name={u.username} url={u.avatar_url} isNeo={isNeo} />
              <span style={{ ...s.name, ...mono }}>{isNeo ? `@${u.username}` : u.username}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, url, isNeo }: { name: string; url: string | null; isNeo?: boolean }) {
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const bg = isNeo ? "#0a0a0a" : colors[Math.abs(hash) % colors.length];
  const radius = isNeo ? 6 : "50%";
  const border = isNeo ? "1px solid var(--accent)" : "none";
  const fg = isNeo ? "var(--accent)" : "#fff";

  return url ? (
    <img src={url.startsWith("http") ? url : `${BASE_URL}${url}`}
      style={{ width: 32, height: 32, borderRadius: radius, border, objectFit: "cover", flexShrink: 0 }} alt={name} />
  ) : (
    <div style={{ width: 32, height: 32, borderRadius: radius, border, background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: fg, fontWeight: 700, fontSize: 13, flexShrink: 0, fontFamily: isNeo ? "var(--font-mono)" : undefined }}>
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
  leaveBtn: { margin: "8px 8px 4px", padding: "8px", background: "var(--bg-active)", color: "var(--text-primary)", borderRadius: 4, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" },
  deleteBtn: { margin: "4px 8px 8px", padding: "8px", background: "#ed4245", color: "#fff", borderRadius: 4, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" },
};
