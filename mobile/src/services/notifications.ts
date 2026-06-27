import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { userApi } from "./api";
import { isChatMutedSync } from "./mutedChats";

// Foreground notification policy:
//   - app is "active" (user is interacting): swallow the notification — they
//     already see new messages in-app; popping a banner over the same chat is
//     annoying.
//   - app is backgrounded/locked: show the banner + play the sound.
//   - per-chat mute: never show.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request?.content?.data ?? {}) as {
      chat_id?: number;
      type?: string;
    };
    const isMuted = typeof data.chat_id === "number" && isChatMutedSync(Number(data.chat_id));
    // Always let incoming calls ring even when muted — calls are not "messages"
    // and the call_signal WS event drives the modal anyway. Users mute chats
    // to silence chatter, not to dodge phone calls.
    const isCall = data.type === "call";
    if (isMuted && !isCall) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      } as unknown as Notifications.NotificationBehavior;
    }
    const isForeground = AppState.currentState === "active";
    const visible = !isForeground;
    return {
      shouldShowAlert: visible,
      shouldPlaySound: visible,
      shouldSetBadge: false,
      shouldShowBanner: visible,
      shouldShowList: visible,
    } as unknown as Notifications.NotificationBehavior;
  },
});

let currentToken: string | null = null;

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  // Two channels so the OS can apply per-category importance / sound / vibration.
  await Notifications.setNotificationChannelAsync("default", {
    name: "По умолчанию",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#c6ff3d",
  });
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Сообщения",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 100, 200],
    lightColor: "#c6ff3d",
    sound: "default",
  });
  await Notifications.setNotificationChannelAsync("calls", {
    name: "Звонки",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 700, 700, 700],
    lightColor: "#c6ff3d",
    sound: "default",
    bypassDnd: true,
  });
}

async function getExpoToken(): Promise<string | null> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
      ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) {
      console.warn("[push] no EAS projectId in Constants — skipping push token");
      return null;
    }
    const res = await Notifications.getExpoPushTokenAsync({ projectId });
    return res.data ?? null;
  } catch (e) {
    console.warn("[push] getExpoPushTokenAsync failed", e);
    return null;
  }
}

/**
 * Request notification permission, fetch an Expo push token, and register it
 * with the backend. Safe to call repeatedly — same token is upserted on the
 * server.
 *
 * Called once after sign-in (from AuthContext).
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    // Warm the muted-chats cache so the synchronous handler check above can
    // see it on the very first notification after launch.
    const { loadMutedChats } = await import("./mutedChats");
    await loadMutedChats();

    // Web build: Expo push doesn't apply — use the Web Push (VAPID) path and
    // stop here. Everything below is native-only (Android channels, Expo token).
    if (Platform.OS === "web") {
      const { registerWebPush } = await import("./webPush");
      await registerWebPush();
      return;
    }

    await ensureAndroidChannels();
    const { status: existing } = await Notifications.getPermissionsAsync();
    let granted = existing === "granted";
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === "granted";
    }
    if (!granted) {
      console.log("[push] permission denied");
      return;
    }
    const token = await getExpoToken();
    if (!token) return;
    currentToken = token;
    await userApi.registerPushToken(token, Platform.OS);
    console.log("[push] token registered");
  } catch (e) {
    console.warn("[push] registerForPushNotifications failed", e);
  }
}

/**
 * Drop the push token from the backend (called on logout) so the user
 * doesn't keep getting notifications for the previous account.
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  // Web: drop the browser's Web Push subscription instead of an Expo token.
  if (Platform.OS === "web") {
    try {
      const { unregisterWebPush } = await import("./webPush");
      await unregisterWebPush();
    } catch {
      // best-effort
    }
    return;
  }
  if (!currentToken) return;
  try {
    await userApi.unregisterPushToken(currentToken);
  } catch {
    // Best-effort — server-side prune job will eventually GC.
  } finally {
    currentToken = null;
  }
}
