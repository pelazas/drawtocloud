import { useEffect, useRef, useState } from "react";
import { useDiagramState } from "@/lib/useDiagramState";
import wsClient from "@/lib/websocket";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TerraformFile, CostEstimate } from "@/components/OutputPanel";
import { ArchDescription } from "@/components/ArchDescriptionViewer";
import { CanvasMessage, CanvasSession } from "@/lib/projects";

export type AgentLogEntry = {
  id: number;
  agent: "requirements" | "architect" | "coder" | "cost_analyst" | "description";
  message: string;
  elapsed: number;
};

async function withAccessToken(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return {
    ...payload,
    access_token: data.session?.access_token,
  };
}

export function useCanvasPipeline(
  appState: "dashboard" | "questionnaire" | "canvas",
  canvasSession: CanvasSession | null,
  onGenerationComplete?: () => void | Promise<void>,
  onProjectReady?: (projectId: string, shareSlug: string | null) => void
) {
  const diagram = useDiagramState();
  const { reset, applyLayout, handleDiagramEvent, hydrate } = diagram;

  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [terraformFiles, setTerraformFiles] = useState<TerraformFile[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [archDescription, setArchDescription] = useState<ArchDescription | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [generationElapsed, setGenerationElapsed] = useState<number>(0);
  const generationStartRef = useRef<number>(0);

  useEffect(() => {
    if (appState !== "canvas" || !canvasSession) return;

    reset();
    setPipelineStatus(null);
    setTerraformFiles([]);
    setCostEstimate(null);
    setArchDescription(null);
    setAgentLogs([]);
    setGenerationElapsed(0);

    wsClient.connect();

    if (canvasSession.mode === "new") {
      setMessages([]);
      setIsGenerating(true);
      generationStartRef.current = Date.now();

      wsClient.onOpen(() => {
        void (async () => {
          const payload = await withAccessToken({
            type: "start_generation",
            answers: canvasSession.answers,
            project_id: canvasSession.projectId ?? undefined,
          });
          wsClient.send(payload);
        })();
      });
    } else {
      setIsGenerating(false);
      setPipelineStatus("Loaded saved project");
      setMessages(canvasSession.project.chatHistory);
      setTerraformFiles(canvasSession.project.terraformFiles);
      setCostEstimate(canvasSession.project.costEstimate);
      hydrate(canvasSession.project.nodes, canvasSession.project.edges);
    }

    const unsubscribe = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;

      if (msg.type === "status") setPipelineStatus(msg.message as string);

      if (msg.type === "project_ready") {
        const projectId = msg.project_id;
        const shareSlug = msg.share_slug;
        if (typeof projectId === "string") {
          onProjectReady?.(projectId, typeof shareSlug === "string" ? shareSlug : null);
        }
      }

      if (msg.type === "done") {
        setIsGenerating(false);
        setPipelineStatus("Architecture ready ✓");
        setGenerationElapsed((Date.now() - generationStartRef.current) / 1000);
        applyLayout();

        if (canvasSession.mode === "new" && onGenerationComplete) {
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

      if (msg.type === "terraform_file") {
        setTerraformFiles((prev) => [...prev, msg as unknown as TerraformFile]);
      }

      if (msg.type === "cost_estimate") {
        setCostEstimate((msg as { type: string; data: CostEstimate }).data);
      }

      if (msg.type === "arch_description") {
        setArchDescription((msg as { type: string; sections: ArchDescription }).sections);
      }

      if (msg.type === "diagram_event") {
        handleDiagramEvent(msg);
      }

      if (msg.type === "chat_reply") {
        setMessages((prev) => [...prev, { role: "assistant", content: msg.message as string }]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [appState, canvasSession, onGenerationComplete, onProjectReady, reset, applyLayout, handleDiagramEvent, hydrate]);

  function handleSend(message: string) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    const projectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId;
    void (async () => {
      const payload = await withAccessToken({ type: "chat", message, project_id: projectId ?? undefined });
      wsClient.send(payload);
    })();
  }

  return {
    ...diagram,
    messages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    archDescription,
    isGenerating,
    agentLogs,
    generationElapsed,
    handleSend,
  };
}
