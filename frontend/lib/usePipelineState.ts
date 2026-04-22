import { useState } from "react";
import {
  type AgentLogEntry,
  type DebugEvent,
  type TerraformProgress,
} from "./useCanvasPipeline";
import type { CanvasMessage, CostBreakdown } from "./projects";
import type { TerraformFile } from "@/components/OutputPanel";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import { INITIAL_BUDGET_RETRY_STATE, type BudgetRetryState } from "./budgetRetry";
import { emptySetupPdfState, type SetupPdfState } from "./setupPdf";
import type { GenerationAgentState } from "./generationObservability";
import type { ConnectionState } from "./websocket";

export type PipelineState = {
  messages: CanvasMessage[];
  setMessages: React.Dispatch<React.SetStateAction<CanvasMessage[]>>;
  pendingChatPlanId: string | null;
  setPendingChatPlanId: React.Dispatch<React.SetStateAction<string | null>>;
  pipelineStatus: string | null;
  setPipelineStatus: React.Dispatch<React.SetStateAction<string | null>>;
  pipelineErrorCode: string | null;
  setPipelineErrorCode: React.Dispatch<React.SetStateAction<string | null>>;
  terraformFiles: TerraformFile[];
  setTerraformFiles: React.Dispatch<React.SetStateAction<TerraformFile[]>>;
  archDescription: ArchDescription | null;
  setArchDescription: React.Dispatch<React.SetStateAction<ArchDescription | null>>;
  costEstimate: CostBreakdown | null;
  setCostEstimate: React.Dispatch<React.SetStateAction<CostBreakdown | null>>;
  isChatStreaming: boolean;
  setIsChatStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  streamingAssistantReply: string;
  setStreamingAssistantReply: React.Dispatch<React.SetStateAction<string>>;
  isGenerating: boolean;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  agentLogs: AgentLogEntry[];
  setAgentLogs: React.Dispatch<React.SetStateAction<AgentLogEntry[]>>;
  generationAgents: GenerationAgentState[] | null;
  setGenerationAgents: React.Dispatch<React.SetStateAction<GenerationAgentState[] | null>>;
  architectureAgents: GenerationAgentState[] | null;
  setArchitectureAgents: React.Dispatch<React.SetStateAction<GenerationAgentState[] | null>>;
  generationElapsed: number;
  setGenerationElapsed: React.Dispatch<React.SetStateAction<number>>;
  generationStartedAt: number | null;
  setGenerationStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  wsState: ConnectionState;
  setWsState: React.Dispatch<React.SetStateAction<ConnectionState>>;
  statusTicker: string[];
  setStatusTicker: React.Dispatch<React.SetStateAction<string[]>>;
  debugEvents: DebugEvent[];
  setDebugEvents: React.Dispatch<React.SetStateAction<DebugEvent[]>>;
  currentStage: string | null;
  setCurrentStage: React.Dispatch<React.SetStateAction<string | null>>;
  traceId: string | null;
  setTraceId: React.Dispatch<React.SetStateAction<string | null>>;
  lastEventAt: number | null;
  setLastEventAt: React.Dispatch<React.SetStateAction<number | null>>;
  budgetRetryState: BudgetRetryState;
  setBudgetRetryState: React.Dispatch<React.SetStateAction<BudgetRetryState>>;
  setupPdfState: SetupPdfState;
  setSetupPdfState: React.Dispatch<React.SetStateAction<SetupPdfState>>;
  terraformOutdated: boolean;
  setTerraformOutdated: React.Dispatch<React.SetStateAction<boolean>>;
  terraformProgress: TerraformProgress;
  setTerraformProgress: React.Dispatch<React.SetStateAction<TerraformProgress>>;
  manualTerraformRunState: "idle" | "running" | "completed" | "failed";
  setManualTerraformRunState: React.Dispatch<React.SetStateAction<"idle" | "running" | "completed" | "failed">>;
};

export function usePipelineState(): PipelineState {
  const [messages, setMessages] = useState<CanvasMessage[]>([]);
  const [pendingChatPlanId, setPendingChatPlanId] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [pipelineErrorCode, setPipelineErrorCode] = useState<string | null>(null);
  const [terraformFiles, setTerraformFiles] = useState<TerraformFile[]>([]);
  const [archDescription, setArchDescription] = useState<ArchDescription | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostBreakdown | null>(null);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [streamingAssistantReply, setStreamingAssistantReply] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [generationAgents, setGenerationAgents] = useState<GenerationAgentState[] | null>(null);
  const [architectureAgents, setArchitectureAgents] = useState<GenerationAgentState[] | null>(null);
  const [generationElapsed, setGenerationElapsed] = useState<number>(0);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [wsState, setWsState] = useState<ConnectionState>("idle");
  const [statusTicker, setStatusTicker] = useState<string[]>([]);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [budgetRetryState, setBudgetRetryState] = useState<BudgetRetryState>(INITIAL_BUDGET_RETRY_STATE);
  const [setupPdfState, setSetupPdfState] = useState<SetupPdfState>(emptySetupPdfState());
  const [terraformOutdated, setTerraformOutdated] = useState(false);
  const [terraformProgress, setTerraformProgress] = useState<TerraformProgress>({
    status: "idle",
    activity: null,
    emittedCount: 0,
    expectedMinFiles: 4,
    currentFile: null,
    lastUpdateAt: null,
  });
  const [manualTerraformRunState, setManualTerraformRunState] = useState<"idle" | "running" | "completed" | "failed">("idle");

  return {
    messages, setMessages,
    pendingChatPlanId, setPendingChatPlanId,
    pipelineStatus, setPipelineStatus,
    pipelineErrorCode, setPipelineErrorCode,
    terraformFiles, setTerraformFiles,
    archDescription, setArchDescription,
    costEstimate, setCostEstimate,
    isChatStreaming, setIsChatStreaming,
    streamingAssistantReply, setStreamingAssistantReply,
    isGenerating, setIsGenerating,
    agentLogs, setAgentLogs,
    generationAgents, setGenerationAgents,
    architectureAgents, setArchitectureAgents,
    generationElapsed, setGenerationElapsed,
    generationStartedAt, setGenerationStartedAt,
    wsState, setWsState,
    statusTicker, setStatusTicker,
    debugEvents, setDebugEvents,
    currentStage, setCurrentStage,
    traceId, setTraceId,
    lastEventAt, setLastEventAt,
    budgetRetryState, setBudgetRetryState,
    setupPdfState, setSetupPdfState,
    terraformOutdated, setTerraformOutdated,
    terraformProgress, setTerraformProgress,
    manualTerraformRunState, setManualTerraformRunState,
  };
}
