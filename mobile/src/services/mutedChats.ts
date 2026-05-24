/**
 * Per-chat mute state, persisted across app restarts in SecureStore.
 *
 * The mute is purely client-side: the server still sends push notifications
 * for every message, but the notification handler in services/notifications.ts
 * checks this set and silently drops alerts for muted chats. WS-level message
 * delivery is unaffected — the chat still updates in-app when the user opens
 * it.
 *
 * SecureStore is overkill for a list of numbers, but expo-secure-store is
 * already in the deps so we avoid adding a separate AsyncStorage dependency.
 */
import * as SecureStore from "expo-secure-store";

const KEY = "gandola.mutedChats";

let cache: Set<number> | null = null;
const listeners = new Set<(muted: Set<number>) => void>();

async function load(): Promise<Set<number>> {
  if (cache) return cache;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    cache = new Set<number>(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    cache = new Set<number>();
  }
  return cache;
}

async function persist(set: Set<number>): Promise<void> {
  cache = set;
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify([...set]));
  } catch {
    // best-effort
  }
  listeners.forEach((l) => l(new Set(set)));
}

/** Synchronous check used by the foreground notification handler — needs to
 *  return immediately, so we serve from the in-memory cache. The cache is
 *  warmed in `loadMutedChats()` at app startup. */
export function isChatMutedSync(chatId: number): boolean {
  if (!cache) return false;
  return cache.has(chatId);
}

export async function isChatMuted(chatId: number): Promise<boolean> {
  const set = await load();
  return set.has(chatId);
}

export async function muteChat(chatId: number): Promise<void> {
  const set = await load();
  set.add(chatId);
  await persist(set);
}

export async function unmuteChat(chatId: number): Promise<void> {
  const set = await load();
  set.delete(chatId);
  await persist(set);
}

export async function toggleChatMuted(chatId: number): Promise<boolean> {
  const set = await load();
  if (set.has(chatId)) {
    set.delete(chatId);
  } else {
    set.add(chatId);
  }
  await persist(set);
  return set.has(chatId);
}

/** Warm the in-memory cache. Call once on app startup so isChatMutedSync()
 *  works for the first notifications that arrive. */
export async function loadMutedChats(): Promise<void> {
  await load();
}

/** Subscribe to mute-state changes. Returns an unsubscribe function. */
export function subscribeMutedChats(listener: (muted: Set<number>) => void): () => void {
  listeners.add(listener);
  if (cache) listener(new Set(cache));
  return () => {
    listeners.delete(listener);
  };
}
