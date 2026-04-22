import { describe, expect, it } from "vitest";

import {
  parseDiagramEvent,
  classifyNodeEvent,
  createEventBuffer,
  bufferDeferredEvent,
  drainDeferredEvents,
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
    const existing: string[] = [];

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

describe("EventBuffer", () => {
  it("buffers a deferred event under the missing parent key", () => {
    const vpcEvent: AddNodeEvent = {
      type: "add_node",
      id: "vpc_eu",
      label: "VPC EU",
      category: "network",
      node_type: "container",
      container_type: "vpc",
      parent_id: "eu_central_1",
    };

    let buffer = createEventBuffer();
    buffer = bufferDeferredEvent(buffer, vpcEvent, "eu_central_1");

    expect(buffer.deferred.has("eu_central_1")).toBe(true);
    expect(buffer.deferred.get("eu_central_1")).toHaveLength(1);
  });

  it("drains deferred events when parent becomes available", () => {
    const vpcEvent: AddNodeEvent = {
      type: "add_node",
      id: "vpc_eu",
      label: "VPC EU",
      category: "network",
      node_type: "container",
      container_type: "vpc",
      parent_id: "eu_central_1",
    };

    let buffer = createEventBuffer();
    buffer = bufferDeferredEvent(buffer, vpcEvent, "eu_central_1");

    const { events, buffer: nextBuffer } = drainDeferredEvents(buffer, "eu_central_1");

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("vpc_eu");
    expect(nextBuffer.deferred.has("eu_central_1")).toBe(false);
  });

  it("returns empty for unknown parent key", () => {
    const buffer = createEventBuffer();
    const { events } = drainDeferredEvents(buffer, "nonexistent");
    expect(events).toHaveLength(0);
  });

  it("supports multiple deferred events for the same parent", () => {
    const vpc1: AddNodeEvent = {
      type: "add_node", id: "vpc_eu", label: "VPC EU", category: "network",
      node_type: "container", container_type: "vpc", parent_id: "eu_central_1",
    };
    const vpc2: AddNodeEvent = {
      type: "add_node", id: "vpc_us", label: "VPC US", category: "network",
      node_type: "container", container_type: "vpc", parent_id: "eu_central_1",
    };

    let buffer = createEventBuffer();
    buffer = bufferDeferredEvent(buffer, vpc1, "eu_central_1");
    buffer = bufferDeferredEvent(buffer, vpc2, "eu_central_1");

    const { events } = drainDeferredEvents(buffer, "eu_central_1");
    expect(events).toHaveLength(2);
  });

  it("simulates out-of-order streaming: child before parent, then parent arrives", () => {
    const existing: string[] = [];
    let buffer = createEventBuffer();
    const applied: AddNodeEvent[] = [];

    // Step 1: VPC arrives referencing region that doesn't exist
    const vpcEvent: AddNodeEvent = {
      type: "add_node", id: "vpc_eu", label: "VPC EU", category: "network",
      node_type: "container", container_type: "vpc", parent_id: "eu_central_1",
    };
    const c1 = classifyNodeEvent(vpcEvent, existingSet(existing));
    expect(c1.action).toBe("defer");
    buffer = bufferDeferredEvent(buffer, vpcEvent, (c1 as { missingParentId: string }).missingParentId);

    // Step 2: Region arrives (root node)
    const regionEvent: AddNodeEvent = {
      type: "add_node", id: "eu_central_1", label: "EU Central 1", category: "network",
      node_type: "container", container_type: "region",
    };
    const c2 = classifyNodeEvent(regionEvent, existingSet(existing));
    expect(c2.action).toBe("apply");
    applied.push(regionEvent);
    existing.push("eu_central_1");

    // Step 3: Drain deferred events for the newly available region
    const { events: drained, buffer: nextBuffer } = drainDeferredEvents(buffer, "eu_central_1");
    buffer = nextBuffer;

    // Step 4: Process each drained event
    for (const event of drained) {
      const c = classifyNodeEvent(event, existingSet(existing));
      expect(c.action).toBe("apply");
      applied.push(event);
      existing.push(event.id);
    }

    expect(applied.map((e) => e.id)).toEqual(["eu_central_1", "vpc_eu"]);
  });
});
