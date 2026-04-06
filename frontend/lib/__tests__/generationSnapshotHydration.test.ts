import { describe, expect, it } from "vitest";
import { shouldHydrateGenerationSnapshot } from "../generationSnapshotHydration";

describe("shouldHydrateGenerationSnapshot", () => {
  it("hydrates when generation is not active", () => {
    expect(
      shouldHydrateGenerationSnapshot({
        generationActive: false,
        nodeCount: 10,
        edgeCount: 8,
      })
    ).toBe(true);
  });

  it("hydrates during active generation when canvas is empty", () => {
    expect(
      shouldHydrateGenerationSnapshot({
        generationActive: true,
        nodeCount: 0,
        edgeCount: 0,
      })
    ).toBe(true);
  });

  it("skips hydration during active generation when canvas already has data", () => {
    expect(
      shouldHydrateGenerationSnapshot({
        generationActive: true,
        nodeCount: 2,
        edgeCount: 1,
      })
    ).toBe(false);
  });
});
