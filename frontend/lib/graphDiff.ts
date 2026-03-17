import type { Edge, Node } from "reactflow";

export type GraphDiffNodeAdd = {
  id?: string;
  label: string;
  category?: string;
  type?: string;
  parent_id?: string | null;
  data?: Record<string, unknown>;
  position?: { x?: number; y?: number };
};

export type GraphDiffNodeEdit = {
  id: string;
  label?: string;
  category?: string;
  type?: string;
  parent_id?: string | null;
  data?: Record<string, unknown>;
};

export type GraphDiffEdgeAdd = {
  id?: string;
  source: string;
  target: string;
  label?: string;
  data?: Record<string, unknown>;
};

export type GraphDiffEdgeEdit = {
  id: string;
  source?: string;
  target?: string;
  label?: string;
  data?: Record<string, unknown>;
};

export type GraphDiffPayload = {
  add_nodes?: GraphDiffNodeAdd[];
  edit_nodes?: GraphDiffNodeEdit[];
  delete_node_ids?: string[];
  add_edges?: GraphDiffEdgeAdd[];
  edit_edges?: GraphDiffEdgeEdit[];
  delete_edge_ids?: string[];
};

export type GraphMutationPayload = {
  diff: GraphDiffPayload;
  summary?: Record<string, unknown>;
  scope?: "selected" | "all";
};

export type GraphDiffApplyResult =
  | { ok: true; nodes: Node[]; edges: Edge[] }
  | { ok: false; nodes: Node[]; edges: Edge[]; error: string };

function cloneNodes(nodes: Node[]): Node[] {
  return nodes.map((node) => ({
    ...node,
    position: {
      x: Number.isFinite(node.position?.x) ? Number(node.position?.x) : 0,
      y: Number.isFinite(node.position?.y) ? Number(node.position?.y) : 0,
    },
    data: typeof node.data === "object" && node.data !== null ? { ...node.data } : {},
  }));
}

function cloneEdges(edges: Edge[]): Edge[] {
  return edges.map((edge) => ({
    ...edge,
    data: typeof edge.data === "object" && edge.data !== null ? { ...edge.data } : edge.data,
  }));
}

function ensureUniqueIds(ids: string[], entity: "node" | "edge"): string | null {
  return ids.length === new Set(ids).size ? null : `Graph contains duplicate ${entity} ids.`;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "node";
}

export function applyGraphDiff(nodes: Node[], edges: Edge[], diff: GraphDiffPayload): GraphDiffApplyResult {
  const nextNodes = cloneNodes(nodes);
  const nextEdges = cloneEdges(edges);

  const nodeDupError = ensureUniqueIds(nextNodes.map((node) => String(node.id)), "node");
  if (nodeDupError) return { ok: false, nodes, edges, error: nodeDupError };
  const edgeDupError = ensureUniqueIds(nextEdges.map((edge) => String(edge.id)), "edge");
  if (edgeDupError) return { ok: false, nodes, edges, error: edgeDupError };

  for (const nodeId of diff.delete_node_ids ?? []) {
    const target = String(nodeId);
    if (!nextNodes.some((node) => node.id === target)) {
      return { ok: false, nodes, edges, error: `Cannot delete node '${target}' because it does not exist.` };
    }
    for (let i = nextNodes.length - 1; i >= 0; i -= 1) {
      if (nextNodes[i].id === target) {
        nextNodes.splice(i, 1);
      }
    }
    for (let i = nextEdges.length - 1; i >= 0; i -= 1) {
      if (nextEdges[i].source === target || nextEdges[i].target === target) {
        nextEdges.splice(i, 1);
      }
    }
  }

  const nodeIds = new Set(nextNodes.map((node) => String(node.id)));
  for (const nodeAdd of diff.add_nodes ?? []) {
    const explicitId = typeof nodeAdd.id === "string" ? nodeAdd.id.trim() : "";
    const nodeId = explicitId.length > 0 ? explicitId : uniqueId(slugify(nodeAdd.label), nodeIds);
    if (nodeIds.has(nodeId)) {
      return { ok: false, nodes, edges, error: `Cannot add node '${nodeId}' because it already exists.` };
    }
    if (nodeAdd.parent_id && !nodeIds.has(nodeAdd.parent_id)) {
      return {
        ok: false,
        nodes,
        edges,
        error: `Cannot add node '${nodeId}' because parent '${nodeAdd.parent_id}' does not exist.`,
      };
    }
    const created: Node = {
      id: nodeId,
      type: nodeAdd.type === "container" ? "container" : "service",
      position: {
        x: Number.isFinite(nodeAdd.position?.x) ? Number(nodeAdd.position?.x) : 0,
        y: Number.isFinite(nodeAdd.position?.y) ? Number(nodeAdd.position?.y) : 0,
      },
      data: {
        ...(nodeAdd.data ?? {}),
        label: nodeAdd.label,
        category: nodeAdd.category ?? "compute",
      },
    };
    if (nodeAdd.parent_id) {
      created.parentId = nodeAdd.parent_id;
      created.extent = "parent";
    }
    nextNodes.push(created);
    nodeIds.add(nodeId);
  }

  for (const nodeEdit of diff.edit_nodes ?? []) {
    const target = nextNodes.find((node) => node.id === nodeEdit.id);
    if (!target) {
      return { ok: false, nodes, edges, error: `Cannot edit node '${nodeEdit.id}' because it does not exist.` };
    }
    const existingData = typeof target.data === "object" && target.data !== null ? target.data : {};
    target.data = {
      ...existingData,
      ...(typeof nodeEdit.data === "object" && nodeEdit.data !== null ? nodeEdit.data : {}),
      ...(typeof nodeEdit.label === "string" ? { label: nodeEdit.label } : {}),
      ...(typeof nodeEdit.category === "string" ? { category: nodeEdit.category } : {}),
    };
    if (typeof nodeEdit.type === "string" && nodeEdit.type.length > 0) {
      target.type = nodeEdit.type;
    }
    if (Object.prototype.hasOwnProperty.call(nodeEdit, "parent_id")) {
      const parentId = nodeEdit.parent_id ?? null;
      if (typeof parentId === "string" && parentId.length > 0) {
        if (!nodeIds.has(parentId)) {
          return {
            ok: false,
            nodes,
            edges,
            error: `Cannot move node '${nodeEdit.id}' under missing parent '${parentId}'.`,
          };
        }
        target.parentId = parentId;
        target.extent = "parent";
      } else {
        delete target.parentId;
        delete target.extent;
      }
    }
  }

  for (const edgeId of diff.delete_edge_ids ?? []) {
    const target = String(edgeId);
    const index = nextEdges.findIndex((edge) => edge.id === target);
    if (index === -1) {
      return { ok: false, nodes, edges, error: `Cannot delete edge '${target}' because it does not exist.` };
    }
    nextEdges.splice(index, 1);
  }

  const edgeIds = new Set(nextEdges.map((edge) => String(edge.id)));
  for (const edgeAdd of diff.add_edges ?? []) {
    if (!nodeIds.has(edgeAdd.source) || !nodeIds.has(edgeAdd.target)) {
      return {
        ok: false,
        nodes,
        edges,
        error: `Cannot add edge '${edgeAdd.source} -> ${edgeAdd.target}' because source/target is missing.`,
      };
    }
    const explicitId = typeof edgeAdd.id === "string" ? edgeAdd.id.trim() : "";
    const edgeId =
      explicitId.length > 0
        ? explicitId
        : uniqueId(`${edgeAdd.source}-${edgeAdd.target}`, edgeIds);
    if (edgeIds.has(edgeId)) {
      return { ok: false, nodes, edges, error: `Cannot add edge '${edgeId}' because it already exists.` };
    }
    nextEdges.push({
      id: edgeId,
      source: edgeAdd.source,
      target: edgeAdd.target,
      label: edgeAdd.label ?? "",
      animated: true,
      style: { stroke: "#6b7280" },
      ...(edgeAdd.data ? { data: edgeAdd.data } : {}),
    });
    edgeIds.add(edgeId);
  }

  for (const edgeEdit of diff.edit_edges ?? []) {
    const target = nextEdges.find((edge) => edge.id === edgeEdit.id);
    if (!target) {
      return { ok: false, nodes, edges, error: `Cannot edit edge '${edgeEdit.id}' because it does not exist.` };
    }
    const source = typeof edgeEdit.source === "string" ? edgeEdit.source : target.source;
    const targetNode = typeof edgeEdit.target === "string" ? edgeEdit.target : target.target;
    if (!nodeIds.has(source) || !nodeIds.has(targetNode)) {
      return {
        ok: false,
        nodes,
        edges,
        error: `Cannot edit edge '${edgeEdit.id}' because source/target would be orphaned.`,
      };
    }
    target.source = source;
    target.target = targetNode;
    if (typeof edgeEdit.label === "string") {
      target.label = edgeEdit.label;
    }
    if (edgeEdit.data && typeof edgeEdit.data === "object") {
      const existingData =
        typeof target.data === "object" && target.data !== null
          ? (target.data as Record<string, unknown>)
          : {};
      target.data = { ...existingData, ...edgeEdit.data };
    }
  }

  for (const edge of nextEdges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return {
        ok: false,
        nodes,
        edges,
        error: `Mutation produced orphan edge '${edge.id}' (${edge.source} -> ${edge.target}).`,
      };
    }
  }

  const finalNodeDupError = ensureUniqueIds(nextNodes.map((node) => String(node.id)), "node");
  if (finalNodeDupError) return { ok: false, nodes, edges, error: finalNodeDupError };
  const finalEdgeDupError = ensureUniqueIds(nextEdges.map((edge) => String(edge.id)), "edge");
  if (finalEdgeDupError) return { ok: false, nodes, edges, error: finalEdgeDupError };

  return {
    ok: true,
    nodes: nextNodes,
    edges: nextEdges,
  };
}
