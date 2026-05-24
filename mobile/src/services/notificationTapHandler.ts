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
 *   message → { type, chat_id, message_id, is_group, peer_user_id, chat_name }
 *   call    → { type, chat_id, from_user_id, is_group, peer_user_id, chat_name }
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
  const isGroup = !!data.is_group;
  const name =
    typeof data.chat_name === "string" && data.chat_name.length > 0
      ? (data.chat_name as string)
      : "Чат";
  // For DM the server includes peer_user_id; for groups it's null/undefined.
  const peerRaw = data.peer_user_id;
  const userId =
    typeof peerRaw === "number"
      ? peerRaw
      : typeof peerRaw === "string" && peerRaw
        ? Number(peerRaw)
        : undefined;
  navigateToChat({ chatId, name, isGroup, userId });
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
