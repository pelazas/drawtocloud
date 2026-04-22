import { useCallback } from "react";
import wsClient from "@/lib/websocket";
import { withAccessToken } from "@/lib/generationStart";
import { hasInvalidNodePositions } from "../canvasPipelineUtils";
import type { PipelineState } from "../usePipelineState";
import type { DiagramState } from "../useDiagramState";
import type { TemplateDetail } from "../templates";
import type { CanvasPipelineRefs } from "../canvasPipelineRefs";

export function useLoadTemplate({
  clearPendingTemplateEstimateRequest,
  startPendingTemplateEstimateRequest,
  pipeline,
  diagram,
  refs,
}: {
  clearPendingTemplateEstimateRequest: () => void;
  startPendingTemplateEstimateRequest: (requestId: string) => void;
  pipeline: Pick<
    PipelineState,
    | "setTerraformFiles"
    | "setArchDescription"
    | "setCostEstimate"
    | "setPipelineStatus"
    | "setPipelineErrorCode"
    | "setIsGenerating"
    | "setCurrentStage"
    | "setLastEventAt"
    | "setTerraformProgress"
  >;
  diagram: Pick<DiagramState, "hydrate" | "applyLayout">;
  refs: Pick<CanvasPipelineRefs, "templateEstimateRequestSeqRef">;
}) {
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

  return { loadTemplateSnapshot };
}
