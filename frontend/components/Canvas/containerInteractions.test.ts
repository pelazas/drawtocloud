import { describe, expect, it } from "vitest";
import type { Node } from "reactflow";

import {
  canDropNodeIntoContainer,
  findReparentTarget,
  getAbsoluteNodePosition,
  getContainerMinSize,
  getContainerResizeBounds,
  getReparentPosition,
  isValidContainerParent,
} from "./containerInteractions";

function container(
  id: string,
  position: { x: number; y: number },
  parentId?: string,
  size = { width: 300, height: 200 },
  containerType: "region" | "vpc" | "az" | "subnet" = "vpc"
): Node {
  return {
    id,
    type: "container",
    position,
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    style: size,
    data: { label: id, category: "network", containerType },
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
      container("vpc", { x: 0, y: 0 }, undefined, { width: 700, height: 500 }, "vpc"),
      container("az", { x: 60, y: 60 }, "vpc", { width: 500, height: 350 }, "az"),
      container("subnet", { x: 50, y: 50 }, "az", { width: 350, height: 220 }, "subnet"),
      service("ecs", { x: 120, y: 90 }),
    ];

    expect(findReparentTarget(nodes[3], nodes)?.id).toBe("subnet");
  });

  it("finds valid parents for dragged containers", () => {
    const nodes = [
      container("region", { x: 0, y: 0 }, undefined, { width: 900, height: 700 }, "region"),
      container("vpc", { x: 40, y: 40 }, "region", { width: 700, height: 500 }, "vpc"),
      container("az", { x: 80, y: 80 }, "vpc", { width: 500, height: 350 }, "az"),
      container("subnet", { x: 120, y: 120 }, undefined, { width: 350, height: 220 }, "subnet"),
    ];

    expect(findReparentTarget(nodes[3], nodes, true)?.id).toBe("az");
  });

  it("ignores overlapping but invalid drop targets", () => {
    const nodes = [
      container("region", { x: 0, y: 0 }, undefined, { width: 900, height: 700 }, "region"),
      container("vpc", { x: 40, y: 40 }, "region", { width: 700, height: 500 }, "vpc"),
      container("az", { x: 80, y: 80 }, "vpc", { width: 500, height: 350 }, "az"),
      container("subnet", { x: 120, y: 120 }, "az", { width: 350, height: 220 }, "subnet"),
      service("ecs", { x: 60, y: 60 }),
    ];

    expect(findReparentTarget(nodes[4], nodes, true)?.id).toBeUndefined();
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

  it("validates strict container parent hierarchy", () => {
    expect(isValidContainerParent("region", null, true)).toBe(true);
    expect(isValidContainerParent("vpc", null, false)).toBe(true);
    expect(isValidContainerParent("vpc", "region", true)).toBe(true);
    expect(isValidContainerParent("az", "vpc", false)).toBe(true);
    expect(isValidContainerParent("subnet", "az", false)).toBe(true);

    expect(isValidContainerParent("region", "region", true)).toBe(false);
    expect(isValidContainerParent("vpc", "az", false)).toBe(false);
    expect(isValidContainerParent("az", null, false)).toBe(false);
    expect(isValidContainerParent("subnet", "vpc", false)).toBe(false);
  });

  it("rejects service drops outside subnet containers", () => {
    const vpc = container("vpc", { x: 0, y: 0 }, undefined, { width: 700, height: 500 }, "vpc");
    const az = container("az", { x: 60, y: 60 }, "vpc", { width: 500, height: 350 }, "az");
    const subnet = container("subnet", { x: 50, y: 50 }, "az", { width: 350, height: 220 }, "subnet");
    const ecs = service("ecs", { x: 120, y: 90 });

    expect(canDropNodeIntoContainer(ecs, vpc, false)).toBe(false);
    expect(canDropNodeIntoContainer(ecs, az, false)).toBe(false);
    expect(canDropNodeIntoContainer(ecs, subnet, false)).toBe(true);
  });

  it("rejects invalid container drops even when overlapping", () => {
    const region = container("region", { x: 0, y: 0 }, undefined, { width: 900, height: 700 }, "region");
    const vpc = container("vpc", { x: 30, y: 30 }, "region", { width: 700, height: 500 }, "vpc");
    const az = container("az", { x: 60, y: 60 }, "vpc", { width: 500, height: 350 }, "az");
    const subnet = container("subnet", { x: 50, y: 50 }, "az", { width: 350, height: 220 }, "subnet");

    expect(canDropNodeIntoContainer(subnet, region, true)).toBe(false);
    expect(canDropNodeIntoContainer(az, subnet, true)).toBe(false);
    expect(canDropNodeIntoContainer(subnet, az, true)).toBe(true);
    expect(canDropNodeIntoContainer(vpc, region, true)).toBe(true);
  });

  it("computes parent-aware max resize bounds for nested containers", () => {
    const vpc = container("vpc", { x: 0, y: 0 }, undefined, { width: 700, height: 500 }, "vpc");
    const subnet = container("subnet", { x: 60, y: 80 }, "vpc", { width: 300, height: 200 }, "subnet");
    const nodes = [vpc, subnet];

    const bounds = getContainerResizeBounds(subnet, nodes);
    expect(bounds).toEqual({
      minWidth: 300,
      minHeight: 200,
      maxWidth: 640,
      maxHeight: 420,
    });
  });

  it("returns unbounded max for root containers", () => {
    const vpc = container("vpc", { x: 0, y: 0 }, undefined, { width: 700, height: 500 }, "vpc");
    const nodes = [vpc];

    const bounds = getContainerResizeBounds(vpc, nodes);
    expect(bounds).toEqual({
      minWidth: 300,
      minHeight: 200,
      maxWidth: Infinity,
      maxHeight: Infinity,
    });
  });
});
