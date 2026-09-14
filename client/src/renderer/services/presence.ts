import { useEffect, useState } from "react";
import { wsService } from "./ws";

// «🎮 в Доте сейчас»: сервер шлёт dota_presence при смене состава и
// снимок на каждое подключение. Держим набор в модуле, компоненты
// подписываются хуком — без проп-дриллинга через всё дерево.
let playing = new Set<number>();
const listeners = new Set<() => void>();

function onPresence(msg: any) {
  playing = new Set<number>((msg?.playing as number[]) || []);
  listeners.forEach((fn) => fn());
}

// «В Доте с этого компа»: Electron-детект процесса dota2.exe (работает
// при стим-невидимке). Раз в 60с шлём хартбит, пока Дота запущена —
// сервер держит отметку с TTL 180с и мержит со Steam-источником.
let clientRunning = false;
let hbTimer: ReturnType<typeof setInterval> | null = null;
let clientDetectHooked = false;

function sendClientPresence() {
  wsService.send({ type: "dota_client_presence", running: clientRunning });
}

function setClientRunning(running: boolean) {
  if (running === clientRunning) return;
  clientRunning = running;
  sendClientPresence();
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  if (running) hbTimer = setInterval(sendClientPresence, 60_000);
}

function onWsOpenResend() {
  // Реконнект: сервер (или его рестарт) забыл клиентскую отметку
  if (clientRunning) sendClientPresence();
}

// wsService.disconnect() (логаут) стирает ВСЕ хендлеры разом — тот же
// класс бага, что чинили в звонках. Перевешиваем при каждом коннекте
// (Main.tsx), off перед on — идемпотентно.
export function initPresence() {
  wsService.off("dota_presence", onPresence);
  wsService.on("dota_presence", onPresence);
  wsService.off("_ws_open", onWsOpenResend);
  wsService.on("_ws_open", onWsOpenResend);
  playing = new Set();
  listeners.forEach((fn) => fn());

  const el = (window as any).electron;
  if (el?.onDotaRunning && !clientDetectHooked) {
    clientDetectHooked = true;  // IPC-подписка живёт всю жизнь окна
    el.onDotaRunning(setClientRunning);
    el.getDotaRunning?.().then((r: boolean) => setClientRunning(!!r)).catch(() => {});
  }
  if (clientRunning) sendClientPresence();
}

initPresence();

export function useDotaPlaying(): Set<number> {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((t) => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return playing;
}

export function isPlaying(userId: number): boolean {
  return playing.has(userId);
}
