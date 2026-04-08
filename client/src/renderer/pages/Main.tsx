import React, { useEffect, useState } from "react";
import { ChatOut, UserOut, chatApi } from "../services/api";
import { wsService } from "../services/ws";
import { webrtcService } from "../services/webrtc";
import { playCallRing } from "../services/sounds";
import Sidebar from "../components/Sidebar";
import ChatArea from "../components/ChatArea";
import MemberList from "../components/MemberList";

interface Props {
  token: string;
  user: UserOut;
  onLogout: () => void;
}

export default function Main({ token, user, onLogout }: Props) {
  const [chats, setChats] = useState<ChatOut[]>([]);
  const [activeChat, setActiveChat] = useState<ChatOut | null>(null);
  const [currentUser, setCurrentUser] = useState<UserOut>(user);
  const [incomingCall, setIncomingCall] = useState<{ chatId: number; fromUserId: number } | null>(null);
  const [acceptedCall, setAcceptedCall] = useState<{ chatId: number; fromUserId: number } | null>(null);

  useEffect(() => {
    wsService.connect(token);
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

    wsService.on("call_signal", (data) => {
      if (webrtcService.isInCall()) return;
      setIncomingCall((prev) => {
        if (!prev) playCallRing();
        return prev ?? { chatId: data.chat_id, fromUserId: data.from_user_id };
      });
    });

    return () => wsService.disconnect();
  }, [token, user.id]);

  function handleLogout() {
    wsService.disconnect();
    localStorage.removeItem("token");
    onLogout();
  }

  function handleChatUpdate(updated: ChatOut) {
    setChats((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (activeChat?.id === updated.id) setActiveChat(updated);
  }

  return (
    <div style={s.root}>
      {/* Title bar */}
      <div style={s.titleBar}>
        <span style={s.titleText}>GandolaChat</span>
        <div style={s.winControls}>
          <button style={s.winBtn} onClick={() => (window as any).electron?.minimize()}>─</button>
          <button style={s.winBtn} onClick={() => (window as any).electron?.maximize()}>□</button>
          <button style={{ ...s.winBtn, ...s.closeBtn }} onClick={() => (window as any).electron?.close()}>✕</button>
        </div>
      </div>

      {incomingCall && (
        <div style={s.incomingCallBanner}>
          <span>📞 Входящий видеозвонок</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.acceptBtn} onClick={() => {
              const chat = chats.find((c) => c.id === incomingCall!.chatId);
              if (chat) setActiveChat(chat);
              setAcceptedCall(incomingCall);
              setIncomingCall(null);
            }}>Принять</button>
            <button style={s.rejectBtn} onClick={() => setIncomingCall(null)}>Отклонить</button>
          </div>
        </div>
      )}

      <div style={s.body}>
        <Sidebar
          chats={chats}
          currentUser={currentUser}
          activeChatId={activeChat?.id ?? null}
          onSelectChat={setActiveChat}
          onChatsUpdate={setChats}
          onLogout={handleLogout}
          onAvatarUpdate={setCurrentUser}
        />

        {activeChat ? (
          <>
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              <ChatArea
                chat={activeChat}
                currentUser={currentUser}
                incomingCall={acceptedCall?.chatId === activeChat.id ? acceptedCall : null}
                onCallEnd={() => { setAcceptedCall(null); setIncomingCall(null); }}
              />
            </div>
            {activeChat.is_group && (
              <MemberList
                chat={activeChat}
                currentUser={currentUser}
                onChatUpdate={handleChatUpdate}
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
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-tertiary)" },
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
