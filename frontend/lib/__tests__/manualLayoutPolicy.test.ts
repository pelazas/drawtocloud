import { describe, expect, it } from "vitest";
import { canApplyManualLayout } from "../manualLayoutPolicy";

describe("canApplyManualLayout", () => {
  it("blocks manual layout in read-only mode", () => {
    expect(canApplyManualLayout({ readOnly: true, isGenerating: false })).toBe(false);
  });

  it("blocks manual layout while generation is active", () => {
    expect(canApplyManualLayout({ readOnly: false, isGenerating: true })).toBe(false);
  });

  it("allows manual layout for editable idle sessions", () => {
    expect(canApplyManualLayout({ readOnly: false, isGenerating: false })).toBe(true);
  });
});
