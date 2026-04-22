import { useCallback } from "react";
import { toast } from "sonner";
import { isQuotaExceededError, startGenerationViaHttp } from "@/lib/generationStart";
import { INITIAL_BUDGET_RETRY_STATE } from "../budgetRetry";
import { resolveGenerationProjectId } from "../generationSession";
import type { PipelineState } from "../usePipelineState";
import type { CanvasSession, QuestionnaireAnswers } from "../projects";
import type { CanvasPipelineRefs } from "../canvasPipelineRefs";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useStartGeneration({
  canvasSession,
  clearPendingTemplateEstimateRequest,
  onProjectReady,
  queueProjectSubscription,
  pipeline,
  refs,
}: {
  canvasSession: CanvasSession | null;
  clearPendingTemplateEstimateRequest: () => void;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  queueProjectSubscription: (projectId: string | null) => void;
  pipeline: Pick<
    PipelineState,
    | "setIsGenerating"
    | "setPipelineStatus"
    | "setPipelineErrorCode"
    | "setCurrentStage"
    | "setCostEstimate"
    | "setLastEventAt"
    | "setTerraformProgress"
    | "setTraceId"
    | "setBudgetRetryState"
  >;
  refs: Pick<CanvasPipelineRefs, "generationStartRef">;
}) {
  const startGenerationFromAnswers = useCallback(
    async (answers: QuestionnaireAnswers, options?: { forceNewProject?: boolean }) => {
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
    },
    [canvasSession, clearPendingTemplateEstimateRequest, onProjectReady, queueProjectSubscription, pipeline, refs]
  );

  return { startGenerationFromAnswers };
}
