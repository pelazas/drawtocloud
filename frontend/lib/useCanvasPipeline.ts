import { useEffect, useState, useCallback } from "react";
import { Node, Edge, NodeChange, EdgeChange, applyNodeChanges, applyEdgeChanges } from "reactflow";
import wsClient from "@/lib/websocket";
import { TerraformFile, CostEstimate } from "@/components/OutputPanel";

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

export function useCanvasPipeline(
  appState: "questionnaire" | "canvas",
  questionnaireAnswers: Record<string, string | string[]>
) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [terraformFiles, setTerraformFiles] = useState<TerraformFile[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((e) => applyEdgeChanges(changes, e)),
    []
  );

  useEffect(() => {
    if (appState !== "canvas") return;

    // Reset canvas for fresh generation
    nodeCounter = 0;
    setNodes([]);
    setEdges([]);
    setPipelineStatus(null);
    setTerraformFiles([]);
    setCostEstimate(null);
    setIsGenerating(true);

    wsClient.connect();

    wsClient.onOpen(() => {
      wsClient.send({ type: "start_generation", answers: questionnaireAnswers });
    });

    const unsubscribe = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;

      if (msg.type === "status") {
        setPipelineStatus(msg.message as string);
      }
      if (msg.type === "done") {
        setIsGenerating(false);
        setPipelineStatus("Architecture ready ✓");
      }
      if (msg.type === "error") {
        setPipelineStatus(`Error: ${msg.message as string}`);
      }

      if (msg.type === "terraform_file") {
        setTerraformFiles((prev) => [...prev, msg as unknown as TerraformFile]);
      }
      if (msg.type === "cost_estimate") {
        setCostEstimate((msg as { type: string; data: CostEstimate }).data);
      }

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
  }, [appState]);

  function handleSend(message: string) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    wsClient.send({ type: "chat", message });
  }

  return {
    nodes,
    edges,
    messages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    isGenerating,
    onNodesChange,
    onEdgesChange,
    handleSend,
  };
}
