import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatRowData } from "../components/ChatRow";
import { apiErrorMessage, chatApi, ChatOut } from "./api";
import { useAuth } from "./AuthContext";
import { wsService } from "./ws";

// Deterministic palette per chat id — same chat keeps the same avatar tint
// across sessions. Matches the desktop client's approach informally.
const PALETTE = [
  "#ef5350",
  "#7c4dff",
  "#ffa726",
  "#26a69a",
  "#ec407a",
  "#5c6bc0",
  "#ff7043",
  "#8d6e63",
  "#3949ab",
  "#66bb6a",
];

function colorFor(id: number): string {
  return PALETTE[id % PALETTE.length];
}

function letterFor(name: string | null): string {
  if (!name) return "?";
  const first = name.trim()[0] ?? "?";
  return first.toUpperCase();
}

function formatTs(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "вчера";
  return `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

interface ChatsState {
  chats: ChatRowData[];
  raw: ChatOut[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useChats(): ChatsState {
  const { user, token } = useAuth();
  const [raw, setRaw] = useState<ChatOut[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [typingChats, setTypingChats] = useState<Set<number>>(new Set());
  const typingTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doRefresh = useCallback(async (silent: boolean) => {
    if (!user) return;
    // `silent` skips toggling `loading`. WS-driven background refreshes use
    // it so the chats list doesn't flash its pull-to-refresh spinner every
    // time a friend sends a message — the user already sees the chat row
    // update with the new last-message text, no need to also draw a loader.
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    // allSettled so one failing endpoint (e.g. unread counts) doesn't wipe out
    // the chat list or online status.
    const [chatsRes, unreadRes, onlineRes] = await Promise.allSettled([
      chatApi.list(),
      chatApi.getUnreadCounts(),
      chatApi.getOnlineUsers(),
    ]);
    if (chatsRes.status === "fulfilled") setRaw(chatsRes.value.data);
    else if (!silent) setError(apiErrorMessage(chatsRes.reason));
    if (unreadRes.status === "fulfilled") setUnread(unreadRes.value.data);
    if (onlineRes.status === "fulfilled") setOnline(new Set(onlineRes.value.data.online_user_ids));
    if (!silent) setLoading(false);
  }, [user]);

  // User-initiated refresh (pull-to-refresh, first mount) — shows the spinner.
  const refresh = useCallback(() => doRefresh(false), [doRefresh]);
  // Background refresh triggered by WS events — never shows the spinner.
  const refreshSilent = useCallback(() => doRefresh(true), [doRefresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live updates via WebSocket — refresh the chat list on any event that
  // could change it. Cheap because /api/chats is paginated server-side.
  useEffect(() => {
    if (!token) return;
    const onNewChat = () => refreshSilent();
    const onMessage = () => refreshSilent();
    const onChatUpdated = () => refreshSilent();
    const onChatDeleted = () => refreshSilent();
    const onUserOnline = (data: Record<string, unknown>) => {
      const uid = data.user_id as number | undefined;
      if (typeof uid === "number") setOnline((prev) => new Set(prev).add(uid));
    };
    const onUserOffline = (data: Record<string, unknown>) => {
      const uid = data.user_id as number | undefined;
      if (typeof uid === "number")
        setOnline((prev) => {
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
    };
    // On (re)connect, re-pull the online snapshot — WS-only tracking would
    // miss friends who were already online before we connected.
    const onWsOpen = () => refreshSilent();
    const clearTyping = (cid: number) => {
      const t = typingTimersRef.current.get(cid);
      if (t) { clearTimeout(t); typingTimersRef.current.delete(cid); }
      setTypingChats((prev) => {
        if (!prev.has(cid)) return prev;
        const next = new Set(prev);
        next.delete(cid);
        return next;
      });
    };
    const onTyping = (data: Record<string, unknown>) => {
      const cid = data.chat_id as number | undefined;
      const uid = data.user_id as number | undefined;
      if (typeof cid !== "number" || uid === user?.id) return;
      setTypingChats((prev) => prev.has(cid) ? prev : new Set(prev).add(cid));
      const existing = typingTimersRef.current.get(cid);
      if (existing) clearTimeout(existing);
      typingTimersRef.current.set(cid, setTimeout(() => clearTyping(cid), 4000));
    };
    // A real message means typing has ended — drop the indicator immediately.
    const onMessageClearTyping = (data: Record<string, unknown>) => {
      const cid = data.chat_id as number | undefined;
      if (typeof cid === "number") clearTyping(cid);
    };
    wsService.on("new_chat", onNewChat);
    wsService.on("message", onMessage);
    wsService.on("message", onMessageClearTyping);
    wsService.on("typing", onTyping);
    wsService.on("chat_updated", onChatUpdated);
    wsService.on("chat_deleted", onChatDeleted);
    wsService.on("user_online", onUserOnline);
    wsService.on("user_offline", onUserOffline);
    wsService.on("_ws_open", onWsOpen);
    return () => {
      typingTimersRef.current.forEach((t) => clearTimeout(t));
      typingTimersRef.current.clear();
      wsService.off("typing", onTyping);
      wsService.off("message", onMessageClearTyping);
      wsService.off("new_chat", onNewChat);
      wsService.off("message", onMessage);
      wsService.off("chat_updated", onChatUpdated);
      wsService.off("chat_deleted", onChatDeleted);
      wsService.off("user_online", onUserOnline);
      wsService.off("user_offline", onUserOffline);
      wsService.off("_ws_open", onWsOpen);
    };
  }, [token, refreshSilent]);

  // Transform raw API chats → flat rows the ChatRow component expects,
  // sorted by most recent activity (newest message first) so a chat you just
  // wrote in jumps to the top.
  const chats = useMemo<ChatRowData[]>(() => {
    if (!user) return [];
    const activityTs = (c: ChatOut): number => {
      const iso = c.last_message?.created_at;
      const t = iso ? new Date(iso).getTime() : NaN;
      return Number.isNaN(t) ? 0 : t;
    };
    const sorted = [...raw].sort((a, b) => activityTs(b) - activityTs(a));
    return sorted.map((c) => {
      const isGroup = c.is_group;
      // For a DM the row should display the OTHER participant — not "Pavel ↔
      // Marina", just "Marina". For groups, show the group name.
      const counterpart = isGroup ? null : c.members.find((m) => m.id !== user.id) ?? c.members[0];
      const displayName = isGroup ? c.name ?? "Группа" : counterpart?.username ?? "Без имени";
      const isOnline = !isGroup && counterpart ? online.has(counterpart.id) : false;
      const avatarUrl = isGroup ? c.avatar_url ?? null : counterpart?.avatar_url ?? null;
      const last = c.last_message;
      const lastText = last?.content
        ? last.content
        : last?.file_name
          ? `📎 ${last.file_name}`
          : "";
      const senderPrefix =
        isGroup && last && last.sender_id !== user.id && last.sender_username
          ? `${last.sender_username}: `
          : "";
      return {
        id: String(c.id),
        name: displayName,
        letter: letterFor(displayName),
        color: colorFor(counterpart?.id ?? c.id),
        last: senderPrefix + lastText,
        ts: formatTs(last?.created_at),
        unread: unread[String(c.id)] ?? 0,
        online: isOnline,
        group: isGroup,
        peerId: counterpart?.id,
        avatarUrl,
        createdBy: c.created_by,
        allowAllWrite: c.allow_all_write,
        typing: typingChats.has(c.id),
      };
    });
  }, [raw, user, unread, online, typingChats]);

  return { chats, raw, loading, error, refresh };
}
