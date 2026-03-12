"use client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { useCallback } from "react";
import { colorForCategory } from "@/lib/categoryColors";

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
}

function NodeLabel({ data }: { data: { label: string; category: string } }) {
  const color = colorForCategory(data.category);
  return (
    <div
      className="px-3 py-2 rounded-lg text-white text-sm font-medium shadow-md min-w-[120px] text-center"
      style={{ backgroundColor: color }}
    >
      {data.label}
    </div>
  );
}

const nodeTypes = { custom: NodeLabel };

export default function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
}: CanvasProps) {
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => onNodesChange(changes),
    [onNodesChange]
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => onEdgesChange(changes),
    [onEdgesChange]
  );

  return (
    <div className="w-full h-full bg-gray-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={24} />
        <Controls className="bg-gray-800 border-gray-600" />
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
      </ReactFlow>
    </div>
  );
}
