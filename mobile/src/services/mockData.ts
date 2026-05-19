import { ChatRowData } from "../components/ChatRow";
import { ReadStatus } from "../components/ReadBar";

// Mock chats used by stub screens while real API/WebSocket wiring is in
// progress. Mirrors mock-data.jsx from the design handoff.
export const CHAT_LIST: ChatRowData[] = [
  {
    id: "g1",
    name: "Команда проекта",
    letter: "#",
    color: "#7a5a3a",
    group: true,
    last: "Лёша: deploy через час",
    ts: "19:42",
    unread: 12,
    online: false,
  },
  {
    id: "d1",
    name: "werfire",
    letter: "W",
    color: "#ef5350",
    last: "печатает…",
    ts: "сейчас",
    typing: true,
    online: true,
  },
  {
    id: "d2",
    name: "Марина",
    letter: "М",
    color: "#7c4dff",
    last: "окей, договорились",
    ts: "19:38",
    online: true,
    lastStatus: "read",
  },
  { id: "d3", name: "zahVer", letter: "Z", color: "#ffa726", last: "кинь скрин", ts: "19:30", unread: 2 },
  {
    id: "d4",
    name: "Богдан Чома",
    letter: "Б",
    color: "#26a69a",
    last: "Ок, жду",
    ts: "18:14",
    muted: true,
  },
  {
    id: "g2",
    name: "Гондола чат · core",
    letter: "G",
    color: "#3a5a2a",
    group: true,
    last: "Кристина: 👀 :pog:",
    ts: "17:50",
  },
  { id: "d5", name: "AnitraNA", letter: "A", color: "#ec407a", last: "Мб чут позже", ts: "16:12", unread: 1 },
  {
    id: "d6",
    name: "super_gymnast2001",
    letter: "S",
    color: "#5c6bc0",
    last: "прикол :kekw:",
    ts: "14:22",
    lastStatus: "delivered",
  },
  { id: "d7", name: "Ban", letter: "B", color: "#ff7043", last: "фа", ts: "09:11", unread: 4, online: true },
];

export interface MockMessage {
  from: "me" | "them";
  text: string;
  ts: string;
  status?: ReadStatus;
  typing?: boolean;
  who?: string;
  avatar?: string;
  color?: string;
}

export const WERFIRE_THREAD: MockMessage[] = [
  { from: "them", text: "Слушай, в 19:00 встречаемся?", ts: "18:42" },
  { from: "me", text: "Да, буду", ts: "18:43", status: "read" },
  { from: "them", text: "Я тебе билет нашёл на тот концерт", ts: "18:45" },
  { from: "them", text: "Скинул в личку контакт продавца", ts: "18:45" },
  { from: "me", text: "Огонь, спасибо большое 🙏", ts: "18:50", status: "read" },
  { from: "me", text: "Через 20 минут наберу", ts: "19:20", status: "delivered" },
];
