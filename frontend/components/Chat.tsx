"use client";

import { Send } from "lucide-react";

import ChatSelectionChips, { type ChatSelectionNode } from "@/components/ChatSelectionChips";
import ChatHeader from "@/components/Chat/ChatHeader";
import ChatMessageList from "@/components/Chat/ChatMessageList";
import ChatStarterPills from "@/components/Chat/ChatStarterPills";
import { useChat } from "@/components/Chat/useChat";
import { shouldShowChatStarters } from "@/lib/chatStarters";
import type { CanvasMessage } from "@/lib/projects";

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
  messages,
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
  const {
    input,
    setInput,
    textareaRef,
    bottomRef,
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
    <div className="flex h-full flex-col border-r border-gray-700 bg-gray-900">
      <ChatHeader isTyping={isTyping} readOnly={readOnly} disabled={disabled} />
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
        <form onSubmit={handleSubmit} className="px-4 py-3">
          {readOnly ? (
            <p className="text-xs text-gray-400">Sign in to start designing</p>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
                disabled={disabled}
                rows={1}
                placeholder={disabled ? "Chat is temporarily unavailable" : "e.g. What database am I using?"}
                className="max-h-40 flex-1 resize-none rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm leading-5 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={disabled || !input.trim()}
                className="rounded-lg bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-700"
              >
                <Send size={16} />
              </button>
            </div>
          )}
          {disabledReason && <p className="mt-2 text-xs text-gray-500">{disabledReason}</p>}
        </form>
      </div>
    </div>
  );
}
