const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

type Handler = (data: any) => void;

class WSService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private token: string | null = null;
  public quality: "good" | "ok" | "bad" | "offline" = "offline";
  public ping: number = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  public onQualityChange: ((q: string, ping: number) => void) | null = null;

  connect(token: string) {
    this.token = token;
    this.reconnectAttempts = 0;
    this._connect();
  }

  private _connect() {
    if (!this.token) return;
    this.ws = new WebSocket(`${WS_URL}/ws?token=${this.token}`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.quality = "good";
      this.onQualityChange?.("good", 0);
      // Ping every 5s
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        const t = Date.now();
        this.send({ type: "ping", t });
      }, 5000);
    };

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "pong" && data.t) {
          const p = Date.now() - data.t;
          this.ping = p;
          this.quality = p < 100 ? "good" : p < 300 ? "ok" : "bad";
          this.onQualityChange?.(this.quality, p);
          return;
        }
        const listeners = this.handlers.get(data.type) || [];
        listeners.forEach((h) => h(data));
      } catch {}
    };

    this.ws.onclose = () => {
      this.quality = "offline";
      this.onQualityChange?.("offline", 0);
      if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => this._connect(), delay);
    };

    this.ws.onerror = () => {
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

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.token = null;
    this.reconnectAttempts = 0;
    this.handlers.clear();
  }
}

export const wsService = new WSService();
