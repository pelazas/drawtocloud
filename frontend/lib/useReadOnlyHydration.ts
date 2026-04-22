import { useEffect } from "react";
import { INITIAL_BUDGET_RETRY_STATE, reduceBudgetRetryState } from "./budgetRetry";
import { setupPdfStateFromProject, getSessionKey, hasInvalidNodePositions, inferPipelineErrorCode, latestPendingChatPlanId } from "./canvasPipelineUtils";
import { projectHydrationSnapshot } from "./canvasHydration";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useReadOnlyHydration({
  appState,
  canvasSession,
  readOnly,
  lastHydratedUpdatedAtRef,
  activeSessionKeyRef,
  pipeline,
  diagram,
  chatActions,
  clearPendingTemplateEstimateRequest,
}: {
  appState: "dashboard" | "questionnaire" | "canvas";
  canvasSession: CanvasSession | null;
  readOnly: boolean;
  lastHydratedUpdatedAtRef: React.MutableRefObject<string | null>;
  activeSessionKeyRef: React.MutableRefObject<string | null>;
  pipeline: React.MutableRefObject<PipelineState>;
  diagram: Pick<DiagramState, "hydrate" | "applyLayout">;
  chatActions: { clearChatResponseTimeout: () => void; resetChatStreamingState: () => void };
  clearPendingTemplateEstimateRequest: () => void;
}) {
  useEffect(() => {
    if (appState !== "canvas" || !canvasSession || !readOnly || canvasSession.mode !== "existing") {
      return;
    }

    const sessionKey = getSessionKey(canvasSession);
    const isFreshSession = activeSessionKeyRef.current !== sessionKey;
    activeSessionKeyRef.current = sessionKey;

    if (isFreshSession || canvasSession.project.updatedAt !== lastHydratedUpdatedAtRef.current) {
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
      pipeline.current.setBudgetRetryState((prev) =>
        reduceBudgetRetryState(prev, {
          stage: "budget_retry",
          event: null,
          message: "Budget optimization retry is running.",
          traceId: canvasSession.project.generationTraceId,
          timestamp: Date.now(),
        })
      );
    } else if (isFreshSession) {
      pipeline.current.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
    }

    const generationActive =
      canvasSession.project.generationStatus === "queued" ||
      canvasSession.project.generationStatus === "running";
    if (generationActive) {
      pipeline.current.setIsGenerating(true);
      pipeline.current.setPipelineStatus("Shared project is still generating...");
      pipeline.current.setPipelineErrorCode(null);
      pipeline.current.setTerraformProgress((prev) => ({
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
      pipeline.current.setIsGenerating(false);
      pipeline.current.setPipelineStatus("Viewing shared project");
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
        ...prev,
        status: canvasSession.project.terraformFiles.length > 0 ? "completed" : "idle",
        activity: canvasSession.project.terraformFiles.length > 0 ? "Terraform ready" : null,
        emittedCount: canvasSession.project.terraformFiles.length,
        currentFile: null,
        lastUpdateAt: Date.now(),
      }));
    }

    return () => {
      clearPendingTemplateEstimateRequest();
      chatActions.clearChatResponseTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs and setters are stable
  }, [
    appState,
    canvasSession,
    readOnly,
    diagram.hydrate,
    diagram.applyLayout,
    chatActions.clearChatResponseTimeout,
    chatActions.resetChatStreamingState,
    clearPendingTemplateEstimateRequest,
  ]);
}
