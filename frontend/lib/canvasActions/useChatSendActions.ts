import { useCallback } from "react";
import wsClient from "@/lib/websocket";
import { withAccessToken } from "@/lib/generationStart";
import { ensureChatProjectContext, type ChatProjectBootstrapState } from "../chatProjectContext";
import { createProject, saveSnapshot } from "../projectApi";
import { buildChatPayload } from "../pipelineWsPayloads";
import { planChatSend } from "../canvasInteractionGuards";
import type { CanvasMessage, CanvasSession } from "../projects";
import type { DiagramState } from "../useDiagramState";

export function useChatSendActions({
  canvasSession,
  chatEnabled,
  canvasHasArchitecture,
  messages,
  diagram,
  onProjectReady,
  clearPendingTemplateEstimateRequest,
  failChatRequest,
  armChatResponseTimeout,
  chatProjectBootstrapRef,
  setMessages,
  messagesRef,
  setIsChatStreaming,
  setStreamingAssistantReply,
  streamingReplyRef,
  setPipelineStatus,
  setLastEventAt,
}: {
  canvasSession: CanvasSession | null;
  chatEnabled: boolean;
  canvasHasArchitecture: boolean;
  messages: CanvasMessage[];
  diagram: Pick<DiagramState, "selectedNodeIds" | "canonicalNodes" | "edges">;
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  clearPendingTemplateEstimateRequest: () => void;
  failChatRequest: (message?: string) => void;
  armChatResponseTimeout: () => void;
  chatProjectBootstrapRef: React.MutableRefObject<ChatProjectBootstrapState>;
  setMessages: React.Dispatch<React.SetStateAction<CanvasMessage[]>>;
  messagesRef: React.MutableRefObject<CanvasMessage[]>;
  setIsChatStreaming: (value: boolean) => void;
  setStreamingAssistantReply: React.Dispatch<React.SetStateAction<string>>;
  streamingReplyRef: React.MutableRefObject<string>;
  setPipelineStatus: (value: string | null) => void;
  setLastEventAt: (value: number | null) => void;
  setPendingChatPlanId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsGenerating: (value: boolean) => void;
  setPipelineErrorCode: (value: string | null) => void;
}) {
  const handleSend = useCallback((message: string, selectedNodeIds: string[] = []) => {
    const currentSelectedIds = diagram.selectedNodeIds.length > 0 ? diagram.selectedNodeIds : selectedNodeIds;
    const selectedNodesForMessage = currentSelectedIds
      .map((id) => {
        const node = diagram.canonicalNodes.find((candidate) => candidate.id === id);
        return {
          id,
          label: typeof node?.data?.label === "string" && node.data.label.length > 0 ? node.data.label : id,
          category:
            typeof node?.data?.category === "string" && node.data.category.length > 0
              ? node.data.category
              : "default",
        };
      })
      .filter((node) => node.id.length > 0);

    const sendPlan = planChatSend({
      chatEnabled,
      hasArchitecture: canvasHasArchitecture,
      previousMessages: messages,
      message,
      selectedNodes: selectedNodesForMessage,
    });
    if (sendPlan.kind === "blocked") return;

    setMessages(sendPlan.nextMessages);
    messagesRef.current = sendPlan.nextMessages;

    if (sendPlan.kind === "local_no_architecture") return;

    setIsChatStreaming(true);
    setStreamingAssistantReply("");
    streamingReplyRef.current = "";
    setPipelineStatus("Assistant is thinking...");
    setLastEventAt(Date.now());
    clearPendingTemplateEstimateRequest();
    void (async () => {
      let projectId: string;
      try {
        const context = await ensureChatProjectContext({
          canvasSession,
          bootstrapState: chatProjectBootstrapRef.current,
          createProject,
          saveSnapshot,
          nodes: diagram.canonicalNodes,
          edges: diagram.edges,
          onProjectReady,
        });
        projectId = context.projectId;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to prepare project context for chat.";
        failChatRequest(errorMessage);
        return;
      }

      try {
        const payload = await withAccessToken(
          buildChatPayload({
            projectId,
            message,
            selectedNodeIds: currentSelectedIds,
            nodes: diagram.canonicalNodes,
            edges: diagram.edges,
          })
        );
        const sent = wsClient.send(payload);
        if (!sent) {
          failChatRequest("Connection lost while sending chat request.");
          return;
        }
        armChatResponseTimeout();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to send chat request.";
        failChatRequest(errorMessage);
      }
    })();
  }, [canvasSession, chatEnabled, canvasHasArchitecture, messages, diagram.selectedNodeIds, diagram.canonicalNodes, diagram.edges, onProjectReady, clearPendingTemplateEstimateRequest, failChatRequest, armChatResponseTimeout, chatProjectBootstrapRef, setMessages, messagesRef, setIsChatStreaming, setStreamingAssistantReply, streamingReplyRef, setPipelineStatus, setLastEventAt]);

  const handleBudgetRecoveryAction = useCallback(
    (action: "accept" | "retry") => {
      if (!chatEnabled) return;
      handleSend(action, []);
    },
    [chatEnabled, handleSend]
  );

  return { handleSend, handleBudgetRecoveryAction };
}
