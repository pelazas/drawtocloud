import { useCallback } from "react";
import { toast } from "sonner";
import wsClient from "@/lib/websocket";
import { withAccessToken, isQuotaExceededError, startGenerationViaHttp } from "@/lib/generationStart";
import { INITIAL_BUDGET_RETRY_STATE } from "../budgetRetry";
import { buildGenerateTerraformPayload } from "../pipelineWsPayloads";
import { hasInvalidNodePositions } from "../canvasPipelineUtils";
import { resolveGenerationProjectId } from "../generationSession";
import type { PipelineState } from "../usePipelineState";
import type { CanvasSession, QuestionnaireAnswers } from "../projects";
import type { DiagramState } from "../useDiagramState";
import type { TemplateDetail } from "../templates";
import type { CanvasPipelineRefs } from "../canvasPipelineRefs";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useGenerationActions({
  canvasSession,
  clearPendingTemplateEstimateRequest,
  startPendingTemplateEstimateRequest,
  onProjectReady,
  queueProjectSubscription,
  pipeline,
  diagram,
  refs,
  recordDebugEvent,
  activeProjectId,
  canvasHasArchitecture,
}: {
  canvasSession: CanvasSession | null;
  clearPendingTemplateEstimateRequest: () => void;
  startPendingTemplateEstimateRequest: (requestId: string) => void;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  queueProjectSubscription: (projectId: string | null) => void;
  pipeline: Pick<PipelineState, "setIsGenerating" | "setPipelineStatus" | "setPipelineErrorCode" | "setCurrentStage" | "setCostEstimate" | "setLastEventAt" | "setTerraformProgress" | "setTraceId" | "setTerraformFiles" | "setArchDescription" | "setManualTerraformRunState" | "setGenerationElapsed" | "setGenerationStartedAt" | "setBudgetRetryState">;
  diagram: Pick<DiagramState, "canonicalNodes" | "edges" | "hydrate" | "applyLayout">;
  refs: Pick<CanvasPipelineRefs, "generationStartRef" | "generationStartedAtRef" | "templateEstimateRequestSeqRef">;
  recordDebugEvent: (message: string, options?: { stage?: string | null; details?: Record<string, unknown> }) => void;
  activeProjectId: string | null;
  canvasHasArchitecture: boolean;
}) {
  const startGenerationFromAnswers = useCallback(async (
    answers: QuestionnaireAnswers,
    options?: { forceNewProject?: boolean }
  ) => {
    const projectId = resolveGenerationProjectId(canvasSession, {
      forceNewProject: options?.forceNewProject === true,
    });
    if (!projectId && options?.forceNewProject !== true) return;

    clearPendingTemplateEstimateRequest();
    pipeline.setIsGenerating(false);
    pipeline.setPipelineStatus("Starting generation...");
    pipeline.setPipelineErrorCode(null);
    pipeline.setCurrentStage("start");
    pipeline.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
    pipeline.setCostEstimate(null);
    refs.generationStartRef.current = Date.now();
    pipeline.setLastEventAt(Date.now());
    pipeline.setTerraformProgress({
      status: "planning",
      activity: "Planning Terraform files",
      emittedCount: 0,
      expectedMinFiles: TERRAFORM_EXPECTED_MIN_FILES,
      currentFile: null,
      lastUpdateAt: Date.now(),
    });

    try {
      const result = await startGenerationViaHttp(answers, projectId);
      pipeline.setTraceId(result.trace_id);
      pipeline.setPipelineStatus("Generation queued...");
      pipeline.setPipelineErrorCode(null);
      pipeline.setCurrentStage("queued");
      if (result.project_id) {
        queueProjectSubscription(result.project_id);
      }
      onProjectReady?.(result.project_id, result.share_slug);
    } catch (error) {
      pipeline.setIsGenerating(false);
      pipeline.setPipelineStatus(`Error: ${(error as Error).message}`);
      pipeline.setPipelineErrorCode("generation_start_failed");
      if (isQuotaExceededError(error)) {
        toast.error("Quota reached, set your own AI key to keep using.", { position: "bottom-right" });
      }
    }
  }, [canvasSession, clearPendingTemplateEstimateRequest, onProjectReady, queueProjectSubscription, pipeline, refs]);

  const loadTemplateSnapshot = useCallback(
    (data: TemplateDetail) => {
      clearPendingTemplateEstimateRequest();
      diagram.hydrate(data.nodes, data.edges);
      pipeline.setTerraformFiles(data.terraform_files);
      pipeline.setArchDescription(data.arch_description);
      pipeline.setCostEstimate(data.cost_estimate);
      pipeline.setPipelineStatus("Template loaded");
      pipeline.setPipelineErrorCode(null);
      pipeline.setIsGenerating(false);
      pipeline.setCurrentStage("completed");
      pipeline.setLastEventAt(Date.now());
      pipeline.setTerraformProgress((prev) => ({
        ...prev,
        status: data.terraform_files.length > 0 ? "completed" : "idle",
        activity: data.terraform_files.length > 0 ? "Terraform ready" : null,
        emittedCount: data.terraform_files.length,
        currentFile: null,
        lastUpdateAt: Date.now(),
      }));
      if (hasInvalidNodePositions(data.nodes)) {
        diagram.applyLayout();
      }

      if (data.cost_estimate == null && data.nodes.length > 0) {
        refs.templateEstimateRequestSeqRef.current += 1;
        const requestId = `template-estimate:${Date.now()}:${refs.templateEstimateRequestSeqRef.current}`;
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
    [clearPendingTemplateEstimateRequest, diagram, pipeline, refs, startPendingTemplateEstimateRequest]
  );

  const generateTerraform = useCallback(async () => {
    const projectId = activeProjectId;
    if (!projectId || !canvasHasArchitecture) return;

    pipeline.setGenerationElapsed(0);
    pipeline.setGenerationStartedAt(null);
    refs.generationStartedAtRef.current = Date.now();

    recordDebugEvent("Manual Terraform generation requested", {
      stage: "coder",
      details: { project_id: projectId },
    });

    pipeline.setManualTerraformRunState("running");
    pipeline.setTerraformFiles([]);
    pipeline.setTerraformProgress({
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
      pipeline.setManualTerraformRunState("failed");
      pipeline.setTerraformProgress((prev) => ({
        ...prev,
        status: "failed",
        activity: "Connection lost. Please try again.",
        currentFile: null,
        lastUpdateAt: Date.now(),
      }));
      return;
    }
  }, [activeProjectId, canvasHasArchitecture, diagram.canonicalNodes, diagram.edges, recordDebugEvent, pipeline, refs]);

  return { startGenerationFromAnswers, loadTemplateSnapshot, generateTerraform };
}
