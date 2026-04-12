import React, { useState, useEffect } from "react";
import { ChatOut, UserOut, chatApi, userApi, authApi, getFileUrl } from "../services/api";
import { wsService } from "../services/ws";

interface Props {
  chats: ChatOut[];
  currentUser: UserOut;
  activeChatId: number | null;
  onSelectChat: (chat: ChatOut) => void;
  onChatsUpdate: (chats: ChatOut[]) => void;
  onLogout: () => void;
  onAvatarUpdate: (user: UserOut) => void;
  onOpenProfile: () => void;
  width?: number;
}

export default function Sidebar({
  chats, currentUser, activeChatId, onSelectChat, onChatsUpdate, onLogout, onAvatarUpdate, onOpenProfile, width = 240
}: Props) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserOut[]>([]);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedForGroup, setSelectedForGroup] = useState<UserOut[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [pendingUsers, setPendingUsers] = useState<Array<{ id: number; username: string; created_at: string }>>([]);
  const [showPending, setShowPending] = useState(false);
  const isAdmin = currentUser.username === "Papa Gandola";
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updatePercent, setUpdatePercent] = useState(0);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [newName, setNewName] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
  const [unread, setUnread] = useState<Map<number, number>>(new Map());
  const [activeCalls, setActiveCalls] = useState<Set<number>>(new Set());

  useEffect(() => {
    const electron = (window as any).electron;
    if (electron?.onUpdateStatus) {
      electron.onUpdateStatus((status: string, info?: any) => {
        setUpdateStatus(status);
        if (status === "downloading") setUpdatePercent(info?.percent || 0);
        if (status === "not-available") {
          setShowUpdateBanner(true);
          setTimeout(() => setShowUpdateBanner(false), 3000);
        }
      });
    }
  }, []);

  useEffect(() => {
    chatApi.getOnlineUsers().then((res) => setOnlineUsers(new Set(res.data.online_user_ids)));
    if (isAdmin) {
      authApi.getPendingUsers().then((res) => setPendingUsers(res.data)).catch(() => {});
    }
    chatApi.getUnreadCounts().then((res) => {
      const m = new Map<number, number>();
      Object.entries(res.data).forEach(([k, v]) => m.set(Number(k), v));
      setUnread(m);
    }).catch(() => {});

    const onOnline = (data: any) => setOnlineUsers((prev) => new Set([...prev, data.user_id]));
    const onOffline = (data: any) => setOnlineUsers((prev) => { const n = new Set(prev); n.delete(data.user_id); return n; });
    const onMsg = (data: any) => {
      if (data.chat_id !== activeChatId && data.sender_id !== currentUser.id) {
        setUnread((prev) => new Map(prev).set(data.chat_id, (prev.get(data.chat_id) || 0) + 1));
      }
    };

    const onCallActive = (data: any) => setActiveCalls((prev) => new Set([...prev, data.chat_id]));
    const onCallEnd = (data: any) => setActiveCalls((prev) => { const n = new Set(prev); n.delete(data.chat_id); return n; });

    wsService.on("user_online", onOnline);
    wsService.on("user_offline", onOffline);
    wsService.on("message", onMsg);
    wsService.on("call_active", onCallActive);
    wsService.on("call_end", onCallEnd);
    return () => {
      wsService.off("user_online", onOnline);
      wsService.off("user_offline", onOffline);
      wsService.off("message", onMsg);
      wsService.off("call_active", onCallActive);
      wsService.off("call_end", onCallEnd);
    };
  }, [activeChatId, currentUser.id]);

  function selectChat(chat: ChatOut) {
    setUnread((prev) => { const n = new Map(prev); n.delete(chat.id); return n; });
    onSelectChat(chat);
  }

  function isOtherOnline(chat: ChatOut): boolean {
    if (chat.is_group) return false;
    const other = chat.members.find((m) => m.id !== currentUser.id);
    return other ? onlineUsers.has(other.id) : false;
  }

  async function handleSearch(q: string) {
    setSearch(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    const res = await userApi.search(q.trim());
    setSearchResults(res.data);
  }

  async function openDm(user: UserOut) {
    const res = await chatApi.createDm(user.id);
    const newChat = res.data;
    const exists = chats.find((c) => c.id === newChat.id);
    if (!exists) onChatsUpdate([newChat, ...chats]);
    onSelectChat(newChat);
    setSearch(""); setSearchResults([]);
  }

  async function createGroup() {
    if (!groupName.trim() || selectedForGroup.length === 0) return;
    const res = await chatApi.createGroup(groupName.trim(), selectedForGroup.map((u) => u.id));
    onChatsUpdate([res.data, ...chats]);
    onSelectChat(res.data);
    setShowNewGroup(false); setGroupName(""); setSelectedForGroup([]);
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await userApi.uploadAvatar(file);
    onAvatarUpdate(res.data);
  }

  function getChatName(chat: ChatOut): string {
    if (chat.is_group) return chat.name || "Группа";
    const other = chat.members.find((m) => m.id !== currentUser.id);
    return other?.username || "Неизвестный";
  }

  function getChatAvatar(chat: ChatOut): string | null {
    if (chat.is_group) return null;
    const other = chat.members.find((m) => m.id !== currentUser.id);
    return other?.avatar_url || null;
  }

  function getInitial(name: string) {
    return name.charAt(0).toUpperCase();
  }

  function renderChatItem(chat: ChatOut) {
    const name = getChatName(chat);
    const avatarUrl = getChatAvatar(chat);
    const isActive = chat.id === activeChatId;
    const online = isOtherOnline(chat);
    const unreadCount = unread.get(chat.id) || 0;
    const hasActiveCall = activeCalls.has(chat.id);
    return (
      <div
        key={chat.id}
        style={{ ...s.chatItem, background: isActive ? "var(--bg-active)" : "transparent" }}
        onClick={() => selectChat(chat)}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <Avatar url={avatarUrl} name={name} size={32} isGroup={chat.is_group} />
          {online && <div style={s.onlineDot} />}
        </div>
        <div style={s.chatInfo}>
          <span style={s.chatName}>{name}</span>
          {hasActiveCall ? (
            <span style={s.callIndicator}>📞 Звонок...</span>
          ) : chat.last_message ? (
            <span style={s.chatPreview}>
              {chat.last_message.content || chat.last_message.file_name || "Файл"}
            </span>
          ) : null}
        </div>
        {unreadCount > 0 && <span style={s.unreadBadge}>{unreadCount}</span>}
      </div>
    );
  }

  return (
    <div style={{ ...s.root, width }}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>GandolaChat</span>
      </div>

      {/* Admin: pending users */}
      {isAdmin && pendingUsers.length > 0 && (
        <div style={s.pendingBtn} onClick={() => setShowPending(!showPending)}>
          📋 Заявки ({pendingUsers.length})
        </div>
      )}
      {showPending && pendingUsers.length > 0 && (
        <div style={s.pendingList}>
          {pendingUsers.map((u) => (
            <div key={u.id} style={s.pendingItem}>
              <span style={s.pendingName}>{u.username}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={s.approveBtn} onClick={async () => {
                  await authApi.approveUser(u.id);
                  setPendingUsers((prev) => prev.filter((p) => p.id !== u.id));
                }}>✓</button>
                <button style={s.rejectBtn2} onClick={async () => {
                  await authApi.rejectUser(u.id);
                  setPendingUsers((prev) => prev.filter((p) => p.id !== u.id));
                }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div style={s.searchWrap}>
        <input
          style={s.searchInput}
          placeholder="Найти пользователя..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div style={s.searchDropdown}>
          {searchResults.map((u) => (
            <div key={u.id} style={s.searchItem} onClick={() => openDm(u)}>
              <Avatar url={u.avatar_url} name={u.username} size={28} />
              <span style={s.searchName}>{u.username}</span>
            </div>
          ))}
        </div>
      )}

      {/* New group form */}
      {showNewGroup && (
        <div style={s.groupForm}>
          <input
            style={s.groupInput}
            placeholder="Название группы..."
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <input
            style={{ ...s.groupInput, marginTop: 6 }}
            placeholder="Добавить участников..."
            onChange={async (e) => {
              const q = e.target.value;
              if (q.length >= 2) {
                const res = await userApi.search(q);
                setSearchResults(res.data);
              }
            }}
          />
          {searchResults.map((u) => (
            <div key={u.id} style={s.groupUserRow} onClick={() => {
              if (!selectedForGroup.find((x) => x.id === u.id)) {
                setSelectedForGroup([...selectedForGroup, u]);
              }
            }}>
              <Avatar url={u.avatar_url} name={u.username} size={24} />
              <span style={{ color: "var(--text-primary)", fontSize: 13 }}>{u.username}</span>
            </div>
          ))}
          {selectedForGroup.length > 0 && (
            <div style={s.selectedTags}>
              {selectedForGroup.map((u) => (
                <span key={u.id} style={s.tag}>
                  {u.username}
                  <span style={s.tagX} onClick={() => setSelectedForGroup(selectedForGroup.filter(x => x.id !== u.id))}>×</span>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={s.btnSm} onClick={createGroup}>Создать</button>
            <button style={{ ...s.btnSm, background: "var(--bg-hover)" }} onClick={() => { setShowNewGroup(false); setSearchResults([]); }}>Отмена</button>
          </div>
        </div>
      )}

      {/* Chat list */}
      <div style={s.chatList}>
        {/* Groups section */}
        {chats.some((c) => c.is_group) && (
          <div style={s.sectionHeader}>
            <span style={s.sectionTitle}>ГРУППЫ</span>
          </div>
        )}
        {chats.filter((c) => c.is_group).map((chat) => renderChatItem(chat))}

        {/* DMs section */}
        <div style={s.sectionHeader}>
          <span style={s.sectionTitle}>ЛИЧНЫЕ СООБЩЕНИЯ</span>
          <button style={s.newGroupBtn} title="Создать группу" onClick={() => setShowNewGroup(true)}>+</button>
        </div>
        {chats.filter((c) => !c.is_group).map((chat) => renderChatItem(chat))}
      </div>

      {/* Update banner */}
      {showUpdateBanner && updateStatus === "not-available" && (
        <div style={s.updateBanner}>У вас последняя версия, че ты тут забыл</div>
      )}
      {updateStatus === "downloading" && (
        <div style={s.updateBannerDownload}>Загрузка обновления... {updatePercent}%</div>
      )}
      {updateStatus === "ready" && (
        <div style={s.updateBannerReady}>
          <span>Обновление готово!</span>
          <button style={s.updateInstallBtn} onClick={() => (window as any).electron?.installUpdate()}>Обновить сейчас</button>
        </div>
      )}

      {/* User panel */}
      <div style={s.userPanel}>
        <label style={{ cursor: "pointer" }}>
          <Avatar url={currentUser.avatar_url} name={currentUser.username} size={32} />
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={uploadAvatar} />
        </label>
        <div style={s.userInfo} onClick={onOpenProfile} role="button">
          <span style={s.userName}>{currentUser.username}</span>
          <span style={s.userSub}>{currentUser.status || "v1.1.0"}</span>
        </div>
        <button style={s.settingsBtn} title="Профиль" onClick={onOpenProfile}>✏️</button>
        <button style={s.settingsBtn} title="Проверить обновления" onClick={() => {
          setUpdateStatus(null);
          setShowUpdateBanner(false);
          (window as any).electron?.checkForUpdates();
        }}>🔄</button>
        <button style={s.logoutBtn} title="Выйти" onClick={onLogout}>⎋</button>
      </div>
    </div>
  );
}

function Avatar({ url, name, size, isGroup }: { url: string | null; name: string; size: number; isGroup?: boolean }) {
  const bg = isGroup ? "#5865f2" : stringToColor(name);
  return url ? (
    <img
      src={url.startsWith("http") ? url : `${import.meta.env.VITE_API_URL || "http://localhost:8000"}${url}`}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      alt={name}
    />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.42, flexShrink: 0,
    }}>
      {isGroup ? "#" : name.charAt(0).toUpperCase()}
    </div>
  );
}

function stringToColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  return colors[Math.abs(hash) % colors.length];
}

const s: Record<string, React.CSSProperties> = {
  root: { background: "var(--bg-secondary)", display: "flex", flexDirection: "column", height: "100%", flexShrink: 0 },
  header: { padding: "16px 16px 8px", borderBottom: "1px solid var(--border)" },
  headerTitle: { color: "var(--text-header)", fontWeight: 700, fontSize: 15 },
  pendingBtn: { margin: "4px 12px", padding: "8px 12px", background: "#faa61a", color: "#000", borderRadius: 4, fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" as const },
  pendingList: { margin: "0 8px 4px", background: "var(--bg-tertiary)", borderRadius: 4, overflow: "hidden" },
  pendingItem: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)" },
  pendingName: { color: "var(--text-primary)", fontSize: 13, fontWeight: 500 },
  approveBtn: { background: "#3ba55d", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 14, cursor: "pointer", fontWeight: 700 },
  rejectBtn2: { background: "#ed4245", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 14, cursor: "pointer", fontWeight: 700 },
  searchWrap: { padding: "8px 12px" },
  searchInput: { width: "100%", background: "var(--bg-tertiary)", borderRadius: 4, padding: "6px 10px", fontSize: 13, color: "var(--text-primary)", border: "none" },
  searchDropdown: { background: "var(--bg-tertiary)", margin: "0 8px", borderRadius: 4, overflow: "hidden" },
  searchItem: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" },
  searchName: { color: "var(--text-primary)", fontSize: 13 },
  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 4px" },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.05em" },
  newGroupBtn: { background: "none", color: "var(--text-muted)", fontSize: 18, padding: "0 4px", lineHeight: 1 },
  groupForm: { padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 },
  groupInput: { background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: 13, color: "var(--text-primary)", width: "100%" },
  groupUserRow: { display: "flex", alignItems: "center", gap: 6, padding: "4px 0", cursor: "pointer" },
  selectedTags: { display: "flex", flexWrap: "wrap", gap: 4 },
  tag: { background: "var(--accent)", color: "#fff", borderRadius: 12, padding: "2px 8px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 },
  tagX: { cursor: "pointer", fontWeight: 700 },
  btnSm: { background: "var(--accent)", color: "#fff", borderRadius: 4, padding: "5px 12px", fontSize: 13, fontWeight: 600 },
  chatList: { flex: 1, overflowY: "auto", padding: "4px 8px" },
  chatItem: { display: "flex", alignItems: "center", gap: 10, padding: "8px", borderRadius: 4, cursor: "pointer", transition: "background 0.1s", position: "relative" as const },
  onlineDot: { position: "absolute" as const, bottom: -1, right: -1, width: 10, height: 10, borderRadius: "50%", background: "#57f287", border: "2px solid var(--bg-secondary)" },
  unreadBadge: { background: "var(--danger, #ed4245)", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  chatInfo: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  chatName: { color: "var(--text-primary)", fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chatPreview: { color: "var(--text-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  callIndicator: { color: "#57f287", fontSize: 12, fontWeight: 600 },
  userPanel: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-tertiary)", borderTop: "1px solid var(--border)" },
  userInfo: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  userName: { color: "var(--text-header)", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  userSub: { color: "var(--text-muted)", fontSize: 10 },
  settingsBtn: { background: "none", color: "var(--text-muted)", fontSize: 14, padding: "2px", cursor: "pointer" },
  editNameInput: { flex: 1, background: "var(--bg-tertiary)", border: "1px solid var(--accent)", borderRadius: 4, padding: "4px 6px", fontSize: 12, color: "var(--text-primary)", minWidth: 0, width: "100%" },
  editNameSave: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, padding: "4px 6px", fontSize: 12, cursor: "pointer", flexShrink: 0 },
  logoutBtn: { background: "none", color: "var(--text-muted)", fontSize: 18 },
  updateBanner: { background: "#5865f2", color: "#fff", padding: "8px 12px", fontSize: 11, textAlign: "center" as const, fontWeight: 600 },
  updateBannerDownload: { background: "#faa61a", color: "#000", padding: "8px 12px", fontSize: 11, textAlign: "center" as const, fontWeight: 600 },
  updateBannerReady: { background: "#3ba55d", color: "#fff", padding: "8px 12px", fontSize: 11, textAlign: "center" as const, display: "flex", alignItems: "center", justifyContent: "space-between" },
  updateInstallBtn: { background: "#fff", color: "#3ba55d", border: "none", borderRadius: 4, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" },
};
