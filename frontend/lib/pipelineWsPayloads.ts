type BuildChatPayloadArgs = {
  projectId: string;
  message: string;
  selectedNodeIds: string[];
  nodes: unknown[];
  edges: unknown[];
};

export function buildChatPayload({
  projectId,
  message,
  selectedNodeIds,
  nodes,
  edges,
}: BuildChatPayloadArgs): Record<string, unknown> {
  return {
    type: "chat",
    project_id: projectId,
    message,
    ...(selectedNodeIds.length > 0 ? { selected_node_ids: selectedNodeIds } : {}),
    nodes,
    edges,
  };
}

export function buildGenerateTerraformPayload(
  projectId: string,
  nodes: unknown[],
  edges: unknown[]
): Record<string, unknown> {
  return {
    type: "generate_terraform",
    project_id: projectId,
    nodes,
    edges,
  };
}

export function pipelineErrorToastMessage(errorCode: unknown, message: string): string | null {
  if (errorCode === "no_diagram_nodes") {
    return message;
  }
  return null;
}
