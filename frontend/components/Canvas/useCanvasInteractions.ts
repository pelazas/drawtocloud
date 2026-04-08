import { useCallback, useEffect, useMemo, useState } from "react";
import type { EdgeChange, Node, NodeChange, Viewport } from "reactflow";
import { useReactFlow } from "reactflow";
import { shouldRestoreDragOrigin } from "@/components/Canvas/dragRestore";

import {
  findReparentTarget,
  getAbsoluteNodePosition,
  getContainerMinSize,
  getReparentPosition,
} from "@/components/Canvas/containerInteractions";
import { formatArchitectStatusWithDots, nextArchitectDotCount } from "@/lib/generationUiState";

type UseCanvasInteractionsArgs = {
  nodes: Node[];
  statusText: string | null;
  fitViewTrigger: number;
  readOnly: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDetachNode?: (nodeId: string, position: { x: number; y: number }) => void;
  onReparentNode?: (nodeId: string, parentId: string, position: { x: number; y: number }) => void;
  onPersistStructure?: () => void;
};

type DragOrigin = {
  parentId: string | null;
  relativePosition: { x: number; y: number };
  absolutePosition: { x: number; y: number };
};

export function useCanvasInteractions({
  nodes,
  statusText,
  fitViewTrigger,
  readOnly,
  onNodesChange,
  onEdgesChange,
  onDeleteNodes,
  onDetachNode,
  onReparentNode,
  onPersistStructure,
}: UseCanvasInteractionsArgs) {
  const { fitView, zoomIn, zoomOut, zoomTo, getZoom } = useReactFlow();
  const [zoomPercent, setZoomPercent] = useState(100);
  const [dotCount, setDotCount] = useState(1);
  const [dragOverContainerId, setDragOverContainerId] = useState<string | null>(null);
  const [dragOriginByNodeId, setDragOriginByNodeId] = useState<Record<string, DragOrigin>>({});

  useEffect(() => {
    if (fitViewTrigger > 0) {
      fitView({ padding: 0.2, duration: 400 });
    }
  }, [fitViewTrigger, fitView]);

  useEffect(() => {
    setZoomPercent(Math.round(getZoom() * 100));
  }, [fitViewTrigger, getZoom]);

  useEffect(() => {
    if (!statusText) {
      setDotCount(1);
      return;
    }

    const interval = setInterval(() => {
      setDotCount((prev) => nextArchitectDotCount(prev));
    }, 500);

    return () => clearInterval(interval);
  }, [statusText]);

  const selectedContainer = useMemo(
    () => nodes.find((node) => node.type === "container" && node.selected),
    [nodes]
  );
  const isMultiRegion = useMemo(
    () => nodes.some((node) => node.type === "container" && node.data?.containerType === "region"),
    [nodes]
  );
  const selectedContainerMinSize = useMemo(
    () =>
      selectedContainer
        ? getContainerMinSize(selectedContainer, nodes)
        : { width: 300, height: 200 },
    [nodes, selectedContainer]
  );
  const displayNodes = useMemo(
    () =>
      nodes.map((node) =>
        node.type === "container"
          ? {
              ...node,
              data: {
                ...node.data,
                isDragOver: node.id === dragOverContainerId,
              },
            }
          : node
      ),
    [dragOverContainerId, nodes]
  );

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes), [onNodesChange]);
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => onEdgesChange(changes), [onEdgesChange]);
  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (!readOnly && onDeleteNodes) {
        onDeleteNodes(deleted.map((node) => node.id));
      }
    },
    [onDeleteNodes, readOnly]
  );
  const handleViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  }, []);

  const handleNodeDrag = useCallback(
    (_event: unknown, draggedNode: Node) => {
      if (readOnly) return;
      const nextNodes = nodes.map((node) =>
        node.id === draggedNode.id ? { ...node, position: draggedNode.position } : node
      );
      setDragOverContainerId(findReparentTarget({ ...draggedNode }, nextNodes, isMultiRegion)?.id ?? null);
    },
    [isMultiRegion, nodes, readOnly]
  );

  const handleNodeDragStart = useCallback(
    (_event: unknown, draggedNode: Node) => {
      if (readOnly) return;
      const absolutePosition = getAbsoluteNodePosition(draggedNode, nodes);
      setDragOriginByNodeId((prev) => ({
        ...prev,
        [draggedNode.id]: {
          parentId: draggedNode.parentId ?? null,
          relativePosition: {
            x: Number.isFinite(draggedNode.position?.x) ? Number(draggedNode.position.x) : 0,
            y: Number.isFinite(draggedNode.position?.y) ? Number(draggedNode.position.y) : 0,
          },
          absolutePosition,
        },
      }));
      if (!draggedNode.parentId || !onDetachNode) return;
      onDetachNode(draggedNode.id, absolutePosition);
      setDragOverContainerId(null);
    },
    [nodes, onDetachNode, readOnly]
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, draggedNode: Node) => {
      if (readOnly) return;
      const nextNodes = nodes.map((node) =>
        node.id === draggedNode.id ? { ...node, position: draggedNode.position } : node
      );
      const targetContainer = findReparentTarget({ ...draggedNode }, nextNodes, isMultiRegion);
      const dragOrigin = dragOriginByNodeId[draggedNode.id];
      setDragOverContainerId(null);

      if (targetContainer && onReparentNode) {
        onReparentNode(
          draggedNode.id,
          targetContainer.id,
          getReparentPosition({ ...draggedNode }, targetContainer, nextNodes)
        );
      } else if (shouldRestoreDragOrigin(dragOrigin) && onReparentNode) {
        onReparentNode(draggedNode.id, dragOrigin.parentId, dragOrigin.relativePosition);
      }

      setDragOriginByNodeId((prev) => {
        const next = { ...prev };
        delete next[draggedNode.id];
        return next;
      });

      onPersistStructure?.();
    },
    [dragOriginByNodeId, isMultiRegion, nodes, onDetachNode, onPersistStructure, onReparentNode, readOnly]
  );

  return {
    displayNodes,
    selectedContainer,
    selectedContainerMinSize,
    zoomPercent,
    dotCount,
    zoomIn,
    zoomOut,
    zoomTo,
    handleNodesChange,
    handleEdgesChange,
    handleNodesDelete,
    handleViewportChange,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleResizeEnd: onPersistStructure,
    statusLabel: statusText ? formatArchitectStatusWithDots(statusText, dotCount) : null,
  };
}
