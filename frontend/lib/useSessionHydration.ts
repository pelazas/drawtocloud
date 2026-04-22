import { useEffect } from "react";
import { startGenerationViaHttp } from "@/lib/generationStart";
import { INITIAL_BUDGET_RETRY_STATE, reduceBudgetRetryState } from "./budgetRetry";
import { emptySetupPdfState } from "./setupPdf";
import { getSessionKey, hasInvalidNodePositions, inferPipelineErrorCode, latestPendingChatPlanId, setupPdfStateFromProject } from "./canvasPipelineUtils";
import { projectHydrationSnapshot, shouldHydrateFromProject } from "./canvasHydration";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";
import type { CanvasPipelineRefs } from "./canvasPipelineRefs";
import type { ConnectionState } from "./websocket";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useSessionHydration({
  appState,
  canvasSession,
  readOnly,
  liveSession,
  wsStateRef,
  traceIdRef,
  pipeline,
  diagram,
  chatActions,
  debugActions,
  queueProjectSubscription,
  onProjectReady,
  generationStartRef,
  generationStartedAtRef,
  stallWarnedRef,
  lastHydratedUpdatedAtRef,
  activeSessionKeyRef,
  generationRequestKeyRef,
  clearPendingTemplateEstimateRequest,
}: {
  appState: "dashboard" | "questionnaire" | "canvas";
  canvasSession: CanvasSession | null;
  readOnly: boolean;
  liveSession: boolean;
  wsStateRef: React.MutableRefObject<ConnectionState>;
  traceIdRef: React.MutableRefObject<string | null>;
  pipeline: PipelineState;
  diagram: Pick<DiagramState, "reset" | "hydrate" | "applyLayout">;
  chatActions: { clearChatResponseTimeout: () => void; resetChatStreamingState: () => void };
  debugActions: { pushDebugEvent: (event: Omit<import("./useCanvasPipeline").DebugEvent, "id">) => void; pushTicker: (message: string) => void };
  queueProjectSubscription: (projectId: string | null) => void;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  generationStartRef: React.MutableRefObject<number>;
  generationStartedAtRef: React.MutableRefObject<number | null>;
  stallWarnedRef: React.MutableRefObject<boolean>;
  lastHydratedUpdatedAtRef: React.MutableRefObject<string | null>;
  activeSessionKeyRef: React.MutableRefObject<string | null>;
  generationRequestKeyRef: React.MutableRefObject<string | null>;
  clearPendingTemplateEstimateRequest: () => void;
  messagesRef: React.MutableRefObject<import("./projects").CanvasMessage[]>;
}) {
  useEffect(() => {
    if (appState !== "canvas" || !canvasSession) {
      return;
    }

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

    if (readOnly && canvasSession.mode === "existing") {
      if (isFreshSession || canvasSession.project.updatedAt !== lastHydratedUpdatedAtRef.current) {
        const snapshot = projectHydrationSnapshot(canvasSession.project);
        pipeline.setMessages(snapshot.chatHistory);
        pipeline.setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
        pipeline.setTerraformFiles(snapshot.terraformFiles);
        pipeline.setArchDescription(snapshot.archDescription);
        pipeline.setCostEstimate(snapshot.costEstimate);
        pipeline.setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
        chatActions.clearChatResponseTimeout();
        chatActions.resetChatStreamingState();
        diagram.hydrate(snapshot.nodes, snapshot.edges);
        if (hasInvalidNodePositions(snapshot.nodes)) {
          diagram.applyLayout();
        }
        lastHydratedUpdatedAtRef.current = snapshot.updatedAt;
      }

      pipeline.setTraceId(canvasSession.project.generationTraceId);
      pipeline.setCurrentStage(canvasSession.project.generationStage);
      pipeline.setLastEventAt(canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now());
      if (canvasSession.project.generationStage === "budget_retry") {
        pipeline.setBudgetRetryState((prev) =>
          reduceBudgetRetryState(prev, {
            stage: "budget_retry",
            event: null,
            message: "Budget optimization retry is running.",
            traceId: canvasSession.project.generationTraceId,
            timestamp: Date.now(),
          })
        );
      } else if (isFreshSession) {
        pipeline.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
      }

      const generationActive =
        canvasSession.project.generationStatus === "queued" ||
        canvasSession.project.generationStatus === "running";
      if (generationActive) {
        pipeline.setIsGenerating(true);
        pipeline.setPipelineStatus("Shared project is still generating...");
        pipeline.setPipelineErrorCode(null);
        pipeline.setTerraformProgress((prev) => ({
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
        pipeline.setIsGenerating(false);
        pipeline.setPipelineStatus("Viewing shared project");
        if (canvasSession.project.generationStatus === "failed") {
          pipeline.setPipelineErrorCode(
            inferPipelineErrorCode(
              { generation_error: canvasSession.project.generationError },
              canvasSession.project.generationError
            )
          );
        } else {
          pipeline.setPipelineErrorCode(null);
        }
        pipeline.setTerraformProgress((prev) => ({
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

    if (canvasSession.mode === "new") {
      if (isFreshSession) {
        diagram.reset();
        pipeline.setPipelineStatus("Starting generation...");
        pipeline.setPipelineErrorCode(null);
        pipeline.setMessages([]);
        messagesRef.current = [];
        pipeline.setTerraformFiles([]);
        pipeline.setArchDescription(null);
        pipeline.setCostEstimate(null);
        chatActions.clearChatResponseTimeout();
        chatActions.resetChatStreamingState();
        pipeline.setAgentLogs([]);
        pipeline.setGenerationElapsed(0);
        pipeline.setGenerationStartedAt(null);
        generationStartedAtRef.current = null;
        pipeline.setStatusTicker([]);
        pipeline.setDebugEvents([]);
        pipeline.setCurrentStage("start");
        pipeline.setTraceId(null);
        pipeline.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
        pipeline.setSetupPdfState(emptySetupPdfState());
        pipeline.setTerraformProgress({
          status: "planning",
          activity: "Planning Terraform files",
          emittedCount: 0,
          expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
          currentFile: null,
          lastUpdateAt: Date.now(),
        });
        pipeline.setIsGenerating(true);
        generationStartRef.current = Date.now();
        pipeline.setLastEventAt(Date.now());
        stallWarnedRef.current = false;
      }

      void (async () => {
        if (generationRequestKeyRef.current === sessionKey) return;
        generationRequestKeyRef.current = sessionKey;

        try {
          const result = await startGenerationViaHttp(canvasSession.answers, canvasSession.projectId ?? undefined);
          pipeline.setTraceId(result.trace_id);
          pipeline.setCurrentStage("queued");
          pipeline.setPipelineStatus("Generation queued...");
          pipeline.setPipelineErrorCode(null);
          debugActions.pushTicker("queued");
          pipeline.setTerraformProgress((prev) => ({
            ...prev,
            status: "planning",
            activity: "Queued for generation",
            lastUpdateAt: Date.now(),
          }));
          debugActions.pushDebugEvent({
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
          pipeline.setIsGenerating(false);
          pipeline.setPipelineStatus(`Error: ${(error as Error).message}`);
          pipeline.setPipelineErrorCode("generation_start_failed");
          debugActions.pushTicker("error");
          debugActions.pushDebugEvent({
            ts: Date.now(),
            level: "error",
            source: "pipeline",
            stage: "start",
            message: (error as Error).message,
            traceId: traceIdRef.current,
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
        pipeline.setMessages(snapshot.chatHistory);
        pipeline.setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
        pipeline.setTerraformFiles(snapshot.terraformFiles);
        pipeline.setArchDescription(snapshot.archDescription);
        pipeline.setCostEstimate(snapshot.costEstimate);
        pipeline.setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
        chatActions.clearChatResponseTimeout();
        chatActions.resetChatStreamingState();
        diagram.hydrate(snapshot.nodes, snapshot.edges);
        if (hasInvalidNodePositions(snapshot.nodes)) {
          diagram.applyLayout();
        }
        lastHydratedUpdatedAtRef.current = snapshot.updatedAt;
      }

      pipeline.setTraceId(canvasSession.project.generationTraceId);
      pipeline.setCurrentStage(canvasSession.project.generationStage);
      pipeline.setLastEventAt(canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now());
      if (canvasSession.project.generationStage === "budget_retry") {
        pipeline.setBudgetRetryState((prev) =>
          reduceBudgetRetryState(prev, {
            stage: "budget_retry",
            event: null,
            message: "Budget optimization retry is running.",
            traceId: canvasSession.project.generationTraceId,
            timestamp: Date.now(),
          })
        );
      } else if (isFreshSession) {
        pipeline.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
      }

      if (generationActive) {
        pipeline.setIsGenerating(true);
        pipeline.setPipelineStatus((prev) => prev ?? "Resuming generation...");
        pipeline.setPipelineErrorCode(null);
        debugActions.pushTicker(canvasSession.project.generationStage ?? canvasSession.project.generationStatus);
        pipeline.setTerraformProgress((prev) => ({
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
        pipeline.setIsGenerating(false);
        pipeline.setPipelineStatus((prev) => prev ?? "Loaded saved project");
        if (canvasSession.project.generationStatus === "failed") {
          pipeline.setPipelineErrorCode(
            inferPipelineErrorCode(
              { generation_error: canvasSession.project.generationError },
              canvasSession.project.generationError
            )
          );
        } else {
          pipeline.setPipelineErrorCode(null);
        }
        pipeline.setTerraformProgress((prev) => ({
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

    return () => {
      clearPendingTemplateEstimateRequest();
      chatActions.clearChatResponseTimeout();
    };
  }, [appState, canvasSession, readOnly, liveSession, onProjectReady, diagram.reset, diagram.hydrate, diagram.applyLayout, queueProjectSubscription, chatActions.clearChatResponseTimeout, chatActions.resetChatStreamingState, debugActions.pushDebugEvent, debugActions.pushTicker, clearPendingTemplateEstimateRequest, pipeline]);
}
