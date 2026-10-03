// Production fallback over wss:// — see api.ts for the why. Override in
// client/.env for local dev.
const WS_URL = import.meta.env.VITE_WS_URL || "wss://2-26-117-77.sslip.io";
import { logEvent } from "./logbuffer";

type Handler = (data: any) => void;
// Что НЕ писать в буфер «Нашёл баг»: шумные и бесполезные для разбора типы
const QUIET_TYPES = new Set(["ping", "pong", "typing"]);
const PING_EVERY_MS = 5000;
// Три пинга без pong → сокет полумёртвый. Ноут поспал / сменил Wi-Fi /
// дёрнулся VPN: TCP-сессия у ОС ещё «открыта», readyState=OPEN, наши пинги
// уходят в никуда, а сервер уже закрыл сокет (uvicorn ping 20с + таймаут
// 20с) — человек у всех «оффлайн», звонки до него не доходят (сервер пишет
// `call_signal … sockets=0`), а у него самого всё выглядит нормально, пока
// ОС не сдастся сама (до четверти часа). Как на мобилке: сами рвём и
// переподключаемся.
const PONG_TIMEOUT_MS = PING_EVERY_MS * 3 + 1000;

class WSService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private token: string | null = null;
  public quality: "good" | "ok" | "bad" | "offline" = "offline";
  public ping: number = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  public onQualityChange: ((q: string, ping: number) => void) | null = null;
  private seenEids = new Set<string>();

  constructor() {
    // Сеть вернулась / окно снова видно — не ждём бэкофф, пробуем сразу.
    // В браузере без window (тесты) — молча пропускаем.
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this._kick("online"));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this._kick("visible");
      });
    }
  }

  connect(token: string) {
    this.token = token;
    this.reconnectAttempts = 0;
    this._connect();
  }

  // Внешний толчок: сокета нет/закрыт → переподключаемся немедленно;
  // открыт → шлём пинг вне очереди, сторож pong добьёт зомби за ~16с.
  private _kick(reason: string) {
    if (!this.token) return;
    const st = this.ws?.readyState;
    if (st === WebSocket.OPEN) {
      this.send({ type: "ping", t: Date.now() });
      return;
    }
    if (st === WebSocket.CONNECTING) return;
    logEvent(`ws kick (${reason}) → reconnect now`);
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.reconnectAttempts = 0;
    this._connect();
  }

  // Общий хвост «сокет умер»: статус, бэкофф, таймер реконнекта.
  private _onClosed(why: string) {
    this.quality = "offline";
    this.onQualityChange?.("offline", 0);
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    logEvent(`ws ${why} → reconnect in ${delay}ms`);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  // Отцепить сокет от сервиса и закрыть: его onclose/onmessage больше не
  // наши — иначе закрытый на «Выйти» сокет своим onclose ставил реконнект
  // через 1с, и при входе в течение этой секунды открывался ВТОРОЙ сокет:
  // каждое событие прилетало дважды, оффер звонка применялся дважды и
  // ломал peer (нашлось сквозным тестом перелогина 02.10).
  private _detachAndClose(ws: WebSocket | null) {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch {}
  }

  private _connect() {
    if (!this.token) return;
    // Один живой сокет на сервис: старый (если вдруг ещё открыт) — долой.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this._detachAndClose(this.ws);
    }
    this.ws = new WebSocket(`${WS_URL}/ws?token=${this.token}`);

    this.ws.onopen = () => {
      logEvent(`ws open (attempt ${this.reconnectAttempts})`);
      this.reconnectAttempts = 0;
      this.quality = "good";
      this.onQualityChange?.("good", 0);
      // Notify internal listeners that the socket just (re)connected.
      const openListeners = this.handlers.get("_ws_open") || [];
      openListeners.forEach((h) => h({}));
      // Ping every 5s + сторож pong (см. PONG_TIMEOUT_MS)
      this.lastPongAt = Date.now();
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        const silent = Date.now() - this.lastPongAt;
        if (silent > PONG_TIMEOUT_MS) {
          // Не ждём closing-handshake с зомби (Chromium даёт на него до
          // минуты): отцепляем сокет и переподключаемся сами.
          const dead = this.ws;
          this.ws = null;
          this._detachAndClose(dead);
          this._onClosed(`pong timeout ${Math.round(silent / 1000)}s`);
          return;
        }
        this.send({ type: "ping", t: Date.now() });
      }, PING_EVERY_MS);
    };

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "pong" && data.t) {
          this.lastPongAt = Date.now();
          const p = Date.now() - data.t;
          this.ping = p;
          this.quality = p < 100 ? "good" : p < 300 ? "ok" : "bad";
          this.onQualityChange?.(this.quality, p);
          return;
        }
        if (data._eid) {
          if (this.seenEids.has(data._eid)) return;
          this.seenEids.add(data._eid);
          if (this.seenEids.size > 500) {
            const [oldest] = this.seenEids;
            this.seenEids.delete(oldest);
          }
        }
        if (!QUIET_TYPES.has(data.type)) {
          // В буфер «Нашёл баг»: тип события + чат/юзер, без тела (там могут быть тексты)
          logEvent(`ws ← ${data.type}${data.chat_id ? ` chat=${data.chat_id}` : ""}${data.user_id ? ` user=${data.user_id}` : ""}${data.signal?.type ? ` signal=${data.signal.type}` : ""}`);
        }
        const listeners = this.handlers.get(data.type) || [];
        listeners.forEach((h) => h(data));
      } catch {}
    };

    this.ws.onclose = (ev) => {
      // Код закрытия — главное при разборе «меня выкинуло»: 1006 — сеть/
      // сервер оборвал без handshake, 4001 — сервер не принял токен.
      this._onClosed(`close ${ev?.code ?? "?"}`);
    };

    this.ws.onerror = () => {
      logEvent("ws error");
      this.ws?.close();
    };
  }

  on(type: string, handler: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler: Handler) {
    const list = this.handlers.get(type) || [];
    this.handlers.set(type, list.filter((h) => h !== handler));
  }

  send(data: object): boolean {
    const t = (data as { type?: string; chat_id?: number; signal?: { type?: string } }).type;
    if (t && !QUIET_TYPES.has(t)) {
      const d = data as { chat_id?: number; signal?: { type?: string } };
      logEvent(`ws → ${t}${d.chat_id ? ` chat=${d.chat_id}` : ""}${d.signal?.type ? ` signal=${d.signal.type}` : ""}`);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    if (t && !QUIET_TYPES.has(t)) logEvent(`ws → ${t} DROPPED (socket ${this.ws?.readyState ?? "none"})`);
    return false;
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.ws) logEvent("ws closed by app (logout)");
    this._detachAndClose(this.ws);
    this.ws = null;
    this.token = null;
    this.reconnectAttempts = 0;
    this.quality = "offline";
    this.handlers.clear();
  }
}

export const wsService = new WSService();
