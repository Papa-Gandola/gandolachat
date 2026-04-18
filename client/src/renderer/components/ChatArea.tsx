import React, { useEffect, useRef, useState } from "react";
import { ChatOut, MessageOut, UserOut, chatApi } from "../services/api";
import { wsService } from "../services/ws";
import { playMessageSound } from "../services/sounds";
import EmojiPicker from "./EmojiPicker";
import FormattedText from "./FormattedText";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  onStartCall: () => void;
  allChats?: ChatOut[];
  onOpenProfile?: (user: UserOut) => void;
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ChatArea({ chat, currentUser, onStartCall, allChats = [], onOpenProfile }: Props) {
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MessageOut[] | null>(null);
  const [editingMsg, setEditingMsg] = useState<MessageOut | null>(null);
  const [editText, setEditText] = useState("");
  const [replyTo, setReplyToState] = useState<MessageOut | null>(null);
  const setReplyTo = (msg: MessageOut | null) => {
    setReplyToState(msg);
    if (msg) setTimeout(() => textInputRef.current?.focus(), 0);
  };
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: MessageOut } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [hoverEmoji, setHoverEmoji] = useState("😊");
  const RANDOM_EMOJI = ["😊", "😂", "🤣", "😍", "🥰", "😎", "🤔", "😭", "🥺", "🤡", "💀", "🗿", "🔥", "💯", "👻", "🤓", "🫠", "🤯", "😈", "🥴"];
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Map<number, Array<{ emoji: string; userId: number }>>>(new Map());
  const [showReactionPicker, setShowReactionPicker] = useState<number | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessageOut | null>(null);
  const [readBy, setReadBy] = useState<Map<number, number>>(new Map()); // userId -> lastReadMsgId
  const [chatMuted, setChatMuted] = useState(() => {
    const muted = JSON.parse(localStorage.getItem("mutedChats") || "[]");
    return muted.includes(chat.id);
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setMessages([]);
    setReplyTo(null);
    setEditingMsg(null);
    setSearchResults(null);
    setShowSearch(false);
    setTypingUsers(new Map());
    setChatMuted(JSON.parse(localStorage.getItem("mutedChats") || "[]").includes(chat.id));
    setReadBy(new Map());
    chatApi.getReadStatus(chat.id).then((res) => {
      const m = new Map<number, number>();
      res.data.forEach((r) => m.set(r.user_id, r.last_read_message_id));
      setReadBy(m);
    }).catch(() => {});
    loadMessages();
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = undefined;
      }
    };
  }, [chat.id]);

  useEffect(() => {
    const handler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setMessages((prev) => [...prev, data as MessageOut]);
      // Auto mark as read
      wsService.send({ type: "mark_read", chat_id: chat.id, message_id: data.id });
      if (data.sender_id !== currentUser.id) {
        const isMuted = JSON.parse(localStorage.getItem("mutedChats") || "[]").includes(chat.id);
        if (!isMuted) {
          playMessageSound();
          showNotification(data.sender_username, data.content || "Sent a file");
        }
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

    const reactionHandler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setReactions((prev) => {
        const next = new Map(prev);
        const list = next.get(data.message_id) || [];
        next.set(data.message_id, [...list, { emoji: data.emoji, userId: data.user_id }]);
        return next;
      });
    };

    const reactionRemovedHandler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setReactions((prev) => {
        const next = new Map(prev);
        const list = next.get(data.message_id) || [];
        const idx = list.findIndex((r) => r.userId === data.user_id && r.emoji === data.emoji);
        if (idx >= 0) {
          const newList = [...list];
          newList.splice(idx, 1);
          next.set(data.message_id, newList);
        }
        return next;
      });
    };

    const readHandler = (data: any) => {
      if (data.chat_id !== chat.id) return;
      setReadBy((prev) => new Map(prev).set(data.user_id, data.last_read_message_id));
    };

    wsService.on("message", handler);
    wsService.on("typing", typingHandler);
    wsService.on("message_edited", editHandler);
    wsService.on("message_deleted", deleteHandler);
    wsService.on("reaction", reactionHandler);
    wsService.on("reaction_removed", reactionRemovedHandler);
    wsService.on("message_read", readHandler);
    return () => {
      wsService.off("message", handler);
      wsService.off("typing", typingHandler);
      wsService.off("message_edited", editHandler);
      wsService.off("message_deleted", deleteHandler);
      wsService.off("reaction", reactionHandler);
      wsService.off("reaction_removed", reactionRemovedHandler);
      wsService.off("message_read", readHandler);
    };
  }, [chat.id, currentUser.id]);

  // Close context menu on click anywhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // ESC closes image preview (capture phase, before global ESC handler)
  useEffect(() => {
    if (!previewImage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPreviewImage(null);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [previewImage]);

  const [hasMore, setHasMore] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);

  async function loadMessages() {
    setLoading(true);
    setHasMore(true);
    try {
      const res = await chatApi.getMessages(chat.id);
      setMessages(res.data);
      setHasMore(res.data.length >= 50);
      // Load reactions from API response
      const rMap = new Map<number, Array<{ emoji: string; userId: number }>>();
      res.data.forEach((m: any) => {
        if (m.reactions?.length) {
          rMap.set(m.id, m.reactions.map((r: any) => ({ emoji: r.emoji, userId: r.user_id })));
        }
      });
      setReactions(rMap);
      // Mark messages as read
      if (res.data.length > 0) {
        const lastMsg = res.data[res.data.length - 1];
        wsService.send({ type: "mark_read", chat_id: chat.id, message_id: lastMsg.id });
      }
      setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
    } finally {
      setLoading(false);
    }
  }

  async function loadOlderMessages() {
    if (!hasMore || loading || messages.length === 0) return;
    const oldest = messages[0];
    setLoading(true);
    try {
      const res = await chatApi.getMessages(chat.id, 50, oldest.id);
      if (res.data.length < 50) setHasMore(false);
      if (res.data.length > 0) setMessages((prev) => [...res.data, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  function handleMessagesScroll(e: React.UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop === 0 && hasMore) {
      loadOlderMessages();
    }
  }

  function wrapSelection(marker: string) {
    const ta = textInputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = text.slice(0, start);
    const sel = text.slice(start, end);
    const after = text.slice(end);
    const newText = `${before}${marker}${sel}${marker}${after}`;
    setText(newText);
    setTimeout(() => {
      ta.focus();
      const newPos = end + marker.length * 2;
      ta.setSelectionRange(newPos, newPos);
    }, 0);
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

  function formatLastSeen(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return "был только что";
    if (diff < 3600) return `был ${Math.floor(diff / 60)} мин. назад`;
    if (diff < 86400) return `был ${Math.floor(diff / 3600)} ч. назад`;
    return `был ${d.toLocaleDateString("ru-RU")}`;
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
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files || []);
        if (files.length > 0) {
          e.preventDefault();
          files.forEach((f) => sendFile(f));
        }
      }}
    >
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.chatIcon}>{chat.is_group ? "#" : "@"}</span>
          <span style={s.chatTitle}>{getChatTitle()}</span>
          {!chat.is_group && (() => {
            const other = chat.members.find((m) => m.id !== currentUser.id);
            const lastSeen = formatLastSeen(other?.last_seen);
            return (
              <>
                {other?.status && <span style={s.chatStatus}>— {other.status}</span>}
                {lastSeen && <span style={s.lastSeen}>{lastSeen}</span>}
              </>
            );
          })()}
          {chat.is_group && (
            <span style={s.memberCount}>{chat.members.length} участников</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.headerBtn} title={chatMuted ? "Включить уведомления" : "Выключить уведомления"} onClick={() => {
            const muted = JSON.parse(localStorage.getItem("mutedChats") || "[]");
            if (chatMuted) {
              localStorage.setItem("mutedChats", JSON.stringify(muted.filter((id: number) => id !== chat.id)));
            } else {
              localStorage.setItem("mutedChats", JSON.stringify([...muted, chat.id]));
            }
            setChatMuted(!chatMuted);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={chatMuted ? "#ed4245" : "currentColor"} strokeWidth="2" strokeLinecap="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
              {chatMuted && <line x1="1" y1="1" x2="23" y2="23"/>}
            </svg>
          </button>
          <button style={s.headerBtn} title="Поиск" onClick={() => setShowSearch(!showSearch)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <button style={s.headerBtn} title="Видеозвонок" onClick={onStartCall}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </button>
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

      {/* Messages */}
      <div style={s.messages} ref={messagesRef} onScroll={handleMessagesScroll}>
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
                  className="msg-row-hover"
                  style={{ ...s.msgRow, marginTop: isGrouped ? 2 : 16 }}
                  onDoubleClick={() => setReplyTo(msg)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const menuWidth = 220;
                    const menuHeight = 280;
                    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
                    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
                    setContextMenu({ x, y, msg });
                  }}
                >
                  {!isGrouped ? (
                    <div style={{ ...s.avatarSmall, cursor: "pointer" }} onClick={() => {
                      const member = chat.members.find((m) => m.id === msg.sender_id);
                      if (member && onOpenProfile) onOpenProfile(member);
                    }}>
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
                        {isMine && (() => {
                          const otherMembers = chat.members.filter((m) => m.id !== currentUser.id);
                          const allRead = otherMembers.every((m) => (readBy.get(m.id) || 0) >= msg.id);
                          return <span style={{ ...s.readCheck, color: allRead ? "#57f287" : "var(--text-muted)" }}>{allRead ? "✓✓" : "✓"}</span>;
                        })()}
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
                        {msg.content && <p style={s.msgText}><FormattedText text={msg.content} /></p>}
                        {/* Reactions display */}
                        {reactions.get(msg.id)?.length ? (
                          <div style={s.reactionsRow}>
                            {Object.entries(
                              reactions.get(msg.id)!.reduce((acc: Record<string, number>, r) => {
                                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                                return acc;
                              }, {})
                            ).map(([emoji, count]) => {
                              const myReact = reactions.get(msg.id)!.some((r) => r.emoji === emoji && r.userId === currentUser.id);
                              return (
                                <span
                                  key={emoji}
                                  style={{ ...s.reactionBadge, cursor: "pointer", border: myReact ? "1px solid var(--accent)" : "1px solid transparent" }}
                                  onClick={() => {
                                    if (myReact) {
                                      wsService.send({ type: "remove_reaction", message_id: msg.id, chat_id: chat.id, emoji });
                                    } else {
                                      wsService.send({ type: "reaction", message_id: msg.id, chat_id: chat.id, emoji });
                                    }
                                  }}
                                  title={myReact ? "Убрать реакцию" : "Добавить реакцию"}
                                >{emoji} {count}</span>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    )}
                    {msg.file_url && (
                      isImage(msg.file_url) ? (
                        <img
                          src={`${BASE_URL}${msg.file_url}`}
                          style={{ ...s.msgImage, cursor: "pointer" }}
                          alt={msg.file_name || "image"}
                          onClick={() => setPreviewImage(`${BASE_URL}${msg.file_url}`)}
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
          <button style={s.ctxItem} onClick={() => { setForwardMsg(contextMenu.msg); setContextMenu(null); }}>➡ Переслать</button>
          <div style={s.ctxReactions}>
            {["🤡", "💀", "🗿", "😭", "💩", "🤮", "👺", "🫠", "🤯", "😈", "👻", "🤓", "❤️", "👍", "👎", "🔥", "💯", "😂", "🤣", "😍", "🥺", "😤", "🤬", "🥴", "🫡", "🤝", "🙏", "💅"].map((e) => (
              <button key={e} style={s.ctxReactionBtn} onClick={() => {
                wsService.send({ type: "reaction", message_id: contextMenu!.msg.id, chat_id: chat.id, emoji: e });
                setContextMenu(null);
              }}>{e}</button>
            ))}
          </div>
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

      {/* Format toolbar */}
      <div style={s.formatBar}>
        <button type="button" style={s.formatBtn} onClick={() => wrapSelection("**")} title="Жирный"><b>B</b></button>
        <button type="button" style={s.formatBtn} onClick={() => wrapSelection("*")} title="Курсив"><i>I</i></button>
        <button type="button" style={s.formatBtn} onClick={() => wrapSelection("__")} title="Подчёркнутый"><u>U</u></button>
        <button type="button" style={s.formatBtn} onClick={() => wrapSelection("~~")} title="Зачёркнутый"><s>S</s></button>
        <button type="button" style={s.formatBtn} onClick={() => wrapSelection("||")} title="Спойлер">▮</button>
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div style={s.replyBar}>
          <span>Ответ для <b>{replyTo.sender_username}</b>: {replyTo.content?.slice(0, 50)}</span>
          <button style={s.replyBarClose} onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      {/* Forward message modal */}
      {forwardMsg && (
        <div style={s.imageOverlay} onClick={() => setForwardMsg(null)}>
          <div style={s.forwardModal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: "var(--text-header)", margin: "0 0 12px" }}>Переслать сообщение</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 12 }}>"{forwardMsg.content?.slice(0, 80)}"</p>
            {allChats.filter((c) => c.id !== chat.id).map((c) => {
              const name = c.is_group ? c.name : c.members.find((m) => m.id !== currentUser.id)?.username;
              return (
                <div key={c.id} style={s.forwardChatItem} onClick={() => {
                  wsService.send({
                    type: "forward_message",
                    target_chat_id: c.id,
                    content: forwardMsg.content || (forwardMsg.file_url ? `[Файл: ${forwardMsg.file_name}]` : ""),
                    original_author: forwardMsg.sender_username,
                    file_url: forwardMsg.file_url,
                    file_name: forwardMsg.file_name,
                  });
                  setForwardMsg(null);
                }}>
                  <span>{c.is_group ? "#" : "@"} {name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Image preview modal */}
      {previewImage && (
        <div style={s.imageOverlay} onClick={() => setPreviewImage(null)}>
          <img src={previewImage} style={s.imagePreview} alt="preview" />
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
        <button
          type="button"
          style={s.emojiBtn}
          onClick={() => setShowEmoji(!showEmoji)}
          onMouseEnter={() => setHoverEmoji(RANDOM_EMOJI[Math.floor(Math.random() * RANDOM_EMOJI.length)])}
          title="Эмодзи"
        >{hoverEmoji}</button>
        <textarea
          ref={textInputRef}
          style={s.textInput}
          value={text}
          onChange={(e) => { setText(e.target.value); handleTyping(); }}
          placeholder={`Написать ${chat.is_group ? "в группе" : getChatTitle()}...`}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              sendMessage(e as any);
            } else if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              setText((t) => t + "\n");
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
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-primary)", height: 49, boxSizing: "border-box" as const, flexShrink: 0 },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  chatIcon: { color: "var(--text-muted)", fontWeight: 700, fontSize: 18 },
  chatTitle: { color: "var(--text-header)", fontWeight: 600, fontSize: 16 },
  memberCount: { color: "var(--text-muted)", fontSize: 13, marginLeft: 8 },
  chatStatus: { color: "var(--text-muted)", fontSize: 13, marginLeft: 8, fontStyle: "italic" as const },
  lastSeen: { color: "var(--text-muted)", fontSize: 11, marginLeft: 8 },
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
  readCheck: { fontSize: 11, marginLeft: 4 },
  ctxReactions: { display: "flex", flexWrap: "wrap" as const, gap: 2, padding: "4px 8px", borderTop: "1px solid var(--border)" },
  ctxReactionBtn: { background: "none", fontSize: 18, padding: 3, borderRadius: 4, cursor: "pointer" },
  msgText: { color: "var(--text-primary)", lineHeight: 1.5, wordBreak: "break-word" as const, whiteSpace: "pre-wrap" as const, margin: 0 },
  msgImage: { maxWidth: 360, maxHeight: 280, borderRadius: 4, marginTop: 4, display: "block" },
  imageOverlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, cursor: "pointer" },
  imagePreview: { maxWidth: "90%", maxHeight: "90%", borderRadius: 8, objectFit: "contain" as const },
  forwardModal: { background: "var(--bg-primary)", borderRadius: 8, padding: 20, width: 320, maxHeight: "60%", overflowY: "auto" as const, cursor: "default" },
  forwardChatItem: { padding: "10px 12px", borderRadius: 4, cursor: "pointer", color: "var(--text-primary)", fontSize: 14, background: "var(--bg-secondary)", marginBottom: 4 },
  fileLink: { color: "var(--text-link)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4 },
  replyPreview: { background: "var(--bg-secondary)", borderLeft: "3px solid var(--accent)", padding: "4px 8px", borderRadius: 4, marginBottom: 4, fontSize: 12 },
  replyAuthor: { color: "var(--accent)", fontWeight: 600, marginRight: 6 },
  replyText: { color: "var(--text-muted)" },
  replyBtn: { background: "none", color: "var(--text-muted)", fontSize: 14, padding: "2px 6px", opacity: 0.5, position: "absolute" as const, right: 24, top: 0 },
  reactionBtn: { background: "none", color: "var(--text-muted)", fontSize: 14, padding: "2px 6px", opacity: 0.5, position: "absolute" as const, right: 0, top: 0 },
  reactionPicker: { position: "absolute" as const, right: 0, top: -36, background: "var(--bg-tertiary)", borderRadius: 8, padding: 4, display: "flex", gap: 2, zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" },
  reactionEmoji: { background: "none", fontSize: 20, padding: 4, borderRadius: 4, cursor: "pointer" },
  reactionsRow: { display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" as const },
  reactionBadge: { background: "var(--bg-tertiary)", borderRadius: 10, padding: "2px 8px", fontSize: 13 },
  replyBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border)", fontSize: 13, color: "var(--text-secondary)" },
  replyBarClose: { background: "none", color: "var(--text-muted)", fontSize: 16, padding: "2px 8px" },
  typingBar: { padding: "4px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" },
  ctxMenu: { position: "fixed" as const, background: "var(--bg-tertiary)", borderRadius: 6, padding: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", zIndex: 200, minWidth: 160 },
  ctxItem: { display: "block", width: "100%", background: "none", color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, textAlign: "left" as const, borderRadius: 4 },
  editInput: { flex: 1, background: "var(--bg-input)", borderRadius: 4, padding: "4px 8px", fontSize: 13, color: "var(--text-primary)" },
  editSaveBtn: { background: "var(--accent)", color: "#fff", borderRadius: 4, padding: "4px 10px", fontSize: 14 },
  editCancelBtn: { background: "var(--bg-tertiary)", color: "var(--text-muted)", borderRadius: 4, padding: "4px 10px", fontSize: 14 },
  dropOverlay: { position: "absolute" as const, inset: 0, background: "rgba(88,101,242,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", fontSize: 18, fontWeight: 700, zIndex: 50, pointerEvents: "none" as const },
  formatBar: { display: "flex", gap: 4, padding: "4px 16px", background: "var(--bg-primary)", borderTop: "1px solid var(--border)" },
  formatBtn: { background: "none", color: "var(--text-muted)", padding: "4px 10px", borderRadius: 4, fontSize: 13, cursor: "pointer", border: "1px solid transparent" },
  inputBar: { display: "flex", alignItems: "center", gap: 8, padding: "8px 16px 12px", background: "var(--bg-primary)" },
  attachBtn: { background: "var(--bg-input)", color: "var(--text-muted)", width: 36, height: 36, borderRadius: "50%", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  emojiBtn: { background: "none", fontSize: 22, padding: "4px", flexShrink: 0, opacity: 0.7 },
  textInput: { flex: 1, background: "var(--bg-input)", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "var(--text-primary)", resize: "none" as const, fontFamily: "inherit", lineHeight: 1.4, maxHeight: 120, minHeight: 38 },
  sendBtn: { background: "var(--accent)", color: "#fff", width: 36, height: 36, borderRadius: "50%", fontSize: 16, flexShrink: 0, opacity: 1, transition: "opacity 0.15s" },
};
