"use client";

import { useEffect, useState, useCallback } from "react";
import { Node, Edge, NodeChange, EdgeChange, applyNodeChanges, applyEdgeChanges } from "reactflow";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import ApiKeyModal from "@/components/ApiKeyModal";
import wsClient from "@/lib/websocket";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

let nodeCounter = 0;
function autoPosition(index: number): { x: number; y: number } {
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 100 + col * 220, y: 100 + row * 140 };
}

export default function Home() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((e) => applyEdgeChanges(changes, e)),
    []
  );

  useEffect(() => {
    wsClient.connect();

    const unsubscribe = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;

      if (msg.type === "diagram_event" && msg.action === "add_node") {
        const id = msg.id as string;
        const label = msg.label as string;
        const category = (msg.category as string) ?? "compute";
        setNodes((prev) => {
          if (prev.find((n) => n.id === id)) return prev;
          const position = autoPosition(nodeCounter++);
          return [
            ...prev,
            {
              id,
              type: "custom",
              position,
              data: { label, category },
            },
          ];
        });
      }

      if (msg.type === "diagram_event" && msg.action === "add_edge") {
        const from = msg.from as string;
        const to = msg.to as string;
        const label = (msg.label as string) ?? "";
        const edgeId = `${from}-${to}`;
        setEdges((prev) => {
          if (prev.find((e) => e.id === edgeId)) return prev;
          return [
            ...prev,
            {
              id: edgeId,
              source: from,
              target: to,
              label,
              animated: true,
              style: { stroke: "#6b7280" },
            },
          ];
        });
      }

      if (msg.type === "chat_reply") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: msg.message as string },
        ]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  function handleSend(message: string) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    wsClient.send({
      type: "chat",
      message,
      api_key: "demo",
      provider: "anthropic",
    });
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <ApiKeyModal />

      {/* Chat panel — left */}
      <div className="w-80 flex-shrink-0">
        <Chat onSend={handleSend} messages={messages} />
      </div>

      {/* Canvas — centre/right */}
      <div className="flex-1 overflow-hidden">
        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
        />
      </div>
    </div>
  );
}
