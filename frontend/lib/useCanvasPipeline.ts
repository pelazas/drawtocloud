import { useCallback, useEffect } from "react";
import { useDiagramState } from "@/lib/useDiagramState";
import { CanvasSession } from "@/lib/projects";
import { usePipelineState } from "./usePipelineState";
import { useWebSocketConnection } from "./useWebSocketConnection";
import { useSessionHydration } from "./useSessionHydration";
import { useGenerationTimer } from "./useGenerationTimer";
import { useStallRecovery } from "./useStallRecovery";
import { useCanvasPersist } from "./useCanvasPersist";
import { useDashboardConnection } from "./useDashboardConnection";
import { useCanvasPipelineRefs } from "./useCanvasPipelineRefs";
import { useCanvasMessageHandler } from "./useCanvasMessageHandler";
import { useCanvasPipelineDerived } from "./useCanvasPipelineDerived";
import {
  useChatActions,
  useChatSendActions,
  usePlanApprovalActions,
  useDebugAndConnectionActions,
  useSetupPdfActions,
  useGenerationActions,
  useTemplateEstimateAndEditActions,
} from "./canvasActions";
import { projectContextFromSession } from "./chatProjectContext";
import type { CanvasPipelineOptions } from "./canvasPipelineTypes";
import { INITIAL_BUDGET_RETRY_STATE } from "./budgetRetry";
import { emptySetupPdfState } from "./setupPdf";

export type { AgentLogEntry, DebugEvent, TerraformProgress, CanvasPipelineOptions } from "./canvasPipelineTypes";

export function useCanvasPipeline(
  appState: "dashboard" | "questionnaire" | "canvas",
  canvasSession: CanvasSession | null,
  onGenerationComplete?: () => void | Promise<void>,
  onProjectReady?: (projectId: string, shareSlug: string | null) => void,
  options?: CanvasPipelineOptions
) {
  const diagram = useDiagramState();
  const pipeline = usePipelineState();
  const liveSession = options?.liveSession ?? false;
  const readOnly = options?.readOnly ?? false;

  const { refs, traceIdRef } = useCanvasPipelineRefs(pipeline);

  const chatActions = useChatActions({
    setIsChatStreaming: pipeline.setIsChatStreaming, setStreamingAssistantReply: pipeline.setStreamingAssistantReply,
    setIsGenerating: pipeline.setIsGenerating, setPipelineStatus: pipeline.setPipelineStatus,
    setPipelineErrorCode: pipeline.setPipelineErrorCode, setLastEventAt: pipeline.setLastEventAt,
    chatResponseTimeoutRef: refs.chatResponseTimeoutRef, streamingReplyRef: refs.streamingReplyRef,
  });

  const debugAndConnection = useDebugAndConnectionActions({ pipeline, canvasSession, refs });

  const templateEstimateAndEdit = useTemplateEstimateAndEditActions({
    setCostEstimate: pipeline.setCostEstimate, canvasSession,
    pendingTemplateEstimateRequestIdRef: refs.pendingTemplateEstimateRequestIdRef,
    pendingTemplateEstimateTimeoutRef: refs.pendingTemplateEstimateTimeoutRef,
  });

  const derived = useCanvasPipelineDerived({ readOnly, pipeline, diagram, canvasSession });

  const { handleMessage, subscribeProjectRef } = useCanvasMessageHandler({
    canvasSession, pipeline, diagram, chatActions, debugAndConnection, templateEstimateAndEdit, onProjectReady, onGenerationComplete, refs,
  });

  const wsConnection = useWebSocketConnection({
    enabled: appState === "canvas" && !readOnly,
    onMessage: handleMessage,
    desiredProjectSubscriptionRef: refs.desiredProjectSubscriptionRef,
    onConnectionState: (state) => {
      refs.wsStateRef.current = state;
      pipeline.setWsState(state);
      debugAndConnection.pushDebugEvent({
        ts: Date.now(), level: state === "error" ? "error" : "info", source: "ws",
        stage: pipeline.currentStage, message: `WebSocket state: ${state}`, traceId: pipeline.traceId,
      });
    },
  });

  subscribeProjectRef.current = wsConnection.subscribeProject;

  const chatSend = useChatSendActions({
    canvasSession, chatEnabled: derived.chatEnabled, canvasHasArchitecture: derived.canvasHasArchitecture,
    messages: pipeline.messages, diagram, onProjectReady,
    clearPendingTemplateEstimateRequest: templateEstimateAndEdit.clearPendingTemplateEstimateRequest,
    failChatRequest: chatActions.failChatRequest, armChatResponseTimeout: chatActions.armChatResponseTimeout,
    chatProjectBootstrapRef: refs.chatProjectBootstrapRef, setMessages: pipeline.setMessages, messagesRef: refs.messagesRef,
    setIsChatStreaming: pipeline.setIsChatStreaming, setStreamingAssistantReply: pipeline.setStreamingAssistantReply,
    streamingReplyRef: refs.streamingReplyRef, setPipelineStatus: pipeline.setPipelineStatus,
    setLastEventAt: pipeline.setLastEventAt, setPendingChatPlanId: pipeline.setPendingChatPlanId,
    setIsGenerating: pipeline.setIsGenerating, setPipelineErrorCode: pipeline.setPipelineErrorCode,
  });

  const planApproval = usePlanApprovalActions({
    chatEnabled: derived.chatEnabled, pendingChatPlanId: pipeline.pendingChatPlanId, canvasSession, diagram, onProjectReady,
    clearPendingTemplateEstimateRequest: templateEstimateAndEdit.clearPendingTemplateEstimateRequest,
    setIsGenerating: pipeline.setIsGenerating, setPipelineStatus: pipeline.setPipelineStatus,
    setPipelineErrorCode: pipeline.setPipelineErrorCode, setCurrentStage: pipeline.setCurrentStage,
    setLastEventAt: pipeline.setLastEventAt, messagesRef: refs.messagesRef,
  });

  const setupPdf = useSetupPdfActions({ activeProjectId: derived.activeProjectId, generationCompleted: derived.generationCompleted, readOnly, setSetupPdfState: pipeline.setSetupPdfState });

  const generationActions = useGenerationActions({
    canvasSession, clearPendingTemplateEstimateRequest: templateEstimateAndEdit.clearPendingTemplateEstimateRequest,
    startPendingTemplateEstimateRequest: templateEstimateAndEdit.startPendingTemplateEstimateRequest,
    onProjectReady, queueProjectSubscription: wsConnection.queueProjectSubscription, pipeline, diagram, refs,
    recordDebugEvent: debugAndConnection.recordDebugEvent, activeProjectId: derived.activeProjectId, canvasHasArchitecture: derived.canvasHasArchitecture,
  });

  useSessionHydration({ appState, canvasSession, readOnly, liveSession, wsStateRef: refs.wsStateRef, traceIdRef, pipeline, diagram, chatActions, debugActions: debugAndConnection, queueProjectSubscription: wsConnection.queueProjectSubscription, onProjectReady, generationStartRef: refs.generationStartRef, generationStartedAtRef: refs.generationStartedAtRef, stallWarnedRef: refs.stallWarnedRef, lastHydratedUpdatedAtRef: refs.lastHydratedUpdatedAtRef, activeSessionKeyRef: refs.activeSessionKeyRef, generationRequestKeyRef: refs.generationRequestKeyRef, clearPendingTemplateEstimateRequest: templateEstimateAndEdit.clearPendingTemplateEstimateRequest, messagesRef: refs.messagesRef });

  useGenerationTimer({ isGenerating: pipeline.isGenerating, generationStartedAt: pipeline.generationStartedAt, generationStartedAtRef: refs.generationStartedAtRef, setGenerationElapsed: pipeline.setGenerationElapsed });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Ref is stable
  useEffect(() => { refs.latestCanvasShapeRef.current = { nodeCount: diagram.nodes.length, edgeCount: diagram.edges.length }; }, [diagram.nodes.length, diagram.edges.length]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Ref is stable
  useEffect(() => { if (projectContextFromSession(canvasSession) || appState === "canvas") { refs.chatProjectBootstrapRef.current = { context: null, pending: null }; } }, [appState, canvasSession]);

  useStallRecovery({ isGenerating: pipeline.isGenerating, lastEventAt: pipeline.lastEventAt, currentStage: pipeline.currentStage, traceId: pipeline.traceId, pushDebugEvent: debugAndConnection.pushDebugEvent, pushTicker: debugAndConnection.pushTicker, recoverFromGenerationStall: debugAndConnection.recoverFromGenerationStall, stallWarnedRef: refs.stallWarnedRef, setPipelineStatus: pipeline.setPipelineStatus });

  const canvasPersist = useCanvasPersist({ activeProjectId: derived.activeProjectId, readOnly, currentStage: pipeline.currentStage, traceId: pipeline.traceId, pushDebugEvent: debugAndConnection.pushDebugEvent, setTerraformOutdated: pipeline.setTerraformOutdated, setSetupPdfState: pipeline.setSetupPdfState, diagram });

  useDashboardConnection({ appState, readOnly, pipeline: { setIsChatStreaming: pipeline.setIsChatStreaming, setStreamingAssistantReply: pipeline.setStreamingAssistantReply, setLastEventAt: pipeline.setLastEventAt, setMessages: pipeline.setMessages, setPipelineStatus: pipeline.setPipelineStatus, setPipelineErrorCode: pipeline.setPipelineErrorCode, setPendingChatPlanId: pipeline.setPendingChatPlanId, isChatStreaming: pipeline.isChatStreaming, setWsState: pipeline.setWsState, setIsGenerating: pipeline.setIsGenerating }, chatActions, wsStateRef: refs.wsStateRef, onProjectReady, streamingReplyRef: refs.streamingReplyRef, messagesRef: refs.messagesRef, chatProjectBootstrapRef: refs.chatProjectBootstrapRef });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Setters are stable
  useEffect(() => { pipeline.setArchitectureAgents(null); }, [derived.activeProjectId]);

  const reset = useCallback(() => {
    diagram.reset();
    pipeline.setMessages([]);
    pipeline.setPendingChatPlanId(null);
    pipeline.setPipelineStatus(null);
    pipeline.setPipelineErrorCode(null);
    pipeline.setTerraformFiles([]);
    pipeline.setArchDescription(null);
    pipeline.setCostEstimate(null);
    pipeline.setIsChatStreaming(false);
    pipeline.setStreamingAssistantReply("");
    pipeline.setIsGenerating(false);
    pipeline.setAgentLogs([]);
    pipeline.setGenerationAgents(null);
    pipeline.setArchitectureAgents(null);
    pipeline.setGenerationElapsed(0);
    pipeline.setGenerationStartedAt(null);
    pipeline.setStatusTicker([]);
    pipeline.setDebugEvents([]);
    pipeline.setCurrentStage(null);
    pipeline.setTraceId(null);
    pipeline.setLastEventAt(null);
    pipeline.setBudgetRetryState(INITIAL_BUDGET_RETRY_STATE);
    pipeline.setSetupPdfState(emptySetupPdfState());
    pipeline.setTerraformOutdated(false);
    pipeline.setTerraformProgress({
      status: "idle",
      activity: null,
      emittedCount: 0,
      expectedMinFiles: 4,
      currentFile: null,
      lastUpdateAt: null,
    });
    pipeline.setManualTerraformRunState("idle");
  }, [diagram, pipeline]);

  return { ...diagram, reset, messages: derived.displayedMessages, pipelineStatus: pipeline.pipelineStatus, pipelineErrorCode: pipeline.pipelineErrorCode, terraformFiles: pipeline.terraformFiles, archDescription: pipeline.archDescription, costEstimate: pipeline.costEstimate, budgetRetryState: pipeline.budgetRetryState, terraformProgress: pipeline.terraformProgress, terraformOutdated: pipeline.terraformOutdated, isGenerating: pipeline.isGenerating, agentLogs: pipeline.agentLogs, generationAgents: pipeline.generationAgents, architectureAgents: pipeline.architectureAgents, generationElapsed: pipeline.generationElapsed, wsState: pipeline.wsState, statusTicker: pipeline.statusTicker, debugEvents: pipeline.debugEvents, currentStage: pipeline.currentStage, traceId: pipeline.traceId, lastEventAt: pipeline.lastEventAt, selectedNodes: derived.selectedNodes, handleReconnect: debugAndConnection.handleReconnect, copyDebugReport: debugAndConnection.copyDebugReport, recordDebugEvent: debugAndConnection.recordDebugEvent, isChatStreaming: pipeline.isChatStreaming, hasArchitecture: derived.canvasHasArchitecture, chatEnabled: derived.chatEnabled, chatDisabledReason: derived.chatDisabledReason, activeProjectId: derived.activeProjectId, generationCompleted: derived.generationCompleted, setupPdfState: pipeline.setupPdfState, requestSetupPdfGeneration: setupPdf.requestSetupPdfGeneration, requestSetupPdfDownload: setupPdf.requestSetupPdfDownload, handleSend: chatSend.handleSend, handleBudgetRecoveryAction: chatSend.handleBudgetRecoveryAction, handleApprovePlan: planApproval.handleApprovePlan, pendingArchitecturePlanId: pipeline.pendingChatPlanId, handleDeleteNodes: templateEstimateAndEdit.handleDeleteNodes, startGenerationFromAnswers: generationActions.startGenerationFromAnswers, loadTemplateSnapshot: generationActions.loadTemplateSnapshot, generateTerraform: generationActions.generateTerraform, scheduleCanvasPersist: canvasPersist.scheduleCanvasPersist, isManualTerraformRun: derived.isManualTerraformRun };
}
