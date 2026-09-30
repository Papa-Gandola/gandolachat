import Constants from "expo-constants";
import { Platform } from "react-native";

// «Нашёл баг, отправить логи» (просьба хозяина 02.10): кольцевой буфер
// консоли + глобальный обработчик ошибок RN. Ставится в App.tsx на уровне
// модуля, чтобы поймать и ранние падения. По кнопке в профиле («Нашёл
// баг») текст уходит на сервер (POST /api/users/bug-report), тот кладёт
// файл в ЛС админу — ничего выкачивать с телефона не надо.
const MAX_LINES = 1200;
const LINE_MAX = 1500;
const lines: string[] = [];
let installed = false;

function fmt(a: unknown): string {
  try {
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ""}`;
    if (a === undefined) return "undefined";
    const s = JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    return (s ?? String(a)).slice(0, 600);
  } catch {
    return String(a);
  }
}

function push(level: string, args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  lines.push(`${ts} ${level.padEnd(5)} ${args.map(fmt).join(" ")}`.slice(0, LINE_MAX));
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function installLogBuffer(): void {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level.toUpperCase(), args);
      orig(...args);
    };
  }
  // Глобальные ошибки RN (красный экран): дописываем и отдаём прежнему обработчику
  const eu = (globalThis as unknown as { ErrorUtils?: { getGlobalHandler?: () => ((e: unknown, fatal?: boolean) => void) | undefined; setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (eu?.setGlobalHandler) {
    const prev = eu.getGlobalHandler?.();
    eu.setGlobalHandler((e, fatal) => {
      push(fatal ? "FATAL" : "ERROR", ["global:", e]);
      prev?.(e, fatal);
    });
  }
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("error", (e) => push("ERROR", [`uncaught: ${e.message} @ ${e.filename}:${e.lineno}`]));
    window.addEventListener("unhandledrejection", (e) => push("ERROR", ["unhandledrejection:", (e as PromiseRejectionEvent).reason]));
  }
  push("INFO", [`log buffer on · ${Platform.OS} ${Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "?"}`]);
}

export function logEvent(msg: string, extra?: unknown): void {
  push("EVENT", extra === undefined ? [msg] : [msg, extra]);
}

export function getLogText(): string {
  return lines.join("\n");
}

export function bugReportMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: `mobile ${Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "?"}`,
    build: Constants.nativeBuildVersion ?? null,
    runtime: (Constants.expoConfig as { runtimeVersion?: unknown } | null)?.runtimeVersion ?? null,
    os: `${Platform.OS} ${String(Platform.Version)}`,
    web: Platform.OS === "web",
    ...(Platform.OS === "web" && typeof navigator !== "undefined" ? { ua: navigator.userAgent } : {}),
    lines: lines.length,
    ...extra,
  };
}
