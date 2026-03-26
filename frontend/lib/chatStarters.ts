export const DEFAULT_CHAT_STARTERS = [
  "What does this architecture do?",
  "Where is the highest monthly cost?",
  "How can I make this architecture cheaper?",
  "What are the security risks in this design?",
  "Suggest a simpler version of this architecture.",
] as const;

export function shouldShowChatStarters({
  readOnly,
  messageCount,
}: {
  readOnly: boolean;
  messageCount: number;
}): boolean {
  return !readOnly && messageCount === 0;
}
