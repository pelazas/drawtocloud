import { describe, expect, it } from "vitest";
import type { Node } from "reactflow";

import { findReparentTarget, getAbsoluteNodePosition, getContainerMinSize, getReparentPosition } from "./containerInteractions";

function container(id: string, position: { x: number; y: number }, parentId?: string, size = { width: 300, height: 200 }): Node {
  return {
    id,
    type: "container",
    position,
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    style: size,
    data: { label: id, category: "network", containerType: "vpc" },
  };
}

function service(id: string, position: { x: number; y: number }, parentId?: string): Node {
  return {
    id,
    type: "service",
    position,
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data: { label: id, category: "compute", nodeType: id },
  };
}

describe("containerInteractions", () => {
  it("computes child-aware minimum size from direct children", () => {
    const vpc = container("vpc", { x: 0, y: 0 });
    const subnet = container("subnet", { x: 40, y: 40 }, "vpc", { width: 400, height: 300 });
    const ecs = service("ecs", { x: 470, y: 160 }, "vpc");

    expect(getContainerMinSize(vpc, [vpc, subnet, ecs])).toEqual({ width: 630, height: 380 });
  });

  it("prefers the deepest container under the dragged node", () => {
    const nodes = [
      container("vpc", { x: 0, y: 0 }, undefined, { width: 700, height: 500 }),
      container("az", { x: 60, y: 60 }, "vpc", { width: 500, height: 350 }),
      container("subnet", { x: 50, y: 50 }, "az", { width: 350, height: 220 }),
      service("ecs", { x: 120, y: 90 }),
    ];

    expect(findReparentTarget(nodes[3], nodes)?.id).toBe("subnet");
  });

  it("translates absolute position into clamped relative parent coordinates", () => {
    const nodes = [
      container("vpc", { x: 0, y: 0 }, undefined, { width: 700, height: 500 }),
      container("subnet", { x: 100, y: 80 }, "vpc", { width: 300, height: 200 }),
      service("ecs", { x: 460, y: 320 }),
    ];

    expect(getReparentPosition(nodes[2], nodes[1], nodes)).toEqual({ x: 180, y: 120 });
  });

  it("resolves absolute position for nested children", () => {
    const nodes = [
      container("vpc", { x: 10, y: 20 }, undefined, { width: 700, height: 500 }),
      container("subnet", { x: 100, y: 80 }, "vpc", { width: 300, height: 200 }),
      service("ecs", { x: 30, y: 15 }, "subnet"),
    ];

    expect(getAbsoluteNodePosition(nodes[2], nodes)).toEqual({ x: 140, y: 115 });
  });
});
