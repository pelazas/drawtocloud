import { describe, expect, it } from "vitest";

import {
  CHAT_HEADER_SUBTITLE,
  CHAT_HEADER_TITLE,
  getChatHeaderStatusLabel,
} from "./chatHeaderContent";

describe("chatHeaderContent", () => {
  it("exports the approved assistant copy", () => {
    expect(CHAT_HEADER_TITLE).toBe("Architecture Assistant");
    expect(CHAT_HEADER_SUBTITLE).toBe("Ask questions. Propose changes.");
  });

  it("keeps the typing status label", () => {
    expect(
      getChatHeaderStatusLabel({ isTyping: true, readOnly: false, disabled: false }),
    ).toBe("thinking…");
  });

  it("returns the read-only label when chat is locked", () => {
    expect(
      getChatHeaderStatusLabel({ isTyping: false, readOnly: true, disabled: false }),
    ).toBe("sign in to chat");
  });
});
