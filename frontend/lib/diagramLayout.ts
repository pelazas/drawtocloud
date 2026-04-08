import dagre from "dagre";
import type { Edge, Node } from "reactflow";

const CONTAINER_PADDING = 40;
const MIN_CONTAINER_WIDTH = 300;
const MIN_CONTAINER_HEIGHT = 200;
const SERVICE_WIDTH = 120;
const SERVICE_HEIGHT = 80;

type DagreNode = { x: number; y: number; width: number; height: number };

function cloneNode(node: Node): Node {
  return {
    ...node,
    position: {
      x: Number.isFinite(node.position?.x) ? Number(node.position?.x) : 0,
      y: Number.isFinite(node.position?.y) ? Number(node.position?.y) : 0,
    },
    data: typeof node.data === "object" && node.data !== null ? { ...node.data } : {},
    ...(typeof node.style === "object" && node.style !== null ? { style: { ...node.style } } : {}),
  };
}

function createParentMap(nodes: Node[]): Map<string, string | null> {
  return new Map(nodes.map((node) => [node.id, typeof node.parentId === "string" ? node.parentId : null]));
}

function nodeDepth(nodeId: string, parentMap: Map<string, string | null>): number {
  let depth = 0;
  let current = parentMap.get(nodeId) ?? null;
  while (current) {
    depth += 1;
    current = parentMap.get(current) ?? null;
  }
  return depth;
}

export function sortNodesForRender(nodes: Node[]): Node[] {
  const parentMap = createParentMap(nodes);
  const originalIndex = new Map(nodes.map((node, index) => [node.id, index]));

  return [...nodes].sort((left, right) => {
    const depthDiff = nodeDepth(left.id, parentMap) - nodeDepth(right.id, parentMap);
    if (depthDiff !== 0) return depthDiff;
    if (left.type === "container" && right.type !== "container") return -1;
    if (right.type === "container" && left.type !== "container") return 1;
    return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  });
}

function getNodeSize(node: Node): { width: number; height: number } {
  if (node.type === "container") {
    return {
      width: typeof node.style?.width === "number" ? node.style.width : MIN_CONTAINER_WIDTH,
      height: typeof node.style?.height === "number" ? node.style.height : MIN_CONTAINER_HEIGHT,
    };
  }

  return { width: SERVICE_WIDTH, height: SERVICE_HEIGHT };
}

function closestDirectChild(
  nodeId: string,
  directChildIds: Set<string>,
  parentMap: Map<string, string | null>
): string | null {
  if (directChildIds.has(nodeId)) return nodeId;
  let current = parentMap.get(nodeId) ?? null;
  while (current) {
    if (directChildIds.has(current)) return current;
    current = parentMap.get(current) ?? null;
  }
  return null;
}

function createGraph(rankdir: "LR" | "TB", ranksep: number, nodesep: number) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir, ranksep, nodesep });
  return graph;
}

function layoutLevel(
  parentId: string | null,
  nodes: Node[],
  edges: Edge[],
  nodeMap: Map<string, Node>,
  parentMap: Map<string, string | null>
): void {
  const children = nodes.filter((node) => (node.parentId ?? null) === parentId);
  if (children.length === 0) {
    if (parentId) {
      const emptyContainer = nodeMap.get(parentId);
      if (emptyContainer) {
        emptyContainer.style = {
          ...emptyContainer.style,
          width: MIN_CONTAINER_WIDTH,
          height: MIN_CONTAINER_HEIGHT,
        };
      }
    }
    return;
  }

  const childContainers = children.filter((node) => node.type === "container");
  for (const childContainer of childContainers) {
    layoutLevel(childContainer.id, nodes, edges, nodeMap, parentMap);
  }

  const graph = createGraph(childContainers.length === 0 ? "LR" : "TB", childContainers.length === 0 ? 80 : 120, childContainers.length === 0 ? 60 : 80);

  for (const child of children) {
    const current = nodeMap.get(child.id) ?? child;
    const size = getNodeSize(current);
    graph.setNode(child.id, size);
  }

  const directChildIds = new Set(children.map((node) => node.id));
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const source = closestDirectChild(edge.source, directChildIds, parentMap);
    const target = closestDirectChild(edge.target, directChildIds, parentMap);
    if (!source || !target || source === target) continue;
    const key = `${source}→${target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    graph.setEdge(source, target);
  }

  dagre.layout(graph);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    const layout = graph.node(child.id) as DagreNode;
    minX = Math.min(minX, layout.x - layout.width / 2);
    minY = Math.min(minY, layout.y - layout.height / 2);
    maxX = Math.max(maxX, layout.x + layout.width / 2);
    maxY = Math.max(maxY, layout.y + layout.height / 2);
  }

  for (const child of children) {
    const current = nodeMap.get(child.id) ?? child;
    const layout = graph.node(child.id) as DagreNode;
    if (parentId === null) {
      current.position = {
        x: layout.x - layout.width / 2,
        y: layout.y - layout.height / 2,
      };
    } else {
      current.position = {
        x: layout.x - layout.width / 2 - minX + CONTAINER_PADDING,
        y: layout.y - layout.height / 2 - minY + CONTAINER_PADDING,
      };
    }
    nodeMap.set(child.id, current);
  }

  if (parentId !== null) {
    const parent = nodeMap.get(parentId);
    if (parent) {
      parent.style = {
        ...parent.style,
        width: Math.max(MIN_CONTAINER_WIDTH, maxX - minX + CONTAINER_PADDING * 2),
        height: Math.max(MIN_CONTAINER_HEIGHT, maxY - minY + CONTAINER_PADDING * 2),
      };
      nodeMap.set(parentId, parent);
    }
  }
}

export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const normalizedNodes = sortNodesForRender(nodes);
  const nodeMap = new Map<string, Node>(normalizedNodes.map((node) => [node.id, cloneNode(node)]));
  const parentMap = createParentMap(normalizedNodes);

  layoutLevel(null, normalizedNodes, edges, nodeMap, parentMap);

  return sortNodesForRender(Array.from(nodeMap.values()));
}
