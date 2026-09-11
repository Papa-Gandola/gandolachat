/**
 * Локальные уведомления для напоминаний из «Заметок» (только натив).
 *
 * Это офлайн-гарантия: уведомление планируется НА ТЕЛЕФОНЕ и сработает без
 * интернета. Сервер для нативного андроида пуш нарочно не шлёт (иначе дубль);
 * PWA-айфоны и открытые вкладки получают серверный Web Push.
 *
 * Ресинк по серверному списку покрывает напоминания, созданные с других
 * устройств, и переустановку приложения.
 */
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { notesApi } from "./api";
import { wsService } from "./ws";

const PREFIX = "reminder-";
let lastSyncAt = 0;
let hooksInstalled = false;

/** Ресинк не только на старте: разворот приложения и реконнект WS тоже
 *  триггерят (напоминание, созданное/отменённое с ДРУГОГО устройства, иначе
 *  доезжало бы до телефона только после полного перезапуска). Троттлинг 60с. */
export function initReminderResync(): void {
  if (Platform.OS === "web" || hooksInstalled) return;
  hooksInstalled = true;
  const throttled = () => {
    if (Date.now() - lastSyncAt < 60_000) return;
    resyncLocalReminders().catch(() => {});
  };
  AppState.addEventListener("change", (st) => {
    if (st === "active") throttled();
  });
  wsService.on("_ws_open", throttled);
}

export async function scheduleLocalReminder(id: number, text: string, remindAtIso: string): Promise<void> {
  if (Platform.OS === "web") return;
  const date = new Date(remindAtIso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: PREFIX + id,
      // data.type=reminder — форграунд-хендлер показывает напоминание ДАЖЕ
      // при открытом приложении (обычные сообщения он в форграунде глушит).
      content: { title: "⏰ Напоминание", body: text, sound: "default", data: { type: "reminder" } },
      trigger: date as unknown as Notifications.NotificationTriggerInput,
    });
  } catch {
    // не критично: сообщение в Заметках всё равно появится
  }
}

export async function cancelLocalReminder(id: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(PREFIX + id);
  } catch {
    // ignore
  }
}

export async function resyncLocalReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const { data } = await notesApi.listReminders();
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier?.startsWith(PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    for (const r of data) {
      await scheduleLocalReminder(r.id, r.text, r.remind_at);
    }
    lastSyncAt = Date.now();
  } catch {
    // офлайн — попробуем при следующем старте
  }
}
