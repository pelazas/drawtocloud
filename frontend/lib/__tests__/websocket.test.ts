import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_TIMEOUT_MS, WebSocketClient } from "../websocket";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public readonly url: string) {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  send(payload: string) {
    this.sent.push(payload);
  }
}

describe("WebSocketClient heartbeat", () => {
  const originalWebSocket = globalThis.WebSocket;
  let sockets: FakeWebSocket[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    class MockSocket extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    }
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("force reconnects when no messages are received within the heartbeat timeout", () => {
    const client = new WebSocketClient();
    client.connect();
    expect(sockets).toHaveLength(1);
    sockets[0].open();

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 5_000);

    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toBe(true);
    client.disconnect();
  });

  it("does not reconnect while messages keep arriving before timeout", () => {
    const client = new WebSocketClient();
    client.connect();
    expect(sockets).toHaveLength(1);
    sockets[0].open();

    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(20_000);
      sockets[0].message({ type: "pipeline_event", seq: i });
    }

    expect(sockets).toHaveLength(1);
    client.disconnect();
  });

  it("does not forward ping messages to app handlers", () => {
    const client = new WebSocketClient();
    const handler = vi.fn();
    client.onMessage(handler);
    client.connect();
    expect(sockets).toHaveLength(1);
    sockets[0].open();

    sockets[0].message({ type: "ping", ts: Date.now() });

    expect(handler).not.toHaveBeenCalled();
    client.disconnect();
  });
});
