import { useState, useCallback, useMemo, useRef } from "react";
import { Node, Edge, NodeChange, EdgeChange, applyNodeChanges, applyEdgeChanges } from "reactflow";
import { applyDagreLayout, sortNodesForRender } from "@/lib/diagramLayout";
import { deriveNodeType } from "@/lib/awsIcons";
import { defaultContainerSize, normalizeContainerType } from "@/components/Canvas/containerNodeStyles";
import { applyGraphDiff, GraphMutationPayload } from "@/lib/graphDiff";

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
      ...(type === "container" ? { containerType: normalizeContainerType(node.data?.containerType) } : {}),
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
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((n) => {
        const next = applyNodeChanges(changes, n);
        nodesRef.current = next;
        return next;
      }),
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
    nodesRef.current = [];
    edgesRef.current = [];
  }, []);

  const handleDiagramEvent = useCallback((msg: Record<string, unknown>) => {
    if (msg.action === "add_node") {
      const id = msg.id as string;
      const label = msg.label as string;
      const category = (msg.category as string) ?? "compute";
      const isContainer = (msg.node_type as string) === "container";
      const containerType = normalizeContainerType(msg.container_type);
      const parentId = msg.parent_id as string | undefined;

      setNodes((prev) => {
        if (prev.find((n) => n.id === id)) return prev;
        const node: Node = isContainer
          ? {
              id, type: "container", position: { x: 0, y: 0 },
              ...(parentId ? { parentId, extent: "parent" as const } : {}),
              style: defaultContainerSize(containerType), data: { label, category, containerType },
            }
          : {
              id, type: "service", position: { x: 0, y: 0 },
              ...(parentId ? { parentId, extent: "parent" as const } : {}),
              data: { label, category, nodeType: deriveNodeType(id) },
            };
        const next = sortNodesForRender([...prev, node]);
        nodesRef.current = next;
        return next;
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
      const sorted = sortNodesForRender(prev);
      const next = applyDagreLayout(sorted, edgesRef.current);
      nodesRef.current = next;
      return next;
    });
    setFitViewTrigger((v) => v + 1);
  }, []);

  const hydrate = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
    const normalizedNodes = sortNodesForRender(nextNodes.map(normalizeNode));
    const normalizedEdges = nextEdges.map(normalizeEdge);

    setNodes(normalizedNodes);
    setEdges(normalizedEdges);
    nodesRef.current = normalizedNodes;
    edgesRef.current = normalizedEdges;
    setFitViewTrigger((v) => v + 1);
  }, []);

  const applyGraphMutation = useCallback((mutation: GraphMutationPayload): { ok: boolean; error?: string } => {
    const result = applyGraphDiff(nodesRef.current, edgesRef.current, mutation.diff);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const normalizedNodes = sortNodesForRender(result.nodes.map(normalizeNode));
    const normalizedEdges = result.edges.map(normalizeEdge);
    setNodes(normalizedNodes);
    setEdges(normalizedEdges);
    nodesRef.current = normalizedNodes;
    edgesRef.current = normalizedEdges;
    setFitViewTrigger((v) => v + 1);
    return { ok: true };
  }, []);

  const reparentNode = useCallback((nodeId: string, parentId: string, position: { x: number; y: number }) => {
    setNodes((prev) => {
      const next = sortNodesForRender(
        prev.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                parentId,
                extent: "parent" as const,
                position,
              }
            : node
        )
      );
      nodesRef.current = next;
      return next;
    });
  }, []);

  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const deselectNode = useCallback((id: string) => {
    setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, selected: false } : node)));
  }, []);

  return {
    nodes,
    edges,
    selectedNodeIds,
    deselectNode,
    onNodesChange,
    onEdgesChange,
    fitViewTrigger,
    handleDiagramEvent,
    applyGraphMutation,
    reparentNode,
    reset,
    applyLayout,
    hydrate,
  };
}
