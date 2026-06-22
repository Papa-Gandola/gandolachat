/**
 * iOS/Safari PWA shims. Runs once on web boot — no-ops everywhere else.
 *
 * Two jobs:
 *   1. Inject Apple-specific meta tags so "Add to Home Screen" treats the app
 *      as a standalone PWA (no Safari chrome, dark status bar, app title).
 *      Expo's generated manifest covers Android/Chrome, but iOS Safari also
 *      reads these legacy meta tags and won't go fullscreen without them.
 *   2. Register the service worker at /sw.js so the install banner appears
 *      and (once Web Push is wired) push subscriptions can be created.
 *
 * Safe to import unconditionally — the body short-circuits on native.
 */
import { Platform } from "react-native";

function ensureMeta(name: string, content: string, attr: "name" | "property" = "name") {
  const sel = `meta[${attr}="${name}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureLink(rel: string, href: string, extra: Record<string, string> = {}) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
}

export function initWebPwa(): void {
  if (Platform.OS !== "web") return;
  if (typeof document === "undefined") return;

  // PWA / Safari "Add to Home Screen" meta tags. Without these, iOS opens the
  // installed icon in a regular Safari tab with the URL bar visible.
  ensureMeta("apple-mobile-web-app-capable", "yes");
  ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  ensureMeta("apple-mobile-web-app-title", "GandolaChat");
  ensureMeta("mobile-web-app-capable", "yes");
  ensureMeta("theme-color", "#0a0a0a");
  // Fill the notch / safe area with the app background instead of white.
  ensureMeta("viewport", "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no");

  // App lives under /app, so static assets do too. Apple picks this image
  // for the home-screen tile; falls back to the favicon if missing.
  ensureLink("apple-touch-icon", "/app/apple-touch-icon.png", { sizes: "180x180" });

  // Service worker registration. Scope is the directory the SW controls — we
  // set it to /app/ so the SW handles in-app routes only. Wrapped in try
  // because some browsers (e.g. private mode) reject it and we don't want
  // that to crash the chat.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {
      // best-effort — chat keeps working without the SW; only PWA install
      // banner and (future) Web Push need it.
    });
  }
}
