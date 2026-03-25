"use client";

import type { User } from "@supabase/supabase-js";
import Chat from "@/components/Chat";
import type { ChatSelectionNode } from "@/components/ChatSelectionChips";

interface LeftPanelProps {
  user: User | null;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    planReady?: boolean;
    planMeta?: { plan_id?: string };
  }>;
  onSend: (message: string, selectedNodeIds: string[]) => void;
  disabled?: boolean;
  isTyping?: boolean;
  disabledReason?: string | null;
  onAcceptAndGenerate?: (planId?: string) => void;
  approveDisabled?: boolean;
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
          selectedNodes={selectedNodes}
          onDeselectNode={onDeselectNode}
        />
      </div>
    </div>
  );
}
