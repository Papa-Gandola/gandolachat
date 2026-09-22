/**
 * Обновления мобилки: что стоит и что можно подтянуть.
 *
 * Два независимых канала (см. CLAUDE.md, грабля №11):
 *   1. КОД ПО ВОЗДУХУ (expo-updates, OTA) — JS-правки с тем же
 *      runtimeVersion; приезжают сами при запуске, а тут — по кнопке, с
 *      немедленным перезапуском.
 *   2. СБОРКА APK — новый натив; сравниваем номер сборки (versionCode)
 *      установленного приложения с тем, что лежит в зеркале сервера
 *      (GET /apk/info → build, тот же источник, что у окна «обнови меня»).
 *
 * Последний результат кэшируется в модуле (+ подписка) — по нему настройки
 * рисуют бейдж у строки «Обновления», не гоняя проверку заново.
 */
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";

import { API_URL } from "./config";
import * as SecureStore from "./secureStorage";

export type ApkInfo = {
  version: string | null;
  build: number | null;
  release_name: string | null;
  published_at?: string | null;
  size?: number | null;
};

export type CheckResult = {
  /** none — кода свежее нет; downloaded — скачан, нужен перезапуск;
   *  unavailable — OTA тут не работает (PWA / dev-клиент); error — сбой. */
  code: "none" | "downloaded" | "unavailable" | "error";
  /** Новая сборка APK (build больше нашего) или null. */
  apk: ApkInfo | null;
  error?: string;
  /** Когда проверяли (ms). */
  at: number;
};

const LAST_KEY = "gandola.updates.lastCheck";

export async function fetchApkInfo(): Promise<ApkInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API_URL}/apk/info`, { signal: ctrl.signal });
    if (!res.ok) return null; // 404 — зеркало ещё не набрало кэш
    return (await res.json()) as ApkInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Номер установленной сборки (versionCode); null в PWA. */
export function myBuildNumber(): number | null {
  const raw = Constants.nativeBuildVersion;
  const n = raw ? Number.parseInt(String(raw), 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Версия установленной сборки (в PWA — версия из манифеста кода). */
export function myVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "?";
}

/** Что за код сейчас запущен. */
export function codeInfo() {
  const enabled = Platform.OS !== "web" && Updates.isEnabled;
  return {
    enabled,
    embedded: !enabled || Updates.isEmbeddedLaunch,
    id: Updates.updateId ? Updates.updateId.slice(0, 7) : null,
    createdAt: Updates.createdAt ?? null,
    channel: Updates.channel ?? null,
    runtime: Updates.runtimeVersion ?? null,
  };
}

let lastResult: CheckResult | null = null;
const listeners = new Set<(r: CheckResult | null) => void>();

export function getLastResult(): CheckResult | null {
  return lastResult;
}

export function subscribeUpdates(fn: (r: CheckResult | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function publish(r: CheckResult) {
  lastResult = r;
  listeners.forEach((fn) => fn(r));
}

/** Восстановить время последней проверки и найденный APK после перезапуска
 *  (состояние кода не храним: скачан ли OTA — знает сам expo-updates). */
export async function loadLastCheck(): Promise<CheckResult | null> {
  if (lastResult) return lastResult;
  try {
    const raw = await SecureStore.getItemAsync(LAST_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { at: number; apk: ApkInfo | null };
    if (!saved || typeof saved.at !== "number") return null;
    // Найденный раньше APK мог уже быть установлен — перепроверяем по build.
    const mine = myBuildNumber();
    const apk = saved.apk && saved.apk.build != null && mine != null && saved.apk.build > mine ? saved.apk : null;
    lastResult = { code: "none", apk, at: saved.at };
    return lastResult;
  } catch {
    return null;
  }
}

/** Окно «обнови меня» нашло новую сборку при запуске — делимся с бейджем. */
export function noteApkInfo(info: ApkInfo | null) {
  const mine = myBuildNumber();
  const apk = info && info.build != null && mine != null && info.build > mine ? info : null;
  if (!apk && !lastResult) return;
  publish({ code: lastResult?.code ?? "none", apk, at: lastResult?.at ?? Date.now() });
}

/** Проверить оба канала. Ошибка сети по одному каналу не роняет другой. */
export async function checkForUpdates(): Promise<CheckResult> {
  const at = Date.now();
  let code: CheckResult["code"] = "unavailable";
  let error: string | undefined;
  if (Platform.OS !== "web" && Updates.isEnabled) {
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        const fetched = await Updates.fetchUpdateAsync();
        code = fetched.isNew ? "downloaded" : "none";
      } else {
        code = "none";
      }
    } catch (e) {
      code = "error";
      error = e instanceof Error ? e.message : String(e);
    }
  }
  let apk: ApkInfo | null = null;
  if (Platform.OS !== "web") {
    const info = await fetchApkInfo();
    const mine = myBuildNumber();
    if (info && info.build != null && mine != null && info.build > mine) apk = info;
  }
  const result: CheckResult = { code, apk, error, at };
  publish(result);
  SecureStore.setItemAsync(LAST_KEY, JSON.stringify({ at, apk })).catch(() => {});
  return result;
}

/** Сколько обновлений уже известно (скачанный код + новая сборка) — для
 *  бейджа у кнопки «Обновления» в профиле. Ничего не проверяет сам:
 *  берёт то, что нашли запуск (expo-updates, «обнови меня») и кнопка. */
export function useUpdateBadge(): number {
  const [res, setRes] = useState<CheckResult | null>(getLastResult());
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    void loadLastCheck().then((r) => {
      if (r) setRes((cur) => cur ?? r);
    });
    return subscribeUpdates((r) => setRes(r));
  }, []);
  return (isUpdatePending ? 1 : 0) + (res?.apk ? 1 : 0);
}

/** Перезапуск на скачанный код. */
export async function restartToApply(): Promise<void> {
  await Updates.reloadAsync();
}

/** Скачать свежий APK с нашего зеркала (GitHub у РФ-провайдеров душится). */
export function openApkDownload(): void {
  Linking.openURL(`${API_URL}/apk`).catch(() => {});
}
