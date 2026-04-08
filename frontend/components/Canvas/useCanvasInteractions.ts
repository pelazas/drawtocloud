import { useCallback, useEffect, useMemo, useState } from "react";
import type { EdgeChange, Node, NodeChange, Viewport } from "reactflow";
import { useReactFlow } from "reactflow";
import { getContainerMinSize } from "@/components/Canvas/containerInteractions";
import { formatArchitectStatusWithDots, nextArchitectDotCount } from "@/lib/generationUiState";

type UseCanvasInteractionsArgs = {
  nodes: Node[];
  statusText: string | null;
  fitViewTrigger: number;
  readOnly: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
};

export function useCanvasInteractions({
  nodes,
  statusText,
  fitViewTrigger,
  readOnly,
  onNodesChange,
  onEdgesChange,
}: UseCanvasInteractionsArgs) {
  const { fitView, zoomIn, zoomOut, zoomTo, getZoom } = useReactFlow();
  const [zoomPercent, setZoomPercent] = useState(100);
  const [dotCount, setDotCount] = useState(1);

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

  const displayNodes = useMemo(
    () =>
      nodes.map((node) =>
        node.type === "container"
          ? (() => {
              const minSize = getContainerMinSize(node, nodes);
              return {
                ...node,
                data: {
                  ...node.data,
                  isDragOver: false,
                  isEditable: !readOnly,
                  minWidth: minSize.width,
                  minHeight: minSize.height,
                },
              };
            })()
          : node
      ),
    [nodes, readOnly]
  );

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes), [onNodesChange]);
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => onEdgesChange(changes), [onEdgesChange]);
  const handleViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  }, []);

  return {
    displayNodes,
    zoomPercent,
    dotCount,
    zoomIn,
    zoomOut,
    zoomTo,
    handleNodesChange,
    handleEdgesChange,
    handleViewportChange,
    statusLabel: statusText ? formatArchitectStatusWithDots(statusText, dotCount) : null,
  };
}
