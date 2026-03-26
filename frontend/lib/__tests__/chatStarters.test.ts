import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_STARTERS, shouldShowChatStarters } from "../chatStarters";

describe("chat starters", () => {
  it("shows starters only for editable empty chats", () => {
    expect(shouldShowChatStarters({ readOnly: false, messageCount: 0 })).toBe(true);
    expect(shouldShowChatStarters({ readOnly: true, messageCount: 0 })).toBe(false);
    expect(shouldShowChatStarters({ readOnly: false, messageCount: 1 })).toBe(false);
  });

  it("exposes useful default starter prompts", () => {
    expect(DEFAULT_CHAT_STARTERS.length).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_CHAT_STARTERS).toContain("What does this architecture do?");
    expect(DEFAULT_CHAT_STARTERS).toContain("Where is the highest monthly cost?");
  });
});
