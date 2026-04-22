import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionHydration } from "@/lib/useSessionHydration";

describe("useSessionHydration", () => {
  it("should be defined", () => {
    const { result } = renderHook(() =>
      useSessionHydration({
        appState: "canvas",
        canvasSession: null,
        readOnly: false,
        liveSession: false,
        wsStateRef: { current: "idle" },
        traceIdRef: { current: null },
        pipeline: {} as any,
        diagram: {} as any,
        chatActions: {} as any,
        debugActions: {} as any,
        queueProjectSubscription: vi.fn(),
        onProjectReady: vi.fn(),
        generationStartRef: { current: 0 },
        generationStartedAtRef: { current: null },
        stallWarnedRef: { current: false },
        lastHydratedUpdatedAtRef: { current: null },
        activeSessionKeyRef: { current: null },
        generationRequestKeyRef: { current: null },
      })
    );
    expect(result.current).toBeUndefined();
  });
});
