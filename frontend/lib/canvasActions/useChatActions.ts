import { useCallback } from "react";

const CHAT_RESPONSE_TIMEOUT_MS = 25_000;

export function useChatActions({
  setIsChatStreaming,
  setStreamingAssistantReply,
  setIsGenerating,
  setPipelineStatus,
  setPipelineErrorCode,
  setLastEventAt,
  chatResponseTimeoutRef,
  streamingReplyRef,
}: {
  setIsChatStreaming: (value: boolean) => void;
  setStreamingAssistantReply: React.Dispatch<React.SetStateAction<string>>;
  setIsGenerating: (value: boolean) => void;
  setPipelineStatus: (value: string | null) => void;
  setPipelineErrorCode: (value: string | null) => void;
  setLastEventAt: (value: number | null) => void;
  chatResponseTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamingReplyRef: React.MutableRefObject<string>;
}) {
  const clearChatResponseTimeout = useCallback(() => {
    if (chatResponseTimeoutRef.current !== null) {
      clearTimeout(chatResponseTimeoutRef.current);
      chatResponseTimeoutRef.current = null;
    }
  }, [chatResponseTimeoutRef]);

  const resetChatStreamingState = useCallback(() => {
    setIsChatStreaming(false);
    setStreamingAssistantReply("");
    streamingReplyRef.current = "";
  }, [setIsChatStreaming, setStreamingAssistantReply, streamingReplyRef]);

  const failChatRequest = useCallback(
    (message = "Generation failed. Try again later", errorCode: string | null = "chat_failed") => {
      clearChatResponseTimeout();
      resetChatStreamingState();
      setIsGenerating(false);
      setPipelineStatus(`Error: ${message}`);
      setPipelineErrorCode(errorCode);
      setLastEventAt(Date.now());
    },
    [clearChatResponseTimeout, resetChatStreamingState, setIsGenerating, setPipelineStatus, setPipelineErrorCode, setLastEventAt]
  );

  const armChatResponseTimeout = useCallback(() => {
    clearChatResponseTimeout();
    chatResponseTimeoutRef.current = setTimeout(() => {
      failChatRequest();
    }, CHAT_RESPONSE_TIMEOUT_MS);
  }, [clearChatResponseTimeout, failChatRequest, chatResponseTimeoutRef]);

  return { clearChatResponseTimeout, resetChatStreamingState, failChatRequest, armChatResponseTimeout };
}
