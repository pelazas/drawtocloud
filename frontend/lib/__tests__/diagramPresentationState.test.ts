import { describe, expect, it } from "vitest";
import type { Node, NodeChange } from "reactflow";

import {
  applyDiagramNodeChanges,
  replaceDiagramNodes,
} from "../diagramPresentationState";

function serviceNode(id: string, position: { x: number; y: number }, parentId?: string): Node {
  return {
    id,
    type: "service",
    position,
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data: { label: id, category: "compute", nodeType: id },
  };
}

describe("diagramPresentationState", () => {
  it("keeps canonical nodes unchanged while applying manual position overrides to rendered nodes", () => {
    const canonicalNodes = [serviceNode("ecs", { x: 10, y: 20 })];
    const changes: NodeChange[] = [{ id: "ecs", type: "position", position: { x: 120, y: 140 }, dragging: false }];

    expect(applyDiagramNodeChanges(canonicalNodes, changes, {})).toEqual({
      canonicalNodes,
      renderedNodes: [serviceNode("ecs", { x: 120, y: 140 })],
      manualPositionOverrides: { ecs: { x: 120, y: 140 } },
    });
  });

  it("preserves selection changes while stripping only position updates from canonical changes", () => {
    const canonicalNodes = [serviceNode("ecs", { x: 10, y: 20 })];
    const changes: NodeChange[] = [
      { id: "ecs", type: "position", position: { x: 60, y: 80 }, dragging: true },
      { id: "ecs", type: "select", selected: true },
    ];

    expect(applyDiagramNodeChanges(canonicalNodes, changes, {})).toEqual({
      canonicalNodes: [{ ...serviceNode("ecs", { x: 10, y: 20 }), selected: true }],
      renderedNodes: [{ ...serviceNode("ecs", { x: 60, y: 80 }), selected: true }],
      manualPositionOverrides: { ecs: { x: 60, y: 80 } },
    });
  });

  it("clears manual overrides when replacing the graph", () => {
    const canonicalNodes = [serviceNode("ecs", { x: 10, y: 20 })];

    expect(replaceDiagramNodes(canonicalNodes)).toEqual({
      canonicalNodes,
      renderedNodes: canonicalNodes,
      manualPositionOverrides: {},
    });
  });

  it("preserves parent containment metadata in rendered child nodes", () => {
    const canonicalNodes = [serviceNode("ecs", { x: 20, y: 30 }, "subnet-a")];
    const changes: NodeChange[] = [{ id: "ecs", type: "position", position: { x: 120, y: 160 }, dragging: false }];

    expect(applyDiagramNodeChanges(canonicalNodes, changes, {}).renderedNodes).toEqual([
      serviceNode("ecs", { x: 120, y: 160 }, "subnet-a"),
    ]);
  });
});
