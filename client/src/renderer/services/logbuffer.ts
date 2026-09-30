import { APP_VERSION } from "../changelog";

// «Нашёл баг, отправить логи» (просьба хозяина 02.10): кольцевой буфер
// консоли рендерера + необработанные ошибки. Ставится в index.tsx до всего
// остального, чтобы поймать и ранние падения. По кнопке в профиле текст
// уходит на сервер (POST /api/users/bug-report), тот кладёт файл в ЛС
// админу — ничего выкачивать не надо.
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
  window.addEventListener("error", (e) => push("ERROR", [`uncaught: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`]));
  window.addEventListener("unhandledrejection", (e) => push("ERROR", ["unhandledrejection:", (e as PromiseRejectionEvent).reason]));
  push("INFO", [`log buffer on · desktop ${APP_VERSION}`]);
}

/** Пометка от кода (WS открылся/закрылся и т.п.) — в тот же буфер. */
export function logEvent(msg: string, extra?: unknown): void {
  push("EVENT", extra === undefined ? [msg] : [msg, extra]);
}

export function getLogText(): string {
  return lines.join("\n");
}

export function bugReportMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  let mem: string | undefined;
  try {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (m) mem = `${Math.round(m.usedJSHeapSize / 1048576)} / ${Math.round(m.jsHeapSizeLimit / 1048576)} MB`;
  } catch { /* не Chromium */ }
  return {
    app: `desktop ${APP_VERSION}`,
    electron: !!(window as unknown as { electron?: unknown }).electron,
    ua: navigator.userAgent,
    platform: navigator.platform,
    lang: navigator.language,
    screen: `${screen.width}x${screen.height} @${window.devicePixelRatio}`,
    online: navigator.onLine,
    theme: document.body.className || "discord",
    ...(mem ? { jsHeap: mem } : {}),
    lines: lines.length,
    ...extra,
  };
}
