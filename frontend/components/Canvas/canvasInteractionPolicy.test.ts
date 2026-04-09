import { describe, expect, it } from "vitest";

import { getCanvasInteractionPolicy, shouldShowContainerResizeHandle } from "./canvasInteractionPolicy";

describe("getCanvasInteractionPolicy", () => {
  it("enables dragging for editable idle sessions", () => {
    expect(getCanvasInteractionPolicy(true, false)).toEqual({
      nodesDraggable: true,
      nodesConnectable: false,
      elementsSelectable: true,
      deleteKeyCode: null,
      selectionOnDrag: true,
    });
  });

  it("disables selection for read-only viewers", () => {
    expect(getCanvasInteractionPolicy(false, true)).toEqual({
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: false,
      deleteKeyCode: null,
      selectionOnDrag: false,
    });
  });

  it("keeps dragging disabled while generation is active", () => {
    expect(getCanvasInteractionPolicy(false, false)).toEqual({
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: true,
      deleteKeyCode: null,
      selectionOnDrag: true,
    });
  });

  it("only shows container resize handles for selected editable containers", () => {
    expect(shouldShowContainerResizeHandle(true, true)).toBe(true);
    expect(shouldShowContainerResizeHandle(false, true)).toBe(false);
    expect(shouldShowContainerResizeHandle(true, false)).toBe(false);
  });
});
