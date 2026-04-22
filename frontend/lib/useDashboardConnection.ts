import { useCallback, useEffect, useRef } from "react";
import { useWebSocketConnection } from "./useWebSocketConnection";
import { parseBudgetRecoveryMetadata } from "./budgetCapRecovery";
import { inferPipelineErrorCode } from "./canvasPipelineUtils";
import { clearTransientChatErrorStatus } from "./chatPipelineStatus";
import type { PipelineState } from "./usePipelineState";
import type { CanvasMessage } from "./projects";
import type { CanvasPipelineRefs } from "./canvasPipelineRefs";
import type { ConnectionState } from "./websocket";

export function useDashboardConnection({
  appState,
  readOnly,
  pipeline,
  chatActions,
  wsStateRef,
  onProjectReady,
  streamingReplyRef,
  messagesRef,
  chatProjectBootstrapRef,
}: {
  appState: "dashboard" | "questionnaire" | "canvas";
  readOnly: boolean;
  pipeline: Pick<PipelineState, "setIsChatStreaming" | "setStreamingAssistantReply" | "setLastEventAt" | "setMessages" | "setPipelineStatus" | "setPipelineErrorCode" | "setPendingChatPlanId" | "isChatStreaming" | "setWsState">;
  chatActions: { armChatResponseTimeout: () => void; clearChatResponseTimeout: () => void; resetChatStreamingState: () => void; failChatRequest: (message?: string) => void };
  wsStateRef: React.MutableRefObject<ConnectionState>;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  streamingReplyRef: React.MutableRefObject<string>;
  messagesRef: React.MutableRefObject<CanvasMessage[]>;
  chatProjectBootstrapRef: React.MutableRefObject<import("./chatProjectContext").ChatProjectBootstrapState>;
}) {
  const onProjectReadyRef = useRef(onProjectReady);
  useEffect(() => { onProjectReadyRef.current = onProjectReady; }, [onProjectReady]);

  const handleDashboardMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (typeof msg.project_id === "string" && msg.project_id.trim()) {
      const bootstrappedProjectId = chatProjectBootstrapRef.current.context?.projectId;
      if (!bootstrappedProjectId || msg.project_id !== bootstrappedProjectId) {
        return;
      }
    }

    if (msg.type === "chat_reply_delta") {
      const delta = typeof msg.delta === "string" ? msg.delta : "";
      if (delta) {
        chatActions.armChatResponseTimeout();
        pipeline.setIsChatStreaming(true);
        pipeline.setStreamingAssistantReply((prev) => {
          const next = prev + delta;
          streamingReplyRef.current = next;
          return next;
        });
        pipeline.setLastEventAt(Date.now());
      }
    }

    if (msg.type === "chat_reply_done") {
      chatActions.clearChatResponseTimeout();
      const finalMessage =
        typeof msg.message === "string" && msg.message.trim()
          ? msg.message
          : streamingReplyRef.current;
      const planReady = msg.plan_ready === true;
      const executionMode =
        msg.execution_mode === "node_patch" ||
        msg.execution_mode === "architecture_refactor" ||
        msg.execution_mode === "plan_only" ||
        msg.execution_mode === "chat_only"
          ? (msg.execution_mode as CanvasMessage["executionMode"])
          : undefined;
      const planMeta =
        typeof msg.plan_meta === "object" && msg.plan_meta !== null
          ? (msg.plan_meta as CanvasMessage["planMeta"])
          : undefined;
      const budgetRecovery = parseBudgetRecoveryMetadata(msg) ?? undefined;

      chatActions.resetChatStreamingState();
      pipeline.setPipelineStatus((prev) => clearTransientChatErrorStatus(prev));
      if (finalMessage.trim()) {
        pipeline.setMessages((prev) => {
          const next = [
            ...prev,
            {
              role: "assistant" as const,
              content: finalMessage,
              planReady,
              executionMode,
              planMeta,
              ...(budgetRecovery ? { budgetRecovery } : {}),
            },
          ];
          messagesRef.current = next;
          return next;
        });
      }
      if (budgetRecovery?.status === "pending") {
        pipeline.setPipelineErrorCode("budget_cap_unmet");
      } else if (budgetRecovery) {
        pipeline.setPipelineErrorCode(null);
      }

      if ((planMeta?.type === "architecture_refactor" || planMeta?.type === "node_patch") && typeof planMeta.plan_id === "string") {
        if (planMeta.status === "pending") {
          pipeline.setPendingChatPlanId(planMeta.plan_id);
        } else if (
          planMeta.status === "approved" ||
          planMeta.status === "executed" ||
          planMeta.status === "rejected" ||
          planMeta.status === "cancelled"
        ) {
          pipeline.setPendingChatPlanId((prev) => (prev === planMeta.plan_id ? null : prev));
        }
      }
      pipeline.setLastEventAt(Date.now());
    }

    if (msg.type === "error") {
      const message = String(msg.message ?? "Unknown error");
      const errorCode = inferPipelineErrorCode(msg, message);
      chatActions.clearChatResponseTimeout();
      chatActions.resetChatStreamingState();
      pipeline.setIsGenerating(false);
      pipeline.setPipelineStatus(`Error: ${message}`);
      pipeline.setPipelineErrorCode(errorCode);
      pipeline.setLastEventAt(Date.now());
    }
  }, [chatProjectBootstrapRef, chatActions, pipeline, streamingReplyRef, messagesRef]);

  const handleConnectionState = useCallback((state: ConnectionState) => {
    wsStateRef.current = state;
    pipeline.setWsState(state);
  }, [pipeline, wsStateRef]);

  const { wsState } = useWebSocketConnection({
    enabled: appState === "dashboard" && !readOnly,
    onMessage: handleDashboardMessage,
    onConnectionState: handleConnectionState,
  });

  useEffect(() => {
    if (!pipeline.isChatStreaming) return;
    if (wsState !== "closed" && wsState !== "error") return;
    chatActions.failChatRequest("Connection lost. Try again later.");
  }, [pipeline.isChatStreaming, wsState, chatActions.failChatRequest]);
}
