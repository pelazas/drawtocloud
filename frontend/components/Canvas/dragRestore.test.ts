import { describe, expect, it } from "vitest";

import { shouldRestoreDragOrigin } from "./dragRestore";

describe("shouldRestoreDragOrigin", () => {
  it("restores dragged nodes that started inside a parent container", () => {
    expect(shouldRestoreDragOrigin({ parentId: "vpc" })).toBe(true);
  });

  it("does not restore root-level nodes after a normal drag", () => {
    expect(shouldRestoreDragOrigin({ parentId: null })).toBe(false);
  });

  it("does not restore when there is no drag origin", () => {
    expect(shouldRestoreDragOrigin(undefined)).toBe(false);
  });
});
