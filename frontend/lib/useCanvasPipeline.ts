import { useEffect, useState, useRef } from "react";
import { useDiagramState } from "@/lib/useDiagramState";
import wsClient from "@/lib/websocket";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TerraformFile, CostEstimate } from "@/components/OutputPanel";
import { ArchDescription } from "@/components/ArchDescriptionViewer";

export type AgentLogEntry = {
  id: number;
  agent: "requirements" | "architect" | "coder" | "cost_analyst" | "description";
  message: string;
  elapsed: number;
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

async function withAccessToken(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return {
    ...payload,
    access_token: data.session?.access_token,
  };
}

export function useCanvasPipeline(
  appState: "questionnaire" | "canvas",
  questionnaireAnswers: Record<string, string | string[]>,
  onGenerationComplete?: () => void | Promise<void>
) {
  const diagram = useDiagramState();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [terraformFiles, setTerraformFiles] = useState<TerraformFile[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [archDescription, setArchDescription] = useState<ArchDescription | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [generationElapsed, setGenerationElapsed] = useState<number>(0);
  const generationStartRef = useRef<number>(0);

  useEffect(() => {
    if (appState !== "canvas") return;

    diagram.reset();
    setPipelineStatus(null);
    setTerraformFiles([]);
    setCostEstimate(null);
    setArchDescription(null);
    setIsGenerating(true);
    setAgentLogs([]);
    generationStartRef.current = Date.now();

    wsClient.connect();
    wsClient.onOpen(() => {
      void (async () => {
        const payload = await withAccessToken({
          type: "start_generation",
          answers: questionnaireAnswers,
        });
        wsClient.send(payload);
      })();
    });

    const unsubscribe = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;

      if (msg.type === "status") setPipelineStatus(msg.message as string);
      if (msg.type === "done") {
        setIsGenerating(false);
        setPipelineStatus("Architecture ready ✓");
        setGenerationElapsed((Date.now() - generationStartRef.current) / 1000);
        diagram.applyLayout();
        if (onGenerationComplete) {
          void onGenerationComplete();
        }
      }
      if (msg.type === "error") {
        setIsGenerating(false);
        setPipelineStatus(`Error: ${msg.message as string}`);
      }
      if (msg.type === "agent_log") {
        setAgentLogs((prev) => {
          const entry: AgentLogEntry = {
            id: Date.now() + Math.random(),
            agent: msg.agent as AgentLogEntry["agent"],
            message: msg.message as string,
            elapsed: msg.elapsed as number,
          };
          return [...prev, entry].slice(-50);
        });
      }
      if (msg.type === "terraform_file") setTerraformFiles((prev) => [...prev, msg as unknown as TerraformFile]);
      if (msg.type === "cost_estimate") setCostEstimate((msg as { type: string; data: CostEstimate }).data);
      if (msg.type === "arch_description") setArchDescription((msg as { type: string; sections: ArchDescription }).sections);
      if (msg.type === "diagram_event") diagram.handleDiagramEvent(msg);
      if (msg.type === "chat_reply") setMessages((prev) => [...prev, { role: "assistant", content: msg.message as string }]);
    });

    return () => { unsubscribe(); };
  }, [appState, onGenerationComplete]);

  function handleSend(message: string) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    void (async () => {
      const payload = await withAccessToken({ type: "chat", message });
      wsClient.send(payload);
    })();
  }

  return {
    ...diagram,
    messages, pipelineStatus, terraformFiles, costEstimate, archDescription,
    isGenerating, agentLogs, generationElapsed, handleSend,
  };
}
