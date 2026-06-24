import Constants from "expo-constants";
import { Platform } from "react-native";

// Read base URLs from app.json "extra" (set at build time). Falls back to a
// localhost dev value if absent so `expo start` from a simulator works out of
// the box. In production we ALWAYS expect the URLs to be present.
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; wsUrl?: string };

// On web the app is served from the same origin as the API (nginx proxies
// /api, /ws, /uploads and the /app PWA all under one host). Deriving the URLs
// from window.location means the web build ALWAYS matches the page's scheme +
// host — no hardcoded domain, and no "mixed content" errors when the page is
// HTTPS but a baked-in URL is HTTP. Native (iOS/Android) keeps using the
// app.json value since there's no window there.
function webOrigin(): { api: string; ws: string } | null {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined" || !window.location) return null;
  const { protocol, host } = window.location;
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  return { api: `${protocol}//${host}`, ws: `${wsProto}//${host}` };
}

const wo = webOrigin();

export const API_URL: string = wo?.api ?? extra.apiUrl ?? "http://localhost:8000";
export const WS_URL: string = wo?.ws ?? extra.wsUrl ?? "ws://localhost:8000";

export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
