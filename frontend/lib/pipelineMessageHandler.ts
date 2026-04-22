import { toast } from "sonner";
import type { Node, Edge } from "reactflow";
import type { TerraformFile } from "@/components/OutputPanel";
import type { ArchDescription } from "@/components/ArchDescriptionViewer";
import type { CanvasMessage, CostBreakdown } from "@/lib/projects";
import type { GraphMutationPayload } from "@/lib/graphDiff";
import {
  hasInvalidNodePositions,
  parseIncomingCostEstimate,
  upsertTerraformFile,
  inferPipelineErrorCode,
  removeNodeFromCostEstimate,
  normalizeSetupPdfStatus,
} from "./canvasPipelineUtils";
import { shouldApplyLayoutOnPipelineEvent } from "./pipelineLayout";
import { shouldHydrateGenerationSnapshot } from "./generationSnapshotHydration";
import {
  parseGenerationSnapshotHydration,
  parseBudgetRecoveryMetadata,
  parseBudgetCapRecoveryDetails,
  buildBudgetCapRecoveryAssistantMessage,
} from "./budgetCapRecovery";
import { getAppliedSnapshotTerraformFiles, getManualTerraformRunStateFromSnapshot } from "./canvasHydration";
import { pipelineErrorToastMessage } from "./pipelineWsPayloads";
import { clearTransientChatErrorStatus } from "./chatPipelineStatus";
import {
  parseGenerationAgentUpdate,
  parseGenerationAgentsFromSnapshot,
  parseGenerationAgentEvent,
  reduceGenerationAgentEvent,
  mergeCodeGenerationAgents,
  getNextArchitectureAgents,
} from "./generationObservability";
import { reduceBudgetRetryState } from "./budgetRetry";
import type { AgentLogEntry, DebugEvent, TerraformProgress } from "./useCanvasPipeline";
import type { GenerationAgentState } from "./generationObservability";
import type { BudgetRetryState } from "./budgetRetry";
import type { SetupPdfState } from "./setupPdf";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export type PipelineMessageHandlerDeps = {
  targetProjectId: string | null;
  currentStage: string | null;
  traceId: string | null;
  terraformFiles: TerraformFile[];
  manualTerraformRunState: "idle" | "running" | "completed" | "failed";
  isGeneratingRef: { current: boolean };
  latestCanvasShapeRef: { current: { nodeCount: number; edgeCount: number } };
  streamingReplyRef: { current: string };
  messagesRef: { current: CanvasMessage[] };
  architectureAgentsRef: { current: GenerationAgentState[] | null };
  pendingTemplateEstimateRequestIdRef: { current: string | null };
  generationStartRef: { current: number };
  generationStartedAtRef: { current: number | null };
  stallWarnedRef: { current: boolean };
  setTraceId: (value: string | null) => void;
  setIsGenerating: (value: boolean) => void;
  setPipelineStatus: React.Dispatch<React.SetStateAction<string | null>>;
  setPipelineErrorCode: (value: string | null) => void;
  setTerraformFiles: React.Dispatch<React.SetStateAction<TerraformFile[]>>;
  setArchDescription: (value: ArchDescription | null) => void;
  setCostEstimate: React.Dispatch<React.SetStateAction<CostBreakdown | null>>;
  setIsChatStreaming: (value: boolean) => void;
  setStreamingAssistantReply: React.Dispatch<React.SetStateAction<string>>;
  setAgentLogs: React.Dispatch<React.SetStateAction<AgentLogEntry[]>>;
  setGenerationAgents: React.Dispatch<React.SetStateAction<GenerationAgentState[] | null>>;
  setArchitectureAgents: React.Dispatch<React.SetStateAction<GenerationAgentState[] | null>>;
  setGenerationElapsed: React.Dispatch<React.SetStateAction<number>>;
  setGenerationStartedAt: (value: number | null) => void;
  setCurrentStage: (value: string | null) => void;
  setLastEventAt: (value: number | null) => void;
  setBudgetRetryState: React.Dispatch<React.SetStateAction<BudgetRetryState>>;
  setSetupPdfState: React.Dispatch<React.SetStateAction<SetupPdfState>>;
  setTerraformOutdated: (value: boolean) => void;
  setTerraformProgress: React.Dispatch<React.SetStateAction<TerraformProgress>>;
  setManualTerraformRunState: React.Dispatch<React.SetStateAction<"idle" | "running" | "completed" | "failed">>;
  setMessages: React.Dispatch<React.SetStateAction<CanvasMessage[]>>;
  setPendingChatPlanId: React.Dispatch<React.SetStateAction<string | null>>;
  pushDebugEvent: (event: Omit<DebugEvent, "id">) => void;
  pushTicker: (message: string) => void;
  hydrate: (nodes: Node[], edges: Edge[]) => void;
  applyLayout: () => void;
  applyGraphMutation: (payload: GraphMutationPayload) => { ok: boolean; error?: string };
  handleDiagramEvent: (msg: Record<string, unknown>) => void;
  reset: () => void;
  clearChatResponseTimeout: () => void;
  resetChatStreamingState: () => void;
  armChatResponseTimeout: () => void;
  failChatRequest: (message?: string, errorCode?: string | null) => void;
  clearPendingTemplateEstimateRequest: () => void;
  subscribeProject: (projectId: string) => void;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  onGenerationComplete?: () => void | Promise<void>;
};

export function handlePipelineMessage(data: unknown, deps: PipelineMessageHandlerDeps): void {
  const msg = data as Record<string, unknown>;

  if (typeof msg.project_id === "string" && deps.targetProjectId && msg.project_id !== deps.targetProjectId) {
    return;
  }

  const incomingTrace = typeof msg.trace_id === "string" ? msg.trace_id : null;
  if (incomingTrace) {
    deps.setTraceId(incomingTrace);
  }

  if (msg.type === "generation_snapshot") {
    const hydrationPayload = parseGenerationSnapshotHydration(msg);
    if (hydrationPayload) {
      const shouldHydrateSnapshot = shouldHydrateGenerationSnapshot({
        generationActive: deps.isGeneratingRef.current,
        nodeCount: deps.latestCanvasShapeRef.current.nodeCount,
        edgeCount: deps.latestCanvasShapeRef.current.edgeCount,
      });
      if (shouldHydrateSnapshot) {
        deps.hydrate(hydrationPayload.nodes as Node[], hydrationPayload.edges as Edge[]);
        if (hasInvalidNodePositions(hydrationPayload.nodes as { position?: { x?: unknown; y?: unknown } }[])) {
          deps.applyLayout();
        }
      } else {
        deps.pushDebugEvent({
          ts: Date.now(),
          level: "warning",
          source: "local",
          stage: deps.currentStage,
          message: "Skipped generation_snapshot canvas hydration during active generation",
          traceId: incomingTrace ?? deps.traceId,
        });
      }
      if (hydrationPayload.costEstimatePayload) {
        const parsedSnapshotCostEstimate = parseIncomingCostEstimate(hydrationPayload.costEstimatePayload);
        if (parsedSnapshotCostEstimate) {
          deps.setCostEstimate(parsedSnapshotCostEstimate);
        }
      }
    }

    const status = typeof msg.generation_status === "string" ? msg.generation_status : null;
    const snapshotTerraformFiles = Array.isArray(msg.terraform_files)
      ? (msg.terraform_files as TerraformFile[])
      : null;
    const snapshotTerraformFileCount = snapshotTerraformFiles?.length ?? 0;
    const appliedSnapshotTerraformFiles = getAppliedSnapshotTerraformFiles(
      deps.terraformFiles,
      snapshotTerraformFiles,
      deps.isGeneratingRef.current,
    );
    if (appliedSnapshotTerraformFiles) {
      if (
        appliedSnapshotTerraformFiles.length !== deps.terraformFiles.length ||
        !appliedSnapshotTerraformFiles.every(
          (f, i) => f.filename === deps.terraformFiles[i]?.filename && f.content === deps.terraformFiles[i]?.content,
        )
      ) {
        deps.pushDebugEvent({
          ts: Date.now(),
          level: "info",
          source: "local",
          stage: "terraform",
          message: `Merging snapshot terraform_files: ${snapshotTerraformFileCount} snapshot + ${deps.terraformFiles.length} existing → ${appliedSnapshotTerraformFiles.length} total`,
          traceId: deps.traceId,
        });
        deps.setTerraformFiles(appliedSnapshotTerraformFiles);
      }
    }

    if (typeof msg.terraform_outdated === "boolean") {
      deps.setTerraformOutdated(msg.terraform_outdated);
    }

    const snapshotAgents = parseGenerationAgentsFromSnapshot(msg);
    if (snapshotAgents) {
      deps.setGenerationAgents(snapshotAgents);
      const hasArchitectureChain = snapshotAgents.some((a) => a.agent === "requirements");
      if (hasArchitectureChain) {
        deps.setArchitectureAgents(snapshotAgents);
      }
    }

    const stage = msg.generation_stage;
    if (typeof stage === "string") deps.setCurrentStage(stage);
    if (stage === "budget_retry") {
      deps.setBudgetRetryState((prev) =>
        reduceBudgetRetryState(prev, {
          stage: "budget_retry",
          event: null,
          message: "Budget optimization retry is running.",
          traceId: incomingTrace ?? deps.traceId,
          timestamp: Date.now(),
        })
      );
    }
    if (status === "queued" || status === "running") {
      deps.setIsGenerating(true);
      deps.setPipelineStatus(typeof stage === "string" ? `Running: ${stage}` : "Generation running...");
      deps.setPipelineErrorCode(null);
      deps.setTerraformProgress((prev) => ({
        ...prev,
        status: "generating",
        activity: typeof stage === "string" ? `Running ${stage}` : "Generation running",
        emittedCount: appliedSnapshotTerraformFiles ? appliedSnapshotTerraformFiles.length : prev.emittedCount,
        lastUpdateAt: Date.now(),
      }));
    }
    if (status === "completed") {
      deps.setBudgetRetryState((prev) =>
        prev.status === "in_progress"
          ? reduceBudgetRetryState(prev, {
              stage: "budget_cap",
              event: "retry_succeeded",
              message: "Budget optimization retry completed.",
              traceId: incomingTrace ?? deps.traceId,
              timestamp: Date.now(),
            })
          : prev
      );
      deps.setIsGenerating(false);
      deps.setPipelineStatus("Architecture ready ✓");
      deps.setPipelineErrorCode(null);
      deps.setTerraformProgress((prev) => ({
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
        currentState: deps.manualTerraformRunState,
        generationStage: typeof stage === "string" ? stage : undefined,
        generationStatus: typeof status === "string" ? status : undefined,
      });
      if (newManualStateCompleted !== null) {
        deps.setManualTerraformRunState(newManualStateCompleted);
      }
    }
    if (status === "failed") {
      const failedMessage = String(msg.generation_error ?? "Generation failed");
      deps.setBudgetRetryState((prev) =>
        prev.status === "in_progress"
          ? reduceBudgetRetryState(prev, {
              stage: "budget_cap",
              event: "retry_failed",
              message: failedMessage,
              traceId: incomingTrace ?? deps.traceId,
              timestamp: Date.now(),
            })
          : prev
      );
      deps.setIsGenerating(false);
      deps.setPipelineStatus(`Error: ${failedMessage}`);
      deps.setPipelineErrorCode(inferPipelineErrorCode(msg, failedMessage));
      deps.setTerraformProgress((prev) => ({
        ...prev,
        status: "failed",
        activity: failedMessage,
        currentFile: null,
        lastUpdateAt: Date.now(),
      }));
      const newManualStateFailed = getManualTerraformRunStateFromSnapshot({
        currentState: deps.manualTerraformRunState,
        generationStage: typeof stage === "string" ? stage : undefined,
        generationStatus: typeof status === "string" ? status : undefined,
      });
      if (newManualStateFailed !== null) {
        deps.setManualTerraformRunState(newManualStateFailed);
      }
    }
    deps.setSetupPdfState((prev) => {
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
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "setup_pdf_status") {
    deps.setSetupPdfState((prev) => ({
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
      deps.setPipelineStatus(msg.message);
    }
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "project_ready") {
    const projectId = msg.project_id;
    const shareSlug = msg.share_slug;
    if (typeof projectId === "string") {
      deps.onProjectReady?.(projectId, typeof shareSlug === "string" ? shareSlug : null);
      deps.setLastEventAt(Date.now());
    }
  }

  if (msg.type === "generation_started") {
    deps.setIsGenerating(true);
    deps.setPipelineStatus("Generation queued...");
    deps.setCurrentStage("queued");
    deps.setGenerationAgents(null);
    deps.setGenerationElapsed(0);
    deps.setGenerationStartedAt(null);
    deps.generationStartedAtRef.current = null;
    deps.setLastEventAt(Date.now());
    deps.pushTicker("queued");
    deps.setTerraformProgress((prev) => ({
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
    deps.setCurrentStage(stage);
    deps.setLastEventAt(Date.now());
    deps.stallWarnedRef.current = false;
    deps.pushTicker(stage ? `${stage}:${String(eventName ?? "event")}` : message);
    deps.pushDebugEvent({
      ts: Date.now(),
      level,
      source: "pipeline",
      stage,
      message,
      traceId: incomingTrace ?? deps.traceId,
      details,
    });
    deps.setBudgetRetryState((prev) =>
      reduceBudgetRetryState(prev, {
        stage,
        event: eventName,
        message,
        details,
        traceId: incomingTrace ?? deps.traceId,
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

      deps.setTerraformProgress((prev) => {
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
      deps.applyLayout();
    }

    if (level === "error") {
      deps.setPipelineStatus(`Error: ${message}`);
    } else {
      deps.setPipelineStatus(message);
    }
  }

  if (msg.type === "status") {
    const message = msg.message as string;
    deps.setPipelineStatus(message);
    deps.setLastEventAt(Date.now());
    deps.setIsGenerating(true);
    deps.pushTicker(message);
  }

  if (msg.type === "diagram_reset") {
    deps.reset();
    deps.setCostEstimate(null);
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "done") {
    deps.setBudgetRetryState((prev) =>
      prev.status === "in_progress"
        ? reduceBudgetRetryState(prev, {
            stage: "budget_cap",
            event: "retry_succeeded",
            message: "Budget optimization retry completed.",
            traceId: incomingTrace ?? deps.traceId,
            timestamp: Date.now(),
          })
        : prev
    );
    deps.setIsGenerating(false);
    deps.setPipelineStatus("Architecture ready ✓");
    deps.setPipelineErrorCode(null);
    const startedAt = deps.generationStartRef.current || Date.now();
    deps.setGenerationElapsed((Date.now() - startedAt) / 1000);
    deps.setLastEventAt(Date.now());
    deps.pushTicker("done");
    deps.setTerraformProgress((prev) => ({
      ...prev,
      status: "completed",
      activity: "Terraform generation complete",
      currentFile: null,
      emittedCount: prev.emittedCount,
      lastUpdateAt: Date.now(),
    }));
    if (deps.manualTerraformRunState === "running") {
      deps.setManualTerraformRunState("completed");
    }
    deps.applyLayout();

    if (deps.onGenerationComplete) {
      void deps.onGenerationComplete();
    }
  }

  if (msg.type === "error") {
    const message = String(msg.message ?? "Unknown error");
    const errorCode = inferPipelineErrorCode(msg, message);
    const toastMessage = pipelineErrorToastMessage(msg.error, message);
    if (toastMessage) {
      toast.error(toastMessage, { position: "bottom-right" });
    }
    deps.clearChatResponseTimeout();
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
      deps.setMessages((prev) => {
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
        deps.messagesRef.current = next;
        return next;
      });
      if (deps.targetProjectId) {
        void deps.subscribeProject(deps.targetProjectId);
      }
    }
    deps.resetChatStreamingState();
    deps.setIsGenerating(false);
    deps.setPipelineStatus(`Error: ${message}`);
    deps.setPipelineErrorCode(errorCode);
    deps.setLastEventAt(Date.now());
    deps.pushTicker("error");
    deps.setTerraformProgress((prev) => ({
      ...prev,
      status: "failed",
      activity: message,
      currentFile: null,
      lastUpdateAt: Date.now(),
    }));
    if (deps.manualTerraformRunState === "running") {
      deps.setManualTerraformRunState("failed");
    }
    deps.setBudgetRetryState((prev) =>
      prev.status === "in_progress"
        ? reduceBudgetRetryState(prev, {
            stage: "budget_cap",
            event: "retry_failed",
            message,
            traceId: incomingTrace ?? deps.traceId,
            timestamp: Date.now(),
          })
        : prev
    );
    deps.pushDebugEvent({
      ts: Date.now(),
      level: "error",
      source: "pipeline",
      stage: deps.currentStage,
      message,
      traceId: incomingTrace ?? deps.traceId,
      details: { error: msg.error as string },
    });
  }

  if (msg.type === "agent_log") {
    deps.setAgentLogs((prev) => {
      const entry: AgentLogEntry = {
        id: Date.now() + Math.random(),
        agent: msg.agent as AgentLogEntry["agent"],
        message: msg.message as string,
        elapsed: msg.elapsed as number,
      };
      return [...prev, entry].slice(-50);
    });
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "generation_agent_update") {
    const obj = msg as Record<string, unknown>;
    const mode = typeof obj.mode === "string" ? obj.mode : null;
    const incomingAgents = parseGenerationAgentUpdate(msg);
    if (incomingAgents) {
      let nextGenerationAgents: GenerationAgentState[];
      if (mode === "code_generation" && deps.architectureAgentsRef.current) {
        nextGenerationAgents = mergeCodeGenerationAgents(deps.architectureAgentsRef.current, incomingAgents);
      } else {
        nextGenerationAgents = incomingAgents;
      }
      deps.setGenerationAgents(nextGenerationAgents);
      const nextArchitectureAgents = getNextArchitectureAgents(
        deps.architectureAgentsRef.current,
        incomingAgents,
        mode,
      );
      if (nextArchitectureAgents !== deps.architectureAgentsRef.current) {
        deps.setArchitectureAgents(nextArchitectureAgents);
      }
      deps.setLastEventAt(Date.now());
    }
  }

  if (msg.type === "generation_agent_event") {
    const event = parseGenerationAgentEvent(msg);
    if (event) {
      if (event.started_at) {
        const backendMs = new Date(event.started_at).getTime();
        deps.generationStartedAtRef.current = isNaN(backendMs) ? Date.now() : backendMs;
        deps.setGenerationStartedAt(deps.generationStartedAtRef.current);
      }
      deps.setGenerationAgents((prev) => {
        if (!prev) return prev;
        return reduceGenerationAgentEvent(prev, event);
      });
      deps.setArchitectureAgents((prev) => {
        if (!prev) return prev;
        return reduceGenerationAgentEvent(prev, event);
      });
      deps.setLastEventAt(Date.now());
    }
  }

  if (msg.type === "terraform_file") {
    deps.pushDebugEvent({
      ts: Date.now(),
      level: "info",
      source: "ws",
      stage: "coder",
      message: `Received terraform_file: ${(msg as { filename?: string }).filename ?? "unknown"}`,
      traceId: deps.traceId,
    });
    deps.setTerraformFiles((prev) => {
      const next = upsertTerraformFile(prev, msg as unknown as TerraformFile);
      deps.setTerraformProgress((progress) => ({
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
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "arch_description") {
    deps.setArchDescription((msg as { type: string; sections: ArchDescription }).sections);
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "cost_estimate") {
    const incomingRequestId =
      typeof msg.request_id === "string" && msg.request_id.trim().length > 0
        ? msg.request_id.trim()
        : null;
    const pendingRequestId = deps.pendingTemplateEstimateRequestIdRef.current;

    if (incomingRequestId) {
      if (!pendingRequestId || incomingRequestId !== pendingRequestId) {
        return;
      }
      const parsed = parseIncomingCostEstimate(msg);
      deps.clearPendingTemplateEstimateRequest();
      if (parsed) {
        deps.setCostEstimate(parsed);
        deps.setLastEventAt(Date.now());
      }
      return;
    }

    if (pendingRequestId) {
      return;
    }

    const parsed = parseIncomingCostEstimate(msg);
    if (parsed) {
      deps.setCostEstimate(parsed);
      deps.setLastEventAt(Date.now());
    }
  }

  if (msg.type === "canvas_edit_ack") {
    if (msg.action === "remove_node" && typeof msg.node_id === "string") {
      deps.setCostEstimate((prev) => removeNodeFromCostEstimate(prev, msg.node_id as string));
    }
  }

  if (msg.type === "diagram_event") {
    deps.handleDiagramEvent(msg);
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "chat_reply_delta") {
    const delta = typeof msg.delta === "string" ? msg.delta : "";
    if (delta) {
      deps.armChatResponseTimeout();
      deps.setIsChatStreaming(true);
      deps.setStreamingAssistantReply((prev) => {
        const next = prev + delta;
        deps.streamingReplyRef.current = next;
        return next;
      });
      deps.setLastEventAt(Date.now());
    }
  }

  if (msg.type === "chat_reply_done") {
    deps.clearChatResponseTimeout();
    const finalMessage =
      typeof msg.message === "string" && msg.message.trim()
        ? msg.message
        : deps.streamingReplyRef.current;
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
      const applyResult = deps.applyGraphMutation(mutationPayload);
      if (!applyResult.ok) {
        const mutationError = applyResult.error ?? "Unknown mutation apply error";
        deps.pushDebugEvent({
          ts: Date.now(),
          level: "warning",
          source: "local",
          stage: deps.currentStage,
          message: `Skipped unsafe graph mutation: ${mutationError}`,
          traceId: incomingTrace ?? deps.traceId,
        });
      }
    }
    if (
      planMeta?.status === "approved" &&
      (planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch")
    ) {
      deps.setTerraformFiles([]);
      deps.setTerraformProgress({
        status: "idle",
        activity: "Terraform files are outdated. Click Generate Terraform to refresh.",
        emittedCount: 0,
        expectedMinFiles: 0,
        currentFile: null,
        lastUpdateAt: Date.now(),
      });
      deps.setIsGenerating(false);
      deps.setPipelineStatus("Architecture updated ✓");
    }
    deps.resetChatStreamingState();
    deps.setPipelineStatus((prev) => clearTransientChatErrorStatus(prev));
    if (finalMessage.trim()) {
      deps.setMessages((prev) => {
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
        deps.messagesRef.current = next;
        return next;
      });
    }
    if (budgetRecovery?.status === "pending") {
      deps.setPipelineErrorCode("budget_cap_unmet");
    } else if (budgetRecovery) {
      deps.setPipelineErrorCode(null);
    }
    if ((planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch") && typeof planMeta.plan_id === "string") {
      if (planMeta.status === "pending") {
        deps.setPendingChatPlanId(planMeta.plan_id);
      } else if (
        planMeta.status === "approved" ||
        planMeta.status === "executed" ||
        planMeta.status === "rejected" ||
        planMeta.status === "cancelled"
      ) {
        deps.setPendingChatPlanId((prev) => (prev === planMeta.plan_id ? null : prev));
      }
    }
    deps.setLastEventAt(Date.now());
  }

  if (msg.type === "chat_reply") {
    deps.clearChatResponseTimeout();
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
    deps.resetChatStreamingState();
    deps.setPipelineStatus((prev) => clearTransientChatErrorStatus(prev));
    deps.setMessages((prev) => {
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
      deps.messagesRef.current = next;
      return next;
    });
    if (budgetRecovery?.status === "pending") {
      deps.setPipelineErrorCode("budget_cap_unmet");
    } else if (budgetRecovery) {
      deps.setPipelineErrorCode(null);
    }
    if (
      (planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch") &&
      planMeta.status === "pending" &&
      typeof planMeta.plan_id === "string"
    ) {
      deps.setPendingChatPlanId(planMeta.plan_id);
    }
    deps.setLastEventAt(Date.now());
  }
}
