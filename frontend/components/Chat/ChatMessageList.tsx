"use client";

import type { CanvasMessage } from "@/lib/projects";
import ChatTimelineItem from "./ChatTimelineItem";

interface ChatMessageListProps {
  messages: CanvasMessage[];
  latestPlanMessageIndex: number;
  latestPendingBudgetRecoveryIndex: number;
  isTyping: boolean;
  bottomRef: React.RefObject<HTMLDivElement>;
  onAcceptAndGenerate?: (planId?: string) => void;
  approveDisabled?: boolean;
  onBudgetRecoveryAction?: (action: "accept" | "retry") => void;
  budgetRecoveryDisabled?: boolean;
  disabled?: boolean;
  isTyping?: boolean;
  readOnly?: boolean;
}

export default function ChatMessageList({
  messages,
  latestPlanMessageIndex,
  latestPendingBudgetRecoveryIndex,
  isTyping,
  bottomRef,
  onAcceptAndGenerate,
  approveDisabled,
  onBudgetRecoveryAction,
  budgetRecoveryDisabled,
  disabled,
  readOnly,
}: ChatMessageListProps) {
  return (
    <>
      {messages.map((msg, i) => (
        <ChatTimelineItem
          key={i}
          msg={msg}
          index={i}
          latestPlanMessageIndex={latestPlanMessageIndex}
          latestPendingBudgetRecoveryIndex={latestPendingBudgetRecoveryIndex}
          onAcceptAndGenerate={onAcceptAndGenerate}
          approveDisabled={approveDisabled}
          onBudgetRecoveryAction={onBudgetRecoveryAction}
          budgetRecoveryDisabled={budgetRecoveryDisabled}
          disabled={disabled}
          isTyping={isTyping}
          readOnly={readOnly}
        />
      ))}
      {isTyping && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-gray-700 text-gray-100">
            <span className="animate-pulse">...</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </>
  );
}
