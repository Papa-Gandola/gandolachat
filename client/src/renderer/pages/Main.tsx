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
import { useTheme } from "../services/theme";

interface Props {
  token: string;
  user: UserOut;
  onLogout: () => void;
}

export default function Main({ token, user, onLogout }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
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
      setViewingProfile((prev) => prev && prev.id === data.user_id ? { ...prev, username: data.username, avatar_url: data.avatar_url, status: data.status } : prev);
    });

    wsService.on("chat_deleted", (data) => {
      setChats((prev) => prev.filter((c) => c.id !== data.chat_id));
      setActiveChat((prev) => prev?.id === data.chat_id ? null : prev);
    });

    wsService.on("call_signal", (data) => {
      if (webrtcService.isInCall()) return;
      setIncomingCalls((prev) => {
        if (prev.some((c) => c.chatId === data.chat_id)) return prev;
        return [...prev, { chatId: data.chat_id, fromUserId: data.from_user_id }];
      });
    });

    return () => wsService.disconnect();
  }, [token, user.id]);

  // Ring loop while incoming calls
  useEffect(() => {
    if (incomingCalls.length === 0) return;
    playCallRing();
    const interval = setInterval(() => playCallRing(), 5000);
    return () => clearInterval(interval);
  }, [incomingCalls.length]);

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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={s.titleText}>GandolaChat</span>
          <span style={{ ...s.titleText, fontSize: 10, opacity: 0.6 }}>v2.0.2</span>
          <span
            style={{
              width: 8, height: 8, borderRadius: "50%", marginLeft: 4,
              background: connQuality === "good" ? "#3ba55d" : connQuality === "ok" ? "#faa61a" : connQuality === "bad" ? "#ed4245" : "#72767d",
            }}
          />
          <span style={{ ...s.titleText, fontSize: 11 }}>
            {connQuality === "offline" ? "offline" : `${connPing} мс`}
          </span>
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
              {isNeo ? (
                <>
                  <pre className="neo-gandola" aria-hidden="true">
{`    ╔═══════════╗
    ║  `}<span className="eye">◉</span>{`  ___  `}<span className="eye">◉</span>{`  ║
    ║     `}<span style={{ color: "#fff" }}>\\_/</span>{`     ║
    ║   [GANDOLA] ║
    ╚═══╦═════╦═══╝
        ║     ║
       ═╩═   ═╩═`}
                  </pre>
                  <h2 style={{ ...s.emptyTitle, fontFamily: "var(--font-mono)", color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 18, marginTop: 24 }}>
                    &gt; выбери_чат<span className="neo-blink">_</span>
                  </h2>
                  <p style={{ ...s.emptyText, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", letterSpacing: "0.03em" }}>
                    // найди_друга_в_строке_поиска<br/>// или_создай_группу_нажав [+]
                  </p>
                </>
              ) : (
                <>
                  <div className="gondola-scene" aria-hidden="true">
                    {/* Boat */}
                    <svg className="gondola-boat" width="90" height="70" viewBox="0 0 90 70" fill="none">
                      {/* Hull: classic gondola shape — long pointed crescent */}
                      <path d="M4 44 C 14 52, 30 56, 45 56 C 60 56, 76 52, 86 44 L 82 48 C 72 55, 58 58, 45 58 C 32 58, 18 55, 8 48 Z"
                            fill="#2a2a2a" opacity="0.9"/>
                      <path d="M4 44 C 14 50, 30 54, 45 54 C 60 54, 76 50, 86 44 L 86 46 C 76 52, 60 56, 45 56 C 30 56, 14 52, 4 46 Z"
                            fill="#1a1a1a"/>
                      {/* Prow curl (front) */}
                      <path d="M86 44 C 88 40, 86 36, 84 38 C 83 40, 84 42, 86 44 Z" fill="#2a2a2a"/>
                      {/* Stern flat */}
                      <path d="M4 44 C 2 42, 3 40, 5 41 Z" fill="#2a2a2a"/>
                      {/* Deck plank */}
                      <rect x="18" y="42" width="54" height="3" rx="1" fill="#4a3a28"/>
                      {/* Gondolier — body */}
                      <rect x="42" y="22" width="6" height="22" rx="1.5" fill="#1e2a42"/>
                      {/* Head */}
                      <circle cx="45" cy="18" r="4" fill="#e8c7a0"/>
                      {/* Striped shirt */}
                      <rect x="42" y="24" width="6" height="2" fill="#fff"/>
                      <rect x="42" y="28" width="6" height="2" fill="#fff"/>
                      <rect x="42" y="32" width="6" height="2" fill="#fff"/>
                      {/* Straw hat — with ribbon */}
                      <ellipse cx="45" cy="13" rx="8" ry="1.6" fill="#d9b272"/>
                      <path d="M40 13 Q 45 8 50 13 L 50 14 Q 45 10 40 14 Z" fill="#d9b272"/>
                      <rect x="41" y="12.5" width="8" height="1" fill="#ed4245"/>
                      {/* Oar (leaning) */}
                      <line x1="52" y1="26" x2="78" y2="60" stroke="#8b6b3d" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="M76 58 L 82 64 L 80 66 L 74 60 Z" fill="#8b6b3d"/>
                    </svg>
                    {/* Back waves (slower, paler) */}
                    <svg className="gondola-waves-back" viewBox="0 0 300 40" fill="none" preserveAspectRatio="none">
                      <path d="M0 20 Q 15 10 30 20 T 60 20 T 90 20 T 120 20 T 150 20 T 180 20 T 210 20 T 240 20 T 270 20 T 300 20 L 300 40 L 0 40 Z"
                            fill="#5865f2"/>
                    </svg>
                    {/* Front waves (faster, stronger) */}
                    <svg className="gondola-waves-front" viewBox="0 0 300 40" fill="none" preserveAspectRatio="none">
                      <path d="M0 22 Q 10 14 20 22 T 40 22 T 60 22 T 80 22 T 100 22 T 120 22 T 140 22 T 160 22 T 180 22 T 200 22 T 220 22 T 240 22 T 260 22 T 280 22 T 300 22 L 300 40 L 0 40 Z"
                            fill="#4752c4"/>
                    </svg>
                  </div>
                  <h2 style={s.emptyTitle}>Выбери чат</h2>
                  <p style={s.emptyText}>
                    Найди друга в строке поиска или создай группу нажав +
                  </p>
                </>
              )}
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
              <button style={{ ...s.closeDialogBtn, background: "var(--bg-hover)", color: "var(--text-primary)" }} onClick={() => setShowCloseDialog(false)}>
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
  closeDialogBtn: { background: "var(--accent)", color: "var(--accent-text)", border: "none", borderRadius: 6, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
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
