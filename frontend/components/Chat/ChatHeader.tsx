"use client";

interface ChatHeaderProps {
  isTyping: boolean;
  readOnly: boolean;
  disabled: boolean;
}

export default function ChatHeader({ isTyping, readOnly, disabled }: ChatHeaderProps) {
  let statusLabel: string | null = null;
  if (isTyping) {
    statusLabel = "thinking…";
  } else if (readOnly) {
    statusLabel = "sign in to chat";
  } else if (disabled) {
    statusLabel = "unavailable";
  }

  return (
    <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-400 tracking-wide">
          draw<span className="text-white">to</span>cloud
        </span>
        <span className="text-xs text-gray-500">—</span>
        <span className="text-xs text-gray-500">Describe your infrastructure</span>
      </div>
      {statusLabel && (
        <span
          className={`text-xs ${
            isTyping ? "text-gray-400 animate-pulse" : "text-gray-500"
          }`}
        >
          {statusLabel}
        </span>
      )}
    </div>
  );
}
