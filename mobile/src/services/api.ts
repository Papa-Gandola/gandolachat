import axios, { AxiosError, AxiosInstance } from "axios";
import * as SecureStore from "expo-secure-store";

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
};

export const userApi = {
  me: () => getInstance().get<TokenResponse>("/api/users/me"),
  getUser: (userId: number) => getInstance().get<UserOut>(`/api/users/${userId}`),
};

export const chatApi = {
  list: () => getInstance().get<ChatOut[]>("/api/chats"),
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
  uploadFile: (
    chatId: number,
    file: { uri: string; name: string; type: string },
    caption = "",
  ) => {
    const form = new FormData();
    // RN FormData takes a {uri,name,type} object for file parts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.append("file", file as any);
    if (caption) form.append("caption", caption);
    // Do NOT set Content-Type manually — RN's XHR layer adds the multipart
    // boundary automatically when the body is FormData. Setting it by hand
    // produces a boundary-less header the server can't parse.
    return getInstance().post<MessageOut>(`/api/chats/${chatId}/files`, form, {
      timeout: 60000,
    });
  },
};
