import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasPersist } from "@/lib/useCanvasPersist";

vi.mock("@/lib/projectApi", () => ({
  saveSnapshot: vi.fn().mockResolvedValue(undefined),
}));

describe("useCanvasPersist", () => {
  it("returns scheduleCanvasPersist", () => {
    const { result } = renderHook(() =>
      useCanvasPersist({
        activeProjectId: "proj-1",
        readOnly: false,
        currentStage: "completed",
        traceId: "t1",
        pushDebugEvent: vi.fn(),
        setTerraformOutdated: vi.fn(),
        setSetupPdfState: vi.fn(),
        diagram: { canonicalNodes: [], edges: [] } as any,
      })
    );
    expect(result.current.scheduleCanvasPersist).toBeInstanceOf(Function);
  });
});
