import type { CanvasMessage } from "@/lib/projects";

type SelectedNode = NonNullable<CanvasMessage["selectedNodes"]>[number];

export const NO_ARCHITECTURE_CHAT_REPLY =
  "There's no architecture yet. Click New Architecture to design one, then I can answer questions about it.";

export function hasArchitecture(nodes: { id?: string }[]): boolean {
  return nodes.length > 0;
}

export function shouldDisableGenerateTerraformButton({
  actionsDisabled,
  terraformButtonState,
  hasArchitecture,
}: {
  actionsDisabled: boolean;
  terraformButtonState: "generate" | "generating" | "view";
  hasArchitecture: boolean;
}): boolean {
  return actionsDisabled || terraformButtonState === "generating" || !hasArchitecture;
}

function buildUserMessage(message: string, selectedNodes: SelectedNode[]): CanvasMessage {
  return {
    role: "user",
    content: message,
    ...(selectedNodes.length > 0 ? { selectedNodes } : {}),
  };
}

export type ChatSendPlan =
  | { kind: "blocked"; nextMessages: CanvasMessage[] }
  | { kind: "local_no_architecture"; nextMessages: CanvasMessage[] }
  | { kind: "send_backend"; nextMessages: CanvasMessage[] };

export function planChatSend({
  chatEnabled,
  hasArchitecture,
  previousMessages,
  message,
  selectedNodes,
}: {
  chatEnabled: boolean;
  hasArchitecture: boolean;
  previousMessages: CanvasMessage[];
  message: string;
  selectedNodes: SelectedNode[];
}): ChatSendPlan {
  if (!chatEnabled) {
    return {
      kind: "blocked",
      nextMessages: previousMessages,
    };
  }

  const nextMessages = [...previousMessages, buildUserMessage(message, selectedNodes)];
  if (!hasArchitecture) {
    return {
      kind: "local_no_architecture",
      nextMessages: [
        ...nextMessages,
        {
          role: "assistant",
          content: NO_ARCHITECTURE_CHAT_REPLY,
        },
      ],
    };
  }

  return {
    kind: "send_backend",
    nextMessages,
  };
}
