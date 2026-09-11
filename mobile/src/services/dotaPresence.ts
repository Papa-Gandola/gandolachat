import { useEffect, useState } from "react";
import { wsService } from "./ws";

// «🎮 в Доте сейчас»: сервер шлёт dota_presence при смене состава и
// снимок на каждое подключение (зеркало десктопного services/presence.ts).
let playing = new Set<number>();
const listeners = new Set<() => void>();

wsService.on("dota_presence", (msg: { playing?: number[] }) => {
  playing = new Set<number>(msg?.playing || []);
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
