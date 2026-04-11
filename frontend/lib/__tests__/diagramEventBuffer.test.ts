import { describe, expect, it } from "vitest";

import {
  parseDiagramEvent,
  classifyNodeEvent,
  type DiagramEvent,
  type AddNodeEvent,
  type NodeExistsCheck,
} from "../diagramEventBuffer";

function existingSet(ids: string[]): NodeExistsCheck {
  const set = new Set(ids);
  return { hasNode: (id: string) => set.has(id) };
}

describe("classifyNodeEvent", () => {
  it("applies a node when its parent already exists", () => {
    const event: AddNodeEvent = {
      type: "add_node",
      id: "ecs",
      label: "ECS",
      category: "compute",
      node_type: "service",
      parent_id: "vpc",
    };

    const result = classifyNodeEvent(event, existingSet(["vpc"]));

    expect(result.action).toBe("apply");
  });

  it("defers a node when its parent does not exist yet", () => {
    const event: AddNodeEvent = {
      type: "add_node",
      id: "vpc",
      label: "VPC",
      category: "network",
      node_type: "container",
      container_type: "vpc",
      parent_id: "eu_central_1",
    };

    const result = classifyNodeEvent(event, existingSet([]));

    expect(result.action).toBe("defer");
    if (result.action === "defer") {
      expect(result.missingParentId).toBe("eu_central_1");
    }
  });

  it("applies a root node with no parent_id regardless of existing nodes", () => {
    const event: AddNodeEvent = {
      type: "add_node",
      id: "eu_central_1",
      label: "EU Central 1",
      category: "network",
      node_type: "container",
      container_type: "region",
    };

    const result = classifyNodeEvent(event, existingSet([]));

    expect(result.action).toBe("apply");
  });

  it("skips a duplicate node id", () => {
    const event: AddNodeEvent = {
      type: "add_node",
      id: "vpc",
      label: "VPC Copy",
      category: "network",
      node_type: "container",
      container_type: "vpc",
    };

    const result = classifyNodeEvent(event, existingSet(["vpc"]));

    expect(result.action).toBe("skip_duplicate");
  });

  it("handles multi-region: region then vpc then service — correct ordering", () => {
    let existing: string[] = [];

    // Step 1: region arrives (root, no parent)
    const regionEvent: AddNodeEvent = {
      type: "add_node",
      id: "eu_central_1",
      label: "EU Central 1",
      category: "network",
      node_type: "container",
      container_type: "region",
    };
    const r1 = classifyNodeEvent(regionEvent, existingSet(existing));
    expect(r1.action).toBe("apply");
    existing.push("eu_central_1");

    // Step 2: VPC arrives referencing region (parent exists)
    const vpcEvent: AddNodeEvent = {
      type: "add_node",
      id: "vpc_eu",
      label: "VPC EU",
      category: "network",
      node_type: "container",
      container_type: "vpc",
      parent_id: "eu_central_1",
    };
    const r2 = classifyNodeEvent(vpcEvent, existingSet(existing));
    expect(r2.action).toBe("apply");
    existing.push("vpc_eu");

    // Step 3: Service arrives referencing vpc (parent exists)
    const svcEvent: AddNodeEvent = {
      type: "add_node",
      id: "ecs_eu",
      label: "ECS EU",
      category: "compute",
      node_type: "service",
      parent_id: "vpc_eu",
    };
    const r3 = classifyNodeEvent(svcEvent, existingSet(existing));
    expect(r3.action).toBe("apply");
  });

  it("defers vpc when parent region has not been streamed yet", () => {
    const vpcEvent: AddNodeEvent = {
      type: "add_node",
      id: "vpc_eu",
      label: "VPC EU",
      category: "network",
      node_type: "container",
      container_type: "vpc",
      parent_id: "eu_central_1",
    };

    const result = classifyNodeEvent(vpcEvent, existingSet([]));
    expect(result.action).toBe("defer");
  });
});

describe("parseDiagramEvent", () => {
  it("parses a valid add_node event", () => {
    const event = parseDiagramEvent({
      action: "add_node",
      id: "ecs",
      label: "ECS",
      category: "compute",
      node_type: "service",
      parent_id: "vpc",
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("add_node");
    if (event?.type === "add_node") {
      expect(event.id).toBe("ecs");
      expect(event.parent_id).toBe("vpc");
    }
  });

  it("returns null for missing id", () => {
    const event = parseDiagramEvent({
      action: "add_node",
      label: "ECS",
    });
    expect(event).toBeNull();
  });

  it("parses a valid add_edge event", () => {
    const event = parseDiagramEvent({
      action: "add_edge",
      from: "alb",
      to: "ecs",
      label: "routes to",
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("add_edge");
    if (event?.type === "add_edge") {
      expect(event.from).toBe("alb");
      expect(event.to).toBe("ecs");
    }
  });

  it("returns null for unknown action", () => {
    const event = parseDiagramEvent({ action: "remove_node", id: "x" });
    expect(event).toBeNull();
  });
});
