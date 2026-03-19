import { describe, expect, it } from "vitest";
import { shouldApplyLayoutOnPipelineEvent } from "../pipelineLayout";

describe("shouldApplyLayoutOnPipelineEvent", () => {
  it("returns true when architect stage completes", () => {
    expect(shouldApplyLayoutOnPipelineEvent("architect", "completed")).toBe(true);
  });

  it("returns false for non-completion architect events", () => {
    expect(shouldApplyLayoutOnPipelineEvent("architect", "started")).toBe(false);
  });

  it("returns false for other stages", () => {
    expect(shouldApplyLayoutOnPipelineEvent("coder", "completed")).toBe(false);
  });
});
