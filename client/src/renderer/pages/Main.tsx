import React, { useEffect, useState } from "react";
import { ChatOut, UserOut, chatApi } from "../services/api";
import { wsService } from "../services/ws";
import { webrtcService } from "../services/webrtc";
import { playCallRing } from "../services/sounds";
import Sidebar from "../components/Sidebar";
import ChatArea from "../components/ChatArea";
import MemberList from "../components/MemberList";
import VideoCall from "../components/VideoCall";

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

  function handleLogout() {
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
        <span style={s.titleText}>GandolaChat</span>
        <div style={s.winControls}>
          <button style={s.winBtn} onClick={() => (window as any).electron?.minimize()}>─</button>
          <button style={s.winBtn} onClick={() => (window as any).electron?.maximize()}>□</button>
          <button style={{ ...s.winBtn, ...s.closeBtn }} onClick={() => (window as any).electron?.close()}>✕</button>
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
                onStartCall={() => startCall(activeChat)}
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
