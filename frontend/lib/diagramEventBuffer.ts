export type AddNodeEvent = {
  type: "add_node";
  id: string;
  label: string;
  category: string;
  node_type: string;
  container_type?: string;
  parent_id?: string;
  subnet_kind?: string;
  position?: { x?: unknown; y?: unknown };
  style?: Record<string, unknown>;
};

export type AddEdgeEvent = {
  type: "add_edge";
  from: string;
  to: string;
  label?: string;
};

export type DiagramEvent = AddNodeEvent | AddEdgeEvent;

export function parseDiagramEvent(msg: Record<string, unknown>): DiagramEvent | null {
  if (msg.action === "add_node") {
    const id = typeof msg.id === "string" ? msg.id : "";
    const label = typeof msg.label === "string" ? msg.label : "";
    const category = typeof msg.category === "string" ? msg.category : "compute";
    const nodeType = typeof msg.node_type === "string" ? msg.node_type : "service";
    if (!id) return null;
    return {
      type: "add_node",
      id,
      label: label || id,
      category,
      node_type: nodeType,
      container_type: typeof msg.container_type === "string" ? msg.container_type : undefined,
      parent_id: typeof msg.parent_id === "string" ? msg.parent_id : undefined,
      subnet_kind: typeof msg.subnet_kind === "string" ? msg.subnet_kind : undefined,
      position:
        typeof msg.position === "object" && msg.position !== null
          ? (msg.position as { x?: unknown; y?: unknown })
          : undefined,
      style: typeof msg.style === "object" && msg.style !== null ? (msg.style as Record<string, unknown>) : undefined,
    };
  }

  if (msg.action === "add_edge") {
    const from = typeof msg.from === "string" ? msg.from : "";
    const to = typeof msg.to === "string" ? msg.to : "";
    if (!from || !to) return null;
    return {
      type: "add_edge",
      from,
      to,
      label: typeof msg.label === "string" ? msg.label : "",
    };
  }

  return null;
}

export interface NodeExistsCheck {
  hasNode(id: string): boolean;
}

export type ApplyAction =
  | { action: "skip_duplicate"; eventId: string }
  | { action: "defer"; eventId: string; missingParentId: string }
  | { action: "apply"; eventId: string };

export function classifyNodeEvent(event: AddNodeEvent, existingNodes: NodeExistsCheck): ApplyAction {
  if (existingNodes.hasNode(event.id)) {
    return { action: "skip_duplicate", eventId: event.id };
  }

  if (event.parent_id && !existingNodes.hasNode(event.parent_id)) {
    return { action: "defer", eventId: event.id, missingParentId: event.parent_id };
  }

  return { action: "apply", eventId: event.id };
}
