import { useCallback, useEffect, useMemo, useState } from "react";
import type { EdgeChange, Node, NodeChange, Viewport } from "reactflow";
import { useReactFlow } from "reactflow";
import { getContainerResizeBounds, getNodeMapForResize } from "@/components/Canvas/containerInteractions";

type UseCanvasInteractionsArgs = {
  nodes: Node[];
  fitViewTrigger: number;
  readOnly: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
};

export function useCanvasInteractions({
  nodes,
  fitViewTrigger,
  readOnly,
  onNodesChange,
  onEdgesChange,
}: UseCanvasInteractionsArgs) {
  const { fitView, zoomIn, zoomOut, zoomTo, getZoom } = useReactFlow();
  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    if (fitViewTrigger > 0) {
      fitView({ padding: 0.2, duration: 400 });
    }
  }, [fitViewTrigger, fitView]);

  useEffect(() => {
    setZoomPercent(Math.round(getZoom() * 100));
  }, [fitViewTrigger, getZoom]);

  const displayNodes = useMemo(() => {
    const nodeMap = getNodeMapForResize(nodes);
    return nodes.map((node) =>
      node.type === "container"
        ? (() => {
            const bounds = getContainerResizeBounds(node, nodes, nodeMap);
            return {
              ...node,
              data: {
                ...node.data,
                isDragOver: false,
                isEditable: !readOnly,
                minWidth: bounds.minWidth,
                minHeight: bounds.minHeight,
                maxWidth: bounds.maxWidth,
                maxHeight: bounds.maxHeight,
              },
            };
          })()
        : node
    );
  }, [nodes, readOnly]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes), [onNodesChange]);
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => onEdgesChange(changes), [onEdgesChange]);
  const handleViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  }, []);

  return {
    displayNodes,
    zoomPercent,
    zoomIn,
    zoomOut,
    zoomTo,
    handleNodesChange,
    handleEdgesChange,
    handleViewportChange,
  };
}
