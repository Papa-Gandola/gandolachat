/**
 * Звук в звонке: маршрут (динамик/разговорный) и персональная громкость
 * каждого участника — оба параметра переживают перезапуск приложения.
 *
 * ГРОМКОСТЬ. react-native-webrtc отдаёт непубличный, но штатный
 * `MediaStreamTrack._setVolume(gain)` (0..10, по умолчанию 1) — он доходит
 * до нативного AudioTrack, так что свой нативный модуль не нужен. В вебе
 * (PWA) этого метода нет: там звук идёт через <video> RTCView, и регулятор
 * молча ничего не делает — проверяем наличие метода, а не платформу.
 *
 * МАРШРУТ. У react-native-webrtc управления динамиком нет вообще, поэтому
 * react-native-incall-manager: он дёргает AudioManager (MODIFY_AUDIO_SETTINGS).
 * Нативный модуль => правки доезжают только новым APK, не по OTA (грабля №11).
 *
 * Хранилище — тот же secureStorage, что у черновиков и мьюта чатов
 * (AsyncStorage в зависимостях нет, отдельный ради двух ключей не тянем).
 */
import * as SecureStore from "./secureStorage";

const VOL_KEY = "gandola.callVolumes";
const SPK_KEY = "gandola.callSpeaker";

/** Шкала для кнопок −/+. 1 — «как есть», 0 — участник заглушен у меня. */
export const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;
export const DEFAULT_GAIN = 1;

let volumes: Map<number, number> | null = null;
let speaker = false;

async function loadVolumes(): Promise<Map<number, number>> {
  if (volumes) return volumes;
  try {
    const raw = await SecureStore.getItemAsync(VOL_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    volumes = new Map(Object.entries(obj).map(([k, v]) => [Number(k), Number(v)]));
  } catch {
    volumes = new Map();
  }
  return volumes;
}

/** Прогреть кэш на старте приложения: дальше всё читается синхронно —
 *  громкость применяется в момент прихода дорожки, ждать некогда. */
export async function loadCallAudio(): Promise<void> {
  await loadVolumes();
  try {
    speaker = (await SecureStore.getItemAsync(SPK_KEY)) === "1";
  } catch {
    speaker = false;
  }
}

export function getVolume(userId: number): number {
  return volumes?.get(userId) ?? DEFAULT_GAIN;
}

export function getAllVolumes(): Map<number, number> {
  return new Map(volumes ?? []);
}

export async function setVolume(userId: number, gain: number): Promise<void> {
  const map = await loadVolumes();
  if (gain === DEFAULT_GAIN) {
    map.delete(userId); // дефолт не храним — меньше мусора в сторе
  } else {
    map.set(userId, gain);
  }
  try {
    await SecureStore.setItemAsync(VOL_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // best-effort: в этой сессии громкость всё равно уже применена
  }
}

/** Следующий/предыдущий шаг шкалы от текущего значения. */
export function stepVolume(current: number, dir: 1 | -1): number {
  const steps = VOLUME_STEPS as readonly number[];
  // Текущее значение может не совпасть со шкалой (старый стор) — берём ближайшее
  let idx = 0;
  let best = Infinity;
  steps.forEach((s, i) => {
    const d = Math.abs(s - current);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  const next = Math.min(steps.length - 1, Math.max(0, idx + dir));
  return steps[next];
}

export function volumeLabel(gain: number): string {
  return gain === 0 ? "0%" : `${Math.round(gain * 100)}%`;
}

export function isSpeakerOn(): boolean {
  return speaker;
}

export async function setSpeakerPref(on: boolean): Promise<void> {
  speaker = on;
  try {
    await SecureStore.setItemAsync(SPK_KEY, on ? "1" : "0");
  } catch {
    // best-effort
  }
}

/**
 * Применить громкость ко ВСЕМ аудиодорожкам потока участника.
 * Зовётся и при появлении дорожки, и при каждом изменении регулятора:
 * дорожка у участника может появиться позже (аудио-старт, ренегосиация).
 */
export function applyVolume(stream: { getAudioTracks: () => unknown[] } | null, gain: number): void {
  if (!stream) return;
  try {
    for (const t of stream.getAudioTracks()) {
      const setter = (t as { _setVolume?: (v: number) => void })._setVolume;
      if (typeof setter === "function") setter.call(t, gain);
    }
  } catch {
    // Веб-стаб или старая версия библиотеки — регулятор просто не работает,
    // звонок от этого ломаться не должен.
  }
}
