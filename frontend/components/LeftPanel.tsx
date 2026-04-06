"use client";

import type { User } from "@supabase/supabase-js";
import Chat from "@/components/Chat";
import type { ChatSelectionNode } from "@/components/ChatSelectionChips";
import type { CanvasMessage } from "@/lib/projects";

interface LeftPanelProps {
  user: User | null;
  messages: CanvasMessage[];
  onSend: (message: string, selectedNodeIds: string[]) => void;
  disabled?: boolean;
  isTyping?: boolean;
  disabledReason?: string | null;
  onAcceptAndGenerate?: (planId?: string) => void;
  approveDisabled?: boolean;
  onBudgetRecoveryAction?: (action: "accept" | "retry") => void;
  budgetRecoveryDisabled?: boolean;
  selectedNodes?: ChatSelectionNode[];
  onDeselectNode?: (id: string) => void;
}

export default function LeftPanel({
  user,
  messages,
  onSend,
  disabled = false,
  isTyping = false,
  disabledReason = null,
  onAcceptAndGenerate,
  approveDisabled = false,
  onBudgetRecoveryAction,
  budgetRecoveryDisabled = false,
  selectedNodes = [],
  onDeselectNode,
}: LeftPanelProps) {
  const readOnly = !user;

  return (
    <div className="w-80 flex-shrink-0 h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <Chat
          messages={messages}
          onSend={onSend}
          disabled={disabled}
          isTyping={isTyping}
          disabledReason={disabledReason}
          readOnly={readOnly}
          onAcceptAndGenerate={onAcceptAndGenerate}
          approveDisabled={approveDisabled}
          onBudgetRecoveryAction={onBudgetRecoveryAction}
          budgetRecoveryDisabled={budgetRecoveryDisabled}
          selectedNodes={selectedNodes}
          onDeselectNode={onDeselectNode}
        />
      </div>
    </div>
  );
}
