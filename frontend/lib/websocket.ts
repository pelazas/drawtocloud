const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws";

type MessageHandler = (data: unknown) => void;
export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";
type ConnectionStateHandler = (state: ConnectionState) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openHandlers: Array<() => void> = [];
  private stateHandlers: ConnectionStateHandler[] = [];
  private state: ConnectionState = "idle";

  private setState(next: ConnectionState) {
    this.state = next;
    this.stateHandlers.forEach((handler) => handler(next));
  }

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setState("connecting");
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.setState("open");
      const handlers = [...this.openHandlers];
      this.openHandlers = [];
      handlers.forEach((h) => h());
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handlers.forEach((h) => h(data));
      } catch {
        console.error("WS parse error", event.data);
      }
    };

    this.ws.onclose = () => {
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

  send(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not open, message dropped");
      return;
    }
    this.ws.send(JSON.stringify(payload));
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
