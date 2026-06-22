/**
 * Platform-aware secure storage.
 *
 * Native: proxies to expo-secure-store (Keychain on iOS, EncryptedSharedPrefs
 * on Android — the right thing for tokens and per-user state).
 *
 * Web: SecureStore isn't available, so we fall back to localStorage. This is
 * NOT actually secure — anyone with DOM access can read it — but the web
 * build is a PWA running on the user's own device, and the tradeoff matches
 * what every other browser-based chat does. JWT in localStorage is the
 * least-bad option; the alternative (httpOnly cookies) needs a server-side
 * session model we don't have.
 *
 * All call sites that previously imported `expo-secure-store` directly now
 * import from here, so the same code path works on iOS/Android/Web.
 */
import { Platform } from "react-native";

const isWeb = Platform.OS === "web";

export async function getItemAsync(key: string): Promise<string | null> {
  if (isWeb) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  const SecureStore = await import("expo-secure-store");
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (isWeb) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* quota or disabled */ }
    return;
  }
  const SecureStore = await import("expo-secure-store");
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (isWeb) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
    return;
  }
  const SecureStore = await import("expo-secure-store");
  await SecureStore.deleteItemAsync(key);
}
