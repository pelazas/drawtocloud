"use client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  PanOnScrollMode,
  ReactFlowProvider,
  SelectionMode,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  useReactFlow,
} from "reactflow";
import { NodeResizer } from "@reactflow/node-resizer";
import "reactflow/dist/style.css";
import "@reactflow/node-resizer/dist/style.css";
import { useEffect, useCallback } from "react";
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
}

const nodeTypes = { service: ServiceNode, container: ContainerNode };

function CanvasFlow(props: CanvasProps) {
  const { nodes, edges, selectedNodeIds, onNodesChange, onEdgesChange, onDeleteNodes, fitViewTrigger, readOnly = false } = props;
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (fitViewTrigger > 0) {
      fitView({ padding: 0.2, duration: 400 });
    }
  }, [fitViewTrigger, fitView]);

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={readOnly ? undefined : handleNodesChange}
      onEdgesChange={readOnly ? undefined : handleEdgesChange}
      onNodesDelete={readOnly ? undefined : handleNodesDelete}
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
      <Controls className="bg-gray-800 border-gray-600" />
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
        }}
      />
      {!readOnly && <SelectionInfoBar count={selectedNodeIds.length} />}
    </ReactFlow>
  );
}

export default function Canvas(props: CanvasProps) {
  return (
    <div className="w-full h-full bg-gray-950">
      <ReactFlowProvider>
        <CanvasFlow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
