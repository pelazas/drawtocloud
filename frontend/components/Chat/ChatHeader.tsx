"use client";

import { Bot } from "lucide-react";

import {
  CHAT_HEADER_SUBTITLE,
  CHAT_HEADER_TITLE,
  getChatHeaderStatusLabel,
} from "./chatHeaderContent";

interface ChatHeaderProps {
  isTyping: boolean;
  readOnly: boolean;
  disabled: boolean;
}

export default function ChatHeader({ isTyping, readOnly, disabled }: ChatHeaderProps) {
  const statusLabel = getChatHeaderStatusLabel({ isTyping, readOnly, disabled });

  return (
    <div className="border-b border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 bg-gray-800/80 text-gray-400">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-gray-200">{CHAT_HEADER_TITLE}</span>
            <span className="truncate text-xs text-gray-500">{CHAT_HEADER_SUBTITLE}</span>
          </div>
        </div>
        {statusLabel && (
          <span
            className={[
              "ml-3 shrink-0 text-xs text-gray-500",
              isTyping ? "animate-pulse" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  );
}
