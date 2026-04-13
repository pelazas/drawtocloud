import { describe, expect, it } from "vitest";
import {
  parseGenerationAgentUpdate,
  parseGenerationAgentsFromSnapshot,
  parseGenerationAgentEvent,
  reduceGenerationAgentEvent,
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

describe("parseGenerationAgentEvent", () => {
  it("returns null for non-generation_agent_event messages", () => {
    expect(parseGenerationAgentEvent({ type: "diagram_event" })).toBeNull();
    expect(parseGenerationAgentEvent(null)).toBeNull();
    expect(parseGenerationAgentEvent("string")).toBeNull();
  });

  it("returns null when agent field is missing", () => {
    expect(parseGenerationAgentEvent({ type: "generation_agent_event" })).toBeNull();
  });

  it("returns null when event_type field is missing", () => {
    expect(parseGenerationAgentEvent({ type: "generation_agent_event", agent: "requirements" })).toBeNull();
  });

  it("returns null when status is not a string", () => {
    expect(parseGenerationAgentEvent({ type: "generation_agent_event", agent: "requirements", event_type: "started", status: 123 })).toBeNull();
  });

  it("parses a valid running event", () => {
    const result = parseGenerationAgentEvent({
      type: "generation_agent_event",
      agent: "requirements",
      status: "running",
      event_type: "started",
      message: "Reading your app description",
      history: true,
      started_at: "2026-04-11T12:00:00Z",
      completed_at: null,
      ts: "2026-04-11T12:00:00Z",
    });
    expect(result).not.toBeNull();
    expect(result!.agent).toBe("requirements");
    expect(result!.status).toBe("running");
    expect(result!.event_type).toBe("started");
    expect(result!.message).toBe("Reading your app description");
    expect(result!.history).toBe(true);
    expect(result!.started_at).toBe("2026-04-11T12:00:00Z");
    expect(result!.completed_at).toBeNull();
    expect(result!.ts).toBe("2026-04-11T12:00:00Z");
  });

  it("parses a completed event with null optional fields", () => {
    const result = parseGenerationAgentEvent({
      type: "generation_agent_event",
      agent: "architect",
      status: "completed",
      event_type: "completed",
      message: "Architecture complete",
      history: false,
      started_at: null,
      completed_at: null,
      ts: "",
    });
    expect(result).not.toBeNull();
    expect(result!.agent).toBe("architect");
    expect(result!.message).toBe("Architecture complete");
  });

  it("defaults message to empty string when not a string", () => {
    const result = parseGenerationAgentEvent({
      type: "generation_agent_event",
      agent: "requirements",
      status: "running",
      event_type: "started",
      message: 123,
      history: false,
      ts: "2026-04-11T12:00:00Z",
    });
    expect(result).not.toBeNull();
    expect(result!.message).toBe("");
  });
});

describe("reduceGenerationAgentEvent", () => {
  const initialAgents: import("../generationObservability").GenerationAgentState[] = [
    {
      agent: "requirements",
      label: "Requirements",
      status: "blocked",
      summary: "",
      detail: null,
      blocked_by: [],
      started_at: null,
      completed_at: null,
      elapsed_ms: null,
      progress_text: null,
      history: [],
      error: null,
    },
    {
      agent: "architect",
      label: "Architect",
      status: "blocked",
      summary: "",
      detail: null,
      blocked_by: ["requirements"],
      started_at: null,
      completed_at: null,
      elapsed_ms: null,
      progress_text: null,
      history: [],
      error: null,
    },
  ];

  it("returns unchanged agents when agent not found", () => {
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "nonexistent",
      status: "running",
      event_type: "started",
      message: "test",
      history: false,
      started_at: "2026-04-11T12:00:00Z",
      completed_at: null,
      ts: "2026-04-11T12:00:00Z",
    };
    const result = reduceGenerationAgentEvent(initialAgents, event);
    expect(result).toBe(initialAgents);
  });

  it("updates status and summary on running event", () => {
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "running",
      event_type: "started",
      message: "Reading your app description",
      history: false,
      started_at: "2026-04-11T12:00:00Z",
      completed_at: null,
      ts: "2026-04-11T12:00:00Z",
    };
    const result = reduceGenerationAgentEvent(initialAgents, event);
    expect(result[0].status).toBe("running");
    expect(result[0].summary).toBe("Reading your app description");
    expect(result[0].progress_text).toBe("Reading your app description");
    expect(result[0].started_at).toBe("2026-04-11T12:00:00Z");
    expect(result[0].completed_at).toBeNull();
    expect(result[0].error).toBeNull();
  });

  it("does not overwrite started_at once set", () => {
    const agentsWithStarted: import("../generationObservability").GenerationAgentState[] = [
      {
        ...initialAgents[0],
        started_at: "2026-04-11T12:00:00Z",
        status: "running" as const,
      },
      initialAgents[1],
    ];
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "running",
      event_type: "progress",
      message: "Inferring services",
      history: false,
      started_at: "2026-04-11T12:00:05Z",
      completed_at: null,
      ts: "2026-04-11T12:00:05Z",
    };
    const result = reduceGenerationAgentEvent(agentsWithStarted, event);
    expect(result[0].started_at).toBe("2026-04-11T12:00:00Z");
  });

  it("appends to history when history flag is true", () => {
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "running",
      event_type: "progress",
      message: "Reading your app description",
      history: true,
      started_at: "2026-04-11T12:00:00Z",
      completed_at: null,
      ts: "2026-04-11T12:00:00Z",
    };
    const result = reduceGenerationAgentEvent(initialAgents, event);
    expect(result[0].history).toEqual(["Reading your app description"]);
  });

  it("caps history at 3 entries", () => {
    const agentsWithHistory: import("../generationObservability").GenerationAgentState[] = [
      {
        ...initialAgents[0],
        status: "running" as const,
        started_at: "2026-04-11T12:00:00Z",
        history: ["first", "second"],
      },
      initialAgents[1],
    ];
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "running",
      event_type: "progress",
      message: "third",
      history: true,
      started_at: null,
      completed_at: null,
      ts: "2026-04-11T12:00:03Z",
    };
    const result = reduceGenerationAgentEvent(agentsWithHistory, event);
    expect(result[0].history).toEqual(["first", "second", "third"]);
  });

  it("sets elapsed_ms on completed event when started_at and completed_at are available", () => {
    const runningAgents: import("../generationObservability").GenerationAgentState[] = [
      {
        ...initialAgents[0],
        status: "running" as const,
        started_at: "2026-04-11T12:00:00Z",
      },
      initialAgents[1],
    ];
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "completed",
      event_type: "completed",
      message: "Requirements ready",
      history: false,
      started_at: null,
      completed_at: "2026-04-11T12:00:05Z",
      ts: "2026-04-11T12:00:05Z",
    };
    const result = reduceGenerationAgentEvent(runningAgents, event);
    expect(result[0].status).toBe("completed");
    expect(result[0].elapsed_ms).toBe(5000);
    expect(result[0].progress_text).toBeNull();
  });

  it("sets error on failed event", () => {
    const runningAgents: import("../generationObservability").GenerationAgentState[] = [
      {
        ...initialAgents[0],
        status: "running" as const,
        started_at: "2026-04-11T12:00:00Z",
      },
      initialAgents[1],
    ];
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "failed",
      event_type: "failed",
      message: "LLM request timed out",
      history: false,
      started_at: null,
      completed_at: "2026-04-11T12:00:10Z",
      ts: "2026-04-11T12:00:10Z",
    };
    const result = reduceGenerationAgentEvent(runningAgents, event);
    expect(result[0].status).toBe("failed");
    expect(result[0].error).toBe("LLM request timed out");
    expect(result[0].elapsed_ms).toBe(10000);
  });

  it("does not compute elapsed_ms when started_at is missing", () => {
    const runningAgents: import("../generationObservability").GenerationAgentState[] = [
      {
        ...initialAgents[0],
        status: "running" as const,
        started_at: null,
      },
      initialAgents[1],
    ];
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "completed",
      event_type: "completed",
      message: "Done",
      history: false,
      started_at: null,
      completed_at: "2026-04-11T12:00:05Z",
      ts: "2026-04-11T12:00:05Z",
    };
    const result = reduceGenerationAgentEvent(runningAgents, event);
    expect(result[0].elapsed_ms).toBeNull();
  });

  it("handles skipped status", () => {
    const runningAgents: import("../generationObservability").GenerationAgentState[] = [
      {
        ...initialAgents[0],
        status: "running" as const,
        started_at: "2026-04-11T12:00:00Z",
      },
      initialAgents[1],
    ];
    const event: import("../generationObservability").GenerationAgentEvent = {
      agent: "requirements",
      status: "skipped",
      event_type: "skipped",
      message: "Skipped",
      history: false,
      started_at: null,
      completed_at: "2026-04-11T12:00:01Z",
      ts: "2026-04-11T12:00:01Z",
    };
    const result = reduceGenerationAgentEvent(runningAgents, event);
    expect(result[0].status).toBe("skipped");
    expect(result[0].progress_text).toBeNull();
  });
});

describe("Step 4: preserving initial-generation rows during coder-only updates", () => {
  it("parseGenerationAgentUpdate with mode code_generation should preserve architecture agents when they exist", () => {
    const initialAgents: import("../generationObservability").GenerationAgentState[] = [
      {
        agent: "requirements",
        label: "Requirements",
        status: "completed",
        summary: "Requirements ready",
        detail: null,
        blocked_by: [],
        started_at: "2026-04-11T12:00:00Z",
        completed_at: "2026-04-11T12:00:02Z",
        elapsed_ms: 2000,
        progress_text: null,
        history: [],
        error: null,
      },
      {
        agent: "architect",
        label: "Architect",
        status: "completed",
        summary: "Architecture complete",
        detail: null,
        blocked_by: ["requirements"],
        started_at: "2026-04-11T12:00:02Z",
        completed_at: "2026-04-11T12:00:10Z",
        elapsed_ms: 8000,
        progress_text: null,
        history: [],
        error: null,
      },
      {
        agent: "cost_analyst",
        label: "Cost analysis",
        status: "completed",
        summary: "Cost estimate ready",
        detail: null,
        blocked_by: ["architect"],
        started_at: "2026-04-11T12:00:10Z",
        completed_at: "2026-04-11T12:00:15Z",
        elapsed_ms: 5000,
        progress_text: null,
        history: [],
        error: null,
      },
    ];

    const coderOnlyUpdate = {
      type: "generation_agent_update",
      mode: "code_generation",
      agents: [
        {
          agent: "coder",
          label: "Coder",
          status: "running",
          summary: "Generating Terraform files...",
          detail: null,
          blocked_by: [],
          started_at: "2026-04-11T12:00:20Z",
          completed_at: null,
          elapsed_ms: null,
          progress_text: "Generating Terraform files...",
          history: [],
          error: null,
        },
      ],
    };

    const parsed = parseGenerationAgentUpdate(coderOnlyUpdate, initialAgents);

    expect(parsed).not.toBeNull();
    expect(parsed!).toHaveLength(4);
    expect(parsed!.find((a) => a.agent === "requirements")).toMatchObject({
      agent: "requirements",
      status: "completed",
    });
    expect(parsed!.find((a) => a.agent === "architect")).toMatchObject({
      agent: "architect",
      status: "completed",
    });
    expect(parsed!.find((a) => a.agent === "cost_analyst")).toMatchObject({
      agent: "cost_analyst",
      status: "completed",
    });
    expect(parsed!.find((a) => a.agent === "coder")).toMatchObject({
      agent: "coder",
      status: "running",
    });
  });

  it("parseGenerationAgentUpdate with mode code_generation should return only coder when no prior agents exist", () => {
    const coderOnlyUpdate = {
      type: "generation_agent_update",
      mode: "code_generation",
      agents: [
        {
          agent: "coder",
          label: "Coder",
          status: "completed",
          summary: "Terraform generation complete",
          detail: null,
          blocked_by: [],
          started_at: "2026-04-11T12:00:20Z",
          completed_at: "2026-04-11T12:00:30Z",
          elapsed_ms: 10000,
          progress_text: null,
          history: [],
          error: null,
        },
      ],
    };

    const parsed = parseGenerationAgentUpdate(coderOnlyUpdate);

    expect(parsed).not.toBeNull();
    expect(parsed!).toHaveLength(1);
    expect(parsed![0].agent).toBe("coder");
  });

  it("coder-only update should not blow away the last known initial-generation chain", () => {
    const initialAgents: import("../generationObservability").GenerationAgentState[] = [
      {
        agent: "requirements",
        label: "Requirements",
        status: "completed",
        summary: "Requirements ready",
        detail: null,
        blocked_by: [],
        started_at: "2026-04-11T12:00:00Z",
        completed_at: "2026-04-11T12:00:02Z",
        elapsed_ms: 2000,
        progress_text: null,
        history: [],
        error: null,
      },
      {
        agent: "architect",
        label: "Architect",
        status: "completed",
        summary: "Architecture complete",
        detail: null,
        blocked_by: ["requirements"],
        started_at: "2026-04-11T12:00:02Z",
        completed_at: "2026-04-11T12:00:10Z",
        elapsed_ms: 8000,
        progress_text: null,
        history: [],
        error: null,
      },
      {
        agent: "cost_analyst",
        label: "Cost analysis",
        status: "completed",
        summary: "Cost estimate ready",
        detail: null,
        blocked_by: ["architect"],
        started_at: "2026-04-11T12:00:10Z",
        completed_at: "2026-04-11T12:00:15Z",
        elapsed_ms: 5000,
        progress_text: null,
        history: [],
        error: null,
      },
    ];

    const coderOnlyUpdate = {
      type: "generation_agent_update",
      mode: "code_generation",
      agents: [
        {
          agent: "coder",
          label: "Coder",
          status: "completed",
          summary: 'Click on the "SEE TERRAFORM CODE" button in the topbar to see the generated code.',
          detail: null,
          blocked_by: [],
          started_at: "2026-04-11T12:00:20Z",
          completed_at: "2026-04-11T12:00:30Z",
          elapsed_ms: 10000,
          progress_text: null,
          history: [],
          error: null,
        },
      ],
    };

    const parsed = parseGenerationAgentUpdate(coderOnlyUpdate, initialAgents);

    expect(parsed).not.toBeNull();
    expect(parsed!).toHaveLength(4);
    const agentMap = Object.fromEntries(parsed!.map((a) => [a.agent, a]));
    expect(agentMap.requirements.status).toBe("completed");
    expect(agentMap.architect.status).toBe("completed");
    expect(agentMap.cost_analyst.status).toBe("completed");
    expect(agentMap.coder.status).toBe("completed");
    expect(agentMap.requirements.summary).toBe("Requirements ready");
    expect(agentMap.architect.summary).toBe("Architecture complete");
    expect(agentMap.cost_analyst.summary).toBe("Cost estimate ready");
  });
});
