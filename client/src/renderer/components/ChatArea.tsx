import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  onOpenChatInfo?: (chat: ChatOut) => void;
  // External requests routed back into ChatArea (from GroupInfoPage action buttons)
  pendingOpenSearch?: boolean;
  pendingAddMember?: boolean;
  onPendingHandled?: () => void;
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function ChatArea({ chat, currentUser, onStartCall, allChats = [], onOpenProfile, onOpenChatInfo, pendingOpenSearch, pendingAddMember, onPendingHandled }: Props) {
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
  const [replyTo, setReplyToState] = useState<MessageOut | null>(null);
  const setReplyTo = (msg: MessageOut | null) => {
    setReplyToState(msg);
    if (msg) setTimeout(() => textInputRef.current?.focus(), 0);
  };
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flipX: boolean; flipY: boolean; msg: MessageOut } | null>(null);
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
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ file: File; caption: string; preview: string | null }>>([]);
  const [uploadingPack, setUploadingPack] = useState(false);
  const [otherLastSeenAt, setOtherLastSeenAt] = useState<string | null | undefined>(undefined);
  const [, setTimeTick] = useState(0);

  // External request: GroupInfoPage asked us to open the search bar
  useEffect(() => {
    if (pendingOpenSearch) {
      setShowSearch(true);
      onPendingHandled?.();
    }
  }, [pendingOpenSearch]);
  // External request: GroupInfoPage asked us to show "add member" UI.
  // MemberList already has that flow; we just emit a custom event for it to pick up.
  useEffect(() => {
    if (pendingAddMember) {
      window.dispatchEvent(new CustomEvent("focus-add-member", { detail: { chatId: chat.id } }));
      onPendingHandled?.();
    }
  }, [pendingAddMember]);
  const [atBottom, setAtBottom] = useState(true);
  const [pendingSeenId, setPendingSeenId] = useState<number>(0); // highest msg id actually seen in viewport
  const unreadSinceScrollRef = useRef<number>(0);
  const [unreadSinceScroll, setUnreadSinceScroll] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLDivElement>(null);
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
      setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data as MessageOut]);
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
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== data.message_id);
        if (prev.length > 0 && prev[prev.length - 1].id === data.message_id) {
          window.dispatchEvent(new CustomEvent("chat-last-message-changed", {
            detail: { chatId: chat.id, message: filtered[filtered.length - 1] ?? null },
          }));
        }
        return filtered;
      });
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

  // Track online users + capture last_seen on offline
  useEffect(() => {
    chatApi.getOnlineUsers().then((res) => setOnlineUserIds(new Set(res.data.online_user_ids))).catch(() => {});
    const onOnline = (d: any) => setOnlineUserIds((prev) => new Set([...prev, d.user_id]));
    const onOffline = (d: any) => {
      setOnlineUserIds((prev) => { const n = new Set(prev); n.delete(d.user_id); return n; });
      if (!chat.is_group && d.last_seen) {
        const other = chat.members.find((m) => m.id !== currentUser.id);
        if (other && d.user_id === other.id) setOtherLastSeenAt(d.last_seen);
      }
    };
    wsService.on("user_online", onOnline);
    wsService.on("user_offline", onOffline);
    return () => { wsService.off("user_online", onOnline); wsService.off("user_offline", onOffline); };
  }, [chat.id]);

  // Re-render every minute so relative "X min ago" timestamps stay current
  useEffect(() => {
    const id = setInterval(() => setTimeTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
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
  const prevScrollHeightRef = useRef<number>(0);
  const didLoadOlderRef = useRef(false);
  const didInitialLoadRef = useRef(false);

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
      didInitialLoadRef.current = true;
    } finally {
      setLoading(false);
    }
  }

  useLayoutEffect(() => {
    if (didInitialLoadRef.current) {
      didInitialLoadRef.current = false;
      const el = messagesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      setAtBottom(true);
      return;
    }
    if (!didLoadOlderRef.current) return;
    didLoadOlderRef.current = false;
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollTop + (el.scrollHeight - prevScrollHeightRef.current);
  }, [messages]);

  async function loadOlderMessages() {
    if (!hasMore || loading || messages.length === 0) return;
    const oldest = messages[0];
    const el = messagesRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;
    didLoadOlderRef.current = true;
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

  function htmlToMarkdown(el: HTMLElement): string {
    type Sty = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; spoiler: boolean };
    const none: Sty = { bold: false, italic: false, underline: false, strike: false, spoiler: false };
    const leaves: { text: string; sty: Sty }[] = [];

    function collect(node: Node, sty: Sty) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent || "";
        if (t) leaves.push({ text: t, sty: { ...sty } });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const elem = node as HTMLElement;
      const tag = elem.tagName.toLowerCase();
      // Trailing <br> (no nextSibling) is a Chromium layout artifact — skip it
      if (tag === "br") { if (node.nextSibling) leaves.push({ text: "\n", sty: { ...none } }); return; }
      if ((tag === "div" || tag === "p") && leaves.length > 0) leaves.push({ text: "\n", sty: { ...none } });
      const ns: Sty = { ...sty };
      if (tag === "b" || tag === "strong") ns.bold = true;
      if (tag === "i" || tag === "em") ns.italic = true;
      if (tag === "u") ns.underline = true;
      if (tag === "s" || tag === "strike" || tag === "del") ns.strike = true;
      if (elem.dataset.format === "spoiler") ns.spoiler = true;
      elem.childNodes.forEach(c => collect(c, ns));
    }
    collect(el, { ...none });

    const groups: { text: string; sty: Sty }[] = [];
    for (const leaf of leaves) {
      const last = groups[groups.length - 1];
      if (last && last.sty.bold === leaf.sty.bold && last.sty.italic === leaf.sty.italic &&
          last.sty.underline === leaf.sty.underline && last.sty.strike === leaf.sty.strike &&
          last.sty.spoiler === leaf.sty.spoiler) {
        last.text += leaf.text;
      } else {
        groups.push({ text: leaf.text, sty: { ...leaf.sty } });
      }
    }

    function wrap(text: string, s: Sty): string {
      if (!s.bold && !s.italic && !s.underline && !s.strike && !s.spoiler) return text;
      let r = text;
      if (s.spoiler) r = `||${r}||`;
      if (s.strike) r = `~~${r}~~`;
      if (s.underline) r = `__${r}__`;
      if (s.bold && s.italic) r = `***${r}***`;
      else if (s.bold) r = `**${r}**`;
      else if (s.italic) r = `*${r}*`;
      return r;
    }

    let result = "";
    for (const g of groups) {
      const str = wrap(g.text, g.sty);
      // Insert ZWS between adjacent `*`/`_` markers to prevent parser ambiguity
      if (result.length > 0 && str.length > 0) {
        const lc = result[result.length - 1];
        const fc = str[0];
        if ((lc === "*" || lc === "_") && (fc === "*" || fc === "_")) result += "​";
      }
      result += str;
    }
    return result;
  }

  // Convert markdown string → HTML for initializing the contenteditable edit area.
  function markdownToHtml(text: string): string {
    let out = "";
    let i = 0;
    const markers: [string, string][] = [
      ["***", "bolditalic"], ["**", "b"], ["__", "u"], ["~~", "s"], ["||", "spoiler"], ["*", "i"],
    ];
    while (i < text.length) {
      if (text[i] === "\n") { out += "<br>"; i++; continue; }
      if (text[i] === "&") { out += "&amp;"; i++; continue; }
      if (text[i] === "<") { out += "&lt;"; i++; continue; }
      if (text[i] === ">") { out += "&gt;"; i++; continue; }
      let matched = false;
      for (const [marker, type] of markers) {
        if (text.startsWith(marker, i)) {
          const end = text.indexOf(marker, i + marker.length);
          if (end > i + marker.length) {
            const inner = markdownToHtml(text.slice(i + marker.length, end));
            if (type === "bolditalic") out += `<b><i>${inner}</i></b>`;
            else if (type === "spoiler") out += `<span data-format="spoiler" style="background:var(--bg-tertiary);color:var(--text-muted);border-radius:3px;padding:0 2px;cursor:default">${inner}</span>`;
            else out += `<${type}>${inner}</${type}>`;
            i = end + marker.length;
            matched = true;
            break;
          }
        }
      }
      if (!matched) { out += text[i]; i++; }
    }
    return out;
  }

  // Populate the edit contenteditable when a message is opened for editing.
  useEffect(() => {
    if (!editingMsg || !editInputRef.current) return;
    editInputRef.current.innerHTML = markdownToHtml(editingMsg.content || "");
    editInputRef.current.style.height = "auto";
    editInputRef.current.style.height = Math.min(editInputRef.current.scrollHeight, 200) + "px";
    editInputRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editInputRef.current);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [editingMsg?.id]);

  function applyFormat(command: string) {
    const el = textInputRef.current;
    if (!el) return;
    el.focus();
    const _sel = window.getSelection();
    if (!_sel || _sel.rangeCount === 0 || _sel.getRangeAt(0).collapsed) return;
    if (command === "spoiler") {
      const range = _sel.getRangeAt(0);
      // Check if selection starts inside an existing spoiler span
      let startNode: globalThis.Node | null = range.startContainer;
      if (startNode.nodeType === globalThis.Node.TEXT_NODE) startNode = startNode.parentElement;
      const startSpoiler = (startNode as HTMLElement).closest?.("[data-format='spoiler']");
      if (startSpoiler) {
        // Unwrap the spoiler containing the selection start
        const parent = startSpoiler.parentNode!;
        while (startSpoiler.firstChild) parent.insertBefore(startSpoiler.firstChild, startSpoiler);
        parent.removeChild(startSpoiler);
      } else {
        // Unwrap any spoilers the selection intersects, or wrap if none
        const intersecting = Array.from(el.querySelectorAll("[data-format='spoiler']"))
          .filter(sp => range.intersectsNode(sp));
        if (intersecting.length > 0) {
          for (const sp of intersecting) {
            const p = sp.parentNode!;
            while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
            p.removeChild(sp);
          }
        } else {
          const span = document.createElement("span");
          span.dataset.format = "spoiler";
          span.style.cssText = "background:var(--bg-tertiary);color:var(--text-muted);border-radius:3px;padding:0 2px;cursor:default";
          try {
            range.surroundContents(span);
          } catch {
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
          }
          // Place cursor after the span so subsequent typing is outside the spoiler
          const after = document.createRange();
          after.setStartAfter(span);
          after.collapse(true);
          _sel.removeAllRanges();
          _sel.addRange(after);
        }
      }
    } else {
      document.execCommand(command);
    }
    setText(el.innerText.trim());
  }

  function resetInlineFormat() {
    if (document.queryCommandState("bold")) document.execCommand("bold");
    if (document.queryCommandState("italic")) document.execCommand("italic");
    if (document.queryCommandState("underline")) document.execCommand("underline");
    if (document.queryCommandState("strikeThrough")) document.execCommand("strikeThrough");
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
    const el = textInputRef.current;
    const content = el ? htmlToMarkdown(el).trim() : "";
    if (!content) return;
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
    if (el) { el.innerHTML = ""; el.style.height = "auto"; }
    setText("");
    setReplyTo(null);
    // Trigger SEND glow flash
    setSendFlash(true);
    setTimeout(() => setSendFlash(false), 300);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function sendFile(file: File) {
    await chatApi.uploadFile(chat.id, file);
  }

  function queueFiles(files: File[]) {
    if (files.length === 0) return;
    // Cap at 10 per pack; if user dropped 12 we keep the first 10
    const toAdd = files.slice(0, 10 - pendingAttachments.length);
    const enriched = toAdd.map((file) => ({
      file,
      caption: "",
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPendingAttachments((prev) => [...prev, ...enriched].slice(0, 10));
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    queueFiles(files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    queueFiles(files);
  }

  async function sendAttachmentPack() {
    if (pendingAttachments.length === 0) return;
    setUploadingPack(true);
    const groupId = pendingAttachments.length > 1 ? `mg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined;
    try {
      // Upload sequentially so the server-side broadcast order matches the user's order
      for (const att of pendingAttachments) {
        if (att.file.size > 10 * 1024 * 1024) {
          alert(`Файл "${att.file.name}" больше 10 МБ`);
          continue;
        }
        await chatApi.uploadFile(chat.id, att.file, att.caption, groupId);
      }
      // Free preview URLs
      pendingAttachments.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); });
      setPendingAttachments([]);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Ошибка загрузки файлов");
    } finally {
      setUploadingPack(false);
    }
  }

  function removePendingAttachment(idx: number) {
    setPendingAttachments((prev) => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return next;
    });
  }

  function setPendingCaption(idx: number, caption: string) {
    setPendingAttachments((prev) => prev.map((a, i) => i === idx ? { ...a, caption } : a));
  }

  function handleEditSave() {
    if (!editingMsg) return;
    const content = editInputRef.current ? htmlToMarkdown(editInputRef.current).trim() : "";
    if (!content) return;
    wsService.send({ type: "edit_message", message_id: editingMsg.id, content });
    setEditingMsg(null);
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
          queueFiles(files);
        }
      }}
    >
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          {chat.is_group ? (
            <GroupHeaderAvatar
              chat={chat}
              currentUser={currentUser}
              isNeo={isNeo}
            />
          ) : (
            <span style={{ ...s.chatIcon, ...(isNeo ? { ...mono, color: "var(--accent)" } : {}) }}>@</span>
          )}
          <span
            style={{
              ...s.chatTitle,
              ...(isNeo ? mono : {}),
              cursor: "pointer",
              textDecoration: "none",
              transition: "opacity 0.1s",
            }}
            onClick={() => {
              if (chat.is_group) {
                onOpenChatInfo?.(chat);
              } else {
                const other = chat.members.find((m) => m.id !== currentUser.id);
                if (other) onOpenProfile?.(other);
              }
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.opacity = "0.7"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.opacity = "1"; }}
            title={chat.is_group ? "Открыть информацию о группе" : "Открыть профиль"}
          >{getChatTitle()}</span>
          {chat.is_group && chat.allow_all_write === false && (
            <span title="Канал — пишет только создатель" style={{ marginLeft: 6, color: "var(--text-muted)", fontSize: 14 }}>🔒</span>
          )}
          {!chat.is_group && (() => {
            const other = chat.members.find((m) => m.id !== currentUser.id);
            if (!other) return null;
            const isOnline = onlineUserIds.has(other.id);
            const lastSeen = formatLastSeen(otherLastSeenAt !== undefined ? otherLastSeenAt : other.last_seen);
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
          <button style={s.headerBtn} title="Звонок" onClick={onStartCall}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.6 10.8a15.4 15.4 0 006.6 6.6l2.2-2.2a1 1 0 011.1-.2 11.5 11.5 0 003.6.7 1 1 0 011 1V21a1 1 0 01-1 1A17 17 0 012 5a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.7 3.6a1 1 0 01-.2 1.1L6.6 10.8z"/>
            </svg>
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
              const inSamePack = prev && msg.media_group_id && prev.media_group_id === msg.media_group_id;
              const isGrouped = (prev && prev.sender_id === msg.sender_id &&
                (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60000) || !!inSamePack;

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
                  onDoubleClick={() => { if (editingMsg?.id !== msg.id) setReplyTo(msg); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const MENU_W = 252;
                    const MENU_H = msg.sender_id === currentUser.id ? 330 : 265;
                    const flipX = e.clientX + MENU_W + 8 > window.innerWidth;
                    const flipY = e.clientY + MENU_H + 8 > window.innerHeight;
                    setContextMenu({ x: e.clientX, y: e.clientY, flipX, flipY, msg });
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
                    {msg.reply_to_id && msg.reply_to_username && (() => {
                      // Custom palette when the reply preview sits inside our own coloured
                      // bubble — otherwise text reads accent-on-accent and disappears.
                      const ownNeo = isNeo && isMine;
                      const ownDiscord = !isNeo && isMine;
                      const previewOverride: React.CSSProperties =
                        ownNeo ? {
                          background: "rgba(0,0,0,0.18)",
                          borderLeft: "3px solid rgba(0,0,0,0.5)",
                        } : ownDiscord ? {
                          background: "rgba(255,255,255,0.16)",
                          borderLeft: "3px solid rgba(255,255,255,0.6)",
                        } : {};
                      const authorOverride: React.CSSProperties =
                        ownNeo ? { color: "rgba(0,0,0,0.85)" } :
                        ownDiscord ? { color: "rgba(255,255,255,0.95)" } : {};
                      const textOverride: React.CSSProperties =
                        ownNeo ? { color: "rgba(0,0,0,0.65)" } :
                        ownDiscord ? { color: "rgba(255,255,255,0.75)" } : {};
                      return (
                        <div
                          style={{ ...s.replyPreview, ...previewOverride, cursor: "pointer" }}
                          onClick={(e) => { e.stopPropagation(); scrollToMessage(msg.reply_to_id!); }}
                          title="Перейти к сообщению"
                        >
                          <span style={{ ...s.replyAuthor, ...authorOverride }}>{msg.reply_to_username}</span>
                          <span style={{ ...s.replyText, ...textOverride }}>{msg.reply_to_content ? <FormattedText text={msg.reply_to_content} staticSpoiler /> : "..."}</span>
                        </div>
                      );
                    })()}
                    {/* Editing */}
                    {editingMsg?.id === msg.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                        <div
                          ref={editInputRef}
                          contentEditable
                          suppressContentEditableWarning
                          style={s.editInput}
                          onInput={(e) => {
                            const div = e.currentTarget;
                            div.style.height = "auto";
                            div.style.height = Math.min(div.scrollHeight, 200) + "px";
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                            if (e.key === "Escape") setEditingMsg(null);
                            if (e.ctrlKey && !e.shiftKey && e.code === "KeyB") { e.preventDefault(); if (!e.repeat) document.execCommand("bold"); }
                            if (e.ctrlKey && !e.shiftKey && e.code === "KeyI") { e.preventDefault(); if (!e.repeat) document.execCommand("italic"); }
                            if (e.ctrlKey && !e.shiftKey && e.code === "KeyU") { e.preventDefault(); if (!e.repeat) document.execCommand("underline"); }
                            if (e.ctrlKey && e.shiftKey && e.code === "KeyX") { e.preventDefault(); if (!e.repeat) document.execCommand("strikeThrough"); }
                          }}
                        />
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button style={s.editSaveBtn} onClick={handleEditSave}>✓</button>
                          <button style={s.editCancelBtn} onClick={() => setEditingMsg(null)}>✕</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.content && (() => {
                          const pokerMatch = msg.content.match(/^\/poker_table (\d+)$/);
                          if (pokerMatch) {
                            return <PokerInviteCard tableId={Number(pokerMatch[1])} chatId={chat.id} isNeo={isNeo} isMine={isMine} senderName={msg.sender_username} />;
                          }
                          const callMatch = msg.content.match(/^\/call_record (completed|missed|declined|cancelled)\|(\d+)\|(\d+)\|(\d+)$/);
                          if (callMatch) {
                            return <CallRecordCard
                              kind={callMatch[1] as "completed" | "missed" | "declined" | "cancelled"}
                              durationSec={Number(callMatch[2])}
                              participants={Number(callMatch[3])}
                              initiatorId={Number(callMatch[4])}
                              currentUserId={currentUser.id}
                              isNeo={isNeo}
                              isMine={isMine}
                            />;
                          }
                          return <p className="msg-content" style={{ ...s.msgText, ...(isNeo && isMine ? { color: "#0a0a0a" } : {}), ...(!isNeo && isMine ? { color: "#fff" } : {}) }}><FormattedText text={msg.content} /></p>;
                        })()}
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
                    {/* Reactions display — always after media so they sit at the bottom */}
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
                              style={{
                                ...s.reactionBadge,
                                cursor: "pointer",
                                border: myReact ? "1px solid var(--accent)" : "1px solid transparent",
                                color: "var(--text-primary)",
                              }}
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
        <div style={{ ...s.ctxMenu, left: contextMenu.x, top: contextMenu.y, transform: `translate(${contextMenu.flipX ? "-100%" : "0"}, ${contextMenu.flipY ? "-100%" : "0"})` }}>
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
              <button style={s.ctxItem} onClick={() => { setEditingMsg(contextMenu.msg); setContextMenu(null); }}>✏️ Редактировать</button>
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
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => applyFormat("bold")} title="Жирный (Ctrl+B)"><b>B</b></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => applyFormat("italic")} title="Курсив (Ctrl+I)"><i>I</i></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => applyFormat("underline")} title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => applyFormat("strikeThrough")} title="Зачёркнутый (Ctrl+Shift+X)"><s>S</s></button>
        <button type="button" style={{ ...s.formatBtn, ...(isNeo ? mono : {}) }} onClick={() => applyFormat("spoiler")} title="Спойлер (Ctrl+Shift+P)">▮</button>
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
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            Ответ для <b>{replyTo.sender_username}</b>:{" "}
            {replyTo.content ? <FormattedText text={replyTo.content} staticSpoiler /> : "..."}
          </span>
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
          onSelect={(emoji) => {
            const el = textInputRef.current;
            if (el) { el.focus(); document.execCommand("insertText", false, emoji); setText(el.innerText.trim()); }
            setShowEmoji(false);
          }}
          onClose={() => setShowEmoji(false)}
        />
      )}

      {/* Pending attachments preview (up to 10 files) */}
      {pendingAttachments.length > 0 && (
        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-secondary)",
          maxHeight: 280,
          overflowY: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ ...mono, color: "var(--text-muted)", fontSize: 12 }}>
              {isNeo ? `// ${pendingAttachments.length} файл(ов) · до 10 шт, каждый ≤ 10МБ` : `Файлов: ${pendingAttachments.length}/10`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  background: "transparent",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: isNeo ? 0 : 4,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  ...mono,
                }}
              >
                {isNeo ? "[+ ЕЩЁ]" : "+ Ещё файлы"}
              </button>
              <button
                type="button"
                onClick={() => {
                  pendingAttachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
                  setPendingAttachments([]);
                }}
                style={{
                  background: "transparent",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: isNeo ? 0 : 4,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  ...mono,
                }}
              >
                {isNeo ? "[ОТМЕНА]" : "Отмена"}
              </button>
              <button
                type="button"
                onClick={sendAttachmentPack}
                disabled={uploadingPack}
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  border: "none",
                  borderRadius: isNeo ? 0 : 4,
                  padding: "4px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  ...mono,
                  letterSpacing: isNeo ? "0.05em" : undefined,
                }}
              >
                {uploadingPack
                  ? (isNeo ? "[ОТПРАВКА...]" : "Отправка...")
                  : (isNeo ? `[ОТПРАВИТЬ ${pendingAttachments.length}]` : `Отправить ${pendingAttachments.length}`)}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pendingAttachments.map((att, idx) => (
              <div key={idx} style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: 6,
                background: "var(--bg-tertiary)",
                borderRadius: isNeo ? 0 : 4,
                border: isNeo ? "1px solid var(--border)" : undefined,
              }}>
                {att.preview ? (
                  <img src={att.preview} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: isNeo ? 0 : 4, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 48, height: 48, background: "var(--bg-input)", borderRadius: isNeo ? 0 : 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📎</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {att.file.name}
                  </div>
                  <input
                    type="text"
                    value={att.caption}
                    onChange={(e) => setPendingCaption(idx, e.target.value)}
                    placeholder={isNeo ? "подпись..." : "Подпись (необязательно)"}
                    style={{
                      width: "100%",
                      marginTop: 3,
                      background: "var(--bg-input)",
                      border: "none",
                      padding: "3px 6px",
                      borderRadius: isNeo ? 0 : 3,
                      fontSize: 11,
                      color: "var(--text-primary)",
                      ...mono,
                    }}
                    maxLength={300}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePendingAttachment(idx)}
                  style={{ background: "none", color: "var(--text-muted)", fontSize: 16, padding: 4, cursor: "pointer" }}
                  title="Удалить"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input — locked in channel mode when current user isn't the creator */}
      {(() => {
        const isLockedChannel =
          chat.is_group && chat.allow_all_write === false && chat.created_by !== currentUser.id;
        if (isLockedChannel) {
          return (
            <div style={{
              padding: "14px 16px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-secondary)",
              color: "var(--text-muted)",
              fontSize: 13,
              textAlign: "center" as const,
              ...(isNeo ? { fontFamily: "var(--font-mono)", letterSpacing: "0.04em" } : {}),
            }}>
              {isNeo ? "// канал · писать_может_только_создатель" : "🔒 Это канал — писать может только создатель"}
            </div>
          );
        }
        return null;
      })()}
      <form onSubmit={sendMessage} style={{ ...s.inputBar, ...(chat.is_group && chat.allow_all_write === false && chat.created_by !== currentUser.id ? { display: "none" } : {}) }}>
        <button type="button" style={s.attachBtn} onClick={() => fileRef.current?.click()} title="Прикрепить файл">+</button>
        <input type="file" multiple ref={fileRef} style={{ display: "none" }} onChange={handleFileInput} />
        <button
          type="button"
          style={s.emojiBtn}
          onClick={() => setShowEmoji(!showEmoji)}
          onMouseEnter={() => setHoverEmoji(RANDOM_EMOJI[Math.floor(Math.random() * RANDOM_EMOJI.length)])}
          title="Эмодзи"
        >{hoverEmoji}</button>
        {isNeo && <span style={{ color: "var(--accent)", ...mono, fontSize: 14, marginRight: 2 }}>&gt;</span>}
        <div
          ref={textInputRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={isNeo
            ? `написать_${(chat.is_group ? chat.name : getChatTitle())?.toLowerCase().replace(/\s+/g, "_")}...`
            : `Написать ${chat.is_group ? "в группе" : getChatTitle()}...`}
          className="chat-input"
          style={{ ...s.textInput, ...(isNeo ? mono : {}), overflowY: "auto" as const, outline: "none", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, cursor: "text" }}
          onInput={(e) => {
            const div = e.currentTarget;
            setText(div.innerText.trim());
            handleTyping();
            div.style.height = "auto";
            div.style.height = Math.min(div.scrollHeight, 160) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              sendMessage(e as any);
            } else if (e.key === "Enter" && (e.ctrlKey || e.shiftKey)) {
              e.preventDefault();
              resetInlineFormat();
              document.execCommand("insertText", false, "\n");
            } else if (e.key === " ") {
              e.preventDefault();
              resetInlineFormat();
              document.execCommand("insertText", false, " ");
              setText(textInputRef.current?.innerText.trim() || "");
            } else if (e.ctrlKey && !e.shiftKey && e.code === "KeyB") {
              e.preventDefault(); if (!e.repeat) applyFormat("bold");
            } else if (e.ctrlKey && !e.shiftKey && e.code === "KeyI") {
              e.preventDefault(); if (!e.repeat) applyFormat("italic");
            } else if (e.ctrlKey && !e.shiftKey && e.code === "KeyU") {
              e.preventDefault(); if (!e.repeat) applyFormat("underline");
            } else if (e.ctrlKey && e.shiftKey && e.code === "KeyX") {
              e.preventDefault(); if (!e.repeat) applyFormat("strikeThrough");
            } else if (e.ctrlKey && e.shiftKey && e.code === "KeyP") {
              e.preventDefault(); if (!e.repeat) applyFormat("spoiler");
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const plain = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, plain);
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

function GroupHeaderAvatar({ chat, currentUser, isNeo }: { chat: ChatOut; currentUser: UserOut; isNeo: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const isCreator = chat.created_by === currentUser.id;
  const size = 28;
  const radius = isNeo ? 5 : "50%";
  const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await chatApi.uploadGroupAvatar(chat.id, f);
    } catch (err) {
      console.error("[group avatar] upload failed", err);
    }
    e.target.value = "";
  }

  return (
    <label
      onClick={(e) => { if (!isCreator) e.preventDefault(); }}
      style={{
        position: "relative" as const,
        width: size, height: size,
        borderRadius: radius as any,
        cursor: isCreator ? "pointer" : "default",
        flexShrink: 0,
        display: "block",
      }}
      title={isCreator ? "Сменить аватарку" : ""}
    >
      {chat.avatar_url ? (
        <img
          src={chat.avatar_url.startsWith("http") ? chat.avatar_url : `${BASE_URL}${chat.avatar_url}`}
          style={{ width: size, height: size, borderRadius: radius as any, objectFit: "cover" as const, display: "block",
                   border: isNeo ? "1px solid var(--accent)" : undefined }}
          alt={chat.name || "group"}
        />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: radius as any,
          background: isNeo ? "#0a0a0a" : "#5865f2",
          color: isNeo ? "var(--accent)" : "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 14,
          fontFamily: isNeo ? "var(--font-mono)" : undefined,
          border: isNeo ? "1px solid var(--accent)" : undefined,
        }}>
          #
        </div>
      )}
      {isCreator && <input ref={fileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={pickFile} />}
    </label>
  );
}

function CallRecordCard({ kind, durationSec, participants, initiatorId, currentUserId, isNeo, isMine }: {
  kind: "completed" | "missed" | "declined" | "cancelled";
  durationSec: number;
  participants: number;
  initiatorId: number;
  currentUserId: number;
  isNeo: boolean;
  isMine: boolean;
}) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  const initiatedByMe = initiatorId === currentUserId;
  let title = "";
  let icon = "📞";
  let color = "var(--text-primary)";
  if (kind === "completed") {
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const time = min > 0 ? `${min} мин ${sec.toString().padStart(2, "0")} сек` : `${sec} сек`;
    title = participants > 2 ? `Звонок · ${time} · ${participants} участника` : `Звонок · ${time}`;
    icon = "📞";
  } else if (kind === "missed") {
    title = initiatedByMe ? "Никто не ответил" : "Пропущенный звонок";
    icon = "📵";
    color = "#ed4245";
  } else if (kind === "declined") {
    title = initiatedByMe ? "Отклонён" : "Вы отклонили звонок";
    icon = "✕";
    color = "#ed4245";
  } else if (kind === "cancelled") {
    title = initiatedByMe ? "Вы отменили звонок" : "Звонок отменён";
    icon = "↩";
    color = "var(--text-muted)";
  }
  const cardBg = isMine
    ? (isNeo ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.16)")
    : (isNeo ? "transparent" : "rgba(0,0,0,0.18)");
  const cardBorder = isMine
    ? (isNeo ? "1px solid rgba(0,0,0,0.55)" : "1px solid rgba(255,255,255,0.55)")
    : `1px solid ${isNeo ? "var(--border-strong)" : "var(--border)"}`;
  const titleColor = isMine ? (isNeo ? "#0a0a0a" : "#fff") : color;
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 12px",
      background: cardBg,
      border: cardBorder,
      borderRadius: isNeo ? 0 : 8,
      margin: "2px 0",
      ...mono,
      fontSize: 13,
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ color: titleColor, fontWeight: 600 }}>{isNeo ? `// ${title.toLowerCase()}` : title}</span>
    </div>
  );
}

function PokerInviteCard({ tableId, chatId, isNeo, isMine, senderName }: { tableId: number; chatId: number; isNeo: boolean; isMine: boolean; senderName: string }) {
  const mono = isNeo ? { fontFamily: "var(--font-mono)" } : {};
  // The card sits inside the message bubble, so the surrounding background varies:
  //  - Neo own bubble: lime (#87b82a) → use dark text + dark border
  //  - Neo other bubble: dark grey (#131313) → keep light text + accent border
  //  - Discord own bubble: blurple (#5865f2) → light text + light border
  //  - Discord other: dark grey → muted backdrop tint
  const cardBg = isNeo
    ? (isMine ? "rgba(0,0,0,0.18)" : "transparent")
    : (isMine ? "rgba(255,255,255,0.16)" : "rgba(88,101,242,0.08)");
  const cardBorder = isNeo
    ? (isMine ? "1px solid rgba(0,0,0,0.55)" : "1px solid var(--accent)")
    : (isMine ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(88,101,242,0.4)");
  const titleColor = isNeo
    ? (isMine ? "#0a0a0a" : "var(--text-header)")
    : (isMine ? "#fff" : "var(--text-header)");
  const subColor = isNeo
    ? (isMine ? "rgba(0,0,0,0.65)" : "var(--text-muted)")
    : (isMine ? "rgba(255,255,255,0.75)" : "var(--text-muted)");
  const btnBg = isNeo
    ? (isMine ? "#0a0a0a" : "var(--accent)")
    : (isMine ? "rgba(255,255,255,0.95)" : "var(--accent)");
  const btnColor = isNeo
    ? (isMine ? "var(--accent)" : "var(--accent-text)")
    : (isMine ? "var(--accent)" : "var(--accent-text)");
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 12px",
      background: cardBg,
      border: cardBorder,
      borderRadius: isNeo ? 0 : 8,
      margin: "4px 0",
      maxWidth: 360,
    }}>
      <div style={{ fontSize: 28 }}>🎴</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...mono, color: titleColor, fontWeight: 700, fontSize: 14 }}>
          {isNeo ? `// ПОКЕРНЫЙ_СТОЛ #${tableId}` : `Покерный стол #${tableId}`}
        </div>
        <div style={{ ...mono, color: subColor, fontSize: 12, marginTop: 2 }}>
          {isNeo ? `${senderName} зовёт играть` : `${senderName} зовёт играть в покер`}
        </div>
      </div>
      <button
        onClick={() => {
          localStorage.setItem("gandola-mode", "poker");
          window.dispatchEvent(new CustomEvent("set-app-mode", { detail: { mode: "poker" } }));
          window.dispatchEvent(new CustomEvent("open-poker-table", { detail: { chatId, tableId } }));
        }}
        style={{
          background: btnBg,
          color: btnColor,
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
  ctxMenu: { position: "fixed" as const, background: "var(--bg-tertiary)", borderRadius: 6, padding: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", zIndex: 200, width: 252 },
  ctxItem: { display: "block", width: "100%", background: "none", color: "var(--text-primary)", padding: "8px 12px", fontSize: 13, textAlign: "left" as const, borderRadius: 4 },
  editInput: { width: "100%", background: "var(--bg-input)", borderRadius: 4, padding: "6px 10px", fontSize: 13, color: "var(--text-primary)", outline: "none", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, minHeight: 32, maxHeight: 200, overflowY: "auto" as const, cursor: "text", userSelect: "text" as const },
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
