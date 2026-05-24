/**
 * Notification tap → deeplink handler.
 *
 * Two paths into the app:
 *   1. Tap a push that arrived while the app was running OR backgrounded
 *      (Expo Notifications fires `addNotificationResponseReceivedListener`).
 *   2. The app was killed and the OS launched it from a notification
 *      (Expo gives us the initial notification via
 *      `getLastNotificationResponseAsync`).
 *
 * Notification payload contract (set by the server in app/push.py):
 *   message → { type: "message", chat_id: number, message_id: number }
 *   call    → { type: "call",    chat_id: number, from_user_id: number }
 *
 * Both kinds open the chat. For a call, the incoming-call prompt is already
 * driven by the WS `call_signal` event — once the user is back in the app
 * the modal pops up on its own; we just need to put them on the right screen.
 */
import * as Notifications from "expo-notifications";

import { navigateToChat } from "../navigation/navigationRef";

let inited = false;

function handlePayload(data: Record<string, unknown> | undefined | null) {
  if (!data) return;
  const chatIdRaw = data.chat_id;
  if (chatIdRaw == null) return;
  const chatId = String(chatIdRaw);
  navigateToChat(chatId);
}

export function initNotificationTapHandler(): void {
  if (inited) return;
  inited = true;

  // Cold-start: app was killed, launched from a notification tap.
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response?.notification?.request?.content?.data) {
        handlePayload(response.notification.request.content.data as Record<string, unknown>);
      }
    })
    .catch(() => {});

  // Hot path: notification tapped while the app was already running.
  Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | Record<string, unknown>
      | undefined;
    handlePayload(data);
  });
}
