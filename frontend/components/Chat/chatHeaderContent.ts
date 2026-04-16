export const CHAT_HEADER_TITLE = "Architecture Assistant";
export const CHAT_HEADER_SUBTITLE = "Ask questions. Propose changes.";

interface ChatHeaderStatusOptions {
  isTyping: boolean;
  readOnly: boolean;
  disabled: boolean;
}

export function getChatHeaderStatusLabel({
  isTyping,
  readOnly,
  disabled,
}: ChatHeaderStatusOptions): string | null {
  if (isTyping) {
    return "thinking…";
  }

  if (readOnly) {
    return "sign in to chat";
  }

  if (disabled) {
    return "unavailable";
  }

  return null;
}
