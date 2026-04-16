"use client";

import type { CanvasMessage } from "@/lib/projects";
import { colorForCategory } from "@/lib/categoryColors";
import ChatMessageBubble from "./ChatMessageBubble";
import ChatPlanCard from "./ChatPlanCard";

interface ChatTimelineItemProps {
  msg: CanvasMessage;
  index: number;
  latestPlanMessageIndex: number;
  latestPendingBudgetRecoveryIndex: number;
  onAcceptAndGenerate?: (planId?: string) => void;
  approveDisabled?: boolean;
  onBudgetRecoveryAction?: (action: "accept" | "retry") => void;
  budgetRecoveryDisabled?: boolean;
  disabled?: boolean;
  isTyping?: boolean;
  readOnly?: boolean;
}

export default function ChatTimelineItem({
  msg,
  index,
  latestPlanMessageIndex,
  latestPendingBudgetRecoveryIndex,
  onAcceptAndGenerate,
  approveDisabled,
  onBudgetRecoveryAction,
  budgetRecoveryDisabled,
  disabled,
  isTyping,
  readOnly,
}: ChatTimelineItemProps) {
  return (
    <div className="flex flex-col gap-2">
      {msg.selectedNodes && msg.selectedNodes.length > 0 && (
        <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className="max-w-[85%] flex flex-wrap gap-1.5">
            {msg.selectedNodes.map((node) => (
              <div
                key={`${index}-${node.id}`}
                className="inline-flex items-center gap-1.5 bg-white/10 border border-white/10 rounded-md px-2 py-0.5 text-xs text-gray-200"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colorForCategory(node.category) }}
                  aria-hidden
                />
                <span>{node.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ChatMessageBubble role={msg.role} content={msg.content} />

      {msg.planReady && msg.planMeta?.type === "node_patch" && msg.planMeta?.details && (
        <ChatPlanCard
          msg={msg}
          onAcceptAndGenerate={index === latestPlanMessageIndex ? onAcceptAndGenerate : undefined}
          approveDisabled={approveDisabled}
        />
      )}
      {msg.role === "assistant" &&
        onBudgetRecoveryAction &&
        msg.budgetRecovery?.status === "pending" &&
        index === latestPendingBudgetRecoveryIndex && null}
    </div>
  );
}
