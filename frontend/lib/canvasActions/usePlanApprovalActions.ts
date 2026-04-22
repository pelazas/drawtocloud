import { useCallback } from "react";
import wsClient from "@/lib/websocket";
import { withAccessToken } from "@/lib/generationStart";
import { createProject, saveSnapshot } from "../projectApi";
import { requestedChangeForPlan } from "../canvasPipelineUtils";
import type { CanvasSession } from "../projects";
import type { DiagramState } from "../useDiagramState";

export function usePlanApprovalActions({
  chatEnabled,
  pendingChatPlanId,
  canvasSession,
  diagram,
  onProjectReady,
  clearPendingTemplateEstimateRequest,
  setIsGenerating,
  setPipelineStatus,
  setPipelineErrorCode,
  setCurrentStage,
  setLastEventAt,
  messagesRef,
}: {
  chatEnabled: boolean;
  pendingChatPlanId: string | null;
  canvasSession: CanvasSession | null;
  diagram: Pick<DiagramState, "canonicalNodes" | "edges">;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  clearPendingTemplateEstimateRequest: () => void;
  setIsGenerating: (value: boolean) => void;
  setPipelineStatus: (value: string | null) => void;
  setPipelineErrorCode: (value: string | null) => void;
  setCurrentStage: (value: string | null) => void;
  setLastEventAt: (value: number | null) => void;
  messagesRef: React.MutableRefObject<CanvasMessage[]>;
}) {
  const handleApprovePlan = useCallback((planId?: string) => {
    if (!chatEnabled) return;
    const targetPlanId = typeof planId === "string" && planId.trim() ? planId.trim() : pendingChatPlanId;
    if (!targetPlanId) return;
    const planRequestedChange = requestedChangeForPlan(messagesRef.current, targetPlanId);

    clearPendingTemplateEstimateRequest();
    setIsGenerating(true);
    setPipelineStatus("Applying approved chat change...");
    setPipelineErrorCode(null);
    setCurrentStage("queued");
    setLastEventAt(Date.now());
    void (async () => {
      let projectId = canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId ?? null;
      if (!projectId) {
        try {
          const created = await createProject("Untitled Project");
          await saveSnapshot(created.project_id, diagram.canonicalNodes, diagram.edges);
          projectId = created.project_id;
          onProjectReady?.(created.project_id, created.share_slug);
        } catch (error) {
          setIsGenerating(false);
          setPipelineStatus(`Error: ${(error as Error).message}`);
          setPipelineErrorCode("chat_plan_approve_failed");
          return;
        }
      }

      const payload = await withAccessToken({
        type: "chat_plan_approve",
        project_id: projectId,
        plan_id: targetPlanId,
        ...(planRequestedChange ? { requested_change: planRequestedChange } : {}),
      });
      wsClient.send(payload);
    })();
  }, [chatEnabled, pendingChatPlanId, canvasSession, diagram.canonicalNodes, diagram.edges, onProjectReady, clearPendingTemplateEstimateRequest, setIsGenerating, setPipelineStatus, setPipelineErrorCode, setCurrentStage, setLastEventAt, messagesRef]);

  return { handleApprovePlan };
}
