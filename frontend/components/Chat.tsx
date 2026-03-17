"use client";

import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import ChatSelectionChips, { type ChatSelectionNode } from "@/components/ChatSelectionChips";

interface Message {
  role: "user" | "assistant";
  content: string;
  planReady?: boolean;
}

interface ChatProps {
  onSend: (message: string, selectedNodeIds: string[]) => void;
  messages: Message[];
  disabled?: boolean;
  isTyping?: boolean;
  disabledReason?: string | null;
  readOnly?: boolean;
  onAcceptAndGenerate?: () => void;
  approveDisabled?: boolean;
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
  selectedNodes = [],
  onDeselectNode,
}: ChatProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestPlanMessageIndex = messages.reduce<number>(
    (latest, msg, index) => (msg.role === "assistant" && msg.planReady ? index : latest),
    -1
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || readOnly) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed, selectedNodes.map((node) => node.id));
    setInput("");
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h2 className="text-white font-semibold text-sm">DrawToCloud</h2>
        <p className="text-gray-400 text-xs mt-0.5">Describe your infrastructure</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm text-center mt-8">
            Describe the app you want to build on AWS…
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-100"
                }`}
              >
                {msg.content}
              </div>
            </div>
            {msg.planReady && onAcceptAndGenerate && i === latestPlanMessageIndex && (
              <div className="flex justify-start pl-1">
                <button
                  type="button"
                  onClick={onAcceptAndGenerate}
                  disabled={approveDisabled}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {approveDisabled ? "Starting generation..." : "Looks good, generate"}
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

      {/* Input */}
      <div className="border-t border-gray-700">
        {!readOnly && selectedNodes.length > 0 && onDeselectNode && (
          <ChatSelectionChips selectedNodes={selectedNodes} onDeselect={onDeselectNode} />
        )}
        <form onSubmit={handleSubmit} className="px-4 py-3">
          {readOnly ? (
            <p className="text-xs text-gray-400">Read-only shared view</p>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={disabled}
                placeholder={
                  disabled
                    ? "Chat unlocks once generation is completed"
                    : "e.g. What database am I using?"
                }
                className="flex-1 bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
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
