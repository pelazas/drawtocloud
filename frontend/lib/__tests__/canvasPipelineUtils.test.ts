import { describe, expect, it } from "vitest";
import {
  getSessionKey,
  hasInvalidNodePositions,
  inferPipelineErrorCode,
  latestPendingChatPlanId,
  normalizeSetupPdfStatus,
  removeNodeFromCostEstimate,
  requestedChangeForPlan,
  setupPdfStateFromProject,
  upsertTerraformFile,
} from "../canvasPipelineUtils";
import type { CanvasMessage, PersistedProject } from "../projects";

describe("normalizeSetupPdfStatus", () => {
  it("returns the value when it is a valid status", () => {
    expect(normalizeSetupPdfStatus("none")).toBe("none");
    expect(normalizeSetupPdfStatus("generating")).toBe("generating");
    expect(normalizeSetupPdfStatus("ready")).toBe("ready");
    expect(normalizeSetupPdfStatus("failed")).toBe("failed");
    expect(normalizeSetupPdfStatus("outdated")).toBe("outdated");
  });

  it("returns 'none' for invalid values", () => {
    expect(normalizeSetupPdfStatus("unknown")).toBe("none");
    expect(normalizeSetupPdfStatus(null)).toBe("none");
    expect(normalizeSetupPdfStatus(undefined)).toBe("none");
    expect(normalizeSetupPdfStatus(123)).toBe("none");
  });
});

describe("setupPdfStateFromProject", () => {
  it("builds SetupPdfState from a PersistedProject", () => {
    const project = {
      setupPdfStatus: "ready",
      setupPdfProgress: 75.5,
      setupPdfError: null,
      setupPdfGeneratedAt: "2024-01-01T00:00:00Z",
      setupPdfSourceRevision: "abc123",
    } as unknown as PersistedProject;

    const result = setupPdfStateFromProject(project);
    expect(result).toEqual({
      status: "ready",
      progress: 76,
      error: null,
      generatedAt: "2024-01-01T00:00:00Z",
      sourceRevision: "abc123",
    });
  });

  it("clamps progress between 0 and 100", () => {
    const project = {
      setupPdfStatus: "generating",
      setupPdfProgress: -10,
    } as unknown as PersistedProject;

    expect(setupPdfStateFromProject(project).progress).toBe(0);

    const project2 = {
      setupPdfStatus: "generating",
      setupPdfProgress: 150,
    } as unknown as PersistedProject;

    expect(setupPdfStateFromProject(project2).progress).toBe(100);
  });
});

describe("upsertTerraformFile", () => {
  it("adds a new file to the list", () => {
    const existing = [{ filename: "main.tf", content: "a" }];
    const incoming = { filename: "variables.tf", content: "b" };
    const result = upsertTerraformFile(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(incoming);
  });

  it("replaces an existing file by filename", () => {
    const existing = [
      { filename: "main.tf", content: "old" },
      { filename: "variables.tf", content: "b" },
    ];
    const incoming = { filename: "main.tf", content: "new" };
    const result = upsertTerraformFile(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(incoming);
  });
});

describe("inferPipelineErrorCode", () => {
  it("returns the error field when present", () => {
    const result = inferPipelineErrorCode({ error: "quota_exceeded" });
    expect(result).toBe("quota_exceeded");
  });

  it("detects budget_cap_unmet from budget recovery metadata", () => {
    const result = inferPipelineErrorCode({ budget_recovery: { status: "pending" } });
    expect(result).toBe("budget_cap_unmet");
  });

  it("detects budget_cap_unmet from message text", () => {
    const result = inferPipelineErrorCode({}, "Budget hard cap unmet");
    expect(result).toBe("budget_cap_unmet");
  });

  it("returns null when no error code is found", () => {
    expect(inferPipelineErrorCode({})).toBeNull();
    expect(inferPipelineErrorCode({ error: "" })).toBeNull();
  });
});

describe("removeNodeFromCostEstimate", () => {
  it("returns null when input is null", () => {
    expect(removeNodeFromCostEstimate(null, "vpc")).toBeNull();
  });

  it("removes the matching node and recalculates total", () => {
    const current = {
      region: "us-east-1",
      monthly_total: 100,
      items: [
        { node_id: "vpc", label: "VPC", cost: 10, estimated: false },
        { node_id: "alb", label: "ALB", cost: 20, estimated: false },
        { node_id: "rds", label: "RDS", cost: 70, estimated: false },
      ],
    };
    const result = removeNodeFromCostEstimate(current, "alb");
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(2);
    expect(result!.monthly_total).toBe(80);
  });

  it("returns the same object when node is not found", () => {
    const current = {
      region: "us-east-1",
      monthly_total: 100,
      items: [{ node_id: "vpc", label: "VPC", cost: 10, estimated: false }],
    };
    const result = removeNodeFromCostEstimate(current, "missing");
    expect(result).toBe(current);
  });
});

describe("hasInvalidNodePositions", () => {
  it("returns false for empty array", () => {
    expect(hasInvalidNodePositions([])).toBe(false);
  });

  it("returns true when all positions are 0,0", () => {
    const nodes = [{ position: { x: 0, y: 0 } }, { position: { x: 0, y: 0 } }];
    expect(hasInvalidNodePositions(nodes)).toBe(true);
  });

  it("returns false when at least one node has a non-zero position", () => {
    const nodes = [{ position: { x: 0, y: 0 } }, { position: { x: 10, y: 20 } }];
    expect(hasInvalidNodePositions(nodes)).toBe(false);
  });

  it("returns true when a position is missing or non-finite", () => {
    const nodes = [{ position: { x: NaN, y: 0 } }];
    expect(hasInvalidNodePositions(nodes)).toBe(true);
  });
});

describe("getSessionKey", () => {
  it("returns existing:projectId for existing sessions", () => {
    const session = { mode: "existing", project: { id: "proj-123" } } as CanvasSession;
    expect(getSessionKey(session)).toBe("existing:proj-123");
  });

  it("returns composite key for new sessions", () => {
    const session = { mode: "new", projectId: "proj-456", answers: { description: "test" } } as unknown as CanvasSession;
    expect(getSessionKey(session)).toBe(`new:proj-456:${JSON.stringify({ description: "test" })}`);
  });
});

describe("latestPendingChatPlanId", () => {
  it("returns the plan_id of the latest pending architecture_refactor plan", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "ok" },
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-1", status: "pending" } },
    ];
    expect(latestPendingChatPlanId(messages)).toBe("plan-1");
  });

  it("returns null when no pending plan exists", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "ok" },
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-1", status: "approved" } },
    ];
    expect(latestPendingChatPlanId(messages)).toBeNull();
  });

  it("prefers the latest pending plan", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-1", status: "pending" } },
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-2", status: "pending" } },
    ];
    expect(latestPendingChatPlanId(messages)).toBe("plan-2");
  });

  it("returns null when a terminal status appears after a pending plan", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-1", status: "pending" } },
      { role: "assistant", content: "done", planMeta: { type: "architecture_refactor", plan_id: "plan-1", status: "approved" } },
    ];
    expect(latestPendingChatPlanId(messages)).toBeNull();
  });
});

describe("requestedChangeForPlan", () => {
  it("returns the requested_change for a matching plan", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-1", requested_change: "Add Redis" } },
    ];
    expect(requestedChangeForPlan(messages, "plan-1")).toBe("Add Redis");
  });

  it("returns null when plan is not found", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "plan", planMeta: { type: "architecture_refactor", plan_id: "plan-1", requested_change: "Add Redis" } },
    ];
    expect(requestedChangeForPlan(messages, "plan-2")).toBeNull();
  });

  it("returns null for non-architecture_refactor plans", () => {
    const messages: CanvasMessage[] = [
      { role: "assistant", content: "plan", planMeta: { type: "node_patch", plan_id: "plan-1", requested_change: "Fix node" } },
    ];
    expect(requestedChangeForPlan(messages, "plan-1")).toBeNull();
  });
});
