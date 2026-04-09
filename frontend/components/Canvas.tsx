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
} from "reactflow";
import "reactflow/dist/style.css";
import "@reactflow/node-resizer/dist/style.css";
import { type ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { colorForCategory } from "@/lib/categoryColors";
import ServiceNode from "@/components/Canvas/ServiceNode";
import ContainerNode from "@/components/Canvas/ContainerNode";
import SelectionInfoBar from "@/components/Canvas/SelectionInfoBar";
import { getCanvasInteractionPolicy } from "@/components/Canvas/canvasInteractionPolicy";
import { useCanvasInteractions } from "@/components/Canvas/useCanvasInteractions";

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  selectedNodeIds: string[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  fitViewTrigger: number;
  readOnly?: boolean;
  canDragNodes?: boolean;
  statusText?: string | null;
  children?: ReactNode;
}

const nodeTypes = { service: ServiceNode, container: ContainerNode };

function CanvasFlow(props: CanvasProps) {
  const {
    nodes,
    edges,
    selectedNodeIds,
    onNodesChange,
    onEdgesChange,
    fitViewTrigger,
    readOnly = false,
    canDragNodes = false,
    statusText = null,
  } = props;
  const interactionPolicy = getCanvasInteractionPolicy(canDragNodes, readOnly);
  const {
    displayNodes,
    zoomPercent,
    zoomIn,
    zoomOut,
    zoomTo,
    handleNodesChange,
    handleEdgesChange,
    handleViewportChange,
    statusLabel,
  } = useCanvasInteractions({
    nodes,
    statusText,
    fitViewTrigger,
    readOnly,
    onNodesChange,
    onEdgesChange,
  });

  return (
    <div className="relative w-full h-full">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={readOnly ? undefined : handleNodesChange}
          onEdgesChange={readOnly ? undefined : handleEdgesChange}
          onMove={handleViewportChange}
          nodeTypes={nodeTypes}
        fitView
        nodesDraggable={interactionPolicy.nodesDraggable}
        nodesConnectable={interactionPolicy.nodesConnectable}
        elementsSelectable={interactionPolicy.elementsSelectable}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={interactionPolicy.selectionOnDrag}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={interactionPolicy.deleteKeyCode}
        panOnDrag={[1, 2]}
        panOnScroll={true}
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={24} />
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div />
          <div className="justify-self-center text-center">
            {statusText ? (
              <div className="text-center text-sm font-semibold tracking-[0.04em] text-blue-300">
                {statusLabel}
              </div>
            ) : null}
          </div>
          <div className="pointer-events-auto flex items-center gap-3 justify-self-end">
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
  const { children, ...flowProps } = props;

  return (
    <div className="relative w-full h-full bg-gray-950">
      <ReactFlowProvider>
        <CanvasFlow {...flowProps} />
      </ReactFlowProvider>
      {children}
    </div>
  );
}
