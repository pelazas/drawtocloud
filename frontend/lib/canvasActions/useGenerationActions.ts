import { useStartGeneration } from "./useStartGeneration";
import { useLoadTemplate } from "./useLoadTemplate";
import { useGenerateTerraform } from "./useGenerateTerraform";
import type { PipelineState } from "../usePipelineState";
import type { CanvasSession } from "../projects";
import type { DiagramState } from "../useDiagramState";
import type { CanvasPipelineRefs } from "../canvasPipelineRefs";

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
    | "setTerraformFiles"
    | "setArchDescription"
    | "setManualTerraformRunState"
    | "setGenerationElapsed"
    | "setGenerationStartedAt"
    | "setBudgetRetryState"
  >;
  diagram: Pick<DiagramState, "canonicalNodes" | "edges" | "hydrate" | "applyLayout">;
  refs: Pick<CanvasPipelineRefs, "generationStartRef" | "generationStartedAtRef" | "templateEstimateRequestSeqRef">;
  recordDebugEvent: (message: string, options?: { stage?: string | null; details?: Record<string, unknown> }) => void;
  activeProjectId: string | null;
  canvasHasArchitecture: boolean;
}) {
  const { startGenerationFromAnswers } = useStartGeneration({
    canvasSession,
    clearPendingTemplateEstimateRequest,
    onProjectReady,
    queueProjectSubscription,
    pipeline,
    refs,
  });
  const { loadTemplateSnapshot } = useLoadTemplate({
    clearPendingTemplateEstimateRequest,
    startPendingTemplateEstimateRequest,
    pipeline,
    diagram,
    refs,
  });
  const { generateTerraform } = useGenerateTerraform({
    pipeline,
    diagram,
    refs,
    recordDebugEvent,
    activeProjectId,
    canvasHasArchitecture,
  });

  return { startGenerationFromAnswers, loadTemplateSnapshot, generateTerraform };
}
