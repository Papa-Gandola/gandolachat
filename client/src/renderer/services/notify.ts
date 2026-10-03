// Системные уведомления о сообщениях — с реестром по чату, чтобы гасить их,
// когда чат прочитан на ДРУГОМ устройстве (просьба хозяина 03.10): сервер
// шлёт message_read и нашим сокетам, Main.tsx зовёт closeChatNotifications.
// Своё же чтение (клик по чату здесь) тоже проходит через message_read —
// уведомления этого чата закрываются и в этом случае.
const open = new Map<number, Set<Notification>>();

export function showChatNotification(chatId: number, title: string, body: string, onClick?: () => void): void {
  const build = () => {
    const n = new Notification(title, { body });
    let set = open.get(chatId);
    if (!set) {
      set = new Set();
      open.set(chatId, set);
    }
    set.add(n);
    const forget = () => {
      const s = open.get(chatId);
      if (!s) return;
      s.delete(n);
      if (s.size === 0) open.delete(chatId);
    };
    n.onclose = forget;
    n.onclick = () => {
      onClick?.();
      n.close();
      forget();
    };
    return n;
  };
  if (Notification.permission === "granted") {
    build();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => {
      if (p === "granted") build();
    });
  }
}

export function closeChatNotifications(chatId: number): void {
  const set = open.get(chatId);
  if (!set) return;
  open.delete(chatId);
  for (const n of Array.from(set)) {
    try { n.close(); } catch { /* уже закрыто */ }
  }
}
