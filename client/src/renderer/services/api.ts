import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface UserOut {
  id: number;
  username: string;
  email?: string;
  avatar_url: string | null;
  status?: string | null;
  about?: string | null;
  grammar_errors?: number;
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
}

export interface ChatOut {
  id: number;
  name: string | null;
  is_group: boolean;
  created_by?: number;
  members: UserOut[];
  last_message: MessageOut | null;
}

export const authApi = {
  register: (username: string, password: string) =>
    api.post("/api/auth/register", { username, password }),
  login: (username: string, password: string) =>
    api.post("/api/auth/login", { username, password }),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post("/api/auth/change-password", { old_password: oldPassword, new_password: newPassword }),
  getPendingUsers: () => api.get<Array<{ id: number; username: string; created_at: string }>>("/api/auth/pending-users"),
  approveUser: (userId: number) => api.post(`/api/auth/approve-user/${userId}`),
  rejectUser: (userId: number) => api.post(`/api/auth/reject-user/${userId}`),
};

export const userApi = {
  me: () => api.get<UserOut>("/api/users/me"),
  search: (q: string) => api.get<UserOut[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
  updateProfile: (data: { username?: string; status?: string; about?: string }) =>
    api.patch<UserOut>("/api/users/me", data),
  getUser: (userId: number) => api.get<UserOut>(`/api/users/${userId}`),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<UserOut>("/api/users/avatar", form);
  },
};

export const chatApi = {
  list: () => api.get<ChatOut[]>("/api/chats"),
  createDm: (userId: number) =>
    api.post<ChatOut>(`/api/chats/dm?target_user_id=${userId}`),
  createGroup: (name: string, memberIds: number[]) =>
    api.post<ChatOut>("/api/chats/group", { name, member_ids: memberIds }),
  addMember: (chatId: number, userId: number) =>
    api.post(`/api/chats/${chatId}/members`, { user_id: userId }),
  getMessages: (chatId: number, limit = 50, beforeId?: number) =>
    api.get<MessageOut[]>(
      `/api/chats/${chatId}/messages?limit=${limit}${beforeId ? `&before_id=${beforeId}` : ""}`
    ),
  leaveChat: (chatId: number) => api.post(`/api/chats/${chatId}/leave`),
  deleteChat: (chatId: number) => api.delete(`/api/chats/${chatId}`),
  searchMessages: (chatId: number, q: string) =>
    api.get<MessageOut[]>(`/api/chats/${chatId}/search?q=${encodeURIComponent(q)}`),
  uploadFile: (chatId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<MessageOut>(`/api/chats/${chatId}/files`, form);
  },
  getReadStatus: (chatId: number) => api.get<Array<{ user_id: number; last_read_message_id: number }>>(`/api/chats/${chatId}/read-status`),
  getUnreadCounts: () => api.get<Record<string, number>>("/api/chats/unread/counts"),
  getOnlineUsers: () => api.get<{ online_user_ids: number[] }>("/api/chats/online/users"),
  adminDeleteOldMessages: (opts: { beforeDays?: number; beforeDate?: string }) => {
    const params = new URLSearchParams();
    if (opts.beforeDays) params.set("before_days", String(opts.beforeDays));
    if (opts.beforeDate) params.set("before_date", opts.beforeDate);
    return api.delete<{ deleted: number; before: string }>(`/api/chats/admin/messages/old?${params}`);
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

export interface PokerGameView {
  table_id: number;
  small_blind: number;
  big_blind: number;
  blind_level: number;
  next_blind_at: number;
  finished: boolean;
  winner_user_id: number | null;
  last_summary: any;
  hand: PokerHandView | null;
  players: PokerPlayerView[];
}

export const pokerApi = {
  list: (chatId: number) => api.get<PokerTableOut[]>(`/api/poker?chat_id=${chatId}`),
  create: (chatId: number, maxSeats = 6) =>
    api.post<PokerTableOut>("/api/poker", { chat_id: chatId, max_seats: maxSeats }),
  join: (tableId: number) => api.post<PokerTableOut>(`/api/poker/${tableId}/join`),
  leave: (tableId: number) => api.post<PokerTableOut | null>(`/api/poker/${tableId}/leave`),
  start: (tableId: number) => api.post<PokerTableOut>(`/api/poker/${tableId}/start`),
};

export const getFileUrl = (url: string) => `${BASE_URL}${url}`;
export default api;
