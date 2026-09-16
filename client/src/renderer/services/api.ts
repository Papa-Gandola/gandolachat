import axios from "axios";

// Production fallback — keeps us safe if VITE_API_URL ever ships empty (which
// is what happened to v2.1.8: GH Actions secrets still held the old
// http://2.26.117.77:8000 value, so the desktop bundle baked it in and the
// client hit a closed port). Override in client/.env for local dev.
const BASE_URL = import.meta.env.VITE_API_URL || "https://2-26-117-77.sslip.io";

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
  is_admin?: boolean;
  last_seen?: string | null;
  // Steam/Dota (компендиум); steam_id64 строкой — в number не влезает
  steam_id64?: string | null;
  dota_account_id?: number | null;
  dota_rank_tier?: number | null;
  dota_leaderboard_rank?: number | null;
  // Косметика Гандолиума (разблокировки навсегда по comp_max_level)
  comp_max_level?: number;
  comp_badge?: boolean;
  comp_title?: string | null;
  comp_color?: string | null;
  comp_frame?: string | null; // "lime" | "animated" | подиумные
  // «🎮 в Доте сейчас»: показывать себя (невидимка = false)
  dota_presence_visible?: boolean;
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
  compendium_enabled?: boolean;
  is_notes?: boolean;
}

export interface ReminderOut {
  id: number;
  text: string;
  remind_at: string;
}

export const notesApi = {
  open: () => api.get<ChatOut>("/api/chats/notes"),
  createReminder: (text: string, remindAtIso: string) =>
    api.post<ReminderOut & { message_id: number; chat_id: number }>("/api/notes/reminders", {
      text,
      remind_at: remindAtIso,
    }),
  listReminders: () => api.get<ReminderOut[]>("/api/notes/reminders"),
  cancelReminder: (id: number) => api.delete(`/api/notes/reminders/${id}`),
};

export interface ChatStats {
  media_count: number;
  link_count: number;
  file_count: number;
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

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserOut;
}

export const userApi = {
  me: () => api.get<TokenResponse>("/api/users/me"),
  search: (q: string) => api.get<UserOut[]>(`/api/users/search?q=${encodeURIComponent(q)}`),
  updateProfile: (data: { username?: string; status?: string; about?: string; dota_presence_visible?: boolean }) =>
    api.patch<UserOut>("/api/users/me", data),
  getUser: (userId: number) => api.get<UserOut>(`/api/users/${userId}`),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<UserOut>("/api/users/avatar", form);
  },
  // Steam/Dota: принимает ссылку на профиль, steamID64 или Friend ID
  linkSteam: (input: string) => api.post<UserOut>("/api/users/me/steam", { input }),
  unlinkSteam: () => api.delete<UserOut>("/api/users/me/steam"),
  refreshSteam: () => api.post<UserOut>("/api/users/me/steam/refresh"),
};

// ==== Компендиум (Гандолиум) ====
export interface CompendiumQuest {
  id: string;
  num: number;
  name: string;
  desc: string;
  gas: number;
  cat: "daily" | "weekly" | "season" | "team" | "anti" | "secret";
  needs_parse: boolean;
  done: boolean;
  progress?: number;
  target?: number;
  title?: string;
  active?: boolean; // для элементов *_pool: в сегодняшней/этой недели ротации
}

export interface CompendiumTrophy {
  quest_id: string;
  name: string;
  cat: string;
  desc?: string;
  gas: number;
  completed_at: string;
  title?: string;
}

export interface CompendiumCosmetics {
  max_level: number;
  badge: boolean;
  title: string | null;
  color: string | null;
  frame: string | null;
  earned_titles: string[];
  palette: string[];
  unlocks: Record<string, number>;
  // Рамки за подиум финала сезона (место 1/2/3 в любом сезоне)
  podium_frames?: { gold: boolean; silver: boolean; bronze: boolean };
}

// Архив закрытых сезонов (снапшот финальной таблицы)
export interface SeasonArchiveRow {
  place: number;
  user_id: number;
  username: string;
  gas: number;
  level: number;
  quests_done: number;
  anti_count: number;
}

export interface SeasonArchive {
  season: string;       // "2026-08"
  season_name: string;  // «августа»
  rows: SeasonArchiveRow[];
}

export interface CompendiumMe {
  linked: boolean;
  cosmetics?: CompendiumCosmetics;
  season: string;
  gas?: number;
  level?: number;
  level_progress?: number;
  level_target?: number;
  matches?: number;
  wins?: number;
  rank_tier?: number | null;
  leaderboard_rank?: number | null;
  daily?: CompendiumQuest[];
  weekly?: CompendiumQuest[];
  // Полные пулы с флагом active — для разворота «показать все»
  daily_pool?: CompendiumQuest[];
  weekly_pool?: CompendiumQuest[];
  season_quests?: CompendiumQuest[];
  team?: CompendiumQuest[];
  anti?: CompendiumQuest[];
  trophies?: CompendiumTrophy[];
}

export interface CompendiumSeasonRow {
  user_id: number;
  username: string;
  avatar_url: string | null;
  gas: number;
  level: number;
  quests_done: number;
  anti_count: number;
  rank_tier: number | null;
  leaderboard_rank: number | null;
  comp_title?: string | null;
  comp_color?: string | null;
  comp_frame?: string | null;
  comp_badge?: boolean;
}

// === Ставки Гандолиума ===
export interface BetOut {
  id: number;
  bettor_id: number;
  bettor: string;
  target_id: number;
  target: string;
  market: string;   // match | kills | kda | roshan | streak
  side: string;     // win/lose | over/under
  line: number;     // kda — ×10
  label: string;    // готовая подпись с сервера
  stake: number;
  status: string;   // open | won | lost | refunded
  progress: number; // streak: побед подряд
  payout: number;
  placed_at: string;
  resolved_at: string | null;
  pending_parse: boolean;
}

export interface BetTarget {
  user_id: number;
  username: string;
  avatar_url: string | null;
  kills_line: number;
  kda_line: number;  // ×10
  roshan_line: number;
  is_me: boolean;
}

export interface BetsOverview {
  season: string;
  my_gas: number;
  linked: boolean;
  stake_min: number;
  stake_max: number;
  streak_stake_max: Record<string, number>;
  targets: BetTarget[];
  open: BetOut[];
  my_recent: BetOut[];
}

/** Тизер приза сезона: до финала — только открытые подсказки, после — название и чемпион. */
export interface SeasonPrizeTeaser {
  season: string;
  drawn: boolean;
  revealed: boolean;
  hints: string[];
  hints_total: number;
  /** число месяца (МСК), когда откроется следующая подсказка; null — больше нечего ждать */
  next_hint_day: number | null;
  title: string | null;
  winner: string | null;
  last: { season: string; title: string; winner: string | null } | null;
}
export interface SeasonPrize {
  id: number;
  title: string;
  hint1: string | null;
  hint2: string | null;
  hint3: string | null;
  weight: number;
  active: boolean;
}
export type SeasonPrizeIn = Partial<Omit<SeasonPrize, "id">>;

export const compendiumApi = {
  me: () => api.get<CompendiumMe>("/api/compendium/me"),
  prize: () => api.get<SeasonPrizeTeaser>("/api/compendium/prize"),
  // --- админ: пул призов и розыгрыш ---
  prizes: () => api.get<SeasonPrize[]>("/api/compendium/prizes"),
  createPrize: (data: SeasonPrizeIn) => api.post<SeasonPrize>("/api/compendium/prizes", data),
  updatePrize: (id: number, data: SeasonPrizeIn) => api.patch<SeasonPrize>(`/api/compendium/prizes/${id}`, data),
  deletePrize: (id: number) => api.delete<{ ok: boolean }>(`/api/compendium/prizes/${id}`),
  drawPrize: () => api.post<SeasonPrizeTeaser>("/api/compendium/prize/draw"),
  // ""/false = снять; надеть можно только открытое уровнем
  updateCosmetics: (data: { badge?: boolean; title?: string; color?: string; frame?: string }) =>
    api.patch<CompendiumCosmetics>("/api/compendium/cosmetics", data),
  season: () => api.get<{ season: string; rows: CompendiumSeasonRow[]; me: number }>("/api/compendium/season"),
  seasons: () => api.get<SeasonArchive[]>("/api/compendium/seasons"),
  bets: () => api.get<BetsOverview>("/api/compendium/bets"),
  placeBet: (data: { target_id: number; market: string; side: string; line?: number; stake: number }) =>
    api.post<{ bet: BetOut; my_gas: number }>("/api/compendium/bets", data),
  user: (userId: number) =>
    api.get<{ user_id: number; username: string; season: string; gas: number; level: number; trophies: CompendiumTrophy[]; rank_tier: number | null; leaderboard_rank: number | null }>(
      `/api/compendium/user/${userId}`
    ),
};

// === Опросы и закрепы ===
export interface PollOptionOut {
  id: number;
  text: string;
  votes: number;
  // Кто голосовал за вариант — mine каждое устройство считает само
  voter_ids?: number[];
  mine: boolean;
  author: string | null; // у дописанных вариантов — кто добавил
}

export interface PollOut {
  id: number;
  chat_id: number;
  message_id: number | null;
  question: string;
  allow_multi: boolean;
  allow_add: boolean;
  closed: boolean;
  created_by: number;
  creator: string;
  total_voters: number;
  options: PollOptionOut[];
}

export interface PinOut {
  message_id: number;
  content: string | null;
  file_name: string | null;
  sender_username: string;
  pinned_by: number;
  pinned_at: string;
}

export const pollsApi = {
  create: (chatId: number, data: { question: string; options: string[]; allow_multi: boolean; allow_add: boolean }) =>
    api.post<PollOut>(`/api/chats/${chatId}/polls`, data),
  get: (pollId: number) => api.get<PollOut>(`/api/polls/${pollId}`),
  vote: (pollId: number, optionId: number) =>
    api.post<PollOut>(`/api/polls/${pollId}/vote`, { option_id: optionId }),
  addOption: (pollId: number, text: string) =>
    api.post<PollOut>(`/api/polls/${pollId}/options`, { text }),
  close: (pollId: number) => api.post<PollOut>(`/api/polls/${pollId}/close`),
};

export const pinsApi = {
  list: (chatId: number) => api.get<PinOut[]>(`/api/chats/${chatId}/pins`),
  pin: (chatId: number, messageId: number) =>
    api.post<PinOut[]>(`/api/chats/${chatId}/pin`, { message_id: messageId }),
  unpin: (chatId: number, messageId: number) =>
    api.delete<PinOut[]>(`/api/chats/${chatId}/pin/${messageId}`),
};

export const chatApi = {
  list: () => api.get<ChatOut[]>("/api/chats"),
  createDm: (userId: number) =>
    api.post<ChatOut>(`/api/chats/dm?target_user_id=${userId}`),
  createGroup: (name: string, memberIds: number[], allowAllWrite = true) =>
    api.post<ChatOut>("/api/chats/group", { name, member_ids: memberIds, allow_all_write: allowAllWrite }),
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
  uploadFile: (chatId: number, file: File, caption = "", mediaGroupId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    if (mediaGroupId) form.append("media_group_id", mediaGroupId);
    return api.post<MessageOut>(`/api/chats/${chatId}/files`, form);
  },
  getReadStatus: (chatId: number) => api.get<Array<{ user_id: number; last_read_message_id: number }>>(`/api/chats/${chatId}/read-status`),
  getUnreadCounts: () => api.get<Record<string, number>>("/api/chats/unread/counts"),
  getOnlineUsers: () => api.get<{ online_user_ids: number[] }>("/api/chats/online/users"),
  uploadGroupAvatar: (chatId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<ChatOut>(`/api/chats/${chatId}/avatar`, form);
  },
  stats: (chatId: number) => api.get<ChatStats>(`/api/chats/${chatId}/stats`),
  update: (chatId: number, data: { name?: string; description?: string; admin_ids?: number[]; compendium_enabled?: boolean }) =>
    api.patch<ChatOut>(`/api/chats/${chatId}`, data),
  kickMember: (chatId: number, userId: number) =>
    api.delete<ChatOut>(`/api/chats/${chatId}/members/${userId}`),
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
  reentries: number;
  gas_paid: number;
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
  /** chips — обычный на фишки; gas — «за газ ⛽»: энтри, докупки, котёл победителю */
  mode: "chips" | "gas";
  entry_gas: number;
  max_reentries: number;
  reentry_until_level: number;
  gas_pot: number;
  seats: PokerSeatOut[];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/** Настройки стола — создатель задаёт при создании и правит в лобби. */
export interface PokerTableSettings {
  max_seats?: number;
  starting_stack?: number;
  starting_small_blind?: number;
  blind_increase_minutes?: number;
  mode?: "chips" | "gas";
  entry_gas?: number;
  max_reentries?: number;
  reentry_until_level?: number;
}

export interface PokerHistoryAction { user_id: number; action: string; to: number; all_in: boolean }
export interface PokerHistoryStreet { street: string; community: string[]; actions: PokerHistoryAction[] }
export interface PokerHistoryHand {
  hand_no: number;
  blinds: [number, number];
  players: Array<{ user_id: number; seat: number; stack: number }>;
  streets: PokerHistoryStreet[];
  pot: number;
  reason: string;
  winners: number[];
  winning_hand: string | null;
  community: string[];
  showdown: Array<{ user_id: number; hole: string[]; hand: string | null }>;
}
export interface PokerHistory { table_id: number; names: Record<string, string>; hands: PokerHistoryHand[] }

export interface PokerPlayerView {
  user_id: number;
  seat_index: number;
  stack: number;
  bet: number;
  has_folded: boolean;
  is_all_in: boolean;
  reentries: number;
  can_reenter: boolean;
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
  starting_stack: number;
  mode: "chips" | "gas";
  entry_gas: number;
  gas_pot: number;
  max_reentries: number;
  reentry_until_level: number;
  /** epoch-секунды дедлайна паузы «докупись или всё» (режим за газ), иначе null */
  reentry_open_until: number | null;
  history_len: number;
  hand: PokerHandView | null;
  players: PokerPlayerView[];
}

export const dotaApi = {
  // Typing /dota in a chat -> server drops a "/dota_call" card message into
  // the chat and pushes everyone's phones.
  call: (chatId: number) => api.post<{ message_id: number }>("/api/dota/call", { chat_id: chatId }),
};

export const pokerApi = {
  list: (chatId: number) => api.get<PokerTableOut[]>(`/api/poker?chat_id=${chatId}`),
  create: (chatId: number, settings: PokerTableSettings = { max_seats: 6 }) =>
    api.post<PokerTableOut>("/api/poker", { chat_id: chatId, ...settings }),
  settings: (tableId: number, patch: PokerTableSettings) =>
    api.patch<PokerTableOut>(`/api/poker/${tableId}/settings`, patch),
  join: (tableId: number) => api.post<PokerTableOut>(`/api/poker/${tableId}/join`),
  leave: (tableId: number) => api.post<PokerTableOut | null>(`/api/poker/${tableId}/leave`),
  start: (tableId: number) => api.post<PokerTableOut>(`/api/poker/${tableId}/start`),
  close: (tableId: number) => api.post<{ ok: boolean }>(`/api/poker/${tableId}/close`),
  /** Докупка в режиме «за газ» (вылетел → энтри ещё раз → стартовый стек) */
  reentry: (tableId: number) => api.post<PokerTableOut>(`/api/poker/${tableId}/reentry`),
  /** «Сыграть ещё»: новый стол с теми же настройками и людьми, старый удаляется */
  restart: (tableId: number) => api.post<PokerTableOut>(`/api/poker/${tableId}/restart`),
  history: (tableId: number) => api.get<PokerHistory>(`/api/poker/${tableId}/history`),
};

export const getFileUrl = (url: string) => `${BASE_URL}${url}`;
export default api;
