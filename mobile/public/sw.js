// Service worker for the GandolaChat PWA. Three jobs today:
//   - exist (Safari refuses to show the "Add to Home Screen" install prompt
//     without a registered SW + manifest)
//   - handle incoming Web Push events when the server starts firing them
//   - reopen the app to the right chat on notification click
//
// Deliberately no offline cache yet — chat history lives behind auth and the
// JWT can expire while the SW serves stale shells. We'll add a precache for
// the bundle once Web Push is wired and the routing is stable.

const APP_URL = "/app/";

self.addEventListener("install", (e) => {
  // Activate immediately so the user doesn't need to refresh after installing.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  // Take over any open tabs that loaded before the SW was registered.
  e.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // Server sends { title, body, data: { chat_id, ... } } as JSON.
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "GandolaChat";
  const body = payload.body || "";
  const data = payload.data || {};
  const tag = payload.tag || (data.chat_id ? `chat-${data.chat_id}` : undefined);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,           // collapses multiple notifications from the same chat
      renotify: !!tag,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.chat_id ? `${APP_URL}?chat=${data.chat_id}` : APP_URL;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open tab if we have one, otherwise spawn a new one.
      for (const c of clients) {
        if ("focus" in c) {
          if ("navigate" in c) c.navigate(url);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
