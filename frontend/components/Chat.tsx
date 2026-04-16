"use client";

import { Send } from "lucide-react";
import ChatSelectionChips, { type ChatSelectionNode } from "@/components/ChatSelectionChips";
import ChatMessageMarkdown from "@/components/ChatMessageMarkdown";
import { colorForCategory } from "@/lib/categoryColors";
import { DEFAULT_CHAT_STARTERS, shouldShowChatStarters } from "@/lib/chatStarters";
import type { CanvasMessage } from "@/lib/projects";
import { useChat } from "./Chat/useChat";

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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {shouldShowChatStarters({ readOnly, messageCount: messages.length }) && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_CHAT_STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => onSend(starter, [])}
                  disabled={disabled || isTyping}
                  className="rounded-full border border-gray-700 bg-gray-800/70 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700/80 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-2">
            {msg.selectedNodes && msg.selectedNodes.length > 0 && (
              <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[85%] flex flex-wrap gap-1.5">
                  {msg.selectedNodes.map((node) => (
                    <div
                      key={`${i}-${node.id}`}
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
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-100"
                }`}
              >
                {msg.role === "assistant" ? (
                  <ChatMessageMarkdown content={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
            {msg.planReady && msg.planMeta?.type === "node_patch" && msg.planMeta?.details && (
              <div className="ml-1 mt-2 mb-2 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs">
                <div className="font-semibold text-gray-200 mb-2">Planned Changes</div>
                {msg.planMeta.details.nodes_added && msg.planMeta.details.nodes_added.length > 0 && (
                  <div className="mb-1">
                    <span className="text-green-400">Add:</span>{" "}
                    {msg.planMeta.details.nodes_added.map((n) => n.label).join(", ")}
                  </div>
                )}
                {msg.planMeta.details.nodes_edited && msg.planMeta.details.nodes_edited.length > 0 && (
                  <div className="mb-1">
                    <span className="text-blue-400">Edit:</span>{" "}
                    {msg.planMeta.details.nodes_edited.map((n) => n.label).join(", ")}
                  </div>
                )}
                {msg.planMeta.details.nodes_deleted && msg.planMeta.details.nodes_deleted.length > 0 && (
                  <div className="mb-1">
                    <span className="text-red-400">Delete:</span>{" "}
                    {msg.planMeta.details.nodes_deleted.map((n) => n.label).join(", ")}
                  </div>
                )}
                {msg.planMeta.details.edges_added && msg.planMeta.details.edges_added.length > 0 && (
                  <div className="mb-1">
                    <span className="text-green-400">Add connections:</span>{" "}
                    {msg.planMeta.details.edges_added.map((e) => e.label || `${e.from} → ${e.to}`).join(", ")}
                  </div>
                )}
                {msg.planMeta.details.edges_deleted && msg.planMeta.details.edges_deleted.length > 0 && (
                  <div className="mb-1">
                    <span className="text-red-400">Remove connections:</span>{" "}
                    {msg.planMeta.details.edges_deleted.map((e) => e.label || `${e.from} → ${e.to}`).join(", ")}
                  </div>
                )}
                {msg.planMeta.details.reasoning && (
                  <div className="mt-2 text-gray-400 italic">{msg.planMeta.details.reasoning}</div>
                )}
              </div>
            )}
            {msg.planReady && onAcceptAndGenerate && i === latestPlanMessageIndex && (
              <div className="flex justify-start pl-1">
                <button
                  type="button"
                  onClick={() => onAcceptAndGenerate(msg.planMeta?.plan_id)}
                  disabled={approveDisabled}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {approveDisabled
                    ? "Applying update..."
                    : "Implement plan"}
                </button>
              </div>
            )}
            {msg.role === "assistant" &&
              onBudgetRecoveryAction &&
              msg.budgetRecovery?.status === "pending" &&
              i === latestPendingBudgetRecoveryMessageIndex && (
                <div className="flex justify-start gap-2 pl-1">
                  <button
                    type="button"
                    onClick={() => onBudgetRecoveryAction("accept")}
                    disabled={disabled || isTyping || readOnly || budgetRecoveryDisabled}
                    className="px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-800 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60 text-xs text-gray-100 transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => onBudgetRecoveryAction("retry")}
                    disabled={disabled || isTyping || readOnly || budgetRecoveryDisabled}
                    className="px-3 py-1.5 rounded-lg border border-blue-600 bg-blue-600 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 text-xs text-white transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-gray-700 text-gray-100">
              <span className="animate-pulse">...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
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
                placeholder={
                  disabled
                    ? "Chat is temporarily unavailable"
                    : "e.g. What database am I using?"
                }
                className="flex-1 bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500 resize-none leading-5 max-h-40"
              />
              <button
                type="submit"
                disabled={disabled || !input.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white p-2 rounded-lg transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
          )}
          {disabledReason && (
            <p className="mt-2 text-xs text-gray-500">{disabledReason}</p>
          )}
        </form>
      </div>
    </div>
  );
}
