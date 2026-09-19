/**
 * Запись голосовых поверх expo-audio (SDK 57; до этого — expo-av).
 *
 * Рекордер создаём ИМПЕРАТИВНО, а не хуком useAudioRecorder: хук даёт один
 * объект на жизнь экрана, а нам нужен СВЕЖИЙ объект на каждую попытку —
 * упавший prepare оставляет рекордер в состоянии, где повторный prepare на
 * нём падает всегда (грабля «одно голосовое за запуск» ещё со времён
 * expo-av; у expo-audio prepare тоже одноразовый — флаг isPrepared).
 *
 * Конструктор нативного AudioRecorder ждёт УЖЕ ПЛОСКИЕ опции своей
 * платформы (то, что внутри expo-audio делает createRecordingOptions — он не
 * экспортируется), поэтому раскладываем пресет сами.
 */
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { Platform } from "react-native";

type FlatOptions = Partial<RecordingOptions> & Record<string, unknown>;

function platformOptions(o: RecordingOptions): FlatOptions {
  const common = {
    extension: o.extension,
    sampleRate: o.sampleRate,
    numberOfChannels: o.numberOfChannels,
    bitRate: o.bitRate,
    isMeteringEnabled: o.isMeteringEnabled ?? false,
  };
  if (Platform.OS === "ios") return { ...common, directory: o.directory, ...o.ios };
  if (Platform.OS === "android") return { ...common, directory: o.directory, ...o.android };
  return { ...common, ...o.web };
}

/** Свежий рекордер под голосовое (HIGH_QUALITY: m4a/AAC на нативе, webm в
 *  PWA — как и раньше с expo-av). */
export function createVoiceRecorder(): AudioRecorder {
  const opts = platformOptions(RecordingPresets.HIGH_QUALITY);
  if (Platform.OS === "web") {
    // В вебе expo-audio отдаёт класс под другим именем (AudioRecorderWeb),
    // а «AudioRecorder» из нативного модуля там просто нет.
    const Ctor = (AudioModule as unknown as { AudioRecorderWeb: new (o: FlatOptions) => AudioRecorder })
      .AudioRecorderWeb;
    return new Ctor(opts);
  }
  return new AudioModule.AudioRecorder(opts);
}

export async function ensureMicPermission(): Promise<boolean> {
  const perm = await requestRecordingPermissionsAsync();
  return perm.granted;
}

/** Режим аудиосессии под запись (и обратно). В вебе — no-op. */
export async function setRecordingMode(on: boolean): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: on, playsInSilentMode: true });
  } catch {
    // best-effort
  }
}

/** Некоторые андроиды не отпускают нативный рекордер после stop — следующий
 *  prepare падает, и микрофон клинит до перезапуска приложения. Выключение и
 *  включение всей аудиоподсистемы силой освобождает застрявший рекордер. */
export async function resetAudioSubsystem(): Promise<void> {
  try {
    await setIsAudioActiveAsync(false);
    await new Promise((r) => setTimeout(r, 250));
    await setIsAudioActiveAsync(true);
  } catch {
    // best-effort — nothing more we can do from JS
  }
}

/** Отпустить нативный объект (SharedObject). Без этого он живёт до GC. */
export function releaseRecorder(rec: AudioRecorder | null): void {
  if (!rec) return;
  try {
    (rec as unknown as { release?: () => void }).release?.();
  } catch {
    // уже отпущен
  }
}
