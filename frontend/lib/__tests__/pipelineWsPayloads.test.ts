import { describe, expect, it } from "vitest";
import { buildChatPayload, buildGenerateTerraformPayload, pipelineErrorToastMessage } from "../pipelineWsPayloads";

describe("pipelineWsPayloads", () => {
  it("builds chat payload with canvas graph context for project-backed chat", () => {
    const payload = buildChatPayload({
      projectId: "project-123",
      message: "What does this architecture do?",
      selectedNodeIds: ["vpc"],
      nodes: [{ id: "vpc", data: { label: "VPC" } }],
      edges: [{ id: "vpc-alb", source: "vpc", target: "alb" }],
    });

    expect(payload).toEqual({
      type: "chat",
      project_id: "project-123",
      message: "What does this architecture do?",
      selected_node_ids: ["vpc"],
      nodes: [{ id: "vpc", data: { label: "VPC" } }],
      edges: [{ id: "vpc-alb", source: "vpc", target: "alb" }],
    });
  });

  it("builds generate terraform payload with fallback graph context", () => {
    const payload = buildGenerateTerraformPayload("project-123", [{ id: "vpc" }], [{ id: "e1" }]);
    expect(payload).toEqual({
      type: "generate_terraform",
      project_id: "project-123",
      nodes: [{ id: "vpc" }],
      edges: [{ id: "e1" }],
    });
  });

  it("returns toast copy for no_diagram_nodes errors", () => {
    expect(
      pipelineErrorToastMessage("no_diagram_nodes", "Cannot generate Terraform: no nodes on canvas. Design your architecture first.")
    ).toBe("Cannot generate Terraform: no nodes on canvas. Design your architecture first.");
    expect(pipelineErrorToastMessage("chat_failed", "Something failed")).toBeNull();
  });

  it("returns toast copy for llm_rate_limited errors", () => {
    const result = pipelineErrorToastMessage("llm_rate_limited", "The AI provider is temporarily rate-limited");
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain("busy");
    expect(result!.toLowerCase()).toContain("retry");
  });
});
