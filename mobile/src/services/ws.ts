import { AppState, Platform } from "react-native";

import { WS_URL } from "./config";

type Handler = (data: Record<string, unknown>) => void;
type Quality = "good" | "ok" | "bad" | "offline";

// Mirrors client/src/renderer/services/ws.ts — single WebSocket connection,
// exponential backoff reconnect, ping/pong every 5s. The mobile WebSocket
// global is identical to the browser one, so this code is straight-portable.
//
// Телефонная специфика («проблемы со связью»): iOS замораживает JS в фоне и
// молча убивает сокет — причём иногда БЕЗ события close: readyState так и
// висит OPEN, а данные не ходят («полумёртвый» сокет). Поэтому:
//   1. pong-надзор: три пинга подряд без ответа → принудительный close →
//      реконнект (иначе «подключён», а сообщения не приходят до перезапуска);
//   2. на разворот приложения (AppState active / visibilitychange на вебе)
//      — мгновенный реконнект без ожидания бэкоффа, либо контрольный ping.
class WSService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private token: string | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private wakeHooked = false;
  public quality: Quality = "offline";
  public ping = 0;
  public onQualityChange: ((q: Quality, ping: number) => void) | null = null;

  connect(token: string) {
    this.token = token;
    this.reconnectAttempts = 0;
    this._hookWakeEvents();
    this._connect();
  }

  // Вызывается на разворот/пробуждение: мёртвому сокету — немедленный
  // реконнект (сбросив бэкофф), живому — контрольный ping (полумёртвого
  // быстро добьёт pong-надзор).
  private _onWake = () => {
    if (!this.token) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: "ping", t: Date.now() });
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this._connect();
    }
  };

  private _hookWakeEvents() {
    if (this.wakeHooked) return;
    this.wakeHooked = true;
    AppState.addEventListener("change", (state) => {
      if (state === "active") this._onWake();
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this._onWake();
      });
      window.addEventListener("online", this._onWake);
      window.addEventListener("focus", this._onWake);
    }
  }

  private _connect() {
    if (!this.token) return;
    try {
      this.ws = new WebSocket(`${WS_URL}/ws?token=${this.token}`);
    } catch {
      // URL parsing or platform error — schedule reconnect via close handler.
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.missedPongs = 0;
      this.quality = "good";
      this.onQualityChange?.("good", 0);
      // Notify _ws_open subscribers (e.g. screens that want to re-fetch after a reconnect).
      this.handlers.get("_ws_open")?.forEach((h) => h({}));
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        // pong-надзор: три безответных пинга (~15с тишины) = сокет полумёртв
        this.missedPongs += 1;
        if (this.missedPongs >= 3) {
          this.missedPongs = 0;
          this.ws?.close(); // onclose запустит реконнект
          return;
        }
        this.send({ type: "ping", t: Date.now() });
      }, 5000);
    };

    this.ws.onmessage = (e) => {
      // Любые входящие данные = сокет жив (не только pong)
      this.missedPongs = 0;
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (data.type === "pong" && typeof data.t === "number") {
          const p = Date.now() - data.t;
          this.ping = p;
          this.quality = p < 100 ? "good" : p < 300 ? "ok" : "bad";
          this.onQualityChange?.(this.quality, p);
          return;
        }
        const type = data.type as string | undefined;
        if (type) {
          this.handlers.get(type)?.forEach((h) => h(data));
        }
      } catch {
        // ignore malformed payloads
      }
    };

    this.ws.onclose = () => {
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private _scheduleReconnect() {
    this.quality = "offline";
    this.onQualityChange?.("offline", 0);
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  on(type: string, handler: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler: Handler) {
    const list = this.handlers.get(type) || [];
    this.handlers.set(
      type,
      list.filter((h) => h !== handler),
    );
  }

  send(data: object): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.ws?.close();
    this.ws = null;
    this.token = null;
    this.reconnectAttempts = 0;
    this.handlers.clear();
  }
}

export const wsService = new WSService();
