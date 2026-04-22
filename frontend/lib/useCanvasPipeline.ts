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
import { CanvasMessage, CanvasSession, CostBreakdown, QuestionnaireAnswers } from "@/lib/projects";
import {
  emptySetupPdfState,
  fetchSetupPdfDownloadUrl,
  generateSetupPdf,
  SetupPdfState,
} from "@/lib/setupPdf";
import {
  getSessionKey,
  hasInvalidNodePositions,
  inferPipelineErrorCode,
  latestPendingChatPlanId,
  normalizeSetupPdfStatus,
  removeNodeFromCostEstimate,
  requestedChangeForPlan,
  setupPdfStateFromProject,
} from "./canvasPipelineUtils";
import type { GraphMutationPayload } from "@/lib/graphDiff";
import type { TemplateDetail } from "@/lib/templates";
import { resolveGenerationProjectId } from "./generationSession";
import {
  projectHydrationSnapshot,
  shouldHydrateFromProject,
} from "./canvasHydration";
import { createProject, saveSnapshot } from "./projectApi";
import { ensureChatProjectContext, projectContextFromSession, type ChatProjectBootstrapState } from "./chatProjectContext";
import { buildChatPayload, buildGenerateTerraformPayload } from "./pipelineWsPayloads";
import { hasArchitecture, planChatSend } from "./canvasInteractionGuards";
import {
  parseBudgetRecoveryMetadata,
} from "./budgetCapRecovery";
import { clearTransientChatErrorStatus } from "./chatPipelineStatus";
import type { GenerationAgentState } from "./generationObservability";
import { usePipelineMessageHandler } from "./usePipelineMessageHandler";

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

  const handleMessage = usePipelineMessageHandler({
    targetProjectId:
      canvasSession?.mode === "existing"
        ? canvasSession.project.id
        : canvasSession?.projectId ?? null,
    currentStage,
    traceId,
    terraformFiles,
    manualTerraformRunState,
    isGeneratingRef,
    latestCanvasShapeRef,
    streamingReplyRef,
    messagesRef,
    architectureAgentsRef,
    pendingTemplateEstimateRequestIdRef,
    generationStartRef,
    generationStartedAtRef,
    stallWarnedRef,
    setTraceId,
    setIsGenerating,
    setPipelineStatus,
    setPipelineErrorCode,
    setTerraformFiles,
    setArchDescription,
    setCostEstimate,
    setIsChatStreaming,
    setStreamingAssistantReply,
    setAgentLogs,
    setGenerationAgents,
    setArchitectureAgents,
    setGenerationElapsed,
    setGenerationStartedAt,
    setCurrentStage,
    setLastEventAt,
    setBudgetRetryState,
    setSetupPdfState,
    setTerraformOutdated,
    setTerraformProgress,
    setManualTerraformRunState,
    setMessages,
    setPendingChatPlanId,
    pushDebugEvent,
    pushTicker,
    hydrate,
    applyLayout,
    applyGraphMutation,
    handleDiagramEvent,
    reset,
    clearChatResponseTimeout,
    resetChatStreamingState,
    armChatResponseTimeout,
    failChatRequest,
    clearPendingTemplateEstimateRequest,
    subscribeProject,
    onProjectReady,
    onGenerationComplete,
  });

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

    const unsubscribeMessages = wsClient.onMessage(handleMessage);

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
    onProjectReady,
    reset,
    applyLayout,
    handleDiagramEvent,
    hydrate,
    pushDebugEvent,
    pushTicker,
    subscribeProject,
    queueProjectSubscription,
    clearChatResponseTimeout,
    clearPendingTemplateEstimateRequest,
    resetChatStreamingState,
    handleMessage,
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
