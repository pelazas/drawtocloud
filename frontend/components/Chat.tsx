"use client";

import ChatSelectionChips, { type ChatSelectionNode } from "@/components/ChatSelectionChips";
import { shouldShowChatStarters } from "@/lib/chatStarters";
import type { CanvasMessage } from "@/lib/projects";
import { useChat } from "./Chat/useChat";
import ChatHeader from "./Chat/ChatHeader";
import ChatStarterPills from "./Chat/ChatStarterPills";
import ChatMessageList from "./Chat/ChatMessageList";
import ChatComposer from "./Chat/ChatComposer";

const DEBUG_CHAT_STATES = false;

const DEBUG_MESSAGES: Record<string, CanvasMessage[]> = {
  empty: [],
  userAssistant: [
    { role: "user", content: "What database am I using?" },
    { role: "assistant", content: "You're using RDS PostgreSQL with an ElastiCache Redis cluster for caching." },
  ],
  longMarkdown: [
    { role: "user", content: "Explain the architecture" },
    {
      role: "assistant",
      content: `# Architecture Overview

## Components

1. **VPC** - Virtual Private Cloud with public and private subnets
2. **ECS Cluster** - Container orchestration with Fargate
3. **RDS PostgreSQL** - Managed relational database
4. **ElastiCache** - Redis for session storage
5. **S3 Bucket** - Static asset storage

## Data Flow

\`\`\`
Client → CloudFront → ALB → ECS Containers → RDS/ElastiCache/S3
\`\`\`

## Scaling

- Auto-scaling based on CPU utilization
- Multi-AZ deployment for high availability
`,
    },
  ],
  planReady: [
    { role: "user", content: "Add a Redis cache" },
    {
      role: "assistant",
      content: "I'll add Redis to your architecture.",
      planReady: true,
      executionMode: "node_patch",
      planMeta: {
        plan_id: "plan-123",
        type: "node_patch",
        details: {
          nodes_added: [{ id: "redis", label: "ElastiCache Redis", category: "database" }],
          nodes_edited: [],
          nodes_deleted: [],
          edges_added: [{ from: "ecs", to: "redis", label: "caches" }],
          edges_deleted: [],
          reasoning: "Adding Redis for session caching to improve response times.",
        },
      },
    },
  ],
  budgetRecovery: [
    { role: "user", content: "Generate more components" },
    {
      role: "assistant",
      content: "Your estimated monthly cost has exceeded the budget cap.",
      budgetRecovery: {
        status: "pending",
        budgetCap: 100,
        estimatedTotal: 145.5,
        overage: 45.5,
      },
    },
  ],
};

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
  const messages = DEBUG_CHAT_STATES ? (DEBUG_MESSAGES.longMarkdown ?? []) : propMessages;

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
