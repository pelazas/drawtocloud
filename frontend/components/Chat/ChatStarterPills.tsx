"use client";

import { DEFAULT_CHAT_STARTERS } from "@/lib/chatStarters";

interface ChatStarterPillsProps {
  onSend: (message: string) => void;
  disabled: boolean;
  isTyping: boolean;
}

export default function ChatStarterPills({
  onSend,
  disabled,
  isTyping,
}: ChatStarterPillsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Try one of these:</p>
      <div className="flex flex-wrap gap-2">
        {DEFAULT_CHAT_STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onSend(starter)}
            disabled={disabled || isTyping}
            className="rounded-full border border-gray-700/50 bg-gray-800/50 px-3 py-1.5 text-xs text-gray-200
              hover:bg-gray-700/70 hover:border-gray-600
              focus:outline-none focus:border-blue-400
              disabled:cursor-not-allowed disabled:opacity-50
              transition-colors"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}
