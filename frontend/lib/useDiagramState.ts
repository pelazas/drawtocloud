import { useState, useCallback, useMemo, useRef } from "react";
import { Node, Edge, NodeChange, EdgeChange, applyEdgeChanges } from "reactflow";
import { applyDagreLayout, sortNodesForRender } from "@/lib/diagramLayout";
import { deriveNodeType } from "@/lib/awsIcons";
import { defaultContainerSize, normalizeContainerType } from "@/components/Canvas/containerNodeStyles";
import { buildContainerNodeData } from "@/lib/containerNodeData";
import { applyGraphDiff, GraphMutationPayload } from "@/lib/graphDiff";
import { applyDiagramNodeChanges } from "@/lib/diagramPresentationState";
import { clearManualPositionOverrides, type ManualPositionOverrides } from "@/lib/manualNodePositions";

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
  const containerType = normalizeContainerType(node.data?.containerType);
  const containerStyle =
    type === "container"
      ? {
          ...defaultContainerSize(containerType),
          ...(typeof node.style === "object" && node.style !== null ? node.style : {}),
          width: Number.isFinite(node.style?.width) ? Number(node.style?.width) : defaultContainerSize(containerType).width,
          height: Number.isFinite(node.style?.height) ? Number(node.style?.height) : defaultContainerSize(containerType).height,
        }
      : node.style;
  const normalized: Node = {
    ...node,
    id,
    type,
    ...(type === "container" ? { style: containerStyle } : {}),
    position: {
      x: Number.isFinite(node.position?.x) ? Number(node.position?.x) : 0,
      y: Number.isFinite(node.position?.y) ? Number(node.position?.y) : 0,
    },
    data: {
      ...node.data,
      label,
      category,
      ...(type === "container" ? buildContainerNodeData(containerType, label, category, node.data?.subnetKind) : {}),
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
  const [canonicalNodes, setCanonicalNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [manualPositionOverrides, setManualPositionOverrides] = useState<ManualPositionOverrides>(
    clearManualPositionOverrides()
  );
  const [fitViewTrigger, setFitViewTrigger] = useState(0);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const manualPositionOverridesRef = useRef<ManualPositionOverrides>(clearManualPositionOverrides());
  const nodes = useMemo(
    () => applyDiagramNodeChanges(canonicalNodes, [], manualPositionOverrides).renderedNodes,
    [canonicalNodes, manualPositionOverrides]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setCanonicalNodes((currentNodes) => {
        const next = applyDiagramNodeChanges(currentNodes, changes, manualPositionOverridesRef.current);
        nodesRef.current = next.canonicalNodes;
        manualPositionOverridesRef.current = next.manualPositionOverrides;
        setManualPositionOverrides(next.manualPositionOverrides);
        return next.canonicalNodes;
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
    setCanonicalNodes([]);
    setEdges([]);
    const cleared = clearManualPositionOverrides();
    manualPositionOverridesRef.current = cleared;
    setManualPositionOverrides(cleared);
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
      const position = typeof msg.position === "object" && msg.position !== null
        ? {
            x: Number.isFinite((msg.position as { x?: unknown }).x) ? Number((msg.position as { x?: number }).x) : 0,
            y: Number.isFinite((msg.position as { y?: unknown }).y) ? Number((msg.position as { y?: number }).y) : 0,
          }
        : { x: 0, y: 0 };
      const style = typeof msg.style === "object" && msg.style !== null ? msg.style as Node["style"] : undefined;

      setCanonicalNodes((prev) => {
        if (prev.find((n) => n.id === id)) return prev;
        const node: Node = isContainer
          ? {
              id, type: "container", position,
              ...(parentId ? { parentId, extent: "parent" as const } : {}),
              style: { ...defaultContainerSize(containerType), ...style },
              data: buildContainerNodeData(containerType, label, category, msg.subnet_kind),
            }
          : {
              id, type: "service", position,
              ...(parentId ? { parentId, extent: "parent" as const } : {}),
              data: { label, category, nodeType: deriveNodeType(id) },
            };
        const next = sortNodesForRender([...prev, node]);
        nodesRef.current = next;
        const cleared = clearManualPositionOverrides();
        manualPositionOverridesRef.current = cleared;
        setManualPositionOverrides(cleared);
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
    setCanonicalNodes((prev) => {
      const sorted = sortNodesForRender(prev);
      const next = applyDagreLayout(sorted, edgesRef.current);
      nodesRef.current = next;
      return next;
    });
    const cleared = clearManualPositionOverrides();
    manualPositionOverridesRef.current = cleared;
    setManualPositionOverrides(cleared);
    setFitViewTrigger((v) => v + 1);
  }, []);

  const hydrate = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
    const normalizedNodes = sortNodesForRender(nextNodes.map(normalizeNode));
    const normalizedEdges = nextEdges.map(normalizeEdge);

    setCanonicalNodes(normalizedNodes);
    setEdges(normalizedEdges);
    const cleared = clearManualPositionOverrides();
    manualPositionOverridesRef.current = cleared;
    setManualPositionOverrides(cleared);
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
    setCanonicalNodes(normalizedNodes);
    setEdges(normalizedEdges);
    const cleared = clearManualPositionOverrides();
    manualPositionOverridesRef.current = cleared;
    setManualPositionOverrides(cleared);
    nodesRef.current = normalizedNodes;
    edgesRef.current = normalizedEdges;
    setFitViewTrigger((v) => v + 1);
    return { ok: true };
  }, []);

  const reparentNode = useCallback((nodeId: string, parentId: string, position: { x: number; y: number }) => {
    setCanonicalNodes((prev) => {
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
      const cleared = clearManualPositionOverrides();
      manualPositionOverridesRef.current = cleared;
      setManualPositionOverrides(cleared);
      return next;
    });
  }, []);

  const detachNodeFromParent = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setCanonicalNodes((prev) => {
      const next = sortNodesForRender(
        prev.map((node) => {
          if (node.id !== nodeId) return node;
          const updated = { ...node, position };
          delete updated.parentId;
          delete updated.extent;
          return updated;
        })
      );
      nodesRef.current = next;
      const cleared = clearManualPositionOverrides();
      manualPositionOverridesRef.current = cleared;
      setManualPositionOverrides(cleared);
      return next;
    });
  }, []);

  const selectedNodeIds = useMemo(() => canonicalNodes.filter((n) => n.selected).map((n) => n.id), [canonicalNodes]);
  const deselectNode = useCallback((id: string) => {
    setCanonicalNodes((prev) => prev.map((node) => (node.id === id ? { ...node, selected: false } : node)));
  }, []);

  return {
    nodes,
    canonicalNodes,
    edges,
    selectedNodeIds,
    deselectNode,
    onNodesChange,
    onEdgesChange,
    fitViewTrigger,
    handleDiagramEvent,
    applyGraphMutation,
    detachNodeFromParent,
    reparentNode,
    reset,
    applyLayout,
    hydrate,
  };
}
