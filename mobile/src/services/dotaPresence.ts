import { useEffect, useState } from "react";
import { wsService } from "./ws";

// «🎮 в Доте сейчас» (зеркало десктопного services/presence.ts).
let playing = new Set<number>();
const listeners = new Set<() => void>();

function onPresence(msg: { playing?: number[] }) {
  playing = new Set<number>(msg?.playing || []);
  listeners.forEach((fn) => fn());
}

// wsService.disconnect() (логаут) стирает ВСЕ хендлеры разом (см. webrtc.init)
// — перевешиваем при каждом коннекте из AuthContext.
export function initDotaPresence() {
  wsService.off("dota_presence", onPresence);
  wsService.on("dota_presence", onPresence);
  playing = new Set();
  listeners.forEach((fn) => fn());
}

initDotaPresence();

export function useDotaPlaying(): Set<number> {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((t) => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return playing;
}
