import dagre from "dagre";
import { Node, Edge } from "reactflow";

const CONTAINER_PADDING = 40;

export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const nodeMap = new Map<string, Node>(nodes.map((n) => [n.id, { ...n }]));

  // Pass 1: layout each container's children
  const containers = nodes.filter((n) => n.type === "container");

  for (const container of containers) {
    const children = nodes.filter((n) => n.parentId === container.id);

    if (children.length === 0) {
      const c = nodeMap.get(container.id)!;
      c.style = { ...c.style, width: 300, height: 200 };
      nodeMap.set(container.id, c);
      continue;
    }

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 60 });

    for (const child of children) {
      g.setNode(child.id, { width: 120, height: 80 });
    }

    for (const edge of edges) {
      if (
        g.hasNode(edge.source) &&
        g.hasNode(edge.target)
      ) {
        g.setEdge(edge.source, edge.target);
      }
    }

    dagre.layout(g);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
      const { x, y } = g.node(child.id);
      minX = Math.min(minX, x - 60);
      minY = Math.min(minY, y - 40);
      maxX = Math.max(maxX, x + 60);
      maxY = Math.max(maxY, y + 40);
    }

    const bboxW = maxX - minX;
    const bboxH = maxY - minY;

    const containerW = Math.max(300, bboxW + CONTAINER_PADDING * 2);
    const containerH = Math.max(200, bboxH + CONTAINER_PADDING * 2);

    const c = nodeMap.get(container.id)!;
    c.style = { ...c.style, width: containerW, height: containerH };
    nodeMap.set(container.id, c);

    for (const child of children) {
      const { x, y } = g.node(child.id);
      const updated = nodeMap.get(child.id)!;
      updated.position = {
        x: x - 60 - minX + CONTAINER_PADDING,
        y: y - 40 - minY + CONTAINER_PADDING,
      };
      nodeMap.set(child.id, updated);
    }
  }

  // Pass 2: layout top-level graph
  const childIds = new Set(nodes.filter((n) => n.parentId).map((n) => n.id));
  const topLevel = nodes.filter((n) => !n.parentId);

  const g2 = new dagre.graphlib.Graph();
  g2.setDefaultEdgeLabel(() => ({}));
  g2.setGraph({ rankdir: "TB", ranksep: 120, nodesep: 80 });

  for (const node of topLevel) {
    if (node.type === "container") {
      const c = nodeMap.get(node.id)!;
      const w = (c.style?.width as number) ?? 300;
      const h = (c.style?.height as number) ?? 200;
      g2.setNode(node.id, { width: w, height: h });
    } else {
      g2.setNode(node.id, { width: 120, height: 80 });
    }
  }

  // Remap edges: child node refs → parent container; deduplicate
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const src = childIds.has(edge.source)
      ? nodes.find((n) => n.id === edge.source)?.parentId ?? edge.source
      : edge.source;
    const tgt = childIds.has(edge.target)
      ? nodes.find((n) => n.id === edge.target)?.parentId ?? edge.target
      : edge.target;
    if (src === tgt) continue;
    if (!g2.hasNode(src) || !g2.hasNode(tgt)) continue;
    const key = `${src}→${tgt}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      g2.setEdge(src, tgt);
    }
  }

  dagre.layout(g2);

  for (const node of topLevel) {
    const { x, y, width, height } = g2.node(node.id);
    const updated = nodeMap.get(node.id)!;
    updated.position = { x: x - width / 2, y: y - height / 2 };
    nodeMap.set(node.id, updated);
  }

  return Array.from(nodeMap.values());
}
