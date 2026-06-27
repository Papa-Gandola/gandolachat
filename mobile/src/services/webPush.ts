/**
 * Web Push registration for the browser / iOS-PWA build.
 *
 * Native (iOS/Android APK) uses Expo push via services/notifications.ts — this
 * module is a no-op there. On web it:
 *   1. asks the server for the VAPID public key (empty => feature disabled)
 *   2. requests Notification permission
 *   3. subscribes through the service worker's pushManager
 *   4. POSTs the subscription to the server so it can deliver pushes
 *
 * The service worker (public/sw.js) handles the actual `push` event and shows
 * the notification. iOS only delivers Web Push when the PWA is installed to
 * the home screen (iOS 16.4+); in a plain Safari tab subscribe() will reject,
 * which we swallow.
 */
import { Platform } from "react-native";

import { userApi } from "./api";

const isWeb = Platform.OS === "web";

// base64url -> Uint8Array, the form pushManager.subscribe expects for
// applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function subToJSON(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/**
 * Register for Web Push. Safe to call after every sign-in — idempotent
 * (re-subscribing the same browser just re-points the server row). No-op on
 * native or when the browser lacks the APIs.
 */
export async function registerWebPush(): Promise<void> {
  if (!isWeb) return;
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return;
  }
  try {
    // 1. Server-side feature flag — empty key means web push isn't configured.
    const { data } = await userApi.getVapidPublicKey();
    const vapidKey = data?.key;
    if (!vapidKey) return;

    // 2. Permission. Don't prompt if already denied — would just throw.
    if (Notification.permission === "denied") return;
    if (Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }

    // 3. Subscribe via the registered service worker.
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: TS's lib types Uint8Array as generic over ArrayBufferLike,
        // which trips the BufferSource check even though it's valid at runtime.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }

    // 4. Hand the subscription to the server.
    const payload = subToJSON(sub);
    if (payload) await userApi.webPushSubscribe(payload);
  } catch (e) {
    // iOS-Safari-not-installed, permission race, etc. — best effort.
    console.warn("[webpush] register failed", e);
  }
}

/**
 * Drop the current browser's Web Push subscription (called on logout) so the
 * previous account stops getting notifications on this device.
 */
export async function unregisterWebPush(): Promise<void> {
  if (!isWeb || typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    if (endpoint) await userApi.webPushUnsubscribe(endpoint);
  } catch {
    // best-effort
  }
}
