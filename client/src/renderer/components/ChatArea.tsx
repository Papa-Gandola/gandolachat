import React, { useEffect, useRef, useState } from "react";
import { ChatOut, MessageOut, UserOut, chatApi } from "../services/api";
import { wsService } from "../services/ws";
import { playMessageSound } from "../services/sounds";
import EmojiPicker from "./EmojiPicker";
import FormattedText from "./FormattedText";
import { useTheme } from "../services/theme";

interface Props {
  chat: ChatOut;
  currentUser: UserOut;
  onStartCall: () => void;
  allChats?: ChatOut[];
  onOpenProfile?: (user: UserOut) => void;
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ChatArea({ chat, currentUser, onStartCall, allChats = [], onOpenProfile }: Props) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [pendingMsgs, setPendingMsgs] = useState<MessageOut[]>([]);
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
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const [reactions, setReactions] = useState<Map<number, Array<{ emoji: string; userId: number }>>>(new Map());
  const [showReactionPicker, setShowReactionPicker] = useState<number | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessageOut | null>(null);
  const [readBy, setReadBy] = useState<Map<number, number>>(new Map()); // userId -> lastReadMsgId
  const [chatMuted, setChatMuted] = useState(() => {
    const muted = JSON.parse(localStorage.getItem("mutedChats") || "[]");
    return muted.includes(chat.id);
  });
  const [showFormatBar, setShowFormatBar] = useState(() => localStorage.getItem("showFormatBar") !== "false");
  const [sendFlash, setSendFlash] = useState(false);
  const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [pendingSeenId, setPendingSeenId] = useState<number>(0); // highest msg id actually seen in viewport
  const unreadSinceScrollRef = useRef<number>(0);
  const [unreadSinceScroll, setUnreadSinceScroll] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const atBottomRef = useRef(true);

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
      // If it's our own echoed message, drop the matching pending placeholder.
      // Match strictly by _temp_id so two identical messages sent in quick succession
      // don't share the same pending entry.
      if (data.sender_id === currentUser.id) {
        const tempId = data._temp_id;
        setPendingMsgs((prev) => {
          if (tempId != null) {
            const idx = prev.findIndex((p) => p.id === tempId);
            if (idx < 0) return prev;
            const next = [...prev];
            next.splice(idx, 1);
            return next;
          }
          // Fallback for any old client / server combination: content match (single one only)
          const idx = prev.findIndex((p) => p.content === data.content);
          if (idx < 0) return prev;
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
      }
      const isMine = data.sender_id === currentUser.id;
      const atBottomNow = atBottomRef.current;
      if (!isMine) {
        const isMuted = JSON.parse(localStorage.getItem("mutedChats") || "[]").includes(chat.id);
        if (!isMuted) {
          playMessageSound();
          showNotification(data.sender_username, data.content || "Sent a file");
        }
        // Only auto-mark-read if the new message is going to be visible (we're at the bottom
        // and the window has focus). Otherwise leave it unread — IntersectionObserver will
        // mark it once it actually scrolls into view.
        if (atBottomNow && document.hasFocus()) {
          wsService.send({ type: "mark_read", chat_id: chat.id, message_id: data.id });
        } else {
          unreadSinceScrollRef.current += 1;
          setUnreadSinceScroll(unreadSinceScrollRef.current);
        }
      } else {
        // My own message: always mark as read (server knows this but keeps things consistent)
        wsService.send({ type: "mark_read", chat_id: chat.id, message_id: data.id });
      }
      // Auto-scroll only if we were already at the bottom (or the new message is ours)
      if (isMine || atBottomNow) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    };

    const reconnectHandler = () => {
      // On WS (re)connect, flush the pending queue — server has never seen them.
      setPendingMsgs((prev) => {
        prev.forEach((p) => {
          wsService.send({
            type: "message",
            chat_id: chat.id,
            content: p.content,
            reply_to_id: p.reply_to_id || null,
            _temp_id: p.id,
          });
        });
        return prev;
      });
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
    wsService.on("_ws_open", reconnectHandler);
    return () => {
      wsService.off("message", handler);
      wsService.off("typing", typingHandler);
      wsService.off("message_edited", editHandler);
      wsService.off("message_deleted", deleteHandler);
      wsService.off("reaction", reactionHandler);
      wsService.off("reaction_removed", reactionRemovedHandler);
      wsService.off("message_read", readHandler);
      wsService.off("_ws_open", reconnectHandler);
    };
  }, [chat.id, currentUser.id]);

  // Close context menu on click anywhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // Track online users
  useEffect(() => {
    chatApi.getOnlineUsers().then((res) => setOnlineUserIds(new Set(res.data.online_user_ids))).catch(() => {});
    const onOnline = (d: any) => setOnlineUserIds((prev) => new Set([...prev, d.user_id]));
    const onOffline = (d: any) => setOnlineUserIds((prev) => { const n = new Set(prev); n.delete(d.user_id); return n; });
    wsService.on("user_online", onOnline);
    wsService.on("user_offline", onOffline);
    return () => { wsService.off("user_online", onOnline); wsService.off("user_offline", onOffline); };
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
  const seenIdRef = useRef<number>(0);

  // Mark messages as read only when they actually become visible in the viewport.
  useEffect(() => {
    const root = messagesRef.current;
    if (!root) return;
    const obs = new IntersectionObserver((entries) => {
      let maxSeen = seenIdRef.current;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idStr = (entry.target as HTMLElement).dataset.msgId;
        if (!idStr) continue;
        const id = Number(idStr);
        if (id > maxSeen && id > 0) maxSeen = id;
      }
      if (maxSeen > seenIdRef.current && document.hasFocus()) {
        seenIdRef.current = maxSeen;
        wsService.send({ type: "mark_read", chat_id: chat.id, message_id: maxSeen });
      }
    }, { root, threshold: 0.6 });
    // Observe every rendered message row
    root.querySelectorAll("[data-msg-id]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [chat.id, messages.length, pendingMsgs.length]);

  // When the user focuses the window and we're at the bottom, flush-mark the last visible message.
  useEffect(() => {
    const onFocus = () => {
      if (!atBottomRef.current) return;
      const last = messages[messages.length - 1];
      if (last && last.id > seenIdRef.current) {
        seenIdRef.current = last.id;
        wsService.send({ type: "mark_read", chat_id: chat.id, message_id: last.id });
        unreadSinceScrollRef.current = 0;
        setUnreadSinceScroll(0);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [chat.id, messages]);

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
      // Don't mark-read blindly on load — IntersectionObserver will mark as
      // messages actually scroll into view. Scroll to bottom on first open.
      setTimeout(() => {
        bottomRef.current?.scrollIntoView();
        atBottomRef.current = true;
        setAtBottom(true);
      }, 100);
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
    const el = e.currentTarget;
    if (el.scrollTop === 0 && hasMore) {
      loadOlderMessages();
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAtBottom = distanceFromBottom < 80;
    atBottomRef.current = isAtBottom;
    setAtBottom(isAtBottom);
    if (isAtBottom && unreadSinceScrollRef.current > 0) {
      unreadSinceScrollRef.current = 0;
      setUnreadSinceScroll(0);
    }
  }

  function jumpToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    unreadSinceScrollRef.current = 0;
    setUnreadSinceScroll(0);
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

  async function scrollToMessage(msgId: number) {
    // If the target isn't in the current list, page older messages in until it is (or we run out).
    let attempts = 0;
    while (!messages.some((m) => m.id === msgId) && hasMore && attempts < 5) {
      await loadOlderMessages();
      attempts++;
    }
    const el = messagesRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
    if (!el) return;
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightMsgId(msgId);
    setTimeout(() => setHighlightMsgId((curr) => (curr === msgId ? null : curr)), 1500);
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
    const content = text.trim();
    // Optimistic: always enqueue pending placeholder so user sees something immediately,
    // even when WS is offline. It gets removed when the server echoes the real message.
    const tempMsg: MessageOut = {
      id: -Date.now(),
      chat_id: chat.id,
      sender_id: currentUser.id,
      sender_username: currentUser.username,
      sender_avatar: currentUser.avatar_url,
      content,
      file_url: null,
      file_name: null,
      is_edited: false,
      created_at: new Date().toISOString(),
      reply_to_id: replyTo?.id ?? null,
      reply_to_username: replyTo?.sender_username ?? null,
      reply_to_content: replyTo?.content ?? null,
    };
    setPendingMsgs((prev) => [...prev, tempMsg]);
    wsService.send({
      type: "message",
      chat_id: chat.id,
      content,
      reply_to_id: replyTo?.id || null,
      _temp_id: tempMsg.id,
    });
    setText("");
    setReplyTo(null);
    // Trigger SEND glow flash
    setSendFlash(true);
    setTimeout(() => setSendFlash(false), 300);
    // Reset textarea height after sending (it shrunk, so we reset autoresize state)
    if (textInputRef.current) textInputRef.current.style.height = "auto";
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
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
    const build = () => {
      const n = new Notification(title, { body });
      n.onclick = () => {
        (window as any).electron?.focus?.();
        window.dispatchEvent(new CustomEvent("switch-chat", { detail: { chatId: chat.id } }));
        n.close();
      };
      return n;
    };
    if (Notification.permission === "granted") {
      build();
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") build();
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

  // Group messages by date (search results never include pending — they came from server)
  const displayMessages = searchResults ?? [...messages, ...pendingMsgs];
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
          <span style={{ ...s.chatIcon, ...(isNeo ? { ...mono, color: "var(--accent)" } : {}) }}>{chat.is_group ? "#" : "@"}</span>
          <span style={{ ...s.chatTitle, ...(isNeo ? mono : {}) }}>{getChatTitle()}</span>
          {!chat.is_group && (() => {
            const other = chat.members.find((m) => m.id !== currentUser.id);
            if (!other) return null;
            const isOnline = onlineUserIds.has(other.id);
            const lastSeen = formatLastSeen(other.last_seen);
            return (
              <>
                {other.status && <span style={s.chatStatus}>— {other.status}</span>}
                {isOnline ? (
                  <span style={{ ...s.lastSeen, color: "#57f287" }}>● онлайн</span>
                ) : lastSeen ? (
                  <span style={s.lastSeen}>{lastSeen}</span>
                ) : null}
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
            <div className="date-divider">
              <span className="label">{group.date}</span>
            </div>
            {group.messages.map((msg, i) => {
              const prev = group.messages[i - 1];
              const isMine = msg.sender_id === currentUser.id;
              const isPending = msg.id < 0;
              const isGrouped = prev && prev.sender_id === msg.sender_id &&
                (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60000;

              const neoBubble = isNeo ? {
                maxWidth: "68%",
                padding: "9px 13px",
                background: isMine ? "var(--bubble-mine)" : "var(--bg-message)",
                color: isMine ? "var(--accent-text)" : "var(--text-primary)",
                border: isMine ? "none" : "1px solid var(--border)",
                borderRadius: 14,
                borderTopLeftRadius: isMine ? 14 : 6,
                borderTopRightRadius: isMine ? 6 : 14,
              } : {};

              // Discord bubble: same layout as Neo (own right, other left) but Discord colors
              const discordBubble = !isNeo ? {
                maxWidth: "68%",
                padding: "8px 12px",
                background: isMine ? "var(--accent)" : "var(--bg-message)",
                color: isMine ? "#fff" : "var(--text-primary)",
                borderRadius: 16,
                borderTopLeftRadius: isMine ? 16 : 4,
                borderTopRightRadius: isMine ? 4 : 16,
              } : {};

              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  className={`msg-row-hover ${highlightMsgId === msg.id ? "msg-highlight" : ""}`}
                  style={{
                    ...s.msgRow,
                    marginTop: isGrouped ? 2 : 16,
                    justifyContent: isMine ? "flex-end" : "flex-start",
                  }}
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
                  {/* Avatar: hidden for own messages; for others show only on first of group */}
                  {!isMine && (!isGrouped ? (
                    <div style={{ ...s.avatarSmall, cursor: "pointer" }} onClick={() => {
                      const member = chat.members.find((m) => m.id === msg.sender_id);
                      if (member && onOpenProfile) onOpenProfile(member);
                    }}>
                      <AvatarSmall name={msg.sender_username} url={msg.sender_avatar} />
                    </div>
                  ) : (
                    <div style={{ width: 40 }} />
                  ))}
                  <div style={{ ...s.msgContent, flex: "0 1 auto", ...(isNeo ? neoBubble : discordBubble), ...(isPending ? { opacity: 0.7 } : {}) }}>
                    {!isGrouped && (
                      <div style={s.msgMeta}>
                        <span
                          style={{
                            ...s.msgAuthor,
                            color: isNeo && isMine
                              ? "rgba(10,10,10,0.85)"
                              : (!isNeo && isMine
                                ? "rgba(255,255,255,0.95)"
                                : (isMine ? "var(--accent)" : "var(--text-header)")),
                            cursor: isMine ? "default" : "pointer",
                            ...(isNeo ? mono : {}),
                          }}
                          onClick={() => {
                            if (isMine) return;
                            const member = chat.members.find((m) => m.id === msg.sender_id);
                            if (member && onOpenProfile) onOpenProfile(member);
                          }}
                        >
                          {isMine ? "Вы" : msg.sender_username}
                        </span>
                        <span style={{
                          ...s.msgTime,
                          ...(isNeo ? mono : {}),
                          ...(isNeo && isMine ? { color: "rgba(10,10,10,0.55)" } : {}),
                          ...(!isNeo && isMine ? { color: "rgba(255,255,255,0.7)" } : {}),
                        }}>{formatTime(msg.created_at)}</span>
                      </div>
                    )}
                    {/* Reply preview */}
                    {msg.reply_to_id && msg.reply_to_username && (
                      <div
                        style={{ ...s.replyPreview, cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); scrollToMessage(msg.reply_to_id!); }}
                        title="Перейти к сообщению"
                      >
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
                        {msg.content && (() => {
                          const pokerMatch = msg.content.match(/^\/poker_table (\d+)$/);
                          if (pokerMatch) {
                            return <PokerInviteCard tableId={Number(pokerMatch[1])} chatId={chat.id} isNeo={isNeo} senderName={msg.sender_username} />;
                          }
                          return <p style={{ ...s.msgText, ...(isNeo && isMine ? { color: "#0a0a0a" } : {}), ...(!isNeo && isMine ? { color: "#fff" } : {}) }}><FormattedText text={msg.content} /></p>;
                        })()}
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
                    {/* Per-message footer: edited marker + ReadBar — shown on every own/edited msg */}
                    {(msg.is_edited || isMine) && (
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 6,
                        marginTop: 2,
                        fontSize: 10,
                        color: isMine
                          ? (isNeo ? "rgba(10,10,10,0.6)" : "rgba(255,255,255,0.75)")
                          : "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                      }}>
                        {msg.is_edited && (
                          <span style={{
                            letterSpacing: 0.5,
                            opacity: 0.75,
                            textTransform: "lowercase" as const,
                          }}>[ред.]</span>
                        )}
                        {isMine && (() => {
                          if (isPending) return <ReadBar status="sending" />;
                          const otherMembers = chat.members.filter((m) => m.id !== currentUser.id);
                          const anyRead = otherMembers.some((m) => (readBy.get(m.id) || 0) >= msg.id);
                          const allRead = otherMembers.length > 0 && otherMembers.every((m) => (readBy.get(m.id) || 0) >= msg.id);
                          const status: ReadStatus = allRead ? "read" : (anyRead ? "delivered" : "sent");
                          return <ReadBar status={status} />;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Jump-to-bottom floating button (Telegram-style) */}
      {!atBottom && (
        <button
          onClick={jumpToBottom}
          title="К последним сообщениям"
          style={{
            position: "absolute",
            right: 24,
            bottom: 130,
            width: 44,
            height: 44,
            borderRadius: isNeo ? 0 : "50%",
            background: isNeo ? "transparent" : "var(--bg-secondary)",
            border: isNeo ? "1.5px solid var(--accent)" : "1px solid var(--border)",
            color: isNeo ? "var(--accent)" : "var(--text-primary)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 40,
            fontSize: 18,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {unreadSinceScroll > 0 && (
            <span style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 20,
              height: 20,
              borderRadius: isNeo ? 0 : 10,
              background: "#ed4245",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              padding: "0 5px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: isNeo ? "var(--font-mono)" : undefined,
            }}>
              {unreadSinceScroll > 99 ? "99+" : unreadSinceScroll}
            </span>
          )}
        </button>
      )}

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
      {typingText && <div style={{ ...s.typingBar, ...(isNeo ? { ...mono, color: "var(--accent)" } : {}) }}>
        {isNeo ? `> ${typingText.replace("печатает...", "typing_")}` : typingText}
      </div>}

      {/* Format toolbar — collapsible drawer */}
      <div style={{ ...s.formatBar, overflow: "hidden", padding: showFormatBar ? "4px 16px" : "0 16px", maxHeight: showFormatBar ? 40 : 0, transition: "max-height 0.2s ease, padding 0.2s ease", borderTop: showFormatBar ? "1px solid var(--border)" : "none" }}>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => wrapSelection("**")} title="Жирный"><b>B</b></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => wrapSelection("*")} title="Курсив"><i>I</i></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => wrapSelection("__")} title="Подчёркнутый"><u>U</u></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => wrapSelection("~~")} title="Зачёркнутый"><s>S</s></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => wrapSelection("||")} title="Спойлер">▮</button>
        <button
          type="button"
          title="Скрыть панель форматирования"
          onClick={() => { setShowFormatBar(false); localStorage.setItem("showFormatBar", "false"); }}
          style={{ ...s.formatBtn, marginLeft: "auto", color: "var(--text-muted)" }}
        >▾</button>
      </div>
      {!showFormatBar && (
        <div style={{ display: "flex", justifyContent: "center", padding: "2px 0", borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            title="Показать форматирование"
            onClick={() => { setShowFormatBar(true); localStorage.setItem("showFormatBar", "true"); }}
            style={{ background: "none", color: "var(--text-muted)", fontSize: 10, padding: "2px 12px", letterSpacing: 2, ...(isNeo ? mono : {}) }}
          >▴ Aa</button>
        </div>
      )}

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
        {isNeo && <span style={{ color: "var(--accent)", ...mono, fontSize: 14, marginRight: 2 }}>&gt;</span>}
        <textarea
          ref={textInputRef}
          style={{ ...s.textInput, ...(isNeo ? mono : {}), overflowY: "auto" as const }}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleTyping();
            // Auto-resize: grow upward with content, cap at 160px (~6 lines)
            const ta = e.target;
            ta.style.height = "auto";
            ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
          }}
          placeholder={isNeo
            ? `написать_${(chat.is_group ? chat.name : getChatTitle())?.toLowerCase().replace(/\s+/g, "_")}...`
            : `Написать ${chat.is_group ? "в группе" : getChatTitle()}...`}
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
        <button
          type="submit"
          className={isNeo ? `send-btn-neo ${sendFlash ? "flash" : ""}` : ""}
          style={{
            ...s.sendBtn,
            ...(isNeo ? { ...mono, borderRadius: 0, width: "auto", padding: "9px 16px", fontSize: 12, fontWeight: 700, letterSpacing: 1 } : {}),
          }}
          disabled={!text.trim()}
        >{isNeo ? "SEND" : "➤"}</button>
      </form>
    </div>
  );
}

function PokerInviteCard({ tableId, chatId, isNeo, senderName }: { tableId: number; chatId: number; isNeo: boolean; senderName: string }) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 12px",
      background: isNeo ? "transparent" : "rgba(88,101,242,0.08)",
      border: `1px solid ${isNeo ? "var(--accent)" : "rgba(88,101,242,0.4)"}`,
      borderRadius: isNeo ? 0 : 8,
      margin: "4px 0",
      maxWidth: 360,
    }}>
      <div style={{ fontSize: 28 }}>🎴</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...mono, color: "var(--text-header)", fontWeight: 700, fontSize: 14 }}>
          {isNeo ? `// ПОКЕРНЫЙ_СТОЛ #${tableId}` : `Покерный стол #${tableId}`}
        </div>
        <div style={{ ...mono, color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
          {isNeo ? `${senderName} зовёт играть` : `${senderName} зовёт играть в покер`}
        </div>
      </div>
      <button
        onClick={() => {
          // Switch to poker mode in this chat and let Poker component focus the table
          localStorage.setItem("gandola-mode", "poker");
          window.dispatchEvent(new CustomEvent("set-app-mode", { detail: { mode: "poker" } }));
          window.dispatchEvent(new CustomEvent("open-poker-table", { detail: { chatId, tableId } }));
        }}
        style={{
          background: "var(--accent)",
          color: "var(--accent-text)",
          border: "none",
          borderRadius: isNeo ? 0 : 6,
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          letterSpacing: isNeo ? "0.05em" : undefined,
          ...mono,
        }}
      >
        {isNeo ? "[СЕСТЬ]" : "Сесть"}
      </button>
    </div>
  );
}

type ReadStatus = "sending" | "sent" | "delivered" | "read";

function ReadBar({ status }: { status: ReadStatus }) {
  const fill = { sending: 0, sent: 1, delivered: 2, read: 3 }[status];
  const [pulse, setPulse] = React.useState(false);
  const prev = React.useRef(status);
  React.useEffect(() => {
    if (prev.current !== status && fill > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 400);
      prev.current = status;
      return () => clearTimeout(t);
    }
    prev.current = status;
  }, [status, fill]);
  return (
    <span className={`readbar ${pulse ? "just-updated" : ""}`} aria-label={status}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={
            `notch ${i < fill ? "on" : ""} ${status === "sending" ? "shimmer" : ""}`
          }
        />
      ))}
    </span>
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
  editSaveBtn: { background: "var(--accent)", color: "var(--accent-text)", borderRadius: 4, padding: "4px 10px", fontSize: 14 },
  editCancelBtn: { background: "var(--bg-tertiary)", color: "var(--text-muted)", borderRadius: 4, padding: "4px 10px", fontSize: 14 },
  dropOverlay: { position: "absolute" as const, inset: 0, background: "rgba(88,101,242,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", fontSize: 18, fontWeight: 700, zIndex: 50, pointerEvents: "none" as const },
  formatBar: { display: "flex", gap: 4, padding: "4px 16px", background: "var(--bg-primary)", borderTop: "1px solid var(--border)" },
  formatBtn: { background: "none", color: "var(--text-muted)", padding: "4px 10px", borderRadius: 4, fontSize: 13, cursor: "pointer", border: "1px solid transparent" },
  inputBar: { display: "flex", alignItems: "center", gap: 8, padding: "8px 16px 12px", background: "var(--bg-primary)" },
  attachBtn: { background: "var(--bg-input)", color: "var(--text-muted)", width: 36, height: 36, borderRadius: "50%", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  emojiBtn: { background: "none", fontSize: 22, padding: "4px", flexShrink: 0, opacity: 0.7 },
  textInput: { flex: 1, background: "var(--bg-input)", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "var(--text-primary)", resize: "none" as const, fontFamily: "inherit", lineHeight: 1.4, maxHeight: 120, minHeight: 38 },
  sendBtn: { background: "var(--accent)", color: "var(--accent-text)", width: 36, height: 36, borderRadius: "50%", fontSize: 16, flexShrink: 0, opacity: 1, transition: "opacity 0.15s" },
};
