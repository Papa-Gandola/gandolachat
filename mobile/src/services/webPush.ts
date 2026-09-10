/**
 * Web Push для PWA (iOS 16.4+ поддерживает пуши у «На экран Домой»).
 *
 * Нативные платформы ходят через Expo (notifications.ts) — здесь только
 * веб-ветка: подписка PushManager на service worker (sw.js уже умеет
 * показывать уведомления и открывать нужный чат по тапу).
 *
 * Важно про iOS: Notification.requestPermission() работает только из жеста
 * пользователя и только в установленной PWA — поэтому включение живёт на
 * кнопке в профиле, а на старте мы лишь молча переподписываемся, если
 * разрешение уже выдано.
 */
import { Platform } from "react-native";

import { userApi } from "./api";

export type WebPushState = "unsupported" | "denied" | "on" | "off";

function isWebPushCapable(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

function b64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function webPushState(): Promise<WebPushState> {
  if (!isWebPushCapable()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

async function subscribeAndRegister(): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { data } = await userApi.webPushKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(data.key),
    });
  }
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  await userApi.registerWebPush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return true;
}

/** Кнопка «включить уведомления» — можно звать только из жеста (iOS). */
export async function webPushEnable(): Promise<WebPushState> {
  if (!isWebPushCapable()) return "unsupported";
  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  }
  if (Notification.permission !== "granted") return "denied";
  try {
    return (await subscribeAndRegister()) ? "on" : "off";
  } catch (e) {
    console.warn("[webpush] enable failed", e);
    return "off";
  }
}

/** Молчаливая переподписка на старте/логине — только если уже разрешено. */
export async function webPushResubscribeSilent(): Promise<void> {
  if (!isWebPushCapable() || Notification.permission !== "granted") return;
  try {
    await subscribeAndRegister();
  } catch (e) {
    console.warn("[webpush] silent resubscribe failed", e);
  }
}

/** Выключение (кнопка/логаут): снять подписку и на сервере, и в браузере. */
export async function webPushDisable(): Promise<void> {
  if (!isWebPushCapable()) return;
  try {
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await userApi.unregisterWebPush(endpoint).catch(() => {});
  } catch (e) {
    console.warn("[webpush] disable failed", e);
  }
}
