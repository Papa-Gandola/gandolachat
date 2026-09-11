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

// wsService.disconnect() (логаут) стирает ВСЕ хендлеры разом — тот же
// класс бага, что чинили в звонках. Перевешиваем при каждом коннекте
// (Main.tsx), off перед on — идемпотентно.
export function initPresence() {
  wsService.off("dota_presence", onPresence);
  wsService.on("dota_presence", onPresence);
  playing = new Set();
  listeners.forEach((fn) => fn());
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
