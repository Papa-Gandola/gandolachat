/**
 * Foreground Service wrapper for active calls.
 *
 * Android aggressively suspends backgrounded apps. A Foreground Service tells
 * the OS "this process is doing user-visible work" — backed by a persistent
 * notification — so the WebRTC tracks keep flowing and the JS thread keeps
 * scheduling. Without this, calls can pause / drop when the user switches
 * apps. @notifee/react-native does the heavy lifting; we just register a
 * runner and show/hide the notification.
 */
import notifee, { AndroidImportance } from "@notifee/react-native";

const CHANNEL_ID = "call-foreground";
const NOTIFICATION_ID = "gandola-active-call";

let registered = false;

/**
 * Register a no-op runner so notifee knows what to do when an FG service
 * notification is displayed. Must be called once at app startup BEFORE any
 * displayNotification with `asForegroundService: true`. Safe to call multiple
 * times — the second call is a no-op.
 */
export function registerCallForegroundRunner(): void {
  if (registered) return;
  registered = true;
  // The runner must return a promise that resolves only when the service
  // should stop. We resolve it via `stopForegroundService()` below — until
  // then we just sit here keeping the process alive.
  notifee.registerForegroundService(() => {
    return new Promise(() => {
      // Never resolves. stopForegroundService() will tear this down.
    });
  });
}

async function ensureChannel(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: "Активный звонок",
    // LOW so it doesn't make noise — the ringtone handles audio separately.
    importance: AndroidImportance.LOW,
    lights: false,
    vibration: false,
  });
}

/**
 * Show the ongoing call notification and start the Foreground Service.
 * Called from CallContext when `inCall` flips true.
 */
export async function startCallForegroundService(peerName: string): Promise<void> {
  try {
    registerCallForegroundRunner();
    await ensureChannel();
    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: "Активный звонок",
      body: peerName ? `Идёт разговор с ${peerName}` : "Идёт разговор",
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        ongoing: true,
        // Tap brings the app to the front; the call modal is already up.
        pressAction: { id: "default", launchActivity: "default" },
        // Stable colour pulled from the Neo accent so the notification matches the app.
        color: "#c6ff3d",
        // smallIcon defaults to the app icon configured in app.json.
      },
    });
  } catch (e) {
    console.warn("[callFG] start failed", e);
  }
}

export async function stopCallForegroundService(): Promise<void> {
  try {
    await notifee.stopForegroundService();
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch (e) {
    console.warn("[callFG] stop failed", e);
  }
}
