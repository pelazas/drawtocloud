import { describe, expect, it } from "vitest";
import type { Edge, Node } from "reactflow";

import { applyDagreLayout, sortNodesForRender } from "../diagramLayout";

function service(id: string, parentId?: string): Node {
  return {
    id,
    type: "service",
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data: { label: id.toUpperCase(), category: "compute", nodeType: id },
  };
}

function container(id: string, parentId?: string): Node {
  return {
    id,
    type: "container",
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    style: { width: 300, height: 200 },
    data: { label: id.toUpperCase(), category: "network", containerType: "vpc" },
  };
}

describe("diagramLayout", () => {
  it("keeps parents before descendants for nested containers", () => {
    const sorted = sortNodesForRender([
      service("ecs", "subnet_a"),
      container("subnet_a", "az_a"),
      container("vpc"),
      container("az_a", "vpc"),
    ]);

    expect(sorted.map((node) => node.id)).toEqual(["vpc", "az_a", "subnet_a", "ecs"]);
  });

  it("lays out nested containers recursively and sizes them from descendants", () => {
    const nodes: Node[] = [
      container("vpc"),
      container("az_a", "vpc"),
      container("subnet_a", "az_a"),
      service("alb", "subnet_a"),
      service("ecs", "subnet_a"),
      service("cloudwatch"),
    ];
    const edges: Edge[] = [
      { id: "alb-ecs", source: "alb", target: "ecs" },
      { id: "ecs-cloudwatch", source: "ecs", target: "cloudwatch" },
    ];

    const laidOut = applyDagreLayout(nodes, edges);
    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const vpc = byId.get("vpc")!;
    const az = byId.get("az_a")!;
    const subnet = byId.get("subnet_a")!;
    const alb = byId.get("alb")!;
    const ecs = byId.get("ecs")!;

    expect((subnet.style?.width as number) ?? 0).toBeGreaterThanOrEqual(300);
    expect((subnet.style?.height as number) ?? 0).toBeGreaterThanOrEqual(200);
    expect((az.style?.width as number) ?? 0).toBeGreaterThanOrEqual((subnet.style?.width as number) + 80);
    expect((vpc.style?.width as number) ?? 0).toBeGreaterThanOrEqual((az.style?.width as number) + 80);

    expect(subnet.position.x).toBeGreaterThanOrEqual(0);
    expect(subnet.position.y).toBeGreaterThanOrEqual(0);
    expect(alb.position.x).toBeGreaterThanOrEqual(0);
    expect(alb.position.y).toBeGreaterThanOrEqual(0);
    expect(ecs.position.x).toBeGreaterThan(alb.position.x);

    expect(laidOut.map((node) => node.id).slice(0, 5)).toEqual(["vpc", "cloudwatch", "az_a", "subnet_a", "alb"]);
  });

  it("applies minimum size to empty containers", () => {
    const laidOut = applyDagreLayout([container("vpc")], []);

    expect(laidOut[0].style).toMatchObject({ width: 300, height: 200 });
  });
});
