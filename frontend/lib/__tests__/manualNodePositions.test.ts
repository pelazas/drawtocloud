import { describe, expect, it } from "vitest";
import type { Node, NodeChange } from "reactflow";

import {
  applyManualPositionOverrides,
  clearManualPositionOverrides,
  splitManualPositionChanges,
} from "../manualNodePositions";

function serviceNode(id: string, position: { x: number; y: number }, parentId?: string): Node {
  return {
    id,
    type: "service",
    position,
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data: { label: id, category: "compute", nodeType: id },
  };
}

describe("manualNodePositions", () => {
  it("captures root node position changes as manual overrides", () => {
    const change: NodeChange = {
      id: "ecs",
      type: "position",
      position: { x: 240, y: 180 },
      dragging: false,
    };

    expect(splitManualPositionChanges([change])).toEqual({
      graphChanges: [],
      positionOverrides: {
        ecs: { x: 240, y: 180 },
      },
    });
  });

  it("captures child node position changes as manual overrides", () => {
    const change: NodeChange = {
      id: "subnet-a",
      type: "position",
      position: { x: 40, y: 72 },
      dragging: true,
    };

    expect(splitManualPositionChanges([change])).toEqual({
      graphChanges: [],
      positionOverrides: {
        "subnet-a": { x: 40, y: 72 },
      },
    });
  });

  it("preserves non-position changes for the canonical graph updater", () => {
    const changes: NodeChange[] = [
      { id: "ecs", type: "select", selected: true },
      { id: "subnet-a", type: "dimensions", dimensions: { width: 300, height: 200 }, resizing: false },
    ];

    expect(splitManualPositionChanges(changes)).toEqual({
      graphChanges: changes,
      positionOverrides: {},
    });
  });

  it("clears overrides to an empty map", () => {
    expect(clearManualPositionOverrides()).toEqual({});
  });

  it("applies overrides only to matching node ids while preserving other fields", () => {
    const nodes = [
      serviceNode("ecs", { x: 10, y: 20 }),
      serviceNode("rds", { x: 30, y: 40 }, "subnet-a"),
    ];

    expect(
      applyManualPositionOverrides(nodes, {
        rds: { x: 120, y: 160 },
      })
    ).toEqual([
      nodes[0],
      {
        ...nodes[1],
        position: { x: 120, y: 160 },
      },
    ]);
  });

  it("can intentionally drop all overrides after a graph replacement event", () => {
    const nodes = [serviceNode("ecs", { x: 10, y: 20 })];

    expect(applyManualPositionOverrides(nodes, clearManualPositionOverrides())).toEqual(nodes);
  });
});
