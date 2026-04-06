import { describe, expect, it } from "vitest";
import {
  NO_ARCHITECTURE_CHAT_REPLY,
  planChatSend,
  shouldDisableGenerateTerraformButton,
} from "../canvasInteractionGuards";

describe("canvas interaction guards", () => {
  it("disables Generate Terraform when architecture is empty", () => {
    expect(
      shouldDisableGenerateTerraformButton({
        actionsDisabled: false,
        terraformButtonState: "generate",
        hasArchitecture: false,
      })
    ).toBe(true);
  });

  it("keeps Generate Terraform enabled when architecture exists and not generating", () => {
    expect(
      shouldDisableGenerateTerraformButton({
        actionsDisabled: false,
        terraformButtonState: "generate",
        hasArchitecture: true,
      })
    ).toBe(false);
  });

  it("short-circuits chat with a local assistant message when no architecture exists", () => {
    const result = planChatSend({
      chatEnabled: true,
      hasArchitecture: false,
      previousMessages: [],
      message: "Can you explain this architecture?",
      selectedNodes: [],
    });

    expect(result.kind).toBe("local_no_architecture");
    expect(result.nextMessages).toEqual([
      { role: "user", content: "Can you explain this architecture?" },
      { role: "assistant", content: NO_ARCHITECTURE_CHAT_REPLY },
    ]);
  });

  it("allows backend chat send when architecture exists", () => {
    const result = planChatSend({
      chatEnabled: true,
      hasArchitecture: true,
      previousMessages: [],
      message: "Review my VPC setup",
      selectedNodes: [],
    });

    expect(result.kind).toBe("send_backend");
    expect(result.nextMessages).toEqual([{ role: "user", content: "Review my VPC setup" }]);
  });
});
