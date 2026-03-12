"use client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import "@reactflow/node-resizer/dist/style.css";
import { useEffect, useCallback } from "react";
import { colorForCategory } from "@/lib/categoryColors";
import ServiceNode from "@/components/Canvas/ServiceNode";
import ContainerNode from "@/components/Canvas/ContainerNode";

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  fitViewTrigger: number;
}

const nodeTypes = { service: ServiceNode, container: ContainerNode };

import { NodeResizer } from "@reactflow/node-resizer";
import "@reactflow/node-resizer/dist/style.css";

function CanvasFlow(props: CanvasProps) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (props.fitViewTrigger > 0) {
      fitView({ padding: 0.2, duration: 400 });
    }
  }, [props.fitViewTrigger, fitView]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => props.onNodesChange(changes),
    [props.onNodesChange]
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => props.onEdgesChange(changes),
    [props.onEdgesChange]
  );

  return (
    <ReactFlow
      nodes={props.nodes}
      edges={props.edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#374151" gap={24} />
      <Controls className="bg-gray-800 border-gray-600" />
      {props.nodes.find(n => n.type === 'container' && n.selected) && (
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
