import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, chatApi, MessageOut } from "./api";
import { wsService } from "./ws";

interface MessagesState {
  messages: MessageOut[];
  loading: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

// chatId is a string in nav params (RN router quirk) — we accept that here
// and convert to number for the API.
export function useMessages(chatId: string): MessagesState {
  const numericId = Number(chatId);
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(
    async (beforeId?: number) => {
      if (Number.isNaN(numericId)) return;
      setLoading(true);
      setError(null);
      try {
        const res = await chatApi.getMessages(numericId, 50, beforeId);
        // Server already returns ascending order (oldest first, newest last) —
        // exactly what a top-to-bottom thread wants. Do NOT reverse again.
        const ordered = res.data;
        if (beforeId == null) {
          setMessages(ordered);
        } else {
          setMessages((prev) => [...ordered, ...prev]);
        }
        if (res.data.length < 50) setHasMore(false);
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [numericId],
  );

  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    load();
  }, [load]);

  // Append incoming live messages targeted at this chat.
  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      if ((data.chat_id as number) !== numericId) return;
      const msg = data as unknown as MessageOut;
      setMessages((prev) => {
        // Skip duplicates that the server echoes back with the same id (we
        // could be receiving our own optimistic insert).
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };
    wsService.on("message", handler);
    return () => wsService.off("message", handler);
  }, [numericId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || messages.length === 0) return;
    await load(messages[0].id);
  }, [hasMore, loading, messages, load]);

  return { messages, loading, error, loadMore, hasMore };
}
