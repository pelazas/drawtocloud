import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGenerationTimer } from "@/lib/useGenerationTimer";

describe("useGenerationTimer", () => {
  it("increments elapsed time while generating", () => {
    vi.useFakeTimers();
    const setGenerationElapsed = vi.fn();
    renderHook(() =>
      useGenerationTimer({
        isGenerating: true,
        generationStartedAt: Date.now(),
        generationStartedAtRef: { current: Date.now() },
        setGenerationElapsed,
      })
    );
    expect(setGenerationElapsed).toHaveBeenCalledWith(0);
    vi.advanceTimersByTime(1000);
    expect(setGenerationElapsed).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
