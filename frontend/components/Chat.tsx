"use client";

import ChatSelectionChips, { type ChatSelectionNode } from "@/components/ChatSelectionChips";
import { shouldShowChatStarters } from "@/lib/chatStarters";
import type { CanvasMessage } from "@/lib/projects";
import { useChat } from "./Chat/useChat";
import ChatHeader from "./Chat/ChatHeader";
import ChatStarterPills from "./Chat/ChatStarterPills";
import ChatMessageList from "./Chat/ChatMessageList";
import ChatComposer from "./Chat/ChatComposer";

interface ChatProps {
  onSend: (message: string, selectedNodeIds: string[]) => void;
  messages: CanvasMessage[];
  disabled?: boolean;
  isTyping?: boolean;
  disabledReason?: string | null;
  readOnly?: boolean;
  onAcceptAndGenerate?: (planId?: string) => void;
  approveDisabled?: boolean;
  onBudgetRecoveryAction?: (action: "accept" | "retry") => void;
  budgetRecoveryDisabled?: boolean;
  selectedNodes?: ChatSelectionNode[];
  onDeselectNode?: (id: string) => void;
}

export default function Chat({
  onSend,
  messages: propMessages,
  disabled = false,
  isTyping = false,
  disabledReason = null,
  readOnly = false,
  onAcceptAndGenerate,
  approveDisabled = false,
  onBudgetRecoveryAction,
  budgetRecoveryDisabled = false,
  selectedNodes = [],
  onDeselectNode,
}: ChatProps) {
  const messages = propMessages;

  const {
    input,
    setInput,
    textareaRef,
    bottomRef,
    submitMessage,
    handleSubmit,
    handleTextareaKeyDown,
    onCompositionStart,
    onCompositionEnd,
    latestPlanMessageIndex,
    latestPendingBudgetRecoveryMessageIndex,
  } = useChat({
    messages,
    onSend,
    selectedNodes,
    disabled,
    readOnly,
    isTyping,
  });

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700">
      <ChatHeader isTyping={isTyping} readOnly={readOnly} disabled={disabled} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {shouldShowChatStarters({ readOnly, messageCount: messages.length }) && (
          <ChatStarterPills
            onSend={(starter) => onSend(starter, [])}
            disabled={disabled}
            isTyping={isTyping}
          />
        )}
        <ChatMessageList
          messages={messages}
          latestPlanMessageIndex={latestPlanMessageIndex}
          latestPendingBudgetRecoveryIndex={latestPendingBudgetRecoveryMessageIndex}
          isTyping={isTyping}
          bottomRef={bottomRef}
          onAcceptAndGenerate={onAcceptAndGenerate}
          approveDisabled={approveDisabled}
          onBudgetRecoveryAction={onBudgetRecoveryAction}
          budgetRecoveryDisabled={budgetRecoveryDisabled}
          disabled={disabled}
          readOnly={readOnly}
        />
      </div>
      <div className="border-t border-gray-700">
        {!readOnly && selectedNodes.length > 0 && onDeselectNode && (
          <ChatSelectionChips selectedNodes={selectedNodes} onDeselect={onDeselectNode} />
        )}
        <ChatComposer
          input={input}
          textareaRef={textareaRef}
          disabled={disabled}
          disabledReason={disabledReason}
          readOnly={readOnly}
          onChange={setInput}
          onKeyDown={handleTextareaKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
