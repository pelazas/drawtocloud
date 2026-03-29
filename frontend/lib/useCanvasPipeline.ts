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
import { projectHydrationSnapshot, shouldHydrateFromProject } from "./canvasHydration";
import { createProject, saveSnapshot } from "./projectApi";

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
      const instanceType = typeof item.instance_type === "string" && item.instance_type.trim() ? item.instance_type.trim() : undefined;
      return [
        {
          node_id: nodeId,
          label,
          cost,
          ...(expectedCost !== null ? { expected_cost: expectedCost } : {}),
          estimated,
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
  const [terraformFiles, setTerraformFiles] = useState<TerraformFile[]>([]);
  const [archDescription, setArchDescription] = useState<ArchDescription | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostBreakdown | null>(null);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [streamingAssistantReply, setStreamingAssistantReply] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [generationElapsed, setGenerationElapsed] = useState<number>(0);

  const [wsState, setWsState] = useState<ConnectionState>("idle");
  const [statusTicker, setStatusTicker] = useState<string[]>([]);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [budgetRetryState, setBudgetRetryState] = useState<BudgetRetryState>(INITIAL_BUDGET_RETRY_STATE);
  const [setupPdfState, setSetupPdfState] = useState<SetupPdfState>(emptySetupPdfState());
  const [terraformProgress, setTerraformProgress] = useState<TerraformProgress>({
    status: "idle",
    activity: null,
    emittedCount: 0,
    expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
    currentFile: null,
    lastUpdateAt: null,
  });

  const generationStartRef = useRef<number>(0);
  const activeSessionKeyRef = useRef<string | null>(null);
  const generationRequestKeyRef = useRef<string | null>(null);
  const subscribedProjectRef = useRef<string | null>(null);
  const lastHydratedUpdatedAtRef = useRef<string | null>(null);
  const stallWarnedRef = useRef(false);
  const streamingReplyRef = useRef("");
  const messagesRef = useRef<CanvasMessage[]>([]);

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
    wsClient.send(payload);
    subscribedProjectRef.current = projectId;
  }, []);

  useEffect(() => {
    if (appState !== "canvas" || !canvasSession) return;

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

    if (readOnly && canvasSession.mode === "existing") {
      if (isFreshSession || canvasSession.project.updatedAt !== lastHydratedUpdatedAtRef.current) {
        const snapshot = projectHydrationSnapshot(canvasSession.project);
        setMessages(snapshot.chatHistory);
        setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
        setTerraformFiles(snapshot.terraformFiles);
        setArchDescription(snapshot.archDescription);
        setCostEstimate(snapshot.costEstimate);
        setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
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
      }
    });

    let unsubscribeOpen: (() => void) | undefined;

    if (canvasSession.mode === "new") {
      if (isFreshSession) {
        reset();
        setPipelineStatus("Starting generation...");
        setMessages([]);
        messagesRef.current = [];
        setTerraformFiles([]);
        setArchDescription(null);
        setCostEstimate(null);
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setAgentLogs([]);
        setGenerationElapsed(0);
        setStatusTicker([]);
        setDebugEvents([]);
        setCurrentStage("start");
        setTraceId(null);
        setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
        setSetupPdfState(emptySetupPdfState());
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
            if (wsState === "open") {
              await subscribeProject(result.project_id);
            } else {
              unsubscribeOpen = wsClient.onOpen(() => {
                void subscribeProject(result.project_id);
              });
            }
          }

          onProjectReady?.(result.project_id, result.share_slug);
        } catch (error) {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${(error as Error).message}`);
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
        wsState,
      });

      if (shouldHydrateFromProjectState) {
        const snapshot = projectHydrationSnapshot(canvasSession.project);
        setMessages(snapshot.chatHistory);
        setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
        setTerraformFiles(snapshot.terraformFiles);
        setArchDescription(snapshot.archDescription);
        setCostEstimate(snapshot.costEstimate);
        setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
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
      if (wsState === "open") {
        void subscribeProject(projectId);
      } else {
        unsubscribeOpen = wsClient.onOpen(() => {
          void subscribeProject(projectId);
        });
      }
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
        const snapshotTerraformFiles = Array.isArray(msg.terraform_files)
          ? (msg.terraform_files as TerraformFile[])
          : null;
        if (snapshotTerraformFiles) {
          setTerraformFiles(snapshotTerraformFiles);
        }

        const status = msg.generation_status;
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
          setTerraformProgress((prev) => ({
            ...prev,
            status: "generating",
            activity: typeof stage === "string" ? `Running ${stage}` : "Generation running",
            emittedCount: snapshotTerraformFiles ? snapshotTerraformFiles.length : prev.emittedCount,
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
          setTerraformProgress((prev) => ({
            ...prev,
            status: "completed",
            activity:
              snapshotTerraformFiles && snapshotTerraformFiles.length > 0
                ? "Terraform ready"
                : prev.activity ?? "Architecture ready",
            emittedCount: snapshotTerraformFiles ? snapshotTerraformFiles.length : prev.emittedCount,
            currentFile: null,
            lastUpdateAt: Date.now(),
          }));
        }
        if (status === "failed") {
          setBudgetRetryState((prev) =>
            prev.status === "in_progress"
              ? reduceBudgetRetryState(prev, {
                  stage: "budget_cap",
                  event: "retry_failed",
                  message: String(msg.generation_error ?? "Generation failed"),
                  traceId: incomingTrace ?? traceId,
                  timestamp: Date.now(),
                })
              : prev
          );
          setIsGenerating(false);
          setPipelineStatus(`Error: ${String(msg.generation_error ?? "Generation failed")}`);
          setTerraformProgress((prev) => ({
            ...prev,
            status: "failed",
            activity: String(msg.generation_error ?? "Generation failed"),
            currentFile: null,
            lastUpdateAt: Date.now(),
          }));
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
        applyLayout();

        if (onGenerationComplete) {
          void onGenerationComplete();
        }
      }

      if (msg.type === "error") {
        const message = String(msg.message ?? "Unknown error");
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setIsGenerating(false);
        setPipelineStatus(`Error: ${message}`);
        setLastEventAt(Date.now());
        pushTicker("error");
        setTerraformProgress((prev) => ({
          ...prev,
          status: "failed",
          activity: message,
          currentFile: null,
          lastUpdateAt: Date.now(),
        }));
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

      if (msg.type === "terraform_file") {
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
        let finalMessage =
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
            finalMessage = `${finalMessage}\n\nNote: I updated the server state, but couldn't safely apply the visual mutation locally.`;
          }
        }
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        if (finalMessage.trim()) {
          setMessages((prev) => {
            const next = [...prev, { role: "assistant" as const, content: finalMessage, planReady, executionMode, planMeta }];
            messagesRef.current = next;
            return next;
          });
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
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setMessages((prev) => {
          const next = [...prev, { role: "assistant" as const, content: msg.message as string, planReady, executionMode, planMeta }];
          messagesRef.current = next;
          return next;
        });
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
      unsubscribeMessages();
      unsubscribeConnection();
      unsubscribeOpen?.();
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
    applyGraphMutation,
    wsState,
  ]);

  useEffect(() => {
    if (appState !== "dashboard" || readOnly) return;

    wsClient.connect();
    const unsubscribeConnection = wsClient.onConnectionState((state) => {
      setWsState(state);
    });
    const unsubscribeMessages = wsClient.onMessage((data: unknown) => {
      const msg = data as Record<string, unknown>;
      if (typeof msg.project_id === "string" && msg.project_id.trim()) return;

      if (msg.type === "chat_reply_delta") {
        const delta = typeof msg.delta === "string" ? msg.delta : "";
        if (delta) {
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

        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        if (finalMessage.trim()) {
          setMessages((prev) => {
            const next = [...prev, { role: "assistant" as const, content: finalMessage, planReady, executionMode, planMeta }];
            messagesRef.current = next;
            return next;
          });
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
        setIsChatStreaming(false);
        setStreamingAssistantReply("");
        streamingReplyRef.current = "";
        setIsGenerating(false);
        setPipelineStatus(`Error: ${message}`);
        setLastEventAt(Date.now());
      }
    });

    return () => {
      unsubscribeMessages();
      unsubscribeConnection();
    };
  }, [appState, readOnly]);

  useEffect(() => {
    if (!isGenerating) return;

    const timer = setInterval(() => {
      if (!lastEventAt) return;
      const age = Date.now() - lastEventAt;
      if (age < STALL_THRESHOLD_MS || stallWarnedRef.current) {
        return;
      }

      stallWarnedRef.current = true;
      setPipelineStatus("Stalled: no events for 15s. Check Debug panel.");
      pushTicker("stall-warning");
      pushDebugEvent({
        ts: Date.now(),
        level: "warning",
        source: "local",
        stage: currentStage,
        message:
          "No pipeline events for 15s. Check browser console/network WS and backend logs filtered by trace_id.",
        traceId,
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isGenerating, lastEventAt, currentStage, traceId, pushDebugEvent, pushTicker]);

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
  const generationCompleted =
    currentStage === "completed" ||
    (canvasSession?.mode === "existing" && canvasSession.project.generationStage === "completed");
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
        const node = diagram.nodes.find((candidate) => candidate.id === id);
        return {
          id,
          label: typeof node?.data?.label === "string" && node.data.label.length > 0 ? node.data.label : id,
          category:
            typeof node?.data?.category === "string" && node.data.category.length > 0
              ? node.data.category
              : "default",
        };
      }),
    [diagram.nodes, diagram.selectedNodeIds]
  );

  async function requestSetupPdfGeneration() {
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
  }

  async function requestSetupPdfDownload() {
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
  }

  async function startGenerationFromAnswers(
    answers: QuestionnaireAnswers,
    options?: { forceNewProject?: boolean }
  ) {
    const projectId = resolveGenerationProjectId(canvasSession, {
      forceNewProject: options?.forceNewProject === true,
    });
    if (!projectId && options?.forceNewProject !== true) return;

    setIsGenerating(true);
    setPipelineStatus("Starting generation...");
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
      setCurrentStage("queued");
      if (result.project_id) {
        if (wsState === "open") {
          await subscribeProject(result.project_id);
        } else {
          wsClient.onOpen(() => {
            void subscribeProject(result.project_id);
          });
        }
      }
      onProjectReady?.(result.project_id, result.share_slug);
    } catch (error) {
      setIsGenerating(false);
      setPipelineStatus(`Error: ${(error as Error).message}`);
      if (isQuotaExceededError(error)) {
        toast.error("Quota reached, set your own AI key to keep using.", { position: "bottom-right" });
      }
    }
  }

  function handleDeleteNodes(nodeIds: string[]) {
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
  }

  function handleSend(message: string, selectedNodeIds: string[] = []) {
    if (!chatEnabled) return;
    const currentSelectedIds = diagram.selectedNodeIds.length > 0 ? diagram.selectedNodeIds : selectedNodeIds;
    const selectedNodesForMessage = currentSelectedIds
      .map((id) => {
        const node = diagram.nodes.find((candidate) => candidate.id === id);
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
    setMessages((prev) => {
      const next = [
        ...prev,
        {
          role: "user" as const,
          content: message,
          ...(selectedNodesForMessage.length > 0 ? { selectedNodes: selectedNodesForMessage } : {}),
        },
      ];
      messagesRef.current = next;
      return next;
    });
    setIsChatStreaming(true);
    setStreamingAssistantReply("");
    streamingReplyRef.current = "";
    void (async () => {
      const projectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId ?? null;
      const payload = await withAccessToken({
        type: "chat",
        message,
        ...(projectId
          ? { project_id: projectId }
          : {
              nodes: diagram.nodes.map((node) => ({
                id: node.id,
                data: node.data,
                position: node.position,
              })),
              edges: diagram.edges.map((edge) => ({
                source: edge.source,
                target: edge.target,
                ...(edge.label || (edge.data as { label?: string } | undefined)?.label
                  ? { label: edge.label || (edge.data as { label?: string } | undefined)?.label }
                  : {}),
              })),
            }),
        ...(currentSelectedIds.length > 0 ? { selected_node_ids: currentSelectedIds } : {}),
      });
      wsClient.send(payload);
    })();
  }

  function handleApprovePlan(planId?: string) {
    if (!chatEnabled) return;
    const targetPlanId = typeof planId === "string" && planId.trim() ? planId.trim() : pendingChatPlanId;
    if (!targetPlanId) return;
    const planRequestedChange = requestedChangeForPlan(messagesRef.current, targetPlanId);

    setIsGenerating(true);
    setPipelineStatus("Applying approved chat change...");
    setCurrentStage("queued");
    setLastEventAt(Date.now());
    void (async () => {
      let projectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId ?? null;
      if (!projectId) {
        try {
          const created = await createProject("Untitled Project");
          await saveSnapshot(created.project_id, diagram.nodes, diagram.edges);
          projectId = created.project_id;
          onProjectReady?.(created.project_id, created.share_slug);
        } catch (error) {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${(error as Error).message}`);
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
  }

  const loadTemplateSnapshot = useCallback(
    (data: TemplateDetail) => {
      hydrate(data.nodes, data.edges);
      setTerraformFiles(data.terraform_files);
      setArchDescription(data.arch_description);
      setCostEstimate(data.cost_estimate);
      setPipelineStatus("Template loaded");
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
        void (async () => {
          try {
            const payload = await withAccessToken({
              type: "estimate_cost",
              nodes: data.nodes.map((n) => ({
                id: n.id,
                data: (n as Record<string, unknown>).data ?? {},
              })),
            });
            wsClient.send(payload);
          } catch {}
        })();
      }
    },
    [applyLayout, hydrate]
  );

  const generateTerraform = useCallback(async () => {
    const projectId = activeProjectId;
    if (!projectId) return;

    recordDebugEvent("Manual Terraform generation requested", {
      stage: "coder",
      details: { project_id: projectId },
    });

    setTerraformFiles([]);
    setTerraformProgress({
      status: "requesting",
      activity: "Requesting Terraform generation...",
      emittedCount: 0,
      expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
      currentFile: null,
      lastUpdateAt: Date.now(),
    });

    const payload = await withAccessToken({
      type: "generate_terraform",
      project_id: projectId,
    });
    wsClient.send(payload);
  }, [activeProjectId, recordDebugEvent]);

  return {
    ...diagram,
    messages: displayedMessages,
    pipelineStatus,
    terraformFiles,
    archDescription,
    costEstimate,
    budgetRetryState,
    terraformProgress,
    isGenerating,
    agentLogs,
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
    chatEnabled,
    chatDisabledReason,
    activeProjectId,
    generationCompleted,
    setupPdfState,
    requestSetupPdfGeneration,
    requestSetupPdfDownload,
    handleSend,
    handleApprovePlan,
    pendingArchitecturePlanId: pendingChatPlanId,
    handleDeleteNodes,
    startGenerationFromAnswers,
    loadTemplateSnapshot,
    generateTerraform,
  };
}
