import { useState, useCallback, useMemo, useRef } from "react";
import { Node, Edge, NodeChange, EdgeChange, applyNodeChanges, applyEdgeChanges } from "reactflow";
import { applyDagreLayout } from "@/lib/diagramLayout";
import { deriveNodeType } from "@/lib/awsIcons";

function normalizeNode(node: Node): Node {
  const id = String(node.id ?? "");
  const category =
    typeof node.data?.category === "string" && node.data.category.length > 0
      ? node.data.category
      : "default";
  const label =
    typeof node.data?.label === "string" && node.data.label.length > 0
      ? node.data.label
      : id;

  const type = node.type === "container" ? "container" : "service";
  const normalized: Node = {
    ...node,
    id,
    type,
    position: {
      x: Number.isFinite(node.position?.x) ? Number(node.position?.x) : 0,
      y: Number.isFinite(node.position?.y) ? Number(node.position?.y) : 0,
    },
    data: {
      ...node.data,
      label,
      category,
      ...(type === "service" ? { nodeType: node.data?.nodeType ?? deriveNodeType(id) } : {}),
    },
  };

  return normalized;
}

function normalizeEdge(edge: Edge): Edge {
  const source = String(edge.source ?? "");
  const target = String(edge.target ?? "");
  const id = typeof edge.id === "string" && edge.id.length > 0 ? edge.id : `${source}-${target}`;

  return {
    ...edge,
    id,
    source,
    target,
    label: typeof edge.label === "string" ? edge.label : "",
    animated: edge.animated ?? true,
    style: edge.style ?? { stroke: "#6b7280" },
  };
}

export function useDiagramState() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [fitViewTrigger, setFitViewTrigger] = useState(0);
  const edgesRef = useRef<Edge[]>([]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((e) => {
        const next = applyEdgeChanges(changes, e);
        edgesRef.current = next;
        return next;
      }),
    []
  );

  const reset = useCallback(() => {
    setNodes([]);
    setEdges([]);
    edgesRef.current = [];
  }, []);

  const handleDiagramEvent = useCallback((msg: Record<string, unknown>) => {
    if (msg.action === "add_node") {
      const id = msg.id as string;
      const label = msg.label as string;
      const category = (msg.category as string) ?? "compute";
      const isContainer = (msg.node_type as string) === "container";
      const parentId = msg.parent_id as string | undefined;

      setNodes((prev) => {
        if (prev.find((n) => n.id === id)) return prev;
        const node: Node = isContainer
          ? {
              id, type: "container", position: { x: 0, y: 0 },
              style: { width: 700, height: 500 }, data: { label, category },
            }
          : {
              id, type: "service", position: { x: 0, y: 0 },
              ...(parentId ? { parentId, extent: "parent" as const } : {}),
              data: { label, category, nodeType: deriveNodeType(id) },
            };
        // Keep containers at the front (parents before children)
        return isContainer ? [node, ...prev] : [...prev, node];
      });
    }

    if (msg.action === "add_edge") {
      const from = msg.from as string;
      const to = msg.to as string;
      const label = (msg.label as string) ?? "";
      const edgeId = `${from}-${to}`;
      setEdges((prev) => {
        if (prev.find((e) => e.id === edgeId)) return prev;
        const next = [
          ...prev,
          { id: edgeId, source: from, target: to, label, animated: true, style: { stroke: "#6b7280" } },
        ];
        edgesRef.current = next;
        return next;
      });
    }
  }, []);

  const applyLayout = useCallback(() => {
    setNodes((prev) => {
      const sorted = [...prev].sort((a, b) => {
        if (a.type === "container") return -1;
        if (b.type === "container") return 1;
        return 0;
      });
      return applyDagreLayout(sorted, edgesRef.current);
    });
    setFitViewTrigger((v) => v + 1);
  }, []);

  const hydrate = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
    const normalizedNodes = nextNodes.map(normalizeNode).sort((a, b) => {
      if (a.type === "container") return -1;
      if (b.type === "container") return 1;
      return 0;
    });
    const normalizedEdges = nextEdges.map(normalizeEdge);

    setNodes(normalizedNodes);
    setEdges(normalizedEdges);
    edgesRef.current = normalizedEdges;
    setFitViewTrigger((v) => v + 1);
  }, []);

  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);

  return { nodes, edges, selectedNodeIds, onNodesChange, onEdgesChange, fitViewTrigger, handleDiagramEvent, reset, applyLayout, hydrate };
}
