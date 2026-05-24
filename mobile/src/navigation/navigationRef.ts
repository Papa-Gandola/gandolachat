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

/**
 * Navigate to a chat screen from outside React (e.g. notification tap).
 * Safe to call before the navigator is ready — silently no-ops in that case.
 * Routes to GroupChat when isGroup is true, otherwise Chat with userId.
 */
export function navigateToChat(link: ChatDeeplink): void {
  if (!navigationRef.isReady()) return;
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
  navigationRef.dispatch(
    CommonActions.navigate({
      name: "Main",
      params: {
        screen: "Chats",
        params: { screen, params },
      },
    }),
  );
}
