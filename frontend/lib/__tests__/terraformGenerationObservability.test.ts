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
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("running");
      expect(result.coderRow!.label).toBe("Coder");
      expect(result.coderRow!.summary).toBe("Requesting Terraform generation...");
    });

    it("appends a coder row when terraformProgress.status is generating", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating main.tf");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("running");
    });

    it("appends a coder row when terraformProgress.status is completed", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.coderRow!.status).toBe("completed");
    });

    it("coder row has the same GenerationAgentState shape as architecture agents", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating Terraform...");
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
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
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
      expect(result.coderRow).not.toBeNull();
      expect(initialAgents).toHaveLength(3);
      expect(initialAgents[0].agent).toBe("requirements");
      expect(initialAgents[1].agent).toBe("architect");
      expect(initialAgents[2].agent).toBe("cost_analyst");
    });

    it("handles null initialAgents (no prior generation)", () => {
      const tfProgress = makeTerraformProgress("generating", "Generating Terraform...");
      const result = buildCoderAgentStateFromProgress(tfProgress, null);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.agent).toBe("coder");
      expect(result.connectedRowCount).toBe(0);
    });
  });

  describe("Step 2: terminal coder copy", () => {
    it("completed coder row uses the exact terminal summary text", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, []);
      expect(result.coderRow).not.toBeNull();
      expect(result.coderRow!.summary).toBe(TERMINAL_CODER_SUMMARY);
    });

    it("completed coder row reports success through status: completed", () => {
      const tfProgress = makeTerraformProgress("completed", "Terraform generation complete");
      const result = buildCoderAgentStateFromProgress(tfProgress, []);
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
      const result = buildCoderAgentStateFromProgress(tfProgress, []);
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
      const result = buildCoderAgentStateFromProgress(tfProgress, initialAgents);
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
});
