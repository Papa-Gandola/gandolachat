/**
 * Per-chat unsent message drafts, persisted in SecureStore so a half-typed
 * message survives leaving the chat (or killing the app). Cleared on send.
 *
 * Keyed per chat. Values are tiny (a line or two of text), well within
 * SecureStore's per-item limit.
 */
import * as SecureStore from "./secureStorage";

// SecureStore keys must match /^[A-Za-z0-9._-]+$/ — chatId is numeric so the
// template is always valid.
const keyFor = (chatId: string | number) => `gandola.draft.${chatId}`;

export async function getDraft(chatId: string | number): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(keyFor(chatId))) ?? "";
  } catch {
    return "";
  }
}

export async function setDraft(chatId: string | number, text: string): Promise<void> {
  try {
    if (text) await SecureStore.setItemAsync(keyFor(chatId), text);
    else await SecureStore.deleteItemAsync(keyFor(chatId));
  } catch {
    // best-effort
  }
}

export async function clearDraft(chatId: string | number): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(chatId));
  } catch {
    // best-effort
  }
}
