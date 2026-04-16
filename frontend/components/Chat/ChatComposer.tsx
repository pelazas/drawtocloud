"use client";

import { Send } from "lucide-react";

interface ChatComposerProps {
  input: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
  disabledReason?: string | null;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function ChatComposer({
  input,
  textareaRef,
  disabled = false,
  disabledReason = null,
  readOnly = false,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onSubmit,
}: ChatComposerProps) {
  if (readOnly) {
    return (
      <p className="text-xs text-gray-400 px-4 py-3">Sign in to start designing</p>
    );
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
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
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        {disabledReason && (
          <p className="mt-2 text-xs text-gray-500">{disabledReason}</p>
        )}
      </form>
    </div>
  );
}
