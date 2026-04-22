import { useEffect } from "react";
import { INITIAL_BUDGET_RETRY_STATE, reduceBudgetRetryState } from "./budgetRetry";
import { setupPdfStateFromProject, getSessionKey, hasInvalidNodePositions, inferPipelineErrorCode, latestPendingChatPlanId } from "./canvasPipelineUtils";
import { projectHydrationSnapshot, shouldHydrateFromProject } from "./canvasHydration";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";
import type { ConnectionState } from "./websocket";
import type { DebugEvent } from "./useCanvasPipeline";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useExistingProjectHydration({
  appState,
  canvasSession,
  readOnly,
  liveSession,
  wsStateRef,
  lastHydratedUpdatedAtRef,
  activeSessionKeyRef,
  pipeline,
  diagram,
  chatActions,
  debugActions,
  queueProjectSubscription,
  clearPendingTemplateEstimateRequest,
}: {
  appState: "dashboard" | "questionnaire" | "canvas";
  canvasSession: CanvasSession | null;
  readOnly: boolean;
  liveSession: boolean;
  wsStateRef: React.MutableRefObject<ConnectionState>;
  lastHydratedUpdatedAtRef: React.MutableRefObject<string | null>;
  activeSessionKeyRef: React.MutableRefObject<string | null>;
  pipeline: React.MutableRefObject<PipelineState>;
  diagram: Pick<DiagramState, "hydrate" | "applyLayout">;
  chatActions: { clearChatResponseTimeout: () => void; resetChatStreamingState: () => void };
  debugActions: { pushDebugEvent: (event: Omit<DebugEvent, "id">) => void; pushTicker: (message: string) => void };
  queueProjectSubscription: (projectId: string | null) => void;
  clearPendingTemplateEstimateRequest: () => void;
}) {
  useEffect(() => {
    if (appState !== "canvas" || !canvasSession || readOnly || canvasSession.mode !== "existing") {
      return;
    }

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

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
      pipeline.current.setMessages(snapshot.chatHistory);
      pipeline.current.setPendingChatPlanId(latestPendingChatPlanId(snapshot.chatHistory));
      pipeline.current.setTerraformFiles(snapshot.terraformFiles);
      pipeline.current.setArchDescription(snapshot.archDescription);
      pipeline.current.setCostEstimate(snapshot.costEstimate);
      pipeline.current.setSetupPdfState(setupPdfStateFromProject(canvasSession.project));
      chatActions.clearChatResponseTimeout();
      chatActions.resetChatStreamingState();
      diagram.hydrate(snapshot.nodes, snapshot.edges);
      if (hasInvalidNodePositions(snapshot.nodes)) {
        diagram.applyLayout();
      }
      lastHydratedUpdatedAtRef.current = snapshot.updatedAt;
    }

    pipeline.current.setTraceId(canvasSession.project.generationTraceId);
    pipeline.current.setCurrentStage(canvasSession.project.generationStage);
    pipeline.current.setLastEventAt(
      canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now()
    );
    if (canvasSession.project.generationStage === "budget_retry") {
      pipeline.current.setBudgetRetryState((prev) => reduceBudgetRetryState(prev, {
        stage: "budget_retry", event: null, message: "Budget optimization retry is running.",
        traceId: canvasSession.project.generationTraceId, timestamp: Date.now(),
      }));
    } else if (isFreshSession) {
      pipeline.current.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
    }

    if (generationActive) {
      pipeline.current.setIsGenerating(true);
      pipeline.current.setPipelineStatus((prev) => prev ?? "Resuming generation...");
      pipeline.current.setPipelineErrorCode(null);
      debugActions.pushTicker(canvasSession.project.generationStage ?? canvasSession.project.generationStatus);
      pipeline.current.setTerraformProgress((prev) => ({
        ...prev, status: "generating",
        activity: canvasSession.project.generationStage ? `Running ${canvasSession.project.generationStage}` : "Generating Terraform files",
        emittedCount: canvasSession.project.terraformFiles.length,
        expectedMinFiles: Math.max(prev.expectedMinFiles, TERRAFORM_EXPECTED_MIN_FILES),
        currentFile: null,
        lastUpdateAt: canvasSession.project.lastEventAt ? Date.parse(canvasSession.project.lastEventAt) : Date.now(),
      }));
    } else {
      pipeline.current.setIsGenerating(false);
      pipeline.current.setPipelineStatus((prev) => prev ?? "Loaded saved project");
      if (canvasSession.project.generationStatus === "failed") {
        pipeline.current.setPipelineErrorCode(
          inferPipelineErrorCode(
            { generation_error: canvasSession.project.generationError },
            canvasSession.project.generationError
          )
        );
      } else {
        pipeline.current.setPipelineErrorCode(null);
      }
      pipeline.current.setTerraformProgress((prev) => ({
        ...prev, status: canvasSession.project.terraformFiles.length > 0 ? "completed" : "idle",
        activity: canvasSession.project.terraformFiles.length > 0 ? "Terraform ready" : null,
        emittedCount: canvasSession.project.terraformFiles.length, currentFile: null, lastUpdateAt: Date.now(),
      }));
    }

    const projectId = canvasSession.project.id;
    queueProjectSubscription(projectId);

    return () => {
      clearPendingTemplateEstimateRequest();
      chatActions.clearChatResponseTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs and setters are stable
  }, [
    appState, canvasSession, readOnly, liveSession,
    diagram.hydrate, diagram.applyLayout,
    chatActions.clearChatResponseTimeout, chatActions.resetChatStreamingState,
    debugActions.pushDebugEvent, debugActions.pushTicker,
    queueProjectSubscription, clearPendingTemplateEstimateRequest,
  ]);
}
