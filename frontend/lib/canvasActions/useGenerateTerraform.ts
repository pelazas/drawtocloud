import { useCallback } from "react";
import wsClient from "@/lib/websocket";
import { withAccessToken } from "@/lib/generationStart";
import { buildGenerateTerraformPayload } from "../pipelineWsPayloads";
import type { PipelineState } from "../usePipelineState";
import type { DiagramState } from "../useDiagramState";
import type { CanvasPipelineRefs } from "../canvasPipelineRefs";

const TERRAFORM_EXPECTED_MIN_FILES = 4;

export function useGenerateTerraform({
  pipeline,
  diagram,
  refs,
  recordDebugEvent,
  activeProjectId,
  canvasHasArchitecture,
}: {
  pipeline: Pick<
    PipelineState,
    | "setGenerationElapsed"
    | "setGenerationStartedAt"
    | "setManualTerraformRunState"
    | "setTerraformFiles"
    | "setTerraformProgress"
  >;
  diagram: Pick<DiagramState, "canonicalNodes" | "edges">;
  refs: Pick<CanvasPipelineRefs, "generationStartedAtRef">;
  recordDebugEvent: (message: string, options?: { stage?: string | null; details?: Record<string, unknown> }) => void;
  activeProjectId: string | null;
  canvasHasArchitecture: boolean;
}) {
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

  return { generateTerraform };
}
