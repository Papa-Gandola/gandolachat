import { WS_URL } from "./config";

type Handler = (data: Record<string, unknown>) => void;
type Quality = "good" | "ok" | "bad" | "offline";

// Mirrors client/src/renderer/services/ws.ts — single WebSocket connection,
// exponential backoff reconnect, ping/pong every 5s. The mobile WebSocket
// global is identical to the browser one, so this code is straight-portable.
class WSService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private token: string | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  public quality: Quality = "offline";
  public ping = 0;
  public onQualityChange: ((q: Quality, ping: number) => void) | null = null;

  connect(token: string) {
    this.token = token;
    this.reconnectAttempts = 0;
    this._connect();
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
      this.quality = "good";
      this.onQualityChange?.("good", 0);
      // Notify _ws_open subscribers (e.g. screens that want to re-fetch after a reconnect).
      this.handlers.get("_ws_open")?.forEach((h) => h({}));
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        this.send({ type: "ping", t: Date.now() });
      }, 5000);
    };

    this.ws.onmessage = (e) => {
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
