import { useEffect } from "react";
import { startGenerationViaHttp } from "@/lib/generationStart";
import { INITIAL_BUDGET_RETRY_STATE } from "./budgetRetry";
import { emptySetupPdfState } from "./setupPdf";
import { getSessionKey } from "./canvasPipelineUtils";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useNewProjectHydration({
  appState,
  canvasSession,
  readOnly,
  activeSessionKeyRef,
  generationStartRef,
  generationStartedAtRef,
  stallWarnedRef,
  generationRequestKeyRef,
  pipeline,
  diagram,
  chatActions,
  debugActions,
  queueProjectSubscription,
  onProjectReady,
  clearPendingTemplateEstimateRequest,
  messagesRef,
  traceIdRef,
}: {
  appState: "dashboard" | "questionnaire" | "canvas";
  canvasSession: CanvasSession | null;
  readOnly: boolean;
  activeSessionKeyRef: React.MutableRefObject<string | null>;
  generationStartRef: React.MutableRefObject<number>;
  generationStartedAtRef: React.MutableRefObject<number | null>;
  stallWarnedRef: React.MutableRefObject<boolean>;
  generationRequestKeyRef: React.MutableRefObject<string | null>;
  pipeline: React.MutableRefObject<PipelineState>;
  diagram: Pick<DiagramState, "reset">;
  chatActions: { clearChatResponseTimeout: () => void; resetChatStreamingState: () => void };
  debugActions: { pushDebugEvent: (event: Omit<import("./useCanvasPipeline").DebugEvent, "id">) => void; pushTicker: (message: string) => void };
  queueProjectSubscription: (projectId: string | null) => void;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  clearPendingTemplateEstimateRequest: () => void;
  messagesRef: React.MutableRefObject<import("./projects").CanvasMessage[]>;
  traceIdRef: React.MutableRefObject<string | null>;
}) {
  useEffect(() => {
    if (appState !== "canvas" || !canvasSession || readOnly || canvasSession.mode !== "new") {
      return;
    }

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

    if (isFreshSession) {
      diagram.reset();
      pipeline.current.setPipelineStatus("Starting generation...");
      pipeline.current.setPipelineErrorCode(null);
      pipeline.current.setMessages([]);
      messagesRef.current = [];
      pipeline.current.setTerraformFiles([]);
      pipeline.current.setArchDescription(null);
      pipeline.current.setCostEstimate(null);
      chatActions.clearChatResponseTimeout();
      chatActions.resetChatStreamingState();
      pipeline.current.setAgentLogs([]);
      pipeline.current.setGenerationElapsed(0);
      pipeline.current.setGenerationStartedAt(null);
      generationStartedAtRef.current = null;
      pipeline.current.setStatusTicker([]);
      pipeline.current.setDebugEvents([]);
      pipeline.current.setCurrentStage("start");
      pipeline.current.setTraceId(null);
      pipeline.current.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
      pipeline.current.setSetupPdfState(emptySetupPdfState());
      pipeline.current.setTerraformProgress({
        status: "planning",
        activity: "Planning Terraform files",
        emittedCount: 0,
        expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
        currentFile: null,
        lastUpdateAt: Date.now(),
      });
      pipeline.current.setIsGenerating(true);
      generationStartRef.current = Date.now();
      pipeline.current.setLastEventAt(Date.now());
      stallWarnedRef.current = false;
    }

    void (async () => {
      if (generationRequestKeyRef.current === sessionKey) return;
      generationRequestKeyRef.current = sessionKey;

      try {
        const result = await startGenerationViaHttp(canvasSession.answers, canvasSession.projectId ?? undefined);
        pipeline.current.setTraceId(result.trace_id);
        pipeline.current.setCurrentStage("queued");
        pipeline.current.setPipelineStatus("Generation queued...");
        pipeline.current.setPipelineErrorCode(null);
        debugActions.pushTicker("queued");
        pipeline.current.setTerraformProgress((prev) => ({
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
        pipeline.current.setIsGenerating(false);
        pipeline.current.setPipelineStatus(`Error: ${(error as Error).message}`);
        pipeline.current.setPipelineErrorCode("generation_start_failed");
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

    return () => {
      clearPendingTemplateEstimateRequest();
      chatActions.clearChatResponseTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs and setters are stable
  }, [
    appState,
    canvasSession,
    readOnly,
    diagram.reset,
    chatActions.clearChatResponseTimeout,
    chatActions.resetChatStreamingState,
    debugActions.pushDebugEvent,
    debugActions.pushTicker,
    queueProjectSubscription,
    onProjectReady,
    clearPendingTemplateEstimateRequest,
    generationStartRef,
    generationStartedAtRef,
    stallWarnedRef,
    generationRequestKeyRef,
    messagesRef,
    traceIdRef,
  ]);
}
