import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStallRecovery } from "@/lib/useStallRecovery";

describe("useStallRecovery", () => {
  it("triggers recover after stall threshold", () => {
    vi.useFakeTimers();
    const recoverFromGenerationStall = vi.fn();
    renderHook(() =>
      useStallRecovery({
        isGenerating: true,
        lastEventAt: Date.now() - 20_000,
        currentStage: "coder",
        traceId: "t1",
        pushDebugEvent: vi.fn(),
        pushTicker: vi.fn(),
        recoverFromGenerationStall,
        stallWarnedRef: { current: false },
        setPipelineStatus: vi.fn(),
      })
    );
    vi.advanceTimersByTime(1000);
    expect(recoverFromGenerationStall).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
