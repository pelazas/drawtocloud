import { useRef } from "react";
import { usePipelineMessageHandler } from "./usePipelineMessageHandler";
import type { PipelineState } from "./usePipelineState";
import type { DiagramState } from "./useDiagramState";
import type { CanvasSession } from "./projects";
import type { CanvasPipelineRefs } from "./canvasPipelineRefs";
import type { DebugEvent } from "./useCanvasPipeline";

export function useCanvasMessageHandler({
  canvasSession,
  pipeline,
  diagram,
  chatActions,
  debugAndConnection,
  templateEstimateAndEdit,
  onProjectReady,
  onGenerationComplete,
  refs,
}: {
  canvasSession: CanvasSession | null;
  pipeline: PipelineState;
  diagram: DiagramState;
  chatActions: { clearChatResponseTimeout: () => void; resetChatStreamingState: () => void; armChatResponseTimeout: () => void; failChatRequest: (message?: string, errorCode?: string | null) => void };
  debugAndConnection: { pushDebugEvent: (event: Omit<DebugEvent, "id">) => void; pushTicker: (message: string) => void };
  templateEstimateAndEdit: { clearPendingTemplateEstimateRequest: () => void };
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  onGenerationComplete?: () => void | Promise<void>;
  refs: CanvasPipelineRefs;
}) {
  const subscribeProjectRef = useRef<(projectId: string) => void>(() => {});

  const handleMessage = usePipelineMessageHandler({
    targetProjectId: canvasSession?.mode === "existing" ? canvasSession.project.id : canvasSession?.projectId ?? null,
    currentStage: pipeline.currentStage, traceId: pipeline.traceId, terraformFiles: pipeline.terraformFiles,
    manualTerraformRunState: pipeline.manualTerraformRunState, isGeneratingRef: refs.isGeneratingRef,
    latestCanvasShapeRef: refs.latestCanvasShapeRef, streamingReplyRef: refs.streamingReplyRef,
    messagesRef: refs.messagesRef, architectureAgentsRef: refs.architectureAgentsRef,
    pendingTemplateEstimateRequestIdRef: refs.pendingTemplateEstimateRequestIdRef,
    generationStartRef: refs.generationStartRef, generationStartedAtRef: refs.generationStartedAtRef,
    stallWarnedRef: refs.stallWarnedRef, setTraceId: pipeline.setTraceId, setIsGenerating: pipeline.setIsGenerating,
    setPipelineStatus: pipeline.setPipelineStatus, setPipelineErrorCode: pipeline.setPipelineErrorCode,
    setTerraformFiles: pipeline.setTerraformFiles, setArchDescription: pipeline.setArchDescription,
    setCostEstimate: pipeline.setCostEstimate, setIsChatStreaming: pipeline.setIsChatStreaming,
    setStreamingAssistantReply: pipeline.setStreamingAssistantReply, setAgentLogs: pipeline.setAgentLogs,
    setGenerationAgents: pipeline.setGenerationAgents, setArchitectureAgents: pipeline.setArchitectureAgents,
    setGenerationElapsed: pipeline.setGenerationElapsed, setGenerationStartedAt: pipeline.setGenerationStartedAt,
    setCurrentStage: pipeline.setCurrentStage, setLastEventAt: pipeline.setLastEventAt,
    setBudgetRetryState: pipeline.setBudgetRetryState, setSetupPdfState: pipeline.setSetupPdfState,
    setTerraformOutdated: pipeline.setTerraformOutdated, setTerraformProgress: pipeline.setTerraformProgress,
    setManualTerraformRunState: pipeline.setManualTerraformRunState, setMessages: pipeline.setMessages,
    setPendingChatPlanId: pipeline.setPendingChatPlanId, pushDebugEvent: debugAndConnection.pushDebugEvent,
    pushTicker: debugAndConnection.pushTicker, hydrate: diagram.hydrate, applyLayout: diagram.applyLayout,
    applyGraphMutation: diagram.applyGraphMutation, handleDiagramEvent: diagram.handleDiagramEvent, reset: diagram.reset,
    clearChatResponseTimeout: chatActions.clearChatResponseTimeout, resetChatStreamingState: chatActions.resetChatStreamingState,
    armChatResponseTimeout: chatActions.armChatResponseTimeout, failChatRequest: chatActions.failChatRequest,
    clearPendingTemplateEstimateRequest: templateEstimateAndEdit.clearPendingTemplateEstimateRequest,
    subscribeProject: (projectId) => subscribeProjectRef.current(projectId), onProjectReady, onGenerationComplete,
  });

  return { handleMessage, subscribeProjectRef };
}
