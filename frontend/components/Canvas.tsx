"use client";

import ReactFlow, {
  Background,
  MiniMap,
  PanOnScrollMode,
  ReactFlowProvider,
  SelectionMode,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  useReactFlow,
  type Viewport,
} from "reactflow";
import { NodeResizer } from "@reactflow/node-resizer";
import "reactflow/dist/style.css";
import "@reactflow/node-resizer/dist/style.css";
import { useEffect, useCallback, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { colorForCategory } from "@/lib/categoryColors";
import ServiceNode from "@/components/Canvas/ServiceNode";
import ContainerNode from "@/components/Canvas/ContainerNode";
import SelectionInfoBar from "@/components/Canvas/SelectionInfoBar";

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  selectedNodeIds: string[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  fitViewTrigger: number;
  readOnly?: boolean;
  costOverlay?: { monthly_total: number } | null;
}

const nodeTypes = { service: ServiceNode, container: ContainerNode };

function CanvasFlow(props: CanvasProps) {
  const { nodes, edges, selectedNodeIds, onNodesChange, onEdgesChange, onDeleteNodes, fitViewTrigger, readOnly = false } = props;
  const { fitView, zoomIn, zoomOut, zoomTo, getZoom } = useReactFlow();
  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    if (fitViewTrigger > 0) {
      fitView({ padding: 0.2, duration: 400 });
    }
  }, [fitViewTrigger, fitView]);

  useEffect(() => {
    setZoomPercent(Math.round(getZoom() * 100));
  }, [getZoom, fitViewTrigger]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => onNodesChange(changes),
    [onNodesChange]
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => onEdgesChange(changes),
    [onEdgesChange]
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (!readOnly && onDeleteNodes) {
        onDeleteNodes(deleted.map((n) => n.id));
      }
    },
    [readOnly, onDeleteNodes]
  );

  const handleViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  }, []);

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : handleNodesChange}
        onEdgesChange={readOnly ? undefined : handleEdgesChange}
        onNodesDelete={readOnly ? undefined : handleNodesDelete}
        onMove={handleViewportChange}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        multiSelectionKeyCode="Shift"
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
        panOnDrag={[1, 2]}
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={24} />
        {!readOnly && nodes.find((n) => n.type === "container" && n.selected) && (
          <NodeResizer minWidth={300} minHeight={200} />
        )}
        <MiniMap
          nodeColor={(n) => colorForCategory(n.data?.category ?? "") + "99"}
          nodeStrokeColor="transparent"
          maskColor="rgba(0, 0, 0, 0.75)"
          className="rounded-xl border border-white/5 shadow-lg shadow-black/30"
          style={{
            background: "rgba(0, 0, 0, 0.3)",
            backdropFilter: "blur(12px)",
            margin: 8,
            marginBottom: 72,
          }}
        />
        {!readOnly && <SelectionInfoBar count={selectedNodeIds.length} />}
      </ReactFlow>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 border-t border-gray-800/80 bg-gradient-to-r from-[#0b0e1f] via-[#101327] to-[#0b0e1f] px-4 py-2">
        <div className="flex justify-end">
          <div className="pointer-events-auto flex items-center gap-3">
            <div className="flex items-center rounded-2xl border border-gray-800 bg-[#04060f]/95 shadow-lg shadow-black/40 overflow-hidden">
              <button
                type="button"
                onClick={() => void zoomOut({ duration: 150 })}
                className="h-10 w-12 flex items-center justify-center text-gray-200 hover:bg-gray-800 transition-colors"
                aria-label="Zoom out"
              >
                <Minus size={18} />
              </button>
              <span className="min-w-[72px] text-center text-sm font-semibold text-white font-topbar tracking-[0.06em]">
                {zoomPercent}%
              </span>
              <button
                type="button"
                onClick={() => void zoomIn({ duration: 150 })}
                className="h-10 w-12 flex items-center justify-center text-gray-200 hover:bg-gray-800 transition-colors"
                aria-label="Zoom in"
              >
                <Plus size={18} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void zoomTo(1, { duration: 150 })}
              className="h-10 rounded-xl border border-blue-700/40 bg-[#0a0d1d] px-4 inline-flex items-center gap-2 text-blue-200 hover:bg-[#12162b] transition-colors font-topbar text-sm font-semibold tracking-[0.08em] uppercase"
              aria-label="Reset zoom"
            >
              <RotateCcw size={16} />
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Canvas(props: CanvasProps) {
  return (
    <div className="relative w-full h-full bg-gray-950">
      <ReactFlowProvider>
        <CanvasFlow {...props} />
      </ReactFlowProvider>
      {props.costOverlay && (
        <div className="absolute top-3 right-3 z-10 rounded-lg border border-gray-700 bg-gray-900/90 backdrop-blur-sm px-3 py-1.5 text-sm font-medium text-green-400">
          ${props.costOverlay.monthly_total.toFixed(0)}/mo
        </div>
      )}
    </div>
  );
}
