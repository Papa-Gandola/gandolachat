import axios, { AxiosError, AxiosInstance } from "axios";
import * as SecureStore from "./secureStorage";

import { API_URL } from "./config";

export interface UserOut {
  id: number;
  username: string;
  avatar_url: string | null;
  status?: string | null;
  about?: string | null;
  grammar_errors?: number;
  is_admin?: boolean;
  last_seen?: string | null;
}

export interface MessageOut {
  id: number;
  chat_id: number;
  sender_id: number;
  sender_username: string;
  sender_avatar: string | null;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  is_edited?: boolean;
  reply_to_id?: number | null;
  reply_to_username?: string | null;
  reply_to_content?: string | null;
  created_at: string;
  media_group_id?: string | null;
  reactions?: Array<{ emoji: string; user_id: number }>;
}

export interface ChatOut {
  id: number;
  name: string | null;
  is_group: boolean;
  created_by?: number;
  members: UserOut[];
  last_message: MessageOut | null;
  allow_all_write?: boolean;
  avatar_url?: string | null;
  description?: string | null;
  admin_ids?: number[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserOut;
}

export interface ChatStats {
  media_count: number;
  link_count: number;
  file_count: number;
}

const TOKEN_KEY = "gandola.token";

let instance: AxiosInstance | null = null;

// The auth interceptor pulls the token from SecureStore on every request. We
// could cache it, but the win is tiny and the source-of-truth simplicity is
// worth it — token can change (login/logout/refresh) and we never get stale.
function getInstance(): AxiosInstance {
  if (instance) return instance;
  const api = axios.create({ baseURL: API_URL, timeout: 15000 });
  api.interceptors.request.use(async (config) => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) {
      config.headers = config.headers ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
    return config;
  });
  instance = api;
  return api;
}

// Human-friendly error text for UI banners. FastAPI returns { detail: "..." }
// on 4xx/5xx; surface that, falling back to a generic message.
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ detail?: string }>;
    if (ax.response?.data?.detail) return ax.response.data.detail;
    if (ax.code === "ECONNABORTED") return "Сервер не отвечает";
    if (!ax.response) return "Нет связи с сервером";
    return `Ошибка ${ax.response.status}`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Неизвестная ошибка";
}

export const authApi = {
  register: (username: string, password: string) =>
    getInstance().post<{ status?: string; message?: string } | TokenResponse>("/api/auth/register", {
      username,
      password,
    }),
  login: (username: string, password: string) =>
    getInstance().post<TokenResponse>("/api/auth/login", { username, password }),
  changePassword: (oldPassword: string, newPassword: string) =>
    getInstance().post("/api/auth/change-password", { old_password: oldPassword, new_password: newPassword }),
  getPendingUsers: () =>
    getInstance().get<{ id: number; username: string; created_at: string }[]>("/api/auth/pending-users"),
  approveUser: (userId: number) => getInstance().post(`/api/auth/approve-user/${userId}`),
  rejectUser: (userId: number) => getInstance().post(`/api/auth/reject-user/${userId}`),
};

export const userApi = {
  me: () => getInstance().get<TokenResponse>("/api/users/me"),
  getUser: (userId: number) => getInstance().get<UserOut>(`/api/users/${userId}`),
  search: (q: string) => getInstance().get<UserOut[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
  updateProfile: (data: { username?: string; status?: string; about?: string }) =>
    getInstance().patch<UserOut>("/api/users/me", data),
  registerPushToken: (token: string, platform = "android") =>
    getInstance().post("/api/users/push-token", { token, platform }),
  unregisterPushToken: (token: string) =>
    getInstance().delete("/api/users/push-token", { data: { token } }),
  uploadAvatar: async (file: { uri: string; name: string; type: string }): Promise<UserOut> => {
    // Multipart via fetch (RN's fetch builds the boundary correctly for file parts).
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const form = new FormData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.append("file", file as any);
    const res = await fetch(`${API_URL}/api/users/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      let detail = `Ошибка ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // non-JSON error body
      }
      throw new Error(detail);
    }
    return (await res.json()) as UserOut;
  },
};

export const chatApi = {
  list: () => getInstance().get<ChatOut[]>("/api/chats"),
  createDm: (userId: number) =>
    getInstance().post<ChatOut>(`/api/chats/dm?target_user_id=${userId}`),
  createGroup: (name: string, memberIds: number[], allowAllWrite = true) =>
    getInstance().post<ChatOut>("/api/chats/group", {
      name,
      member_ids: memberIds,
      allow_all_write: allowAllWrite,
    }),
  update: (chatId: number, data: { name?: string; description?: string; admin_ids?: number[] }) =>
    getInstance().patch<ChatOut>(`/api/chats/${chatId}`, data),
  addMember: (chatId: number, userId: number) =>
    getInstance().post(`/api/chats/${chatId}/members`, { user_id: userId }),
  kickMember: (chatId: number, userId: number) =>
    getInstance().delete<ChatOut>(`/api/chats/${chatId}/members/${userId}`),
  leaveChat: (chatId: number) => getInstance().post(`/api/chats/${chatId}/leave`),
  deleteChat: (chatId: number) => getInstance().delete(`/api/chats/${chatId}`),
  adminDeleteOldMessages: (beforeDays: number) =>
    getInstance().delete<{ deleted: number; before: string }>(`/api/chats/admin/messages/old?before_days=${beforeDays}`),
  stats: (chatId: number) => getInstance().get<ChatStats>(`/api/chats/${chatId}/stats`),
  uploadGroupAvatar: async (chatId: number, file: { uri: string; name: string; type: string }): Promise<ChatOut> => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const form = new FormData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.append("file", file as any);
    const res = await fetch(`${API_URL}/api/chats/${chatId}/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      let detail = `Ошибка ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // non-JSON error body
      }
      throw new Error(detail);
    }
    return (await res.json()) as ChatOut;
  },
  getMessages: (chatId: number, limit = 50, beforeId?: number) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeId) params.append("before_id", String(beforeId));
    return getInstance().get<MessageOut[]>(`/api/chats/${chatId}/messages?${params}`);
  },
  getUnreadCounts: () => getInstance().get<Record<string, number>>("/api/chats/unread/counts"),
  getOnlineUsers: () => getInstance().get<{ online_user_ids: number[] }>("/api/chats/online/users"),
  getReadStatus: (chatId: number) =>
    getInstance().get<Array<{ user_id: number; last_read_message_id: number | null }>>(
      `/api/chats/${chatId}/read-status`,
    ),
  uploadFile: async (
    chatId: number,
    file: { uri: string; name: string; type: string },
    caption = "",
    mediaGroupId?: string,
  ): Promise<MessageOut> => {
    // Use fetch (not axios) for multipart — RN's fetch builds the multipart
    // boundary correctly for { uri, name, type } file parts, where axios
    // routinely fails and surfaces as a network error.
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const params: string[] = [];
    if (caption) params.push(`caption=${encodeURIComponent(caption)}`);
    if (mediaGroupId) params.push(`media_group_id=${encodeURIComponent(mediaGroupId)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    const url = `${API_URL}/api/chats/${chatId}/files${qs}`;

    // RN's multipart upload over cleartext HTTP is occasionally flaky and
    // fails with "Network request failed" before the request completes —
    // retry a couple of times with a short backoff. Each attempt rebuilds the
    // FormData since a body can't be reused.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const form = new FormData();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        form.append("file", file as any);
        if (caption) form.append("caption", caption);
        if (mediaGroupId) form.append("media_group_id", mediaGroupId);
        const res = await fetch(url, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!res.ok) {
          let detail = `Ошибка ${res.status}`;
          try {
            const body = (await res.json()) as { detail?: string };
            if (body.detail) detail = body.detail;
          } catch {
            // non-JSON error body
          }
          throw new Error(detail);
        }
        return (await res.json()) as MessageOut;
      } catch (err) {
        lastErr = err;
        // Only retry transient network failures, not server-side rejections.
        const msg = err instanceof Error ? err.message : "";
        if (!/network request failed/i.test(msg)) throw err;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw lastErr;
  },
};

export interface PokerSeatOut {
  id: number;
  user_id: number;
  username: string;
  avatar_url: string | null;
  seat_index: number;
  stack: number;
  is_active: boolean;
}

export interface PokerTableOut {
  id: number;
  chat_id: number;
  created_by: number;
  status: "lobby" | "playing" | "finished";
  starting_stack: number;
  starting_small_blind: number;
  starting_big_blind: number;
  blind_increase_minutes: number;
  max_seats: number;
  seats: PokerSeatOut[];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface PokerPlayerView {
  user_id: number;
  seat_index: number;
  stack: number;
  bet: number;
  has_folded: boolean;
  is_all_in: boolean;
  is_my_turn: boolean;
  hole: string[];
}

export interface PokerHandView {
  hand_no: number;
  button_seat: number;
  community: string[];
  pot: number;
  current_bet: number;
  min_raise: number;
  to_act_seat: number | null;
  street: "preflop" | "flop" | "turn" | "river" | "showdown" | "done";
  last_action: { user_id: number; action: string; amount: number } | null;
}

export interface PokerHandSummary {
  winner_user_ids: number[];
  winning_hand?: string | null;
  pot: number;
  reason: string;
  community: string[];
  showdown: { user_id: number; hole: string[]; hand: string }[];
}

export interface PokerGameView {
  table_id: number;
  small_blind: number;
  big_blind: number;
  blind_level: number;
  next_blind_at: number;
  finished: boolean;
  winner_user_id: number | null;
  last_summary: PokerHandSummary | null;
  hand: PokerHandView | null;
  players: PokerPlayerView[];
}

export const pokerApi = {
  list: (chatId: number) => getInstance().get<PokerTableOut[]>(`/api/poker?chat_id=${chatId}`),
  create: (chatId: number, maxSeats = 6) =>
    getInstance().post<PokerTableOut>("/api/poker", { chat_id: chatId, max_seats: maxSeats }),
  join: (tableId: number) => getInstance().post<PokerTableOut>(`/api/poker/${tableId}/join`),
  leave: (tableId: number) => getInstance().post<PokerTableOut | null>(`/api/poker/${tableId}/leave`),
  start: (tableId: number) => getInstance().post<PokerTableOut>(`/api/poker/${tableId}/start`),
  close: (tableId: number) => getInstance().post<{ ok: boolean }>(`/api/poker/${tableId}/close`),
};
