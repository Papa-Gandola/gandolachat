import Constants from "expo-constants";

// Read base URLs from app.json "extra" (set at build time). Falls back to a
// localhost dev value if absent so `expo start` from a simulator works out of
// the box. In production we ALWAYS expect the URLs to be present.
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; wsUrl?: string };

export const API_URL: string = extra.apiUrl ?? "http://localhost:8000";
export const WS_URL: string = extra.wsUrl ?? "ws://localhost:8000";

export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
