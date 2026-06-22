// Web stub for @notifee/react-native.
//
// notifee drives Android foreground-service notifications (used to keep a call
// alive in the background). None of that applies on web — calls only run while
// the PWA is foregrounded, and web notifications go through the service worker.
// Every method here is a harmless no-op.
//
// Only loaded for the web bundle (aliased in metro.config.js).
const noop = () => {};
const asyncNoop = async () => {};

export const AndroidImportance = { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4 };
export const AndroidColor = {};
export const AndroidVisibility = { PRIVATE: 0, PUBLIC: 1, SECRET: -1 };
export const EventType = { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2 };

export default {
  registerForegroundService: noop,
  createChannel: asyncNoop,
  createChannels: asyncNoop,
  displayNotification: asyncNoop,
  stopForegroundService: asyncNoop,
  cancelNotification: asyncNoop,
  cancelAllNotifications: asyncNoop,
  onForegroundEvent: () => noop, // returns an unsubscribe fn
  onBackgroundEvent: noop,
  requestPermission: asyncNoop,
};
