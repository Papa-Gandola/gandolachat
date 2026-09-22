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
 * Both kinds open the chat. Для ЗВОНКА этого мало: пока телефон спал, его
 * сокет был мёртв, и оффер звонящего (send_to_user без живых сокетов)
 * пропал — плашка «Входящий» по WS уже не придёт. Поэтому тап по звонковому
 * пушу сам поднимает плашку через `onCallInvite` (CallContext подписывается),
 * а «Принять» в ней входит в идущий звонок по call_join.
 */
import * as Notifications from "expo-notifications";

import { navigateToChat } from "../navigation/navigationRef";

let inited = false;

export interface CallInvite {
  chatId: number;
  fromUserId: number;
  name: string;
}

type InviteCb = (invite: CallInvite) => void;

let inviteCb: InviteCb | null = null;
// Приглашение, приехавшее до подписки (холодный старт): отдадим, как только
// CallContext смонтируется.
let pendingInvite: CallInvite | null = null;

/** CallContext регистрирует сюда свой обработчик входящего звонка. */
export function setCallInviteHandler(cb: InviteCb | null): void {
  inviteCb = cb;
  if (cb && pendingInvite) {
    const inv = pendingInvite;
    pendingInvite = null;
    cb(inv);
  }
}

function raiseInvite(invite: CallInvite): void {
  if (inviteCb) inviteCb(invite);
  else pendingInvite = invite;
}

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

  if (data.type === "call") {
    const fromRaw = data.from_user_id;
    const fromUserId =
      typeof fromRaw === "number" ? fromRaw : typeof fromRaw === "string" ? Number(fromRaw) : NaN;
    if (Number.isFinite(fromUserId)) {
      raiseInvite({ chatId: Number(chatId), fromUserId, name });
    }
  }
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
