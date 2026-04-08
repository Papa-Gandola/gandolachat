import React, { useEffect, useRef, useState, useCallback } from "react";
import { ChatOut, MessageOut, UserOut, chatApi, getFileUrl } from "../services/api";
import { wsService } from "../services/ws";
import { playMessageSound } from "../services/sounds";
import VideoCall from "./VideoCall";
import EmojiPicker from "./EmojiPicker";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  incomingCall: { chatId: number; fromUserId: number } | null;
  onCallEnd: () => void;
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ChatArea({ chat, currentUser, incomingCall, onCallEnd }: Props) {
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageOut[] | null>(null);
  const [editingMsg, setEditingMsg] = useState<MessageOut | null>(null);
  const [editText, setEditText] = useState("");
  const [replyTo, setReplyTo] = useState<MessageOut | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: MessageOut } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setMessages([]);
    setInCall(false);
    setReplyTo(null);
    setEditingMsg(null);
    setSearchResults(null);
    setShowSearch(false);
    setTypingUsers(new Map());
    loadMessages();
  }, [chat.id]);

  // Auto-open call when incoming call is accepted
  useEffect(() => {
    if (incomingCall) {
      setInCall((prev) => prev ? prev : true);
    }
  }, [incomingCall]);

  useEffect(() => {
    const handler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setMessages((prev) => [...prev, data as MessageOut]);
      if (data.sender_id !== currentUser.id) {
        playMessageSound();
        showNotification(data.sender_username, data.content || "Sent a file");
      }
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    };

    const typingHandler = (data: any) => {
      if (data.chat_id !== chat.id || data.user_id === currentUser.id) return;
      const member = chat.members.find((m) => m.id === data.user_id);
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.set(data.user_id, member?.username || "Someone");
        return next;
      });
      setTimeout(() => {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(data.user_id);
          return next;
        });
      }, 3000);
    };

    const editHandler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setMessages((prev) =>
        prev.map((m) => m.id === data.message_id ? { ...m, content: data.content, is_edited: true } : m)
      );
    };

    const deleteHandler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setMessages((prev) => prev.filter((m) => m.id !== data.message_id));
    };

    wsService.on("message", handler);
    wsService.on("typing", typingHandler);
    wsService.on("message_edited", editHandler);
    wsService.on("message_deleted", deleteHandler);
    return () => {
      wsService.off("message", handler);
      wsService.off("typing", typingHandler);
      wsService.off("message_edited", editHandler);
      wsService.off("message_deleted", deleteHandler);
    };
  }, [chat.id, currentUser.id]);

  // Close context menu on click anywhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function loadMessages() {
    setLoading(true);
    try {
      const res = await chatApi.getMessages(chat.id);
      setMessages(res.data);
      setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
    } finally {
      setLoading(false);
    }
  }

  function handleTyping() {
    if (typingTimerRef.current) return;
    wsService.send({ type: "typing", chat_id: chat.id });
    typingTimerRef.current = setTimeout(() => {
      typingTimerRef.current = undefined;
    }, 2000);
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    wsService.send({
      type: "message",
      chat_id: chat.id,
      content: text.trim(),
      reply_to_id: replyTo?.id || null,
    });
    setText("");
    setReplyTo(null);
  }

  async function sendFile(file: File) {
    await chatApi.uploadFile(chat.id, file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) sendFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) sendFile(file);
  }

  function handleEditSave() {
    if (!editingMsg || !editText.trim()) return;
    wsService.send({ type: "edit_message", message_id: editingMsg.id, content: editText.trim() });
    setEditingMsg(null);
    setEditText("");
  }

  function handleDelete(msgId: number) {
    wsService.send({ type: "delete_message", message_id: msgId });
  }

  async function handleSearch() {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    const res = await chatApi.searchMessages(chat.id, searchQuery);
    setSearchResults(res.data);
  }

  function showNotification(title: string, body: string) {
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body });
      });
    }
  }

  function getChatTitle() {
    if (chat.is_group) return chat.name;
    const other = chat.members.find((m) => m.id !== currentUser.id);
    return other?.username || "Unknown";
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Сегодня";
    if (d.toDateString() === yesterday.toDateString()) return "Вчера";
    return d.toLocaleDateString("ru-RU");
  }

  function isImage(url: string) {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  }

  const typingText = typingUsers.size > 0
    ? [...typingUsers.values()].join(", ") + " печатает..."
    : null;

  // Group messages by date
  const displayMessages = searchResults ?? messages;
  const grouped: Array<{ date: string; messages: MessageOut[] }> = [];
  displayMessages.forEach((msg) => {
    const date = formatDate(msg.created_at);
    const last = grouped[grouped.length - 1];
    if (!last || last.date !== date) grouped.push({ date, messages: [msg] });
    else last.messages.push(msg);
  });

  return (
    <div
      style={{ ...s.root, ...(dragOver ? { outline: "2px dashed var(--accent)" } : {}) }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.chatIcon}>{chat.is_group ? "#" : "@"}</span>
          <span style={s.chatTitle}>{getChatTitle()}</span>
          {chat.is_group && (
            <span style={s.memberCount}>{chat.members.length} участников</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.headerBtn} title="Поиск" onClick={() => setShowSearch(!showSearch)}>🔍</button>
          <button style={s.headerBtn} title="Видеозвонок" onClick={() => setInCall(true)}>📹</button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div style={s.searchBar}>
          <input
            style={s.searchInput}
            placeholder="Поиск по сообщениям..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          {searchResults && (
            <button style={s.searchClose} onClick={() => { setSearchResults(null); setSearchQuery(""); }}>✕</button>
          )}
        </div>
      )}

      {/* Video call overlay */}
      {inCall && (
        <VideoCall
          chat={chat}
          currentUser={currentUser}
          initiator={!incomingCall}
          onEnd={() => { setInCall(false); onCallEnd(); }}
        />
      )}

      {/* Messages */}
      <div style={s.messages}>
        {loading && <p style={s.loadingText}>Загрузка...</p>}
        {searchResults && <p style={s.searchLabel}>Найдено: {searchResults.length}</p>}
        {dragOver && <div style={s.dropOverlay}>Перетащите файл сюда</div>}

        {grouped.map((group) => (
          <div key={group.date}>
            <div style={s.dateSep}>
              <hr style={s.dateLine} />
              <span style={s.dateLabel}>{group.date}</span>
              <hr style={s.dateLine} />
            </div>
            {group.messages.map((msg, i) => {
              const prev = group.messages[i - 1];
              const isMine = msg.sender_id === currentUser.id;
              const isGrouped = prev && prev.sender_id === msg.sender_id &&
                (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60000;

              return (
                <div
                  key={msg.id}
                  style={{ ...s.msgRow, marginTop: isGrouped ? 2 : 16 }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, msg });
                  }}
                >
                  {!isGrouped ? (
                    <div style={s.avatarSmall}>
                      <AvatarSmall name={msg.sender_username} url={msg.sender_avatar} />
                    </div>
                  ) : (
                    <div style={{ width: 40 }} />
                  )}
                  <div style={s.msgContent}>
                    {!isGrouped && (
                      <div style={s.msgMeta}>
                        <span style={{ ...s.msgAuthor, color: isMine ? "var(--accent)" : "var(--text-header)" }}>
                          {isMine ? "Вы" : msg.sender_username}
                        </span>
                        <span style={s.msgTime}>{formatTime(msg.created_at)}</span>
                        {msg.is_edited && <span style={s.editedTag}>(ред.)</span>}
                      </div>
                    )}
                    {/* Reply preview */}
                    {msg.reply_to_id && msg.reply_to_username && (
                      <div style={s.replyPreview}>
                        <span style={s.replyAuthor}>{msg.reply_to_username}</span>
                        <span style={s.replyText}>{msg.reply_to_content || "..."}</span>
                      </div>
                    )}
                    {/* Editing */}
                    {editingMsg?.id === msg.id ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          style={s.editInput}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSave();
                            if (e.key === "Escape") setEditingMsg(null);
                          }}
                          autoFocus
                        />
                        <button style={s.editSaveBtn} onClick={handleEditSave}>✓</button>
                        <button style={s.editCancelBtn} onClick={() => setEditingMsg(null)}>✕</button>
                      </div>
                    ) : (
                      <>
                        {msg.content && <p style={s.msgText}>{msg.content}</p>}
                        {/* Reply button (inline) */}
                        {msg.content && (
                          <button style={s.replyBtn} onClick={() => setReplyTo(msg)} title="Ответить">↩</button>
                        )}
                      </>
                    )}
                    {msg.file_url && (
                      isImage(msg.file_url) ? (
                        <img
                          src={`${BASE_URL}${msg.file_url}`}
                          style={s.msgImage}
                          alt={msg.file_name || "image"}
                        />
                      ) : (
                        <a href={`${BASE_URL}${msg.file_url}`} target="_blank" rel="noreferrer" style={s.fileLink}>
                          📎 {msg.file_name}
                        </a>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div style={{ ...s.ctxMenu, left: contextMenu.x, top: contextMenu.y }}>
          <button style={s.ctxItem} onClick={() => { setReplyTo(contextMenu.msg); setContextMenu(null); }}>↩ Ответить</button>
          {contextMenu.msg.sender_id === currentUser.id && (
            <>
              <button style={s.ctxItem} onClick={() => { setEditingMsg(contextMenu.msg); setEditText(contextMenu.msg.content || ""); setContextMenu(null); }}>✏️ Редактировать</button>
              <button style={{ ...s.ctxItem, color: "var(--danger)" }} onClick={() => { handleDelete(contextMenu.msg.id); setContextMenu(null); }}>🗑 Удалить</button>
            </>
          )}
        </div>
      )}

      {/* Typing indicator */}
      {typingText && <div style={s.typingBar}>{typingText}</div>}

      {/* Reply preview bar */}
      {replyTo && (
        <div style={s.replyBar}>
          <span>Ответ для <b>{replyTo.sender_username}</b>: {replyTo.content?.slice(0, 50)}</span>
          <button style={s.replyBarClose} onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <EmojiPicker
          onSelect={(emoji) => { setText((prev) => prev + emoji); setShowEmoji(false); }}
          onClose={() => setShowEmoji(false)}
        />
      )}

      {/* Input */}
      <form onSubmit={sendMessage} style={s.inputBar}>
        <button type="button" style={s.attachBtn} onClick={() => fileRef.current?.click()} title="Прикрепить файл">+</button>
        <input type="file" ref={fileRef} style={{ display: "none" }} onChange={handleFileInput} />
        <button type="button" style={s.emojiBtn} onClick={() => setShowEmoji(!showEmoji)} title="Эмодзи">😊</button>
        <input
          style={s.textInput}
          value={text}
          onChange={(e) => { setText(e.target.value); handleTyping(); }}
          placeholder={`Написать ${chat.is_group ? "в группе" : getChatTitle()}...`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(e as any);
            }
          }}
        />
        <button type="submit" style={s.sendBtn} disabled={!text.trim()}>➤</button>
      </form>
    </div>
  );
}

function AvatarSmall({ name, url }: { name: string; url: string | null }) {
  const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
  const colors = ["#5865f2", "#57f287", "#fee75c", "#ed4245", "#eb459e", "#faa61a", "#00b0f4"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const bg = colors[Math.abs(hash) % colors.length];

  return url ? (
    <img src={url.startsWith("http") ? url : `${BASE_URL}${url}`}
      style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} alt={name} />
  ) : (
    <div style={{ width: 40, height: 40, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 16 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)", height: "100%", position: "relative" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-primary)" },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  chatIcon: { color: "var(--text-muted)", fontWeight: 700, fontSize: 18 },
  chatTitle: { color: "var(--text-header)", fontWeight: 600, fontSize: 16 },
  memberCount: { color: "var(--text-muted)", fontSize: 13, marginLeft: 8 },
  headerBtn: { background: "none", color: "var(--text-secondary)", fontSize: 20, padding: "4px 8px", borderRadius: 4 },
  searchBar: { display: "flex", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" },
  searchInput: { flex: 1, background: "var(--bg-input)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "var(--text-primary)" },
  searchClose: { background: "none", color: "var(--text-muted)", fontSize: 16, padding: "4px 8px" },
  searchLabel: { color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 8 },
  messages: { flex: 1, overflowY: "auto", padding: "16px 16px 8px" },
  loadingText: { color: "var(--text-muted)", textAlign: "center" },
  dateSep: { display: "flex", alignItems: "center", gap: 8, margin: "16px 0 8px" },
  dateLine: { flex: 1, border: "none", borderTop: "1px solid var(--border)" },
  dateLabel: { color: "var(--text-muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" },
  msgRow: { display: "flex", gap: 12, alignItems: "flex-start", position: "relative" as const },
  avatarSmall: { flexShrink: 0 },
  msgContent: { flex: 1, minWidth: 0 },
  msgMeta: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 },
  msgAuthor: { fontWeight: 600, fontSize: 14 },
  msgTime: { color: "var(--text-muted)", fontSize: 11 },
  editedTag: { color: "var(--text-muted)", fontSize: 10, fontStyle: "italic" },
  msgText: { color: "var(--text-primary)", lineHeight: 1.5, wordBreak: "break-word" as const },
  msgImage: { maxWidth: 360, maxHeight: 280, borderRadius: 4, marginTop: 4, display: "block" },
  fileLink: { color: "var(--text-link)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4 },
  replyPreview: { background: "var(--bg-secondary)", borderLeft: "3px solid var(--accent)", padding: "4px 8px", borderRadius: 4, marginBottom: 4, fontSize: 12 },
  replyAuthor: { color: "var(--accent)", fontWeight: 600, marginRight: 6 },
  replyText: { color: "var(--text-muted)" },
  replyBtn: { background: "none", color: "var(--text-muted)", fontSize: 14, padding: "2px 6px", opacity: 0.5, position: "absolute" as const, right: 0, top: 0 },
  replyBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border)", fontSize: 13, color: "var(--text-secondary)" },
  replyBarClose: { background: "none", color: "var(--text-muted)", fontSize: 16, padding: "2px 8px" },
  typingBar: { padding: "4px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" },
  ctxMenu: { position: "fixed" as const, background: "var(--bg-tertiary)", borderRadius: 6, padding: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", zIndex: 200, minWidth: 160 },
  ctxItem: { display: "block", width: "100%", background: "none", color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, textAlign: "left" as const, borderRadius: 4 },
  editInput: { flex: 1, background: "var(--bg-input)", borderRadius: 4, padding: "4px 8px", fontSize: 13, color: "var(--text-primary)" },
  editSaveBtn: { background: "var(--accent)", color: "#fff", borderRadius: 4, padding: "4px 10px", fontSize: 14 },
  editCancelBtn: { background: "var(--bg-tertiary)", color: "var(--text-muted)", borderRadius: 4, padding: "4px 10px", fontSize: 14 },
  dropOverlay: { position: "absolute" as const, inset: 0, background: "rgba(88,101,242,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", fontSize: 18, fontWeight: 700, zIndex: 50, pointerEvents: "none" as const },
  inputBar: { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "var(--bg-primary)", borderTop: "1px solid var(--border)" },
  attachBtn: { background: "var(--bg-input)", color: "var(--text-muted)", width: 36, height: 36, borderRadius: "50%", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  emojiBtn: { background: "none", fontSize: 22, padding: "4px", flexShrink: 0, opacity: 0.7 },
  textInput: { flex: 1, background: "var(--bg-input)", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "var(--text-primary)" },
  sendBtn: { background: "var(--accent)", color: "#fff", width: 36, height: 36, borderRadius: "50%", fontSize: 16, flexShrink: 0, opacity: 1, transition: "opacity 0.15s" },
};
