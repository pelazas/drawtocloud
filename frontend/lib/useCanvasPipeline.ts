import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDiagramState } from "@/lib/useDiagramState";
import wsClient, { ConnectionState } from "@/lib/websocket";
import { isQuotaExceededError, startGenerationViaHttp, withAccessToken } from "@/lib/generationStart";
import {
  INITIAL_BUDGET_RETRY_STATE,
  type BudgetRetryState,
  reduceBudgetRetryState,
} from "@/lib/budgetRetry";
import { TerraformFile } from "@/components/OutputPanel";
import { ArchDescription } from "@/components/ArchDescriptionViewer";
import { CanvasMessage, CanvasSession, CostBreakdown, PersistedProject, QuestionnaireAnswers } from "@/lib/projects";
import {
  emptySetupPdfState,
  fetchSetupPdfDownloadUrl,
  generateSetupPdf,
  SetupPdfState,
  SetupPdfStatus,
} from "@/lib/setupPdf";
import type { GraphMutationPayload } from "@/lib/graphDiff";
import type { TemplateDetail } from "@/lib/templates";
import { resolveGenerationProjectId } from "./generationSession";
import { shouldApplyLayoutOnPipelineEvent } from "./pipelineLayout";
import { projectHydrationSnapshot, mergeTerraformFiles, shouldHydrateFromProject, getManualTerraformRunStateFromSnapshot } from "./canvasHydration";
import { createProject, saveSnapshot } from "./projectApi";
import { ensureChatProjectContext, projectContextFromSession, type ChatProjectBootstrapState } from "./chatProjectContext";
import { buildChatPayload, buildGenerateTerraformPayload, pipelineErrorToastMessage } from "./pipelineWsPayloads";
import { hasArchitecture, planChatSend } from "./canvasInteractionGuards";
import { shouldHydrateGenerationSnapshot } from "./generationSnapshotHydration";
import {
  buildBudgetCapRecoveryAssistantMessage,
  parseBudgetRecoveryMetadata,
  parseBudgetCapRecoveryDetails,
  parseGenerationSnapshotHydration,
} from "./budgetCapRecovery";
import { clearTransientChatErrorStatus } from "./chatPipelineStatus";
import type { GenerationAgentState } from "./generationObservability";
import { parseGenerationAgentUpdate, parseGenerationAgentsFromSnapshot, parseGenerationAgentEvent, reduceGenerationAgentEvent, mergeCodeGenerationAgents } from "./generationObservability";

export type AgentLogEntry = {
  id: number;
  agent: "requirements" | "architect" | "coder" | "description";
  message: string;
  elapsed: number;
};

export type DebugEvent = {
  id: number;
  ts: number;
  level: "info" | "warning" | "error";
  source: "ws" | "pipeline" | "local";
  stage: string | null;
  message: string;
  traceId: string | null;
  details?: Record<string, unknown>;
};

export type TerraformProgress = {
  status: "idle" | "planning" | "requesting" | "generating" | "finalizing" | "completed" | "failed";
  activity: string | null;
  emittedCount: number;
  expectedMinFiles: number;
  currentFile: string | null;
  lastUpdateAt: number | null;
};

type CanvasPipelineOptions = {
  liveSession?: boolean;
  readOnly?: boolean;
};

const STALL_THRESHOLD_MS = 15_000;
const TERRAFORM_EXPECTED_MIN_FILES = 4;
const TEMPLATE_ESTIMATE_REQUEST_TIMEOUT_MS = 15_000;
const CHAT_RESPONSE_TIMEOUT_MS = 25_000;

function normalizeSetupPdfStatus(value: unknown): SetupPdfStatus {
  if (value === "none" || value === "generating" || value === "ready" || value === "failed" || value === "outdated") {
    return value;
  }
  return "none";
}

function setupPdfStateFromProject(project: PersistedProject): SetupPdfState {
  return {
    status: normalizeSetupPdfStatus(project.setupPdfStatus),
    progress: Math.max(0, Math.min(100, Math.round(project.setupPdfProgress ?? 0))),
    error: project.setupPdfError,
    generatedAt: project.setupPdfGeneratedAt,
    sourceRevision: project.setupPdfSourceRevision,
  };
}

function upsertTerraformFile(existing: TerraformFile[], incoming: TerraformFile): TerraformFile[] {
  const index = existing.findIndex((file) => file.filename === incoming.filename);
  if (index === -1) {
    return [...existing, incoming];
  }

  const next = [...existing];
  next[index] = incoming;
  return next;
}

function parseIncomingCostEstimate(message: Record<string, unknown>): CostBreakdown | null {
  if (typeof message.region !== "string" || !message.region.trim()) return null;
  if (typeof message.monthly_total !== "number" || !Number.isFinite(message.monthly_total)) return null;
  if (!Array.isArray(message.items)) return null;

  const items = message.items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .flatMap((item) => {
      const nodeId = typeof item.node_id === "string" ? item.node_id.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const cost = typeof item.cost === "number" && Number.isFinite(item.cost) ? item.cost : null;
      if (!nodeId || !label || cost === null) return [];
      const expectedCost =
        typeof item.expected_cost === "number" && Number.isFinite(item.expected_cost) ? item.expected_cost : null;
      const estimated = item.estimated === true;
      const unpriced = item.unpriced === true;
      const instanceType = typeof item.instance_type === "string" && item.instance_type.trim() ? item.instance_type.trim() : undefined;
      return [
        {
          node_id: nodeId,
          label,
          cost,
          ...(expectedCost !== null ? { expected_cost: expectedCost } : {}),
          estimated,
          ...(unpriced ? { unpriced: true } : {}),
          ...(instanceType ? { instance_type: instanceType } : {}),
        },
      ];
    });

  const costEstimate: CostBreakdown = {
    region: message.region.trim(),
    monthly_total: message.monthly_total,
    items,
  };

  if (typeof message.budget_cap === "number" && Number.isFinite(message.budget_cap)) {
    costEstimate.budget_cap = message.budget_cap;
  }
  if (typeof message.monthly_budget === "number" && Number.isFinite(message.monthly_budget)) {
    costEstimate.monthly_budget = message.monthly_budget;
  }
  if (typeof message.over_budget === "boolean") {
    costEstimate.over_budget = message.over_budget;
  }
  if (
    typeof message.scenarios === "object" &&
    message.scenarios !== null &&
    typeof (message.scenarios as { baseline_total?: unknown }).baseline_total === "number" &&
    typeof (message.scenarios as { expected_total?: unknown }).expected_total === "number" &&
    typeof (message.scenarios as { peak_total?: unknown }).peak_total === "number"
  ) {
    costEstimate.scenarios = {
      baseline_total: (message.scenarios as { baseline_total: number }).baseline_total,
      expected_total: (message.scenarios as { expected_total: number }).expected_total,
      peak_total: (message.scenarios as { peak_total: number }).peak_total,
    };
  }

  return costEstimate;
}

function inferPipelineErrorCode(
  payload: Record<string, unknown>,
  fallbackMessage?: string | null
): string | null {
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  const budgetRecovery = parseBudgetRecoveryMetadata(payload);
  if (budgetRecovery?.status === "pending") {
    return "budget_cap_unmet";
  }
  const normalizedMessage = typeof fallbackMessage === "string" ? fallbackMessage.trim().toLowerCase() : "";
  if (normalizedMessage.includes("budget hard cap unmet")) {
    return "budget_cap_unmet";
  }
  return null;
}

function removeNodeFromCostEstimate(
  current: CostBreakdown | null,
  nodeId: string
): CostBreakdown | null {
  if (!current) return current;
  const trimmedNodeId = nodeId.trim();
  if (!trimmedNodeId) return current;

  const items = current.items.filter((item) => item.node_id !== trimmedNodeId);
  if (items.length === current.items.length) return current;

  const monthlyTotal = items.reduce((sum, item) => sum + item.cost, 0);
  return {
    ...current,
    items,
    monthly_total: Math.round(monthlyTotal * 100) / 100,
  };
}

function hasInvalidNodePositions(nodes: { position?: { x?: unknown; y?: unknown } }[]): boolean {
  if (nodes.length === 0) return false;

  let allZero = true;
  for (const node of nodes) {
    const x = Number(node.position?.x);
    const y = Number(node.position?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
    if (x !== 0 || y !== 0) allZero = false;
  }

  return allZero;
}

function getSessionKey(canvasSession: CanvasSession): string {
  if (canvasSession.mode === "existing") {
    return `existing:${canvasSession.project.id}`;
  }

  return `${canvasSession.mode}:${canvasSession.projectId ?? "none"}:${JSON.stringify(canvasSession.answers)}`;
}

function latestPendingChatPlanId(messages: CanvasMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const planMeta = msg.planMeta;
    if (!planMeta || (planMeta.type !== "architecture_refactor" && planMeta.type !== "node_patch") || !planMeta.plan_id) continue;
    const status = planMeta.status ?? "";
    if (status === "pending") return planMeta.plan_id;
    if (status === "approved" || status === "executed" || status === "rejected" || status === "cancelled") {
      return null;
    }
  }
  return null;
}

function requestedChangeForPlan(messages: CanvasMessage[], planId: string): string | null {
  const normalizedPlanId = planId.trim();
  if (!normalizedPlanId) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const planMeta = msg.planMeta;
    if (!planMeta || planMeta.type !== "architecture_refactor") continue;
    if (planMeta.plan_id !== normalizedPlanId) continue;
    const requestedChange = typeof planMeta.requested_change === "string" ? planMeta.requested_change.trim() : "";
    if (requestedChange) return requestedChange;
  }
  return null;
}

export function useCanvasPipeline(
  appState: "dashboard" | "questionnaire" | "canvas",
  canvasSession: CanvasSession | null,
  onGenerationComplete?: () => void | Promise<void>,
  onProjectReady?: (projectId: string, shareSlug: string | null) => void,
  options?: CanvasPipelineOptions
) {
  const diagram = useDiagramState();
  const { reset, applyLayout, handleDiagramEvent, hydrate, applyGraphMutation } = diagram;
  const liveSession = options?.liveSession ?? false;
  const readOnly = options?.readOnly ?? false;

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
    expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
    currentFile: null,
    lastUpdateAt: null,
  });
  const [manualTerraformRunState, setManualTerraformRunState] = useState<"idle" | "running" | "completed" | "failed">("idle");

  const generationStartRef = useRef<number>(0);
  const generationStartedAtRef = useRef<number | null>(null);
  const isGeneratingRef = useRef(false);
  const activeSessionKeyRef = useRef<string | null>(null);
  const generationRequestKeyRef = useRef<string | null>(null);
  const subscribedProjectRef = useRef<string | null>(null);
  const desiredProjectSubscriptionRef = useRef<string | null>(null);
  const wsStateRef = useRef<ConnectionState>("idle");
  const latestCanvasShapeRef = useRef<{ nodeCount: number; edgeCount: number }>({ nodeCount: 0, edgeCount: 0 });
  const lastHydratedUpdatedAtRef = useRef<string | null>(null);
  const stallWarnedRef = useRef(false);
  const pendingTemplateEstimateRequestIdRef = useRef<string | null>(null);
  const pendingTemplateEstimateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatResponseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const templateEstimateRequestSeqRef = useRef(0);
  const streamingReplyRef = useRef("");
  const messagesRef = useRef<CanvasMessage[]>([]);
  const architectureAgentsRef = useRef<GenerationAgentState[] | null>(null);
  const chatProjectBootstrapRef = useRef<ChatProjectBootstrapState>({
    context: null,
    pending: null,
  });

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    architectureAgentsRef.current = architectureAgents;
  }, [architectureAgents]);

  useEffect(() => {
    if (!isGenerating || generationStartedAtRef.current === null) {
      return;
    }
    const tick = () => {
      const start = generationStartedAtRef.current;
      if (start !== null) {
        setGenerationElapsed(Math.floor((Date.now() - start) / 1000));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isGenerating, generationStartedAt]);

  useEffect(() => {
    latestCanvasShapeRef.current = {
      nodeCount: diagram.nodes.length,
      edgeCount: diagram.edges.length,
    };
  }, [diagram.nodes.length, diagram.edges.length]);

  useEffect(() => {
    if (projectContextFromSession(canvasSession) || appState === "canvas") {
      chatProjectBootstrapRef.current = { context: null, pending: null };
    }
  }, [appState, canvasSession]);

  const clearPendingTemplateEstimateRequest = useCallback(() => {
    pendingTemplateEstimateRequestIdRef.current = null;
    if (pendingTemplateEstimateTimeoutRef.current !== null) {
      clearTimeout(pendingTemplateEstimateTimeoutRef.current);
      pendingTemplateEstimateTimeoutRef.current = null;
    }
  }, []);

  const startPendingTemplateEstimateRequest = useCallback(
    (requestId: string) => {
      clearPendingTemplateEstimateRequest();
      pendingTemplateEstimateRequestIdRef.current = requestId;
      pendingTemplateEstimateTimeoutRef.current = setTimeout(() => {
        if (pendingTemplateEstimateRequestIdRef.current === requestId) {
          pendingTemplateEstimateRequestIdRef.current = null;
        }
        pendingTemplateEstimateTimeoutRef.current = null;
      }, TEMPLATE_ESTIMATE_REQUEST_TIMEOUT_MS);
    },
    [clearPendingTemplateEstimateRequest]
  );

  const clearChatResponseTimeout = useCallback(() => {
    if (chatResponseTimeoutRef.current !== null) {
      clearTimeout(chatResponseTimeoutRef.current);
      chatResponseTimeoutRef.current = null;
    }
  }, []);

  const resetChatStreamingState = useCallback(() => {
    setIsChatStreaming(false);
    setStreamingAssistantReply("");
    streamingReplyRef.current = "";
  }, []);

  const failChatRequest = useCallback(
    (message = "Generation failed. Try again later", errorCode: string | null = "chat_failed") => {
      clearChatResponseTimeout();
      resetChatStreamingState();
      setIsGenerating(false);
      setPipelineStatus(`Error: ${message}`);
      setPipelineErrorCode(errorCode);
      setLastEventAt(Date.now());
    },
    [clearChatResponseTimeout, resetChatStreamingState]
  );

  const armChatResponseTimeout = useCallback(() => {
    clearChatResponseTimeout();
    chatResponseTimeoutRef.current = setTimeout(() => {
      failChatRequest();
    }, CHAT_RESPONSE_TIMEOUT_MS);
  }, [clearChatResponseTimeout, failChatRequest]);

  const pushTicker = useCallback((message: string) => {
    setStatusTicker((prev) => [...prev, message].slice(-20));
  }, []);

  const pushDebugEvent = useCallback((event: Omit<DebugEvent, "id">) => {
    setDebugEvents((prev) => [...prev, { ...event, id: Date.now() + Math.random() }].slice(-200));
  }, []);

  const recordDebugEvent = useCallback(
    (
      message: string,
      options?: {
        level?: DebugEvent["level"];
        stage?: string | null;
        details?: Record<string, unknown>;
      }
    ) => {
      pushDebugEvent({
        ts: Date.now(),
        level: options?.level ?? "info",
        source: "local",
        stage: options?.stage ?? currentStage,
        message,
        traceId,
        details: options?.details,
      });
    },
    [currentStage, pushDebugEvent, traceId]
  );

  const subscribeProject = useCallback(async (projectId: string) => {
    const payload = await withAccessToken({ type: "subscribe_project", project_id: projectId });
    const sent = wsClient.send(payload);
    if (sent) {
      subscribedProjectRef.current = projectId;
    }
  }, []);

  const queueProjectSubscription = useCallback(
    (projectId: string | null) => {
      desiredProjectSubscriptionRef.current = projectId;
      if (!projectId) return;
      void subscribeProject(projectId);
    },
    [subscribeProject]
  );

  useEffect(() => {
    return () => {
      clearPendingTemplateEstimateRequest();
      clearChatResponseTimeout();
    };
  }, [clearPendingTemplateEstimateRequest, clearChatResponseTimeout]);

  useEffect(() => {
    if (appState !== "canvas" || !canvasSession) {
      desiredProjectSubscriptionRef.current = null;
      return;
    }

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

    if (readOnly && canvasSession.mode === "existing") {
      desiredProjectSubscriptionRef.current = null;
      if (isFreshSession || canvasSession.project.updatedAt !== lastHydratedUpdatedAtRef.current) {
        const snapshot = projectHydrationSnapshot(canvasSession.project);
        setMessages(snapshot.chatHistory);
        setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
        setTerraformFiles(snapshot.terraformFiles);
        setArchDescription(snapshot.archDescription);
        setCostEstimate(snapshot.costEstimate);
        setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
        clearChatResponseTimeout();
        resetChatStreamingState();
        hydrate(snapshot.nodes, snapshot.edges);
        if (hasInvalidNodePositions(snapshot.nodes)) {
          applyLayout();
        }
        lastHydratedUpdatedAtRef.current = snapshot.updatedAt;
      }

      setTraceId(canvasSession.project.generationTraceId);
      setCurrentStage(canvasSession.project.generationStage);
      setLastEventAt(canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now());
      if (canvasSession.project.generationStage === "budget_retry") {
        setBudgetRetryState((prev) =>
          reduceBudgetRetryState(prev, {
            stage: "budget_retry",
            event: null,
            message: "Budget optimization retry is running.",
            traceId: canvasSession.project.generationTraceId,
            timestamp: Date.now(),
          })
        );
      } else if (isFreshSession) {
        setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
      }

      const generationActive =
        canvasSession.project.generationStatus === "queued" ||
        canvasSession.project.generationStatus === "running";
      if (generationActive) {
        setIsGenerating(true);
        setPipelineStatus("Shared project is still generating...");
        setPipelineErrorCode(null);
        setTerraformProgress((prev) => ({
          ...prev,
          status: "generating",
          activity: canvasSession.project.generationStage
            ? `Running ${canvasSession.project.generationStage}`
            : "Generation running",
          emittedCount: canvasSession.project.terraformFiles.length,
          expectedMinFiles: Math.max(prev.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
          currentFile: null,
          lastUpdateAt: canvasSession.project.lastEventAt
            ? Date.parse(canvasSession.project.lastEventAt)
            : Date.now(),
        }));
      } else {
        setIsGenerating(false);
        setPipelineStatus("Viewing shared project");
        if (canvasSession.project.generationStatus === "failed") {
          setPipelineErrorCode(
            inferPipelineErrorCode(
              { generation_error: canvasSession.project.generationError },
              canvasSession.project.generationError
            )
          );
        } else {
          setPipelineErrorCode(null);
        }
        setTerraformProgress((prev) => ({
          ...prev,
          status: canvasSession.project.terraformFiles.length > 0 ? "completed" : "idle",
          activity: canvasSession.project.terraformFiles.length > 0 ? "Terraform ready" : null,
          emittedCount: canvasSession.project.terraformFiles.length,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
      }

      return;
    }

    wsClient.connect();

    const unsubscribeConnection = wsClient.onConnectionState((state) => {
      wsStateRef.current = state;
      setWsState(state);
      pushDebugEvent({
        ts: Date.now(),
        level: state === "error" ? "error" : "info",
        source: "ws",
        stage: currentStage,
        message: `WebSocket state: ${state}`,
        traceId,
      });

      if (state !== "open") {
        subscribedProjectRef.current = null;
        return;
      }

      const desiredProjectId = desiredProjectSubscriptionRef.current;
      if (desiredProjectId && desiredProjectId !== subscribedProjectRef.current) {
        void subscribeProject(desiredProjectId);
      }
    });

    if (canvasSession.mode === "new") {
      if (isFreshSession) {
        reset();
        setPipelineStatus("Starting generation...");
        setPipelineErrorCode(null);
        setMessages([]);
        messagesRef.current = [];
        setTerraformFiles([]);
        setArchDescription(null);
        setCostEstimate(null);
        clearChatResponseTimeout();
        resetChatStreamingState();
        setAgentLogs([]);
        setGenerationElapsed(0);
        setGenerationStartedAt(null);
        generationStartedAtRef.current = null;
        setStatusTicker([]);
        setDebugEvents([]);
        setCurrentStage("start");
        setTraceId(null);
        setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
        setSetupPdfState(emptySetupPdfState());
        setTerraformProgress({
          status: "planning",
          activity: "Planning Terraform files",
          emittedCount: 0,
          expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
          currentFile: null,
          lastUpdateAt: Date.now(),
        });
        setIsGenerating(true);
        generationStartRef.current = Date.now();
        setLastEventAt(Date.now());
        stallWarnedRef.current = false;
      }

      void (async () => {
        if (generationRequestKeyRef.current === sessionKey) return;
        generationRequestKeyRef.current = sessionKey;

        try {
          const result = await startGenerationViaHttp(canvasSession.answers, canvasSession.projectId ?? undefined);
          setTraceId(result.trace_id);
          setCurrentStage("queued");
          setPipelineStatus("Generation queued...");
          setPipelineErrorCode(null);
          pushTicker("queued");
          setTerraformProgress((prev) => ({
            ...prev,
            status: "planning",
            activity: "Queued for generation",
            lastUpdateAt: Date.now(),
          }));
          pushDebugEvent({
            ts: Date.now(),
            level: "info",
            source: "pipeline",
            stage: "queued",
            message: `Generation started (trace ${result.trace_id})`,
            traceId: result.trace_id,
          });

          if (result.project_id) {
            queueProjectSubscription(result.project_id);
          }

          onProjectReady?.(result.project_id, result.share_slug);
        } catch (error) {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${(error as Error).message}`);
          setPipelineErrorCode("generation_start_failed");
          pushTicker("error");
          pushDebugEvent({
            ts: Date.now(),
            level: "error",
            source: "pipeline",
            stage: "start",
            message: (error as Error).message,
            traceId: traceId,
          });
        }
      })();
    } else {
      const generationActive =
        canvasSession.project.generationStatus === "queued" ||
        canvasSession.project.generationStatus === "running";

      const shouldHydrateFromProjectState = shouldHydrateFromProject({
        isFreshSession,
        projectUpdatedAt: canvasSession.project.updatedAt,
        lastHydratedUpdatedAt: lastHydratedUpdatedAtRef.current,
        generationActive,
        liveSession,
        wsState: wsStateRef.current,
      });

      if (shouldHydrateFromProjectState) {
        const snapshot = projectHydrationSnapshot(canvasSession.project);
        setMessages(snapshot.chatHistory);
        setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
        setTerraformFiles(snapshot.terraformFiles);
        setArchDescription(snapshot.archDescription);
        setCostEstimate(snapshot.costEstimate);
        setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
        clearChatResponseTimeout();
        resetChatStreamingState();
        hydrate(snapshot.nodes, snapshot.edges);
        if (hasInvalidNodePositions(snapshot.nodes)) {
          applyLayout();
        }
        lastHydratedUpdatedAtRef.current = snapshot.updatedAt;
      }

      setTraceId(canvasSession.project.generationTraceId);
      setCurrentStage(canvasSession.project.generationStage);
      setLastEventAt(canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now());
      if (canvasSession.project.generationStage === "budget_retry") {
        setBudgetRetryState((prev) =>
          reduceBudgetRetryState(prev, {
            stage: "budget_retry",
            event: null,
            message: "Budget optimization retry is running.",
            traceId: canvasSession.project.generationTraceId,
            timestamp: Date.now(),
          })
        );
      } else if (isFreshSession) {
        setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
      }

      if (generationActive) {
        setIsGenerating(true);
        setPipelineStatus((prev) => prev ?? "Resuming generation...");
        setPipelineErrorCode(null);
        pushTicker(canvasSession.project.generationStage ?? canvasSession.project.generationStatus);
        setTerraformProgress((prev) => ({
          ...prev,
          status: "generating",
          activity: canvasSession.project.generationStage
            ? `Running ${canvasSession.project.generationStage}`
            : "Generating Terraform files",
          emittedCount: canvasSession.project.terraformFiles.length,
          expectedMinFiles: Math.max(prev.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
          currentFile: null,
          lastUpdateAt: canvasSession.project.lastEventAt
            ? Date.parse(canvasSession.project.lastEventAt)
            : Date.now(),
        }));
      } else {
        setIsGenerating(false);
        setPipelineStatus((prev) => prev ?? "Loaded saved project");
        if (canvasSession.project.generationStatus === "failed") {
          setPipelineErrorCode(
            inferPipelineErrorCode(
              { generation_error: canvasSession.project.generationError },
              canvasSession.project.generationError
            )
          );
        } else {
          setPipelineErrorCode(null);
        }
        setTerraformProgress((prev) => ({
          ...prev,
          status: canvasSession.project.terraformFiles.length > 0 ? "completed" : "idle",
          activity: canvasSession.project.terraformFiles.length > 0 ? "Terraform ready" : null,
          emittedCount: canvasSession.project.terraformFiles.length,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
      }

      const projectId = canvasSession.project.id;
      queueProjectSubscription(projectId);
    }

    const unsubscribeMessages = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;
      const targetProjectId =
        canvasSession.mode === "existing"
          ? canvasSession.project.id
          : canvasSession.projectId ?? null;

      if (typeof msg.project_id === "string" && targetProjectId && msg.project_id !== targetProjectId) {
        return;
      }

      const incomingTrace = typeof msg.trace_id === "string" ? msg.trace_id : null;
      if (incomingTrace) {
        setTraceId(incomingTrace);
      }

      if (msg.type === "generation_snapshot") {
        const hydrationPayload = parseGenerationSnapshotHydration(msg);
        if (hydrationPayload) {
          const shouldHydrateSnapshot = shouldHydrateGenerationSnapshot({
            generationActive: isGeneratingRef.current,
            nodeCount: latestCanvasShapeRef.current.nodeCount,
            edgeCount: latestCanvasShapeRef.current.edgeCount,
          });
          if (shouldHydrateSnapshot) {
            hydrate(hydrationPayload.nodes as typeof diagram.nodes, hydrationPayload.edges as typeof diagram.edges);
            if (hasInvalidNodePositions(hydrationPayload.nodes as { position?: { x?: unknown; y?: unknown } }[])) {
              applyLayout();
            }
          } else {
            pushDebugEvent({
              ts: Date.now(),
              level: "warning",
              source: "local",
              stage: currentStage,
              message: "Skipped generation_snapshot canvas hydration during active generation",
              traceId: incomingTrace ?? traceId,
            });
          }
          if (hydrationPayload.costEstimatePayload) {
            const parsedSnapshotCostEstimate = parseIncomingCostEstimate(hydrationPayload.costEstimatePayload);
            if (parsedSnapshotCostEstimate) {
              setCostEstimate(parsedSnapshotCostEstimate);
            }
          }
        }

        const status = typeof msg.generation_status === "string" ? msg.generation_status : null;
        const snapshotTerraformFiles = Array.isArray(msg.terraform_files)
          ? (msg.terraform_files as TerraformFile[])
          : null;
        if (snapshotTerraformFiles && snapshotTerraformFiles.length > 0) {
          const mergedFiles = mergeTerraformFiles(terraformFiles, snapshotTerraformFiles, isGeneratingRef.current);
          if (mergedFiles.length !== terraformFiles.length || !mergedFiles.every((f, i) => f.filename === terraformFiles[i]?.filename && f.content === terraformFiles[i]?.content)) {
            pushDebugEvent({
              ts: Date.now(),
              level: "info",
              source: "local",
              stage: "terraform",
              message: `Merging snapshot terraform_files: ${snapshotTerraformFiles.length} snapshot + ${terraformFiles.length} existing → ${mergedFiles.length} total`,
              traceId,
            });
            setTerraformFiles(mergedFiles);
          }
        }

        if (typeof msg.terraform_outdated === "boolean") {
          setTerraformOutdated(msg.terraform_outdated);
        }

        const snapshotAgents = parseGenerationAgentsFromSnapshot(msg);
        if (snapshotAgents) {
          setGenerationAgents(snapshotAgents);
          const hasArchitectureChain = snapshotAgents.some((a) => a.agent === "requirements");
          if (hasArchitectureChain) {
            setArchitectureAgents(snapshotAgents);
          }
        }

        const stage = msg.generation_stage;
        if (typeof stage === "string") setCurrentStage(stage);
        if (stage === "budget_retry") {
          setBudgetRetryState((prev) =>
            reduceBudgetRetryState(prev, {
              stage: "budget_retry",
              event: null,
              message: "Budget optimization retry is running.",
              traceId: incomingTrace ?? traceId,
              timestamp: Date.now(),
            })
          );
        }
        if (status === "queued" || status === "running") {
          setIsGenerating(true);
          setPipelineStatus(typeof stage === "string" ? `Running: ${stage}` : "Generation running...");
          setPipelineErrorCode(null);
          setTerraformProgress((prev) => ({
            ...prev,
            status: "generating",
            activity: typeof stage === "string" ? `Running ${stage}` : "Generation running",
            emittedCount: appliedSnapshotTerraformFiles ? appliedSnapshotTerraformFiles.length : prev.emittedCount,
            lastUpdateAt: Date.now(),
          }));
        }
        if (status === "completed") {
          setBudgetRetryState((prev) =>
            prev.status === "in_progress"
              ? reduceBudgetRetryState(prev, {
                  stage: "budget_cap",
                  event: "retry_succeeded",
                  message: "Budget optimization retry completed.",
                  traceId: incomingTrace ?? traceId,
                  timestamp: Date.now(),
                })
              : prev
          );
          setIsGenerating(false);
          setPipelineStatus("Architecture ready ✓");
          setPipelineErrorCode(null);
          setTerraformProgress((prev) => ({
            ...prev,
            status: "completed",
            activity:
              appliedSnapshotTerraformFiles && appliedSnapshotTerraformFiles.length > 0
                ? "Terraform ready"
                : prev.activity ?? "Architecture ready",
            emittedCount: appliedSnapshotTerraformFiles ? appliedSnapshotTerraformFiles.length : prev.emittedCount,
            currentFile: null,
            lastUpdateAt: Date.now(),
          }));
          const newManualStateCompleted = getManualTerraformRunStateFromSnapshot({
            currentState: manualTerraformRunState,
            generationStage: typeof stage === "string" ? stage : undefined,
            generationStatus: typeof status === "string" ? status : undefined,
          });
          if (newManualStateCompleted !== null) {
            setManualTerraformRunState(newManualStateCompleted);
          }
        }
        if (status === "failed") {
          const failedMessage = String(msg.generation_error ?? "Generation failed");
          setBudgetRetryState((prev) =>
            prev.status === "in_progress"
              ? reduceBudgetRetryState(prev, {
                  stage: "budget_cap",
                  event: "retry_failed",
                  message: failedMessage,
                  traceId: incomingTrace ?? traceId,
                  timestamp: Date.now(),
                })
              : prev
          );
          setIsGenerating(false);
          setPipelineStatus(`Error: ${failedMessage}`);
          setPipelineErrorCode(inferPipelineErrorCode(msg, failedMessage));
          setTerraformProgress((prev) => ({
            ...prev,
            status: "failed",
            activity: failedMessage,
            currentFile: null,
            lastUpdateAt: Date.now(),
          }));
          const newManualStateFailed = getManualTerraformRunStateFromSnapshot({
            currentState: manualTerraformRunState,
            generationStage: typeof stage === "string" ? stage : undefined,
            generationStatus: typeof status === "string" ? status : undefined,
          });
          if (newManualStateFailed !== null) {
            setManualTerraformRunState(newManualStateFailed);
          }
        }
        setSetupPdfState((prev) => {
          const incomingStatus =
            msg.setup_pdf_status !== undefined ? normalizeSetupPdfStatus(msg.setup_pdf_status) : prev.status;
          const incomingProgress =
            typeof msg.setup_pdf_progress === "number" ? Math.max(0, Math.min(100, Math.round(msg.setup_pdf_progress))) : prev.progress;
          const incomingError = typeof msg.setup_pdf_error === "string" ? msg.setup_pdf_error : prev.error;
          const incomingGeneratedAt = typeof msg.setup_pdf_generated_at === "string" ? msg.setup_pdf_generated_at : prev.generatedAt;
          const incomingSourceRevision =
            typeof msg.setup_pdf_source_revision === "string" ? msg.setup_pdf_source_revision : prev.sourceRevision;
          return {
            status: incomingStatus,
            progress: incomingProgress,
            error: incomingError,
            generatedAt: incomingGeneratedAt,
            sourceRevision: incomingSourceRevision,
          };
        });
        setLastEventAt(Date.now());
      }

      if (msg.type === "setup_pdf_status") {
        setSetupPdfState((prev) => ({
          status: normalizeSetupPdfStatus(msg.setup_pdf_status),
          progress:
            typeof msg.setup_pdf_progress === "number"
              ? Math.max(0, Math.min(100, Math.round(msg.setup_pdf_progress)))
              : prev.progress,
          error: typeof msg.setup_pdf_error === "string" ? msg.setup_pdf_error : null,
          generatedAt: typeof msg.setup_pdf_generated_at === "string" ? msg.setup_pdf_generated_at : prev.generatedAt,
          sourceRevision:
            typeof msg.setup_pdf_source_revision === "string"
              ? msg.setup_pdf_source_revision
              : prev.sourceRevision,
        }));
        if (typeof msg.message === "string" && msg.message.trim()) {
          setPipelineStatus(msg.message);
        }
        setLastEventAt(Date.now());
      }

      if (msg.type === "project_ready") {
        const projectId = msg.project_id;
        const shareSlug = msg.share_slug;
        if (typeof projectId === "string") {
          onProjectReady?.(projectId, typeof shareSlug === "string" ? shareSlug : null);
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "generation_started") {
        setIsGenerating(true);
        setPipelineStatus("Generation queued...");
        setCurrentStage("queued");
        setGenerationAgents(null);
        setGenerationElapsed(0);
        setGenerationStartedAt(null);
        generationStartedAtRef.current = null;
        setLastEventAt(Date.now());
        pushTicker("queued");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "planning",
          activity: "Queued for generation",
          emittedCount: 0,
          expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
      }

      if (msg.type === "pipeline_event") {
        const stage = typeof msg.stage === "string" ? msg.stage : null;
        const eventName = typeof msg.event === "string" ? msg.event : null;
        const level = msg.level === "warning" || msg.level === "error" ? msg.level : "info";
        const message = typeof msg.message === "string" ? msg.message : "Pipeline event";
        const details =
          typeof msg.details === "object" && msg.details !== null
            ? (msg.details as Record<string, unknown>)
            : undefined;
        setCurrentStage(stage);
        setLastEventAt(Date.now());
        stallWarnedRef.current = false;
        pushTicker(stage ? `${stage}:${String(eventName ?? "event")}` : message);
        pushDebugEvent({
          ts: Date.now(),
          level,
          source: "pipeline",
          stage,
          message,
          traceId: incomingTrace ?? traceId,
          details,
        });
        setBudgetRetryState((prev) =>
          reduceBudgetRetryState(prev, {
            stage,
            event: eventName,
            message,
            details,
            traceId: incomingTrace ?? traceId,
            timestamp: Date.now(),
          })
        );

        if (stage === "coder") {
          const expectedFromEvent =
            typeof details?.expected_min_files === "number"
              ? details.expected_min_files
              : TERRAFORM_EXPECTED_MIN_FILES;
          const emittedFromEvent = typeof details?.emitted_count === "number" ? details.emitted_count : null;
          const currentFile = typeof details?.current_file === "string" ? details.current_file : null;
          const activity =
            typeof details?.activity === "string" && details.activity.trim().length > 0
              ? details.activity
              : message;

          setTerraformProgress((prev) => {
            let status: TerraformProgress["status"] = prev.status;
            if (eventName === "coder.started") status = "planning";
            if (eventName === "coder.llm_request_started") status = "requesting";
            if (eventName === "coder.first_file_emitted" || eventName === "coder.file_emitted") status = "generating";
            if (eventName === "coder.completed") status = "finalizing";
            if (level === "error" && (eventName === "coder.parse_fallback" || eventName === "coder.timeout_fallback")) {
              status = "failed";
            }

            return {
              status,
              activity,
              emittedCount: emittedFromEvent ?? prev.emittedCount,
              expectedMinFiles: Math.max(prev.expectedMinFiles, expectedFromEvent),
              currentFile,
              lastUpdateAt: Date.now(),
            };
          });
        }

        if (shouldApplyLayoutOnPipelineEvent(stage, eventName)) {
          applyLayout();
        }

        if (level === "error") {
          setPipelineStatus(`Error: ${message}`);
        } else {
          setPipelineStatus(message);
        }
      }

      if (msg.type === "status") {
        const message = msg.message as string;
        setPipelineStatus(message);
        setLastEventAt(Date.now());
        setIsGenerating(true);
        pushTicker(message);
      }

      if (msg.type === "diagram_reset") {
        reset();
        setCostEstimate(null);
        setLastEventAt(Date.now());
      }

      if (msg.type === "done") {
        setBudgetRetryState((prev) =>
          prev.status === "in_progress"
            ? reduceBudgetRetryState(prev, {
                stage: "budget_cap",
                event: "retry_succeeded",
                message: "Budget optimization retry completed.",
                traceId: incomingTrace ?? traceId,
                timestamp: Date.now(),
              })
            : prev
        );
        setIsGenerating(false);
        setPipelineStatus("Architecture ready ✓");
        setPipelineErrorCode(null);
        const startedAt = generationStartRef.current || Date.now();
        setGenerationElapsed((Date.now() - startedAt) / 1000);
        setLastEventAt(Date.now());
        pushTicker("done");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "completed",
          activity: "Terraform generation complete",
          currentFile: null,
          emittedCount: prev.emittedCount,
          lastUpdateAt: Date.now(),
        }));
        if (manualTerraformRunState === "running") {
          setManualTerraformRunState("completed");
        }
        applyLayout();

        if (onGenerationComplete) {
          void onGenerationComplete();
        }
      }

      if (msg.type === "error") {
        const message = String(msg.message ?? "Unknown error");
        const errorCode = inferPipelineErrorCode(msg, message);
        const toastMessage = pipelineErrorToastMessage(msg.error, message);
        if (toastMessage) {
          toast.error(toastMessage, { position: "bottom-right" });
        }
        clearChatResponseTimeout();
        const budgetRecoveryDetails = parseBudgetCapRecoveryDetails(msg);
        const budgetRecoveryMetadata =
          parseBudgetRecoveryMetadata(msg) ??
          (budgetRecoveryDetails
            ? {
                status: "pending",
                budgetCap: budgetRecoveryDetails.budgetCap,
                estimatedTotal: budgetRecoveryDetails.estimatedTotal,
                overage: budgetRecoveryDetails.overage,
              }
            : null);
        if (budgetRecoveryDetails || budgetRecoveryMetadata?.status === "pending") {
          const budgetDetails = budgetRecoveryDetails ?? {
            budgetCap: budgetRecoveryMetadata?.budgetCap ?? 0,
            estimatedTotal: budgetRecoveryMetadata?.estimatedTotal ?? 0,
            overage:
              budgetRecoveryMetadata?.overage ??
              Math.max((budgetRecoveryMetadata?.estimatedTotal ?? 0) - (budgetRecoveryMetadata?.budgetCap ?? 0), 0),
          };
          const assistantMessage = buildBudgetCapRecoveryAssistantMessage(budgetDetails);
          setMessages((prev) => {
            const previous = prev[prev.length - 1];
            if (previous?.role === "assistant" && previous.content === assistantMessage) {
              return prev;
            }
            const next = [
              ...prev,
              {
                role: "assistant" as const,
                content: assistantMessage,
                ...(budgetRecoveryMetadata ? { budgetRecovery: budgetRecoveryMetadata } : {}),
              },
            ];
            messagesRef.current = next;
            return next;
          });
          if (targetProjectId) {
            void subscribeProject(targetProjectId);
          }
        }
        resetChatStreamingState();
        setIsGenerating(false);
        setPipelineStatus(`Error: ${message}`);
        setPipelineErrorCode(errorCode);
        setLastEventAt(Date.now());
        pushTicker("error");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "failed",
          activity: message,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
        if (manualTerraformRunState === "running") {
          setManualTerraformRunState("failed");
        }
        setBudgetRetryState((prev) =>
          prev.status === "in_progress"
            ? reduceBudgetRetryState(prev, {
                stage: "budget_cap",
                event: "retry_failed",
                message,
                traceId: incomingTrace ?? traceId,
                timestamp: Date.now(),
              })
            : prev
        );
        pushDebugEvent({
          ts: Date.now(),
          level: "error",
          source: "pipeline",
          stage: currentStage,
          message,
          traceId: incomingTrace ?? traceId,
          details: { error: msg.error as string },
        });
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
        setLastEventAt(Date.now());
      }

      if (msg.type === "generation_agent_update") {
        const obj = msg as Record<string, unknown>;
        const mode = typeof obj.mode === "string" ? obj.mode : null;
        const incomingAgents = parseGenerationAgentUpdate(msg);
        if (incomingAgents) {
          let nextGenerationAgents: GenerationAgentState[];
          if (mode === "code_generation" && architectureAgentsRef.current) {
            nextGenerationAgents = mergeCodeGenerationAgents(architectureAgentsRef.current, incomingAgents);
          } else {
            nextGenerationAgents = incomingAgents;
          }
          setGenerationAgents(nextGenerationAgents);
          if (mode === "initial_generation" && architectureAgentsRef.current === null) {
            setArchitectureAgents(incomingAgents);
          }
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "generation_agent_event") {
        const event = parseGenerationAgentEvent(msg);
        if (event) {
          if (event.started_at) {
            const backendMs = new Date(event.started_at).getTime();
            generationStartedAtRef.current = isNaN(backendMs) ? Date.now() : backendMs;
            setGenerationStartedAt(generationStartedAtRef.current);
          }
          setGenerationAgents((prev) => {
            if (!prev) return prev;
            return reduceGenerationAgentEvent(prev, event);
          });
          setArchitectureAgents((prev) => {
            if (!prev) return prev;
            return reduceGenerationAgentEvent(prev, event);
          });
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "terraform_file") {
        pushDebugEvent({
          ts: Date.now(),
          level: "info",
          source: "ws",
          stage: "coder",
          message: `Received terraform_file: ${(msg as { filename?: string }).filename ?? "unknown"}`,
          traceId,
        });
        setTerraformFiles((prev) => {
          const next = upsertTerraformFile(prev, msg as unknown as TerraformFile);
          setTerraformProgress((progress) => ({
            ...progress,
            status: "generating",
            activity:
              typeof (msg as { filename?: unknown }).filename === "string"
                ? `Generating ${(msg as { filename: string }).filename}`
                : "Generating Terraform files",
            emittedCount: next.length,
            expectedMinFiles: Math.max(progress.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
            currentFile: typeof (msg as { filename?: unknown }).filename === "string" ? (msg as { filename: string }).filename : null,
            lastUpdateAt: Date.now(),
          }));
          return next;
        });
        setLastEventAt(Date.now());
      }

      if (msg.type === "arch_description") {
        setArchDescription((msg as { type: string; sections: ArchDescription }).sections);
        setLastEventAt(Date.now());
      }

      if (msg.type === "cost_estimate") {
        const incomingRequestId =
          typeof msg.request_id === "string" && msg.request_id.trim().length > 0
            ? msg.request_id.trim()
            : null;
        const pendingRequestId = pendingTemplateEstimateRequestIdRef.current;

        if (incomingRequestId) {
          if (!pendingRequestId || incomingRequestId !== pendingRequestId) {
            return;
          }
          const parsed = parseIncomingCostEstimate(msg);
          clearPendingTemplateEstimateRequest();
          if (parsed) {
            setCostEstimate(parsed);
            setLastEventAt(Date.now());
          }
          return;
        }

        if (pendingRequestId) {
          return;
        }

        const parsed = parseIncomingCostEstimate(msg);
        if (parsed) {
          setCostEstimate(parsed);
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "canvas_edit_ack") {
        if (msg.action === "remove_node" && typeof msg.node_id === "string") {
          setCostEstimate((prev) => removeNodeFromCostEstimate(prev, msg.node_id as string));
        }
      }

      if (msg.type === "diagram_event") {
        handleDiagramEvent(msg);
        setLastEventAt(Date.now());
      }

      if (msg.type === "chat_reply_delta") {
        const delta = typeof msg.delta === "string" ? msg.delta : "";
        if (delta) {
          armChatResponseTimeout();
          setIsChatStreaming(true);
          setStreamingAssistantReply((prev) => {
            const next = prev + delta;
            streamingReplyRef.current = next;
            return next;
          });
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "chat_reply_done") {
        clearChatResponseTimeout();
        const finalMessage =
          typeof msg.message === "string" && msg.message.trim()
            ? msg.message
            : streamingReplyRef.current;
        const mutationPayload =
          typeof msg.mutation === "object" && msg.mutation !== null
            ? (msg.mutation as GraphMutationPayload)
            : null;
        const planReady = msg.plan_ready === true;
        const executionMode =
          msg.execution_mode === "node_patch" ||
          msg.execution_mode === "architecture_refactor" ||
          msg.execution_mode === "plan_only" ||
          msg.execution_mode === "chat_only"
            ? (msg.execution_mode as CanvasMessage["executionMode"])
            : undefined;
        const planMeta =
          typeof msg.plan_meta === "object" && msg.plan_meta !== null
            ? (msg.plan_meta as CanvasMessage["planMeta"])
            : undefined;
        const budgetRecovery = parseBudgetRecoveryMetadata(msg) ?? undefined;
        if (mutationPayload?.diff) {
          const applyResult = applyGraphMutation(mutationPayload);
          if (!applyResult.ok) {
            const mutationError = applyResult.error ?? "Unknown mutation apply error";
            pushDebugEvent({
              ts: Date.now(),
              level: "warning",
              source: "local",
              stage: currentStage,
              message: `Skipped unsafe graph mutation: ${mutationError}`,
              traceId: incomingTrace ?? traceId,
            });
          }
        }
        if (
          planMeta?.status === "approved" &&
          (planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch")
        ) {
          setTerraformFiles([]);
          setTerraformProgress({
            status: "idle",
            activity: "Terraform files are outdated. Click Generate Terraform to refresh.",
            emittedCount: 0,
            expectedMinFiles: 0,
            currentFile: null,
            lastUpdateAt: Date.now(),
          });
          setIsGenerating(false);
          setPipelineStatus("Architecture updated ✓");
        }
        resetChatStreamingState();
        setPipelineStatus((prev) => clearTransientChatErrorStatus(prev));
        if (finalMessage.trim()) {
          setMessages((prev) => {
            const next = [
              ...prev,
              {
                role: "assistant" as const,
                content: finalMessage,
                planReady,
                executionMode,
                planMeta,
                ...(budgetRecovery ? { budgetRecovery } : {}),
              },
            ];
            messagesRef.current = next;
            return next;
          });
        }
        if (budgetRecovery?.status === "pending") {
          setPipelineErrorCode("budget_cap_unmet");
        } else if (budgetRecovery) {
          setPipelineErrorCode(null);
        }
        if ((planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch") && typeof planMeta.plan_id === "string") {
          if (planMeta.status === "pending") {
            setPendingChatPlanId(planMeta.plan_id);
          } else if (
            planMeta.status === "approved" ||
            planMeta.status === "executed" ||
            planMeta.status === "rejected" ||
            planMeta.status === "cancelled"
          ) {
            setPendingChatPlanId((prev) => (prev === planMeta.plan_id ? null : prev));
          }
        }
        setLastEventAt(Date.now());
      }

      if (msg.type === "chat_reply") {
        clearChatResponseTimeout();
        const planReady = msg.plan_ready === true;
        const executionMode =
          msg.execution_mode === "node_patch" ||
          msg.execution_mode === "architecture_refactor" ||
          msg.execution_mode === "plan_only" ||
          msg.execution_mode === "chat_only"
            ? (msg.execution_mode as CanvasMessage["executionMode"])
            : undefined;
        const planMeta =
          typeof msg.plan_meta === "object" && msg.plan_meta !== null
            ? (msg.plan_meta as CanvasMessage["planMeta"])
            : undefined;
        const budgetRecovery = parseBudgetRecoveryMetadata(msg) ?? undefined;
        resetChatStreamingState();
        setPipelineStatus((prev) => clearTransientChatErrorStatus(prev));
        setMessages((prev) => {
          const next = [
            ...prev,
            {
              role: "assistant" as const,
              content: msg.message as string,
              planReady,
              executionMode,
              planMeta,
              ...(budgetRecovery ? { budgetRecovery } : {}),
            },
          ];
          messagesRef.current = next;
          return next;
        });
        if (budgetRecovery?.status === "pending") {
          setPipelineErrorCode("budget_cap_unmet");
        } else if (budgetRecovery) {
          setPipelineErrorCode(null);
        }
        if (
          (planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch") &&
          planMeta.status === "pending" &&
          typeof planMeta.plan_id === "string"
        ) {
          setPendingChatPlanId(planMeta.plan_id);
        }
        setLastEventAt(Date.now());
      }
    });

    return () => {
      clearPendingTemplateEstimateRequest();
      clearChatResponseTimeout();
      unsubscribeMessages();
      unsubscribeConnection();
    };
  }, [
    appState,
    canvasSession,
    liveSession,
    readOnly,
    onGenerationComplete,
    onProjectReady,
    reset,
    applyLayout,
    handleDiagramEvent,
    hydrate,
    pushDebugEvent,
    pushTicker,
    subscribeProject,
    queueProjectSubscription,
    applyGraphMutation,
    armChatResponseTimeout,
    clearChatResponseTimeout,
    clearPendingTemplateEstimateRequest,
    resetChatStreamingState,
  ]);

  useEffect(() => {
    if (appState !== "dashboard" || readOnly) return;

    wsClient.connect();
    const unsubscribeConnection = wsClient.onConnectionState((state) => {
      wsStateRef.current = state;
      setWsState(state);
    });
    const unsubscribeMessages = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;
      if (typeof msg.project_id === "string" && msg.project_id.trim()) {
        const bootstrappedProjectId = chatProjectBootstrapRef.current.context?.projectId;
        if (!bootstrappedProjectId || msg.project_id !== bootstrappedProjectId) {
          return;
        }
      }

      if (msg.type === "chat_reply_delta") {
        const delta = typeof msg.delta === "string" ? msg.delta : "";
        if (delta) {
          armChatResponseTimeout();
          setIsChatStreaming(true);
          setStreamingAssistantReply((prev) => {
            const next = prev + delta;
            streamingReplyRef.current = next;
            return next;
          });
          setLastEventAt(Date.now());
        }
      }

      if (msg.type === "chat_reply_done") {
        clearChatResponseTimeout();
        const finalMessage =
          typeof msg.message === "string" && msg.message.trim()
            ? msg.message
            : streamingReplyRef.current;
        const planReady = msg.plan_ready === true;
        const executionMode =
          msg.execution_mode === "node_patch" ||
          msg.execution_mode === "architecture_refactor" ||
          msg.execution_mode === "plan_only" ||
          msg.execution_mode === "chat_only"
            ? (msg.execution_mode as CanvasMessage["executionMode"])
            : undefined;
        const planMeta =
          typeof msg.plan_meta === "object" && msg.plan_meta !== null
            ? (msg.plan_meta as CanvasMessage["planMeta"])
            : undefined;
        const budgetRecovery = parseBudgetRecoveryMetadata(msg) ?? undefined;

        resetChatStreamingState();
        setPipelineStatus((prev) => clearTransientChatErrorStatus(prev));
        if (finalMessage.trim()) {
          setMessages((prev) => {
            const next = [
              ...prev,
              {
                role: "assistant" as const,
                content: finalMessage,
                planReady,
                executionMode,
                planMeta,
                ...(budgetRecovery ? { budgetRecovery } : {}),
              },
            ];
            messagesRef.current = next;
            return next;
          });
        }
        if (budgetRecovery?.status === "pending") {
          setPipelineErrorCode("budget_cap_unmet");
        } else if (budgetRecovery) {
          setPipelineErrorCode(null);
        }

        if ((planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch") && typeof planMeta.plan_id === "string") {
          if (planMeta.status === "pending") {
            setPendingChatPlanId(planMeta.plan_id);
          } else if (
            planMeta.status === "approved" ||
            planMeta.status === "executed" ||
            planMeta.status === "rejected" ||
            planMeta.status === "cancelled"
          ) {
            setPendingChatPlanId((prev) => (prev === planMeta.plan_id ? null : prev));
          }
        }
        setLastEventAt(Date.now());
      }

      if (msg.type === "error") {
        const message = String(msg.message ?? "Unknown error");
        const errorCode = inferPipelineErrorCode(msg, message);
        clearChatResponseTimeout();
        resetChatStreamingState();
        setIsGenerating(false);
        setPipelineStatus(`Error: ${message}`);
        setPipelineErrorCode(errorCode);
        setLastEventAt(Date.now());
      }
    });

    return () => {
      unsubscribeMessages();
      unsubscribeConnection();
    };
  }, [appState, readOnly, armChatResponseTimeout, clearChatResponseTimeout, resetChatStreamingState]);

  useEffect(() => {
    if (!isChatStreaming) return;
    if (wsState !== "closed" && wsState !== "error") return;
    failChatRequest("Connection lost. Try again later.");
  }, [isChatStreaming, wsState, failChatRequest]);

  const recoverFromGenerationStall = useCallback(() => {
    const targetProjectId =
      canvasSession?.mode === "existing"
        ? canvasSession.project.id
        : canvasSession?.projectId ?? null;
    pushDebugEvent({
      ts: Date.now(),
      level: "warning",
      source: "local",
      stage: currentStage,
      message: "Stall detected: forcing websocket reconnect",
      traceId,
      details: targetProjectId ? { project_id: targetProjectId } : undefined,
    });
    desiredProjectSubscriptionRef.current = targetProjectId;
    stallWarnedRef.current = false;
    wsClient.reconnect();
  }, [canvasSession, currentStage, pushDebugEvent, traceId]);

  useEffect(() => {
    if (!isGenerating) return;

    const timer = setInterval(() => {
      if (!lastEventAt) return;
      const age = Date.now() - lastEventAt;
      if (age < STALL_THRESHOLD_MS || stallWarnedRef.current) {
        return;
      }

      stallWarnedRef.current = true;
      setPipelineStatus("Stalled: no events for 15s. Reconnecting websocket...");
      pushTicker("stall-warning");
      pushTicker("stall-recover");
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: currentStage,
        message:
          "No pipeline events for 15s. Triggering websocket reconnect and project re-subscription.",
        traceId,
      });
      recoverFromGenerationStall();
    }, 1000);

    return () => clearInterval(timer);
  }, [isGenerating, lastEventAt, currentStage, traceId, pushDebugEvent, pushTicker, recoverFromGenerationStall]);

  const handleReconnect = useCallback(() => {
    pushDebugEvent({
      ts: Date.now(),
      level: "info",
      source: "local",
      stage: currentStage,
      message: "Manual websocket reconnect requested",
      traceId,
    });
    wsClient.reconnect();
  }, [currentStage, pushDebugEvent, traceId]);

  const copyDebugReport = useCallback(async () => {
    const latestPollEvent = [...debugEvents]
      .reverse()
      .find((event) => typeof event.details?.poll_mode === "string");
    const latestCoderEvent = [...debugEvents]
      .reverse()
      .find((event) => event.stage === "coder");

    const lines = [
      `trace_id: ${traceId ?? "n/a"}`,
      `ws_state: ${wsState}`,
      `current_stage: ${currentStage ?? "n/a"}`,
      `status: ${pipelineStatus ?? "n/a"}`,
      `poll_mode: ${typeof latestPollEvent?.details?.poll_mode === "string" ? latestPollEvent.details.poll_mode : "n/a"}`,
      `coder_last_milestone: ${latestCoderEvent?.message ?? "n/a"}`,
      `event_count: ${debugEvents.length}`,
      "",
      ...debugEvents.map((event) => {
        const when = new Date(event.ts).toISOString();
        return `${when} [${event.level}] (${event.source}) stage=${event.stage ?? "n/a"} trace=${event.traceId ?? "n/a"} :: ${event.message}`;
      }),
    ];

    const report = lines.join("\n");
    try {
      await navigator.clipboard.writeText(report);
      pushDebugEvent({
        ts: Date.now(),
        level: "info",
        source: "local",
        stage: currentStage,
        message: "Copied debug report to clipboard",
        traceId,
      });
    } catch {
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: currentStage,
        message: "Failed to copy debug report",
        traceId,
      });
    }
  }, [currentStage, debugEvents, pipelineStatus, pushDebugEvent, traceId, wsState]);

  const activeProjectId =
    canvasSession?.mode === "existing"
      ? canvasSession.project.id
      : canvasSession?.mode === "new"
      ? canvasSession.projectId ?? null
      : null;
  const latestGraphRef = useRef({ nodes: diagram.canonicalNodes, edges: diagram.edges });
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latestGraphRef.current = { nodes: diagram.canonicalNodes, edges: diagram.edges };
  }, [diagram.edges, diagram.canonicalNodes]);
  useEffect(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, [activeProjectId]);
  useEffect(() => {
    setArchitectureAgents(null);
  }, [activeProjectId]);
  useEffect(
    () => () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    },
    []
  );

  const scheduleCanvasPersist = useCallback(
    (options?: { structureChanged?: boolean }) => {
      if (!activeProjectId || readOnly) return;
      const structureChanged = options?.structureChanged ?? true;
      if (structureChanged) {
        setTerraformOutdated(true);
        setSetupPdfState((prev) =>
          prev.status === "ready" || prev.status === "outdated"
            ? { ...prev, status: "outdated" }
            : prev
        );
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }

      const projectId = activeProjectId;
      const snapshot = latestGraphRef.current;

      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void saveSnapshot(projectId, snapshot.nodes, snapshot.edges, { structureChanged }).catch((error) => {
          pushDebugEvent({
            ts: Date.now(),
            level: "warning",
            source: "local",
            stage: currentStage,
            message: `Failed to persist canvas snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
            traceId,
          });
        });
      }, 300);
    },
    [activeProjectId, currentStage, pushDebugEvent, readOnly, traceId]
  );
  const generationCompleted =
    currentStage === "completed" ||
    (canvasSession?.mode === "existing" && canvasSession.project.generationStage === "completed");
  const canvasHasArchitecture = hasArchitecture(diagram.nodes);
  const chatEnabled =
    !readOnly &&
    !isGenerating &&
    !isChatStreaming;
  const chatDisabledReason = readOnly
    ? "Read-only shared view."
    : !activeProjectId
      ? null
      : isGenerating
        ? "Chat unlocks once generation is completed."
        : isChatStreaming
          ? "Assistant is replying..."
          : null;
  const displayedMessages = streamingAssistantReply
    ? [...messages, { role: "assistant" as const, content: streamingAssistantReply }]
    : messages;
  const selectedNodes = useMemo(
    () =>
      diagram.selectedNodeIds.map((id) => {
        const node = diagram.canonicalNodes.find((candidate) => candidate.id === id);
        return {
          id,
          label: typeof node?.data?.label === "string" && node.data.label.length > 0 ? node.data.label : id,
          category:
            typeof node?.data?.category === "string" && node.data.category.length > 0
              ? node.data.category
              : "default",
        };
      }),
    [diagram.canonicalNodes, diagram.selectedNodeIds]
  );

  const requestSetupPdfGeneration = useCallback(async () => {
    if (!activeProjectId || !generationCompleted || readOnly) return;

    setSetupPdfState((prev) => ({
      ...prev,
      status: "generating",
      progress: Math.max(prev.progress, 0),
      error: null,
    }));

    try {
      const result = await generateSetupPdf(activeProjectId);
      setSetupPdfState((prev) => ({
        ...prev,
        status: normalizeSetupPdfStatus(result.setup_pdf_status),
        progress: Math.max(0, Math.min(100, Math.round(result.setup_pdf_progress))),
        error: result.setup_pdf_error,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate setup PDF.";
      setSetupPdfState((prev) => ({
        ...prev,
        status: "failed",
        error: message,
      }));
    }
  }, [activeProjectId, generationCompleted, readOnly]);

  const requestSetupPdfDownload = useCallback(async () => {
    if (!activeProjectId || readOnly) return;

    try {
      const result = await fetchSetupPdfDownloadUrl(activeProjectId);
      setSetupPdfState((prev) => ({
        ...prev,
        status: normalizeSetupPdfStatus(result.setup_pdf_status),
        error: null,
      }));
      if (typeof window !== "undefined") {
        window.open(result.download_url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch setup PDF download URL.";
      setSetupPdfState((prev) => ({
        ...prev,
        error: message,
      }));
    }
  }, [activeProjectId, readOnly]);

  const startGenerationFromAnswers = useCallback(async (
    answers: QuestionnaireAnswers,
    options?: { forceNewProject?: boolean }
  ) => {
    const projectId = resolveGenerationProjectId(canvasSession, {
      forceNewProject: options?.forceNewProject === true,
    });
    if (!projectId && options?.forceNewProject !== true) return;

    clearPendingTemplateEstimateRequest();
    setIsGenerating(false);
    setPipelineStatus("Starting generation...");
    setPipelineErrorCode(null);
    setCurrentStage("start");
    setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
    setCostEstimate(null);
    generationStartRef.current = Date.now();
    setLastEventAt(Date.now());
    setTerraformProgress({
      status: "planning",
      activity: "Planning Terraform files",
      emittedCount: 0,
      expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
      currentFile: null,
      lastUpdateAt: Date.now(),
    });

    try {
      const result = await startGenerationViaHttp(answers, projectId);
      setTraceId(result.trace_id);
      setPipelineStatus("Generation queued...");
      setPipelineErrorCode(null);
      setCurrentStage("queued");
      if (result.project_id) {
        queueProjectSubscription(result.project_id);
      }
      onProjectReady?.(result.project_id, result.share_slug);
    } catch (error) {
      setIsGenerating(false);
      setPipelineStatus(`Error: ${(error as Error).message}`);
      setPipelineErrorCode("generation_start_failed");
      if (isQuotaExceededError(error)) {
        toast.error("Quota reached, set your own AI key to keep using.", { position: "bottom-right" });
      }
    }
  }, [canvasSession, clearPendingTemplateEstimateRequest, onProjectReady, queueProjectSubscription]);

  const handleDeleteNodes = useCallback((nodeIds: string[]) => {
    if (!nodeIds.length) return;
    const projectId =
      canvasSession?.mode === "existing"
        ? canvasSession.project.id
        : canvasSession?.projectId ?? null;
    if (!projectId) return;

    for (const id of nodeIds) {
      setCostEstimate((prev) => removeNodeFromCostEstimate(prev, id));
      void (async () => {
        const payload = await withAccessToken({
          type: "canvas_edit",
          action: "remove_node",
          id,
          project_id: projectId,
        });
        wsClient.send(payload);
      })();
    }
  }, [canvasSession]);

  const handleSend = useCallback((message: string, selectedNodeIds: string[] = []) => {
    const currentSelectedIds = diagram.selectedNodeIds.length > 0 ? diagram.selectedNodeIds : selectedNodeIds;
    const selectedNodesForMessage = currentSelectedIds
      .map((id) => {
        const node = diagram.canonicalNodes.find((candidate) => candidate.id === id);
        return {
          id,
          label: typeof node?.data?.label === "string" && node.data.label.length > 0 ? node.data.label : id,
          category:
            typeof node?.data?.category === "string" && node.data.category.length > 0
              ? node.data.category
              : "default",
        };
      })
      .filter((node) => node.id.length > 0);

    const sendPlan = planChatSend({
      chatEnabled,
      hasArchitecture: canvasHasArchitecture,
      previousMessages: messages,
      message,
      selectedNodes: selectedNodesForMessage,
    });
    if (sendPlan.kind === "blocked") return;

    setMessages(sendPlan.nextMessages);
    messagesRef.current = sendPlan.nextMessages;

    if (sendPlan.kind === "local_no_architecture") return;

    setIsChatStreaming(true);
    setStreamingAssistantReply("");
    streamingReplyRef.current = "";
    setPipelineStatus("Assistant is thinking...");
    setLastEventAt(Date.now());
    clearPendingTemplateEstimateRequest();
    void (async () => {
      let projectId: string;
      try {
        const context = await ensureChatProjectContext({
          canvasSession,
          bootstrapState: chatProjectBootstrapRef.current,
          createProject,
          saveSnapshot,
          nodes: diagram.canonicalNodes,
          edges: diagram.edges,
          onProjectReady,
        });
        projectId = context.projectId;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to prepare project context for chat.";
        failChatRequest(errorMessage);
        return;
      }

      try {
        const payload = await withAccessToken(
          buildChatPayload({
            projectId,
            message,
            selectedNodeIds: currentSelectedIds,
            nodes: diagram.canonicalNodes,
            edges: diagram.edges,
          })
        );
        const sent = wsClient.send(payload);
        if (!sent) {
          failChatRequest("Connection lost while sending chat request.");
          return;
        }
        armChatResponseTimeout();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to send chat request.";
        failChatRequest(errorMessage);
      }
    })();
  }, [canvasSession, chatEnabled, canvasHasArchitecture, messages, diagram.selectedNodeIds, diagram.canonicalNodes, diagram.edges, onProjectReady, clearPendingTemplateEstimateRequest, failChatRequest, armChatResponseTimeout]);

  const handleBudgetRecoveryAction = useCallback(
    (action: "accept" | "retry") => {
      if (!chatEnabled) return;
      handleSend(action, []);
    },
    [chatEnabled, handleSend]
  );

  const handleApprovePlan = useCallback((planId?: string) => {
    if (!chatEnabled) return;
    const targetPlanId = typeof planId === "string" && planId.trim() ? planId.trim() : pendingChatPlanId;
    if (!targetPlanId) return;
    const planRequestedChange = requestedChangeForPlan(messagesRef.current, targetPlanId);

    clearPendingTemplateEstimateRequest();
    setIsGenerating(true);
    setPipelineStatus("Applying approved chat change...");
    setPipelineErrorCode(null);
    setCurrentStage("queued");
    setLastEventAt(Date.now());
    void (async () => {
      let projectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId ?? null;
      if (!projectId) {
        try {
          const created = await createProject("Untitled Project");
          await saveSnapshot(created.project_id, diagram.canonicalNodes, diagram.edges);
          projectId = created.project_id;
          onProjectReady?.(created.project_id, created.share_slug);
        } catch (error) {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${(error as Error).message}`);
          setPipelineErrorCode("chat_plan_approve_failed");
          return;
        }
      }

      const payload = await withAccessToken({
        type: "chat_plan_approve",
        project_id: projectId,
        plan_id: targetPlanId,
        ...(planRequestedChange ? { requested_change: planRequestedChange } : {}),
      });
      wsClient.send(payload);
    })();
  }, [chatEnabled, pendingChatPlanId, canvasSession, diagram.canonicalNodes, diagram.edges, onProjectReady, clearPendingTemplateEstimateRequest]);

  const loadTemplateSnapshot = useCallback(
    (data: TemplateDetail) => {
      clearPendingTemplateEstimateRequest();
      hydrate(data.nodes, data.edges);
      setTerraformFiles(data.terraform_files);
      setArchDescription(data.arch_description);
      setCostEstimate(data.cost_estimate);
      setPipelineStatus("Template loaded");
      setPipelineErrorCode(null);
      setIsGenerating(false);
      setCurrentStage("completed");
      setLastEventAt(Date.now());
      setTerraformProgress((prev) => ({
        ...prev,
        status: data.terraform_files.length > 0 ? "completed" : "idle",
        activity: data.terraform_files.length > 0 ? "Terraform ready" : null,
        emittedCount: data.terraform_files.length,
        currentFile: null,
        lastUpdateAt: Date.now(),
      }));
      if (hasInvalidNodePositions(data.nodes)) {
        applyLayout();
      }

      if (data.cost_estimate == null && data.nodes.length > 0) {
        templateEstimateRequestSeqRef.current += 1;
        const requestId = `template-estimate:${Date.now()}:${templateEstimateRequestSeqRef.current}`;
        startPendingTemplateEstimateRequest(requestId);
        void (async () => {
          try {
            const payload = await withAccessToken({
              type: "estimate_cost",
              request_id: requestId,
              nodes: data.nodes.map((n) => ({
                id: n.id,
                data: (n as Record<string, unknown>).data ?? {},
              })),
            });
            wsClient.send(payload);
          } catch {
            clearPendingTemplateEstimateRequest();
          }
        })();
      }
    },
    [applyLayout, clearPendingTemplateEstimateRequest, hydrate, startPendingTemplateEstimateRequest]
  );

  const generateTerraform = useCallback(async () => {
    const projectId = activeProjectId;
    if (!projectId || !canvasHasArchitecture) return;

    setGenerationElapsed(0);
    setGenerationStartedAt(null);
    generationStartedAtRef.current = Date.now();

    recordDebugEvent("Manual Terraform generation requested", {
      stage: "coder",
      details: { project_id: projectId },
    });

    setManualTerraformRunState("running");
    setTerraformFiles([]);
    setTerraformProgress({
      status: "planning",
      activity: "Planning Terraform files...",
      emittedCount: 0,
      expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
      currentFile: null,
      lastUpdateAt: Date.now(),
    });

    const payload = await withAccessToken(
      buildGenerateTerraformPayload(projectId, diagram.canonicalNodes, diagram.edges)
    );
    const sent = wsClient.send(payload);
    if (!sent) {
      setManualTerraformRunState("failed");
      setTerraformProgress((prev) => ({
        ...prev,
        status: "failed",
        activity: "Connection lost. Please try again.",
        currentFile: null,
        lastUpdateAt: Date.now(),
      }));
      return;
    }
  }, [activeProjectId, canvasHasArchitecture, diagram.edges, diagram.canonicalNodes, recordDebugEvent]);

  const isManualTerraformRun =
    manualTerraformRunState === "running" ||
    manualTerraformRunState === "completed" ||
    manualTerraformRunState === "failed";

  return {
    ...diagram,
    messages: displayedMessages,
    pipelineStatus,
    pipelineErrorCode,
    terraformFiles,
    archDescription,
    costEstimate,
    budgetRetryState,
    terraformProgress,
    terraformOutdated,
    isGenerating,
    agentLogs,
    generationAgents,
    architectureAgents,
    generationElapsed,
    wsState,
    statusTicker,
    debugEvents,
    currentStage,
    traceId,
    lastEventAt,
    selectedNodes,
    handleReconnect,
    copyDebugReport,
    recordDebugEvent,
    isChatStreaming,
    hasArchitecture: canvasHasArchitecture,
    chatEnabled,
    chatDisabledReason,
    activeProjectId,
    generationCompleted,
    setupPdfState,
    requestSetupPdfGeneration,
    requestSetupPdfDownload,
    handleSend,
    handleBudgetRecoveryAction,
    handleApprovePlan,
    pendingArchitecturePlanId: pendingChatPlanId,
    handleDeleteNodes,
    startGenerationFromAnswers,
    loadTemplateSnapshot,
    generateTerraform,
    scheduleCanvasPersist,
    isManualTerraformRun,
  };
}
