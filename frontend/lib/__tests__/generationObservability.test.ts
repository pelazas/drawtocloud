import { describe, expect, it } from "vitest";
import {
  parseGenerationAgentUpdate,
  parseGenerationAgentsFromSnapshot,
} from "../generationObservability";

describe("parseGenerationAgentUpdate", () => {
  it("returns null for non-generation_agent_update messages", () => {
    expect(parseGenerationAgentUpdate({ type: "diagram_event" })).toBeNull();
    expect(parseGenerationAgentUpdate(null)).toBeNull();
    expect(parseGenerationAgentUpdate("string")).toBeNull();
  });

  it("returns null when agents array is missing", () => {
    expect(parseGenerationAgentUpdate({ type: "generation_agent_update" })).toBeNull();
  });

  it("normalizes valid agent entries and drops invalid ones", () => {
    const result = parseGenerationAgentUpdate({
      type: "generation_agent_update",
      mode: "initial_generation",
      agents: [
        {
          agent: "requirements",
          label: "Requirements",
          status: "running",
          summary: "Reading your app description",
          detail: null,
          blocked_by: [],
          started_at: "2026-04-11T12:00:00Z",
          completed_at: null,
          elapsed_ms: 1200,
          progress_text: "Reading your app description",
          history: ["Reading your app description", "Inferring core AWS services"],
          error: null,
        },
        {
          agent: "architect",
          label: "Architect",
          status: "blocked",
          summary: "Waiting for requirements",
          detail: null,
          blocked_by: ["requirements"],
          started_at: null,
          completed_at: null,
          elapsed_ms: null,
          progress_text: null,
          history: [],
          error: null,
        },
        { agent: "bad", status: "unknown_status" },
      ],
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].agent).toBe("requirements");
    expect(result![0].status).toBe("running");
    expect(result![1].agent).toBe("architect");
    expect(result![1].status).toBe("blocked");
  });

  it("returns null when all agents are invalid", () => {
    const result = parseGenerationAgentUpdate({
      type: "generation_agent_update",
      agents: [{ agent: "x", status: "nope" }],
    });
    expect(result).toBeNull();
  });
});

describe("parseGenerationAgentsFromSnapshot", () => {
  it("returns null for non-generation_snapshot messages", () => {
    expect(parseGenerationAgentsFromSnapshot({ type: "done" })).toBeNull();
  });

  it("returns null when generation_agents is absent", () => {
    expect(parseGenerationAgentsFromSnapshot({ type: "generation_snapshot" })).toBeNull();
  });

  it("parses agents from snapshot", () => {
    const result = parseGenerationAgentsFromSnapshot({
      type: "generation_snapshot",
      generation_agents: [
        {
          agent: "cost_analyst",
          label: "Cost analysis",
          status: "completed",
          summary: "Cost estimate ready",
          detail: null,
          blocked_by: [],
          started_at: "2026-04-11T12:00:00Z",
          completed_at: "2026-04-11T12:00:05Z",
          elapsed_ms: 5000,
          progress_text: null,
          history: ["Cost estimate ready"],
          error: null,
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].agent).toBe("cost_analyst");
    expect(result![0].status).toBe("completed");
    expect(result![0].elapsed_ms).toBe(5000);
  });
});
