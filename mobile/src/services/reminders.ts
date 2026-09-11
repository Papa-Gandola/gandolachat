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
import { Platform } from "react-native";

import { notesApi } from "./api";

const PREFIX = "reminder-";

export async function scheduleLocalReminder(id: number, text: string, remindAtIso: string): Promise<void> {
  if (Platform.OS === "web") return;
  const date = new Date(remindAtIso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: PREFIX + id,
      content: { title: "⏰ Напоминание", body: text, sound: "default" },
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
  } catch {
    // офлайн — попробуем при следующем старте
  }
}
