import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { userApi } from "./api";

// In-foreground behaviour: still show a banner + play sound, otherwise the
// system would suppress notifications when the app is open and the user
// wouldn't know a message arrived from another chat.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    // SDK 53+ split shouldShowAlert into banner/list; SDK 51 still accepts
    // just shouldShowAlert. Both forms below are no-ops on the older SDK.
    shouldShowBanner: true,
    shouldShowList: true,
  } as unknown as Notifications.NotificationBehavior),
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
  if (!currentToken) return;
  try {
    await userApi.unregisterPushToken(currentToken);
  } catch {
    // Best-effort — server-side prune job will eventually GC.
  } finally {
    currentToken = null;
  }
}
