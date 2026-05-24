/**
 * Global navigation ref. Lets non-React modules (push tap handlers,
 * notifee event listeners, deep-link handlers) drive navigation without
 * having to live inside the component tree.
 */
import { createNavigationContainerRef, StackActions } from "@react-navigation/native";

import type { RootStackParamList } from "./types";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Navigate to a chat screen from outside React (e.g. notification tap).
 * Safe to call before the navigator is ready — silently no-ops in that case.
 */
export function navigateToChat(chatId: string, name = "Чат"): void {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    StackActions.push("Main", {
      screen: "Chats",
      params: {
        screen: "Chat",
        params: { chatId, name },
      },
    }),
  );
}
