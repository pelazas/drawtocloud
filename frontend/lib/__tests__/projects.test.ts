import { describe, expect, it } from "vitest";
import { mapProjectRow, toProjectSummary } from "../projects";

describe("mapProjectRow project mode parsing", () => {
  it("maps explicit discovery mode from backend", () => {
    const project = mapProjectRow({
      id: "project-1",
      title: "Discovery project",
      project_mode: "discovery",
      questionnaire_answers: {
        app_name: "Discovery App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.projectMode).toBe("discovery");
  });

  it("defaults to discovery when legacy questionnaire marks chat first", () => {
    const project = mapProjectRow({
      id: "project-2",
      questionnaire_answers: {
        app_name: "Legacy Discovery App",
        _mode: "chat_first",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.projectMode).toBe("discovery");
  });

  it("falls back to default mode when backend value is unknown", () => {
    const project = mapProjectRow({
      id: "project-3",
      project_mode: "something_else",
      questionnaire_answers: {
        app_name: "Default App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.projectMode).toBe("default");
  });

  it("maps persisted cost_estimate payload and uses it for project summaries", () => {
    const project = mapProjectRow({
      id: "project-cost",
      title: "Costly Project",
      questionnaire_answers: {},
      nodes: [{ id: "n1" }],
      cost_estimate: {
        region: "us-east-1",
        monthly_total: 99.2,
        items: [
          {
            node_id: "rds",
            label: "RDS PostgreSQL",
            instance_type: "db.t3.medium",
            cost: 29.2,
            estimated: false,
          },
        ],
      },
    });

    expect(project).not.toBeNull();
    expect(project?.costEstimate?.region).toBe("us-east-1");
    expect(project?.costEstimate?.monthly_total).toBe(99.2);
    expect(project?.costEstimate?.items).toHaveLength(1);

    const summary = toProjectSummary(project!);
    expect(summary.monthlyCost).toBe(99.2);
  });

  it("maps selected node chips from chat history metadata", () => {
    const project = mapProjectRow({
      id: "project-4",
      project_mode: "default",
      chat_history: [
        {
          role: "user",
          content: "Can you optimize this?",
          selected_nodes: [
            { id: "alb", label: "ALB", category: "network" },
            { id: "rds", label: "RDS", category: "database" },
          ],
        },
      ],
      questionnaire_answers: {
        app_name: "Default App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.chatHistory).toHaveLength(1);
    expect(project?.chatHistory[0].selectedNodes).toEqual([
      { id: "alb", label: "ALB", category: "network" },
      { id: "rds", label: "RDS", category: "database" },
    ]);
  });

  it("maps last_opened_at when present", () => {
    const project = mapProjectRow({
      id: "project-last-opened",
      title: "Recently Opened",
      questionnaire_answers: {},
      last_opened_at: "2026-03-31T10:00:00.000Z",
    });

    expect(project).not.toBeNull();
    expect(project?.lastOpenedAt).toBe("2026-03-31T10:00:00.000Z");
  });

  it("maps pending node patch plan metadata from chat history", () => {
    const project = mapProjectRow({
      id: "project-5",
      project_mode: "default",
      chat_history: [
        {
          role: "assistant",
          content: "Approve to apply this change.",
          plan_ready: true,
          execution_mode: "node_patch",
          plan_meta: {
            plan_id: "plan-node-1",
            type: "node_patch",
            status: "pending",
            requested_change: "make this cheaper",
            selected_node_ids: ["rds"],
          },
        },
      ],
      questionnaire_answers: {
        app_name: "Default App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.chatHistory).toHaveLength(1);
    expect(project?.chatHistory[0].planReady).toBe(true);
    expect(project?.chatHistory[0].executionMode).toBe("node_patch");
    expect(project?.chatHistory[0].planMeta?.type).toBe("node_patch");
    expect(project?.chatHistory[0].planMeta?.status).toBe("pending");
    expect(project?.chatHistory[0].planMeta?.plan_id).toBe("plan-node-1");
  });

  it("maps budget recovery metadata from chat history", () => {
    const project = mapProjectRow({
      id: "project-budget-recovery",
      project_mode: "default",
      chat_history: [
        {
          role: "assistant",
          content: "Reply with \"retry\" to run another tighter pass, or \"accept\" to continue with this architecture.",
          execution_mode: "chat_only",
          budget_recovery: {
            status: "pending",
            budget_cap: 5,
            estimated_total: 65,
            overage: 60,
          },
        },
      ],
      questionnaire_answers: {
        app_name: "Budget App",
      },
    });

    expect(project).not.toBeNull();
    expect(project?.chatHistory).toHaveLength(1);
    expect(project?.chatHistory[0].budgetRecovery).toEqual({
      status: "pending",
      budgetCap: 5,
      estimatedTotal: 65,
      overage: 60,
    });
  });

  it("sets monthlyCost to null when cost_estimate is missing", () => {
    const project = mapProjectRow({
      id: "project-no-cost",
      questionnaire_answers: {},
      nodes: [{ id: "n1" }, { id: "n2" }],
    });

    expect(project).not.toBeNull();
    const summary = toProjectSummary(project!);
    expect(summary.monthlyCost).toBeNull();
    expect(summary.nodeCount).toBe(2);
  });
});
