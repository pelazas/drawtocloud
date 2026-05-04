function resolveWebSocketUrl(raw: string | undefined): string {
  const value = raw?.trim();

  if (!value) {
    return "ws://localhost:8000/ws";
  }

  if (value.startsWith("ws://") || value.startsWith("wss://")) {
    return value;
  }

  if (value.startsWith("/")) {
    if (typeof window === "undefined") {
      return value;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${value}`;
  }

  return value;
}

type MessageHandler = (data: unknown) => void;
export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";
type ConnectionStateHandler = (state: ConnectionState) => void;

/** Milliseconds of silence before we consider the connection dead and force-reconnect. */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openHandlers: Array<() => void> = [];
  private stateHandlers: ConnectionStateHandler[] = [];
  private state: ConnectionState = "idle";
  private lastMessageAt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private setState(next: ConnectionState) {
    this.state = next;
    this.stateHandlers.forEach((handler) => handler(next));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastMessageAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== "open") return;
      const silence = Date.now() - this.lastMessageAt;
      if (silence >= HEARTBEAT_TIMEOUT_MS) {
        console.warn(`WS heartbeat: no data for ${Math.round(silence / 1000)}s - force reconnecting`);
        this.reconnect();
      }
    }, 5_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setState("connecting");
    this.ws = new WebSocket(resolveWebSocketUrl(process.env.NEXT_PUBLIC_WS_URL));

    this.ws.onopen = () => {
      this.setState("open");
      this.startHeartbeat();
      [...this.openHandlers].forEach((h) => h());
    };

    this.ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      try {
        const data = JSON.parse(event.data);
        if ((data as { type?: string }).type === "ping") {
          return;
        }
        this.handlers.forEach((h) => h(data));
      } catch {
        console.error("WS parse error", event.data);
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setState("closed");
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      this.setState("error");
      console.error("WS error", err);
    };
  }

  onOpen(handler: () => void): () => void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      handler();
      return () => {};
    } else {
      this.openHandlers.push(handler);
      return () => {
        this.openHandlers = this.openHandlers.filter((h) => h !== handler);
      };
    }
  }

  send(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not open, message dropped");
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  /** Send a message once the connection is open, or reject after timeout. */
  sendWhenOpen(payload: unknown, timeoutMs = 10_000): Promise<boolean> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const handler = () => {
        cleanup();
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(payload));
          resolve(true);
        } else {
          resolve(false);
        }
      };

      timer = setTimeout(() => {
        cleanupOpenHandler();
        reject(new Error("WebSocket send timed out waiting for connection to open"));
      }, timeoutMs);

      const cleanupOpenHandler = this.onOpen(handler);
    });
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  onConnectionState(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.push(handler);
    handler(this.state);
    return () => {
      this.stateHandlers = this.stateHandlers.filter((h) => h !== handler);
    };
  }

  reconnect() {
    this.disconnect();
    this.connect();
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
    this.setState("idle");
  }
}

// Singleton
const wsClient = new WebSocketClient();
export default wsClient;
