import { describe, expect, it } from "vitest";

import { getCanvasInteractionPolicy, shouldShowContainerResizeHandle } from "./canvasInteractionPolicy";

describe("getCanvasInteractionPolicy", () => {
  it("keeps selection but disables direct structural canvas edits for editable sessions", () => {
    expect(getCanvasInteractionPolicy(false)).toEqual({
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: true,
      deleteKeyCode: null,
      selectionOnDrag: true,
    });
  });

  it("disables selection for read-only viewers", () => {
    expect(getCanvasInteractionPolicy(true)).toEqual({
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: false,
      deleteKeyCode: null,
      selectionOnDrag: false,
    });
  });

  it("only shows container resize handles for selected editable containers", () => {
    expect(shouldShowContainerResizeHandle(true, true)).toBe(true);
    expect(shouldShowContainerResizeHandle(false, true)).toBe(false);
    expect(shouldShowContainerResizeHandle(true, false)).toBe(false);
  });
});
