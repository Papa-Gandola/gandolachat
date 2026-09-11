import { useEffect, useState } from "react";
import { wsService } from "./ws";

// «🎮 в Доте сейчас»: сервер шлёт dota_presence при смене состава и
// снимок на каждое подключение. Держим набор в модуле, компоненты
// подписываются хуком — без проп-дриллинга через всё дерево.
let playing = new Set<number>();
const listeners = new Set<() => void>();

wsService.on("dota_presence", (msg: any) => {
  playing = new Set<number>((msg?.playing as number[]) || []);
  listeners.forEach((fn) => fn());
});

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
