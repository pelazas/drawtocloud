import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocketConnection } from "../useWebSocketConnection";
import wsClient from "@/lib/websocket";

vi.mock("@/lib/websocket", () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    send: vi.fn().mockReturnValue(true),
    onMessage: vi.fn().mockReturnValue(() => {}),
    onConnectionState: vi.fn().mockReturnValue(() => {}),
    onOpen: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock("@/lib/generationStart", () => ({
  withAccessToken: vi.fn(async (payload) => payload),
}));

describe("useWebSocketConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects when enabled is true", () => {
    renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
      })
    );
    expect(wsClient.connect).toHaveBeenCalledTimes(1);
  });

  it("does not connect when enabled is false", () => {
    renderHook(() =>
      useWebSocketConnection({
        enabled: false,
        onMessage: () => {},
      })
    );
    expect(wsClient.connect).not.toHaveBeenCalled();
  });

  it("disconnects on unmount", () => {
    const { unmount } = renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
      })
    );
    unmount();
    expect(wsClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it("registers beforeunload handler that disconnects", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
      })
    );

    expect(addEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("does not reconnect when onMessage reference changes", () => {
    const { rerender } = renderHook(
      ({ onMessage }) =>
        useWebSocketConnection({
          enabled: true,
          onMessage,
        }),
      {
        initialProps: { onMessage: () => {} },
      }
    );

    expect(wsClient.connect).toHaveBeenCalledTimes(1);

    rerender({ onMessage: () => {} });
    expect(wsClient.connect).toHaveBeenCalledTimes(1);
  });

  it("subscribes to project when requested", async () => {
    const { result } = renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
      })
    );

    let subscribed = false;
    await act(async () => {
      subscribed = await result.current.subscribeProject("proj-123");
    });

    expect(subscribed).toBe(true);
    expect(wsClient.send).toHaveBeenCalled();
  });

  it("exposes connection state from wsClient", () => {
    const { result } = renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
      })
    );

    expect(result.current.wsState).toBe("idle");
  });

  it("provides a reconnect function", () => {
    const { result } = renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
      })
    );

    act(() => {
      result.current.reconnect();
    });

    expect(wsClient.reconnect).toHaveBeenCalledTimes(1);
  });

  it("queues project subscription and replays when connection opens", async () => {
    let stateHandler: ((state: string) => void) | null = null;

    vi.mocked(wsClient.onConnectionState).mockImplementation((handler) => {
      stateHandler = handler;
      handler("idle");
      return () => {};
    });

    const desiredRef = { current: null as string | null };

    const { result } = renderHook(() =>
      useWebSocketConnection({
        enabled: true,
        onMessage: () => {},
        desiredProjectSubscriptionRef: desiredRef,
      })
    );

    act(() => {
      result.current.queueProjectSubscription("proj-queued");
    });

    expect(desiredRef.current).toBe("proj-queued");

    // Simulate connection opening
    act(() => {
      stateHandler?.("open");
    });

    // Wait for the async subscribeProject microtask
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(wsClient.send).toHaveBeenCalled();
  });
});
