import { describe, expect, it } from "vitest";
import { shouldHydrateGenerationSnapshot } from "../generationSnapshotHydration";
import { parseGenerationAgentsFromSnapshot, mergeCodeGenerationAgents } from "../generationObservability";
import type { GenerationAgentState } from "../generationObservability";
import type { TerraformProgress } from "@/components/TerraformViewer";
import { buildCoderAgentStateFromProgress } from "../terraformGenerationObservability";

describe("shouldHydrateGenerationSnapshot", () => {
  it("hydrates when generation is not active", () => {
    expect(
      shouldHydrateGenerationSnapshot({
        generationActive: false,
        nodeCount: 10,
        edgeCount: 8,
      })
    ).toBe(true);
  });

  it("hydrates during active generation when canvas is empty", () => {
    expect(
      shouldHydrateGenerationSnapshot({
        generationActive: true,
        nodeCount: 0,
        edgeCount: 0,
      })
    ).toBe(true);
  });

  it("skips hydration during active generation when canvas already has data", () => {
    expect(
      shouldHydrateGenerationSnapshot({
        generationActive: true,
        nodeCount: 2,
        edgeCount: 1,
      })
    ).toBe(false);
  });
});

describe("Step 3: architecture-agent snapshot hydration", () => {
  it("demonstrates that mergeCodeGenerationAgents preserves architecture when architectureAgents is set", () => {
    const snapshotArchitectureAgents = parseGenerationAgentsFromSnapshot({
      type: "generation_snapshot",
      generation_agents: [
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
      ],
    });

    expect(snapshotArchitectureAgents).not.toBeNull();
    expect(snapshotArchitectureAgents).toHaveLength(3);

    const coderAgents: GenerationAgentState[] = [
      {
        agent: "coder",
        label: "Coder",
        status: "completed",
        summary: 'Click on the "SEE TERRAFORM CODE" button in the topbar to see the generated code.',
        detail: null,
        blocked_by: [],
        started_at: "2026-04-11T12:00:20Z",
        completed_at: "2026-04-11T12:00:25Z",
        elapsed_ms: 5000,
        progress_text: null,
        history: [],
        error: null,
      },
    ];

    const resultWithArchitecture = mergeCodeGenerationAgents(snapshotArchitectureAgents, coderAgents);
    expect(resultWithArchitecture).toHaveLength(4);
    expect(resultWithArchitecture.find((a: GenerationAgentState) => a.agent === "cost_analyst")).toBeDefined();
    expect(resultWithArchitecture.find((a: GenerationAgentState) => a.agent === "coder")).toBeDefined();
  });

  it("demonstrates the impact of architectureAgents not being hydrated from snapshot", () => {
    const snapshotArchitectureAgents = parseGenerationAgentsFromSnapshot({
      type: "generation_snapshot",
      generation_agents: [
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
      ],
    });

    expect(snapshotArchitectureAgents).not.toBeNull();
    expect(snapshotArchitectureAgents).toHaveLength(3);

    const coderAgents: GenerationAgentState[] = [
      {
        agent: "coder",
        label: "Coder",
        status: "completed",
        summary: 'Click on the "SEE TERRAFORM CODE" button in the topbar to see the generated code.',
        detail: null,
        blocked_by: [],
        started_at: "2026-04-11T12:00:20Z",
        completed_at: "2026-04-11T12:00:25Z",
        elapsed_ms: 5000,
        progress_text: null,
        history: [],
        error: null,
      },
    ];

    const architectureAgentsRefCurrent: GenerationAgentState[] | null = null;
    const resultWithoutArchitecture = architectureAgentsRefCurrent === null
      ? coderAgents
      : mergeCodeGenerationAgents(architectureAgentsRefCurrent, coderAgents);

    expect(resultWithoutArchitecture).toHaveLength(1);
    expect(resultWithoutArchitecture[0].agent).toBe("coder");
    expect(resultWithoutArchitecture.find((a: GenerationAgentState) => a.agent === "cost_analyst")).toBeUndefined();
  });
});
