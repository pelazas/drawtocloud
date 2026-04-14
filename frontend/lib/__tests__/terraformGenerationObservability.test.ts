import { describe, expect, it } from "vitest";
import {
  buildCoderAgentStateFromProgress,
  TERMINAL_CODER_SUMMARY,
} from "../terraformGenerationObservability";
import type { GenerationAgentState } from "../generationObservability";
import type { TerraformProgress } from "@/components/TerraformViewer";

function makeAgent(agent: string, status: GenerationAgentState["status"] = "completed"): GenerationAgentState {
  return {
    agent,
    label: agent === "requirements" ? "Requirements" : agent === "architect" ? "Architect" : "Cost analysis",
    status,
    summary: `${agent} complete`,
    detail: null,
    blocked_by: agent === "requirements" ? [] : agent === "architect" ? ["requirements"] : ["architect"],
    started_at: "2026-04-11T12:00:00Z",
    completed_at: status === "completed" ? "2026-04-11T12:00:05Z" : null,
    elapsed_ms: 5000,
    progress_text: null,
    history: [],
    error: null,
  };
}

function makeTerraformProgress(status: TerraformProgress["status"], activity: string | null = null): TerraformProgress {
  return {
    status,
    activity,
    emittedCount: status === "completed" ? 4 : 0,
    expectedMinFiles: 4,
    currentFile: status === "generating" ? "main.tf" : null,
    lastUpdateAt: status !== "idle" ? Date.now() : null,
  };
}

describe("buildCoderAgentStateFromProgress", () => {
  describe("Step 1: synthetic coder row derivation", () => {
    const initialAgents: GenerationAgentState[] = [
      makeAgent("requirements", "completed"),
      makeAgent("architect", "completed"),
      makeAgent("cost_analyst", "completed"),
    ];

    it("returns null coderRow when terraformProgress is undefined", () => {
      const result = buildCoderAgentStateFromProgress(undefined, initialAgents);
      expect(result.coderRow).toBeNull();
    });

    it("returns null coderRow when terraformProgress.status is idle", () => {
      const tfProgress = makeTerraformProgress("idle");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.coderRow).toBeNull();
    });

    it("appends a coder row when terraformProgress.status is requesting", () => {
      const tfProgress = makeTerraformProgress("requesting", "Requesting Terraform generation...");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents, true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("running");
      expect(result.coderRow!.label).toBe("Coder");
      expect(result.coderRow!.summary).toBe("Requesting Terraform generation...");
    });

    it("appends a coder row when terraformProgress.status is generating", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating main.tf");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents, true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("running");
    });

    it("appends a coder row when terraformProgress.status is completed", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents, true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("completed");
    });

    it("coder row has the same GenerationAgentState shape as architecture agents", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating Terraform...");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents, true);
      const coder = result.coderRow!;
      expect(coder).toHaveProperty("agent");
      expect(coder).toHaveProperty("label");
      expect(coder).toHaveProperty("status");
      expect(coder).toHaveProperty("summary");
      expect(coder).toHaveProperty("detail");
      expect(coder).toHaveProperty("blocked_by");
      expect(coder).toHaveProperty("started_at");
      expect(coder).toHaveProperty("completed_at");
      expect(coder).toHaveProperty("elapsed_ms");
      expect(coder).toHaveProperty("progress_text");
      expect(coder).toHaveProperty("history");
      expect(coder).toHaveProperty("error");
    });

    it("preserves initial agents unchanged", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating Terraform...");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents, true);
      expect(result.coderRow).not.toBeNull();
      expect(initialAgents).toHaveLength(3);
      expect(initialAgents[0].agent).toBe("requirements");
      expect(initialAgents[1].agent).toBe("architect");
      expect(initialAgents[2].agent).toBe("cost_analyst");
    });

    it("handles null initialAgents (no prior generation)", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating Terraform...");
      const result = buildCoderAgentStateFromProgress(tfProgress, null, true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.connectedRowCount).toBe(0);
    });
  });

  describe("Step 2: terminal coder copy", () => {
    it("completed coder row uses the exact terminal summary text", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.summary).toBe(TERMINAL_CODER_SUMMARY);
    });

    it("completed coder row reports success through status: completed", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.status).toBe("completed");
    });

    it("failed coder row reports failure through status: failed", () => {
      const tfProgress: TerraformProgress = {
        status: "failed",
        activity: "Generation failed",
        emittedCount: 0,
        expectedMinFiles: 4,
        currentFile: null,
        lastUpdateAt: Date.now(),
      };
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.status).toBe("failed");
      expect(result.coderRow!.error).toBe("Generation failed");
    });
  });

  describe("Step 3: no-architecture-line rule", () => {
    const initialAgents: GenerationAgentState[] = [
      makeAgent("requirements", "completed"),
      makeAgent("architect", "completed"),
      makeAgent("cost_analyst", "completed"),
    ];

    it("connectedRowCount equals the number of initial agents", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.connectedRowCount).toBe(3);
    });

    it("connectedRowCount is 0 when initialAgents is null", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, null);
      expect(result.connectedRowCount).toBe(0);
    });

    it("connectedRowCount reflects actual initialAgents length", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating Terraform...");
      const partialAgents: GenerationAgentState[] = [
        makeAgent("requirements", "running"),
        makeAgent("architect", "blocked"),
      ];
      const result = buildCoderAgentStateFromProgress(tfProgress, partialAgents);
      expect(result.connectedRowCount).toBe(2);
    });

    it("coder is not counted in connectedRowCount", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents, true);
      const totalRows = result.connectedRowCount + (result.coderRow ? 1 : 0);
      expect(totalRows).toBe(4);
      expect(result.connectedRowCount).toBe(3);
    });

    it("idle status returns 0 connectedRowCount and null coderRow", () => {
      const tfProgress = makeTerraformProgress("idle");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.coderRow).toBeNull();
      expect(result.connectedRowCount).toBe(0);
    });
  });

  describe("Step 1 & 2: coder-row gating — only renders for explicit manual Terraform runs", () => {
    const completedArchitectureAgents: GenerationAgentState[] = [
      makeAgent("requirements", "completed"),
      makeAgent("architect", "completed"),
      makeAgent("cost_analyst", "completed"),
    ];

    function makeTerraformProgressWithStatus(status: TerraformProgress["status"], activity: string | null = null): TerraformProgress {
      return {
        status,
        activity,
        emittedCount: status === "completed" ? 4 : 0,
        expectedMinFiles: 4,
        currentFile: status === "generating" ? "main.tf" : null,
        lastUpdateAt: status !== "idle" ? Date.now() : null,
      };
    }

    const buildWithManualFlag = (
      tfProgress: TerraformProgress,
      agents: GenerationAgentState[] | null,
      isManual: boolean
    ) => (buildCoderAgentStateFromProgress as (a: TerraformProgress | undefined, b: GenerationAgentState[] | null, c: boolean) => ReturnType<typeof buildCoderAgentStateFromProgress>)(tfProgress, agents, isManual);

    it("FAILS: returns null coderRow during regular architecture generation even when terraformProgress.status is planning", () => {
      const tfProgress = makeTerraformProgressWithStatus("planning", "Planning infrastructure...");
      const result = buildWithManualFlag(tfProgress, completedArchitectureAgents, false);
      expect(result.coderRow).toBeNull();
    });

    it("FAILS: returns null coderRow during regular architecture generation even when terraformProgress.status is generating", () => {
      const tfProgress = makeTerraformProgressWithStatus("generating", "Generating Terraform...");
      const result = buildWithManualFlag(tfProgress, completedArchitectureAgents, false);
      expect(result.coderRow).toBeNull();
    });

    it("FAILS: returns null coderRow during regular architecture generation even when terraformProgress.status is completed", () => {
      const tfProgress = makeTerraformProgressWithStatus("completed", "Terraform generation complete");
      const result = buildWithManualFlag(tfProgress, completedArchitectureAgents, false);
      expect(result.coderRow).toBeNull();
    });

    it("FAILS: returns coderRow only when isManualTerraformRun is true", () => {
      const tfProgress = makeTerraformProgressWithStatus("generating", "Generating Terraform...");
      const result = buildWithManualFlag(tfProgress, completedArchitectureAgents, true);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("running");
    });

    it("FAILS: terminal CTA (TERMINAL_CODER_SUMMARY) only appears for manual Terraform run completion", () => {
      const tfProgress = makeTerraformProgressWithStatus("completed", "Terraform generation complete");
      const resultWithManual = buildWithManualFlag(tfProgress, completedArchitectureAgents, true);
      expect(resultWithManual.coderRow).not.toBeNull();
      expect(resultWithManual.coderRow!.summary).toBe(TERMINAL_CODER_SUMMARY);
      expect(resultWithManual.coderRow!.status).toBe("completed");

      const resultWithoutManual = buildWithManualFlag(tfProgress, completedArchitectureAgents, false);
      expect(resultWithoutManual.coderRow).toBeNull();
    });
  });

  describe("Step 4: connector rendering — structural ownership", () => {
    function makeArchAgent(agent: string, status: GenerationAgentState["status"] = "completed"): GenerationAgentState {
      return {
        agent,
        label: agent === "requirements" ? "Requirements" : agent === "architect" ? "Architect" : "Cost analysis",
        status,
        summary: `${agent} complete`,
        detail: null,
        blocked_by: agent === "requirements" ? [] : agent === "architect" ? ["requirements"] : ["architect"],
        started_at: "2026-04-11T12:00:00Z",
        completed_at: status === "completed" ? "2026-04-11T12:00:05Z" : null,
        elapsed_ms: 5000,
        progress_text: null,
        history: [],
        error: null,
      };
    }

    function makeCoderRow(status: GenerationAgentState["status"] = "completed"): GenerationAgentState {
      return {
        agent: "coder",
        label: "Coder",
        status,
        summary: "Terraform generation complete",
        detail: null,
        blocked_by: [],
        started_at: "2026-04-11T12:00:10Z",
        completed_at: status === "completed" ? "2026-04-11T12:00:20Z" : null,
        elapsed_ms: 10000,
        progress_text: null,
        history: [],
        error: null,
      };
    }

    function buildAllRows(archAgents: GenerationAgentState[], coderRow: GenerationAgentState | null): GenerationAgentState[] {
      return coderRow ? [...archAgents, coderRow] : archAgents;
    }

    function connectorOwners(allRows: GenerationAgentState[]): Array<{ index: number; agent: string; ownsConnector: boolean }> {
      const archRowCount = allRows.filter(r => r.agent !== "coder").length;
      return allRows.map((row, i) => {
        const isArchRow = row.agent !== "coder";
        const archIndex = allRows.slice(0, i + 1).filter(r => r.agent !== "coder").length - 1;
        const isLastArchRow = isArchRow && archIndex === archRowCount - 1;
        const ownsConnector = isArchRow && !isLastArchRow;
        return { index: i, agent: row.agent, ownsConnector };
      });
    }

    it("FAILS: only non-coder rows own a continuation connector segment", () => {
      const archAgents = [
        makeArchAgent("requirements", "completed"),
        makeArchAgent("architect", "completed"),
        makeArchAgent("cost_analyst", "completed"),
      ];
      const coderRow = makeCoderRow("completed");
      const allRows = buildAllRows(archAgents, coderRow);
      const owners = connectorOwners(allRows);

      owners.forEach(({ agent, ownsConnector }) => {
        if (agent === "coder") {
          expect(ownsConnector).toBe(false);
        }
      });
    });

    it("FAILS: the coder row does not render a top or bottom continuation connector", () => {
      const archAgents = [
        makeArchAgent("requirements", "completed"),
        makeArchAgent("architect", "completed"),
      ];
      const coderRow = makeCoderRow("completed");
      const allRows = buildAllRows(archAgents, coderRow);
      const coderEntry = connectorOwners(allRows).find(e => e.agent === "coder");

      expect(coderEntry).toBeDefined();
      expect(coderEntry!.ownsConnector).toBe(false);
    });

    it("FAILS: the last architecture row stops its connector before the coder row", () => {
      const archAgents = [
        makeArchAgent("requirements", "completed"),
        makeArchAgent("architect", "completed"),
        makeArchAgent("cost_analyst", "completed"),
      ];
      const coderRow = makeCoderRow("completed");
      const allRows = buildAllRows(archAgents, coderRow);
      const owners = connectorOwners(allRows);

      const lastArchOwner = owners.filter(e => e.agent !== "coder").pop();
      const coderOwner = owners.find(e => e.agent === "coder");

      expect(lastArchOwner!.ownsConnector).toBe(false);
      expect(coderOwner!.ownsConnector).toBe(false);
    });

    it("FAILS: connector ownership is determined by architecture-chain position, not fixed row-count height", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");

      const archAgents: GenerationAgentState[] = [
        makeArchAgent("requirements", "completed"),
        makeArchAgent("architect", "completed"),
        makeArchAgent("cost_analyst", "completed"),
      ];
      const result = buildCoderAgentStateFromProgress(tfProgress, archAgents, true);
      const allRows = buildAllRows(archAgents, result.coderRow);
      const owners = connectorOwners(allRows);

      const archOwners = owners.filter(e => e.agent !== "coder");
      expect(archOwners.length).toBe(3);

      archOwners.slice(0, -1).forEach(e => expect(e.ownsConnector).toBe(true));
      expect(archOwners[archOwners.length - 1].ownsConnector).toBe(false);

      const coderOwner = owners.find(e => e.agent === "coder");
      expect(coderOwner!.ownsConnector).toBe(false);
    });
  });

  describe("backendAgents timestamp authority", () => {
    function makeBackendCoderAgent(overrides: Partial<GenerationAgentState> = {}): GenerationAgentState {
      return {
        agent: "coder",
        label: "Coder",
        status: "running",
        summary: "Generating Terraform...",
        detail: null,
        blocked_by: [],
        started_at: "2026-04-11T12:00:00Z",
        completed_at: null,
        elapsed_ms: 5000,
        progress_text: null,
        history: [],
        error: null,
        ...overrides,
      };
    }

    it("coder row started_at comes from terraformProgress.lastUpdateAt when backendAgents is null", () => {
      const lastUpdateAt = Date.now();
      const tfProgress: TerraformProgress = {
        status: "generating",
        activity: "Generating main.tf",
        emittedCount: 1,
        expectedMinFiles: 4,
        currentFile: "main.tf",
        lastUpdateAt,
      };
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true, null);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.started_at).toBe(new Date(lastUpdateAt).toISOString());
    });

    it("coder row started_at comes from backendAgents when available", () => {
      const tfProgress: TerraformProgress = {
        status: "generating",
        activity: "Generating main.tf",
        emittedCount: 1,
        expectedMinFiles: 4,
        currentFile: "main.tf",
        lastUpdateAt: Date.now() + 10000,
      };
      const backendCoder = makeBackendCoderAgent({
        started_at: "2026-04-11T12:00:00Z",
        completed_at: null,
        elapsed_ms: 5000,
      });
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true, [backendCoder]);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.started_at).toBe("2026-04-11T12:00:00Z");
    });

    it("backend timestamps take precedence for completed_at and elapsed_ms", () => {
      const tfProgress: TerraformProgress = {
        status: "completed",
        activity: "Terraform generation complete",
        emittedCount: 4,
        expectedMinFiles: 4,
        currentFile: null,
        lastUpdateAt: Date.now() + 10000,
      };
      const backendCoder = makeBackendCoderAgent({
        status: "completed",
        started_at: "2026-04-11T12:00:00Z",
        completed_at: "2026-04-11T12:00:30Z",
        elapsed_ms: 30000,
        progress_text: null,
      });
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true, [backendCoder]);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.completed_at).toBe("2026-04-11T12:00:30Z");
      expect(result.coderRow!.elapsed_ms).toBe(30000);
    });

    it("progress_text still comes from terraformProgress even when backendAgents is available", () => {
      const tfProgress: TerraformProgress = {
        status: "generating",
        activity: "Generating variables.tf",
        emittedCount: 2,
        expectedMinFiles: 4,
        currentFile: "variables.tf",
        lastUpdateAt: Date.now(),
      };
      const backendCoder = makeBackendCoderAgent({
        progress_text: "Old progress text",
      });
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true, [backendCoder]);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.progress_text).toBe("Generating variables.tf");
    });

    it("timer does not restart: existing started_at is preserved when backendAgents provides coder", () => {
      const oldTimestamp = "2026-04-11T12:00:00Z";
      const newTimestamp = Date.now() + 10000;
      const tfProgress: TerraformProgress = {
        status: "generating",
        activity: "Generating outputs.tf",
        emittedCount: 3,
        expectedMinFiles: 4,
        currentFile: "outputs.tf",
        lastUpdateAt: newTimestamp,
      };
      const backendCoder = makeBackendCoderAgent({
        started_at: oldTimestamp,
      });
      const result = buildCoderAgentStateFromProgress(tfProgress, [], true, [backendCoder]);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.started_at).toBe(oldTimestamp);
      expect(result.coderRow!.started_at).not.toBe(new Date(newTimestamp).toISOString());
    });
  });
});
