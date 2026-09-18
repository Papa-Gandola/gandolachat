/**
 * Global navigation ref. Lets non-React modules (push tap handlers,
 * notifee event listeners, deep-link handlers) drive navigation without
 * having to live inside the component tree.
 */
import { CommonActions, createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./types";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export interface ChatDeeplink {
  chatId: string;
  name: string;
  isGroup: boolean;
  /** For DM: the other participant's user_id. Required so ChatScreen
   *  treats the conversation as a DM (otherwise userId == null is
   *  interpreted as "this is a group", which breaks the call button
   *  and the online indicator). */
  userId?: number;
}

// Переход, заказанный ДО готовности навигатора. Тап по пушу с убитого
// приложения приходит раньше, чем смонтирован контейнер (а он ещё и ждёт
// чтения токена в AuthContext) — раньше такой переход молча терялся, и
// пуш открывал приложение «просто так», не на чате.
let pendingLink: ChatDeeplink | null = null;

function dispatchChat(link: ChatDeeplink): void {
  const screen = link.isGroup ? "GroupChat" : "Chat";
  const params = {
    chatId: link.chatId,
    name: link.name,
    isGroup: link.isGroup,
    userId: link.userId,
  };
  // CommonActions.navigate handles nested navigators correctly: if the user
  // is already on a Chat screen, this just updates params (and ChatScreen's
  // route param change will pick it up). If they're elsewhere, it pushes.
  // pop: true — в react-navigation 7 navigate иначе не возвращается к
  // экрану чата, лежащему глубже в стеке (пуш поверх поиска по сообщениям
  // плодил бы второй ChatScreen).
  navigationRef.dispatch(
    CommonActions.navigate("Main", {
      screen: "Chats",
      params: { screen, params, pop: true },
    }),
  );
}

/**
 * Navigate to a chat screen from outside React (e.g. notification tap).
 * Если навигатор ещё не готов (холодный старт из пуша), переход
 * запоминается и выполняется из `flushPendingLink()` на onReady.
 * Routes to GroupChat when isGroup is true, otherwise Chat with userId.
 */
export function navigateToChat(link: ChatDeeplink): void {
  if (!navigationRef.isReady()) {
    pendingLink = link;
    return;
  }
  dispatchChat(link);
}

/** Выполнить отложенный переход. Зовётся из NavigationContainer.onReady. */
export function flushPendingLink(): void {
  const link = pendingLink;
  pendingLink = null;
  if (!link || !navigationRef.isReady()) return;
  dispatchChat(link);
}
