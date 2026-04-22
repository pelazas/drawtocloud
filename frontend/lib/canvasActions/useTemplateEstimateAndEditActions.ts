import { useCallback } from "react";
import wsClient from "@/lib/websocket";
import { withAccessToken } from "@/lib/generationStart";
import { removeNodeFromCostEstimate } from "../canvasPipelineUtils";
import type { CanvasSession } from "../projects";

const TEMPLATE_ESTIMATE_REQUEST_TIMEOUT_MS = 15_000;

export function useTemplateEstimateAndEditActions({
  setCostEstimate,
  canvasSession,
  pendingTemplateEstimateRequestIdRef,
  pendingTemplateEstimateTimeoutRef,
}: {
  setCostEstimate: React.Dispatch<React.SetStateAction<import("../projects").CostBreakdown | null>>;
  canvasSession: CanvasSession | null;
  pendingTemplateEstimateRequestIdRef: React.MutableRefObject<string | null>;
  pendingTemplateEstimateTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const clearPendingTemplateEstimateRequest = useCallback(() => {
    pendingTemplateEstimateRequestIdRef.current = null;
    if (pendingTemplateEstimateTimeoutRef.current !== null) {
      clearTimeout(pendingTemplateEstimateTimeoutRef.current);
      pendingTemplateEstimateTimeoutRef.current = null;
    }
  }, [pendingTemplateEstimateRequestIdRef, pendingTemplateEstimateTimeoutRef]);

  const startPendingTemplateEstimateRequest = useCallback(
    (requestId: string) => {
      clearPendingTemplateEstimateRequest();
      pendingTemplateEstimateRequestIdRef.current = requestId;
      pendingTemplateEstimateTimeoutRef.current = setTimeout(() => {
        if (pendingTemplateEstimateRequestIdRef.current === requestId) {
          pendingTemplateEstimateRequestIdRef.current = null;
        }
        pendingTemplateEstimateTimeoutRef.current = null;
      }, TEMPLATE_ESTIMATE_REQUEST_TIMEOUT_MS);
    },
    [clearPendingTemplateEstimateRequest, pendingTemplateEstimateRequestIdRef, pendingTemplateEstimateTimeoutRef]
  );

  const handleDeleteNodes = useCallback((nodeIds: string[]) => {
    if (!nodeIds.length) return;
    const projectId =
      canvasSession?.mode === "existing"
        ? canvasSession.project.id
        : canvasSession?.projectId ?? null;
    if (!projectId) return;

    for (const id of nodeIds) {
      setCostEstimate((prev) => removeNodeFromCostEstimate(prev, id));
      void (async () => {
        const payload = await withAccessToken({
          type: "canvas_edit",
          action: "remove_node",
          id,
          project_id: projectId,
        });
        wsClient.send(payload);
      })();
    }
  }, [canvasSession, setCostEstimate]);

  return { clearPendingTemplateEstimateRequest, startPendingTemplateEstimateRequest, handleDeleteNodes };
}
