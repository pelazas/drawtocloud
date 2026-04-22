import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDashboardConnection } from "@/lib/useDashboardConnection";

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

describe("useDashboardConnection", () => {
  it("should be defined", () => {
    const { result } = renderHook(() =>
      useDashboardConnection({
        appState: "dashboard",
        readOnly: false,
        pipeline: {} as any,
        chatActions: {} as any,
        wsStateRef: { current: "idle" },
        onProjectReady: vi.fn(),
        streamingReplyRef: { current: "" },
        messagesRef: { current: [] },
        chatProjectBootstrapRef: { current: { context: null, pending: null } },
      })
    );
    expect(result.current).toBeUndefined();
  });
});
