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
};

export const getFileUrl = (url: string) => `${BASE_URL}${url}`;
export default api;
