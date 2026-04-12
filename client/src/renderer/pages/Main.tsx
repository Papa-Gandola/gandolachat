import React, { useEffect, useState } from "react";
import { ChatOut, UserOut, chatApi } from "../services/api";
import { wsService } from "../services/ws";
import { webrtcService } from "../services/webrtc";
import { playCallRing } from "../services/sounds";
import Sidebar from "../components/Sidebar";
import ChatArea from "../components/ChatArea";
import MemberList from "../components/MemberList";
import VideoCall from "../components/VideoCall";
import ProfilePage from "../components/ProfilePage";

interface Props {
  token: string;
  user: UserOut;
  onLogout: () => void;
}

export default function Main({ token, user, onLogout }: Props) {
  const [chats, setChats] = useState<ChatOut[]>([]);
  const [activeChat, setActiveChat] = useState<ChatOut | null>(null);
  const [currentUser, setCurrentUser] = useState<UserOut>(user);
  const [incomingCalls, setIncomingCalls] = useState<Array<{ chatId: number; fromUserId: number }>>([]);
  const [callChat, setCallChat] = useState<ChatOut | null>(null);
  const [callInitiator, setCallInitiator] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<UserOut | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [resizing, setResizing] = useState(false);
  const [connQuality, setConnQuality] = useState<string>("good");
  const [connPing, setConnPing] = useState(0);
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  useEffect(() => {
    wsService.connect(token);
    wsService.onQualityChange = (q, p) => { setConnQuality(q); setConnPing(p); };
    webrtcService.init(user.id);
    chatApi.list().then((res) => setChats(res.data));

    wsService.on("new_chat", async () => {
      const res = await chatApi.list();
      setChats(res.data);
    });

    wsService.on("message", (data) => {
      setChats((prev) =>
        prev.map((c) =>
          c.id === data.chat_id ? { ...c, last_message: data } : c
        )
      );
    });

    wsService.on("profile_updated", (data) => {
      setChats((prev) => prev.map((c) => ({
        ...c,
        members: c.members.map((m) => m.id === data.user_id ? { ...m, username: data.username, avatar_url: data.avatar_url, status: data.status } : m),
      })));
      if (data.user_id === user.id) {
        setCurrentUser((prev) => ({ ...prev, username: data.username, avatar_url: data.avatar_url, status: data.status }));
      }
    });

    wsService.on("chat_deleted", (data) => {
      setChats((prev) => prev.filter((c) => c.id !== data.chat_id));
      setActiveChat((prev) => prev?.id === data.chat_id ? null : prev);
    });

    wsService.on("call_signal", (data) => {
      if (webrtcService.isInCall()) return;
      setIncomingCalls((prev) => {
        if (prev.some((c) => c.chatId === data.chat_id)) return prev;
        playCallRing();
        return [...prev, { chatId: data.chat_id, fromUserId: data.from_user_id }];
      });
    });

    return () => wsService.disconnect();
  }, [token, user.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveChat(null);
        setViewingProfile(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.max(180, Math.min(400, e.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => setResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  function handleLogout() {
    // End active call first
    if (webrtcService.isInCall()) {
      webrtcService.endCall();
    }
    setCallChat(null);
    setCallInitiator(false);
    setIncomingCalls([]);
    wsService.disconnect();
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    onLogout();
  }

  function handleChatUpdate(updated: ChatOut) {
    setChats((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (activeChat?.id === updated.id) setActiveChat(updated);
  }

  function startCall(chat: ChatOut) {
    setCallChat(chat);
    setCallInitiator(true);
  }

  function acceptCall(call: { chatId: number; fromUserId: number }) {
    const chat = chats.find((c) => c.id === call.chatId);
    if (chat) {
      setCallChat(chat);
      setCallInitiator(false);
      setActiveChat(chat);
    }
    setIncomingCalls((prev) => prev.filter((c) => c.chatId !== call.chatId));
  }

  function rejectCall(chatId: number) {
    setIncomingCalls((prev) => prev.filter((c) => c.chatId !== chatId));
  }

  function endCall() {
    setCallChat(null);
    setCallInitiator(false);
    setIncomingCalls([]);
  }

  function getChatName(chat: ChatOut) {
    if (chat.is_group) return chat.name || "Группа";
    const other = chat.members.find((m) => m.id !== currentUser.id);
    return other?.username || "Unknown";
  }

  return (
    <div style={s.root}>
      {/* Title bar */}
      <div style={s.titleBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={s.titleText}>GandolaChat</span>
          <span
            style={{
              width: 8, height: 8, borderRadius: "50%",
              background: connQuality === "good" ? "#3ba55d" : connQuality === "ok" ? "#faa61a" : connQuality === "bad" ? "#ed4245" : "#72767d",
            }}
            title={connQuality === "offline" ? "Нет соединения" : `Пинг: ${connPing}мс`}
          />
        </div>
        <div style={s.winControls}>
          <button style={s.winBtn} onClick={() => (window as any).electron?.minimize()}>─</button>
          <button style={s.winBtn} onClick={() => (window as any).electron?.maximize()}>□</button>
          <button style={{ ...s.winBtn, ...s.closeBtn }} onClick={() => setShowCloseDialog(true)}>✕</button>
        </div>
      </div>

      {/* Incoming call banners — multiple */}
      {incomingCalls.map((call) => (
        <div key={call.chatId} style={s.incomingCallBanner}>
          <span>📞 Звонок: {getChatName(chats.find((c) => c.id === call.chatId) || { id: 0, name: "...", is_group: false, members: [], last_message: null })}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.acceptBtn} onClick={() => acceptCall(call)}>Принять</button>
            <button style={s.rejectBtn} onClick={() => rejectCall(call.chatId)}>Отклонить</button>
          </div>
        </div>
      ))}

      <div style={s.body}>
        <Sidebar
          chats={chats}
          currentUser={currentUser}
          activeChatId={activeChat?.id ?? null}
          onSelectChat={(c) => { setActiveChat(c); setViewingProfile(null); }}
          onChatsUpdate={setChats}
          onLogout={handleLogout}
          onAvatarUpdate={setCurrentUser}
          onOpenProfile={() => setViewingProfile(currentUser)}
          width={sidebarWidth}
        />
        <div style={s.resizer} onMouseDown={() => setResizing(true)} />

        {viewingProfile ? (
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <ProfilePage
              user={viewingProfile}
              currentUser={currentUser}
              onClose={() => setViewingProfile(null)}
              onUpdate={(u) => { if (u.id === currentUser.id) setCurrentUser(u); }}
            />
          </div>
        ) : activeChat ? (
          <>
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              <ChatArea
                chat={activeChat}
                currentUser={currentUser}
                onStartCall={() => startCall(activeChat)}
                allChats={chats}
                onOpenProfile={(u) => setViewingProfile(u)}
              />
            </div>
            {activeChat.is_group && (
              <MemberList
                chat={activeChat}
                currentUser={currentUser}
                onChatUpdate={handleChatUpdate}
                onDeleteChat={activeChat.created_by === currentUser.id ? async () => {
                  await chatApi.deleteChat(activeChat.id);
                  setChats((prev) => prev.filter((c) => c.id !== activeChat.id));
                  setActiveChat(null);
                } : undefined}
              />
            )}
          </>
        ) : (
          <div style={s.empty}>
            <div style={s.emptyInner}>
              <span style={s.emptyIcon}>💬</span>
              <h2 style={s.emptyTitle}>Выбери чат</h2>
              <p style={s.emptyText}>
                Найди друга в строке поиска или создай группу нажав +
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Close dialog */}
      {showCloseDialog && (
        <div style={s.closeDialogOverlay} onClick={() => setShowCloseDialog(false)}>
          <div style={s.closeDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", color: "var(--text-header)" }}>Закрыть GandolaChat?</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>Что сделать с приложением?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button style={s.closeDialogBtn} onClick={() => { (window as any).electron?.hide(); setShowCloseDialog(false); }}>
                Свернуть в трей
              </button>
              <button style={{ ...s.closeDialogBtn, background: "#ed4245" }} onClick={() => (window as any).electron?.quit()}>
                Полностью закрыть
              </button>
              <button style={{ ...s.closeDialogBtn, background: "var(--bg-tertiary)" }} onClick={() => setShowCloseDialog(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video call overlay — lives at top level, persists across chat switches */}
      {callChat && (
        <VideoCall
          chat={callChat}
          currentUser={currentUser}
          initiator={callInitiator}
          onEnd={endCall}
        />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-tertiary)", position: "relative" },
  titleBar: {
    height: 32, background: "var(--bg-tertiary)", display: "flex",
    alignItems: "center", justifyContent: "space-between",
    padding: "0 8px", WebkitAppRegion: "drag" as any, flexShrink: 0,
    borderBottom: "1px solid var(--border)",
  },
  titleText: { color: "var(--text-muted)", fontSize: 12, fontWeight: 600, userSelect: "none" },
  winControls: { display: "flex", gap: 4, WebkitAppRegion: "no-drag" as any },
  winBtn: {
    background: "none", color: "var(--text-muted)", width: 28, height: 22,
    borderRadius: 4, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center",
  },
  closeBtn: { color: "var(--text-muted)" },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  resizer: { width: 4, cursor: "col-resize", background: "var(--border)", flexShrink: 0 },
  closeDialogOverlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 },
  closeDialog: { background: "var(--bg-primary)", borderRadius: 8, padding: 24, width: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" },
  closeDialogBtn: { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  incomingCallBanner: {
    background: "#5865f2", display: "flex", alignItems: "center",
    justifyContent: "space-between", padding: "10px 16px", color: "#fff", fontWeight: 600,
  },
  acceptBtn: { background: "#57f287", color: "#000", fontWeight: 700, padding: "6px 16px", borderRadius: 4, fontSize: 13 },
  rejectBtn: { background: "#ed4245", color: "#fff", fontWeight: 700, padding: "6px 16px", borderRadius: 4, fontSize: 13 },
  empty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-primary)" },
  emptyInner: { textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  emptyIcon: { fontSize: 64 },
  emptyTitle: { color: "var(--text-header)", fontSize: 24, fontWeight: 700 },
  emptyText: { color: "var(--text-secondary)", maxWidth: 300, lineHeight: 1.5 },
};
