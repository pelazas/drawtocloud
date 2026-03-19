import { describe, expect, it } from "vitest";
import { INITIAL_BUDGET_RETRY_STATE, formatBudgetRetryStatus, reduceBudgetRetryState } from "../budgetRetry";

describe("budget retry lifecycle state", () => {
  it("captures retry_started and reports in-progress status", () => {
    const started = reduceBudgetRetryState(INITIAL_BUDGET_RETRY_STATE, {
      stage: "budget_cap",
      event: "retry_started",
      message: "Estimated monthly cost exceeds hard budget cap; running constrained optimization pass.",
      details: {
        budget_cap: 120,
        estimated_total: 168,
        overage: 48,
      },
      traceId: "trace-start",
      timestamp: 1_700_000_000_000,
    });

    expect(started.status).toBe("in_progress");
    expect(started.budgetCap).toBe(120);
    expect(started.estimatedTotal).toBe(168);
    expect(started.overage).toBe(48);
    expect(formatBudgetRetryStatus(started)).toContain("retry in progress");
  });

  it("captures retry success with metadata and context", () => {
    const started = reduceBudgetRetryState(INITIAL_BUDGET_RETRY_STATE, {
      stage: "budget_cap",
      event: "retry_started",
      message: "retry started",
      details: {
        budget_cap: 120,
        estimated_total: 168,
        overage: 48,
      },
      traceId: "trace-1",
      timestamp: 1_700_000_000_000,
    });

    const succeeded = reduceBudgetRetryState(started, {
      stage: "budget_cap",
      event: "retry_succeeded",
      message: "Constrained optimization pass satisfied hard budget cap.",
      details: {
        budget_cap: 120,
        estimated_total: 98,
      },
      traceId: "trace-1",
      timestamp: 1_700_000_100_000,
    });

    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.budgetCap).toBe(120);
    expect(succeeded.estimatedTotal).toBe(98);
    expect(formatBudgetRetryStatus(succeeded)).toBeNull();
  });

  it("formatBudgetRetryStatus returns null for succeeded status", () => {
    const state = reduceBudgetRetryState(
      reduceBudgetRetryState(INITIAL_BUDGET_RETRY_STATE, {
        stage: "budget_cap",
        event: "retry_started",
        message: "Retrying",
        details: { budget_cap: 100, estimated_total: 150, overage: 50 },
      }),
      {
        stage: "budget_cap",
        event: "retry_succeeded",
        message: "Constrained optimization pass satisfied hard budget cap.",
        details: { budget_cap: 100, estimated_total: 90 },
      }
    );
    expect(state.status).toBe("succeeded");
    expect(formatBudgetRetryStatus(state)).toBeNull();
  });

  it("captures retry failure and overage details", () => {
    const started = reduceBudgetRetryState(INITIAL_BUDGET_RETRY_STATE, {
      stage: "budget_cap",
      event: "retry_started",
      message: "retry started",
      details: {
        budget_cap: 120,
        estimated_total: 168,
        overage: 48,
      },
      traceId: "trace-2",
      timestamp: 1_700_000_000_000,
    });

    const failed = reduceBudgetRetryState(started, {
      stage: "budget_cap",
      event: "retry_failed",
      message: "Estimated monthly cost still exceeds hard budget cap after retry.",
      details: {
        budget_cap: 120,
        estimated_total: 141,
        overage: 21,
      },
      traceId: "trace-2",
      timestamp: 1_700_000_100_000,
    });

    expect(failed.status).toBe("failed");
    expect(failed.budgetCap).toBe(120);
    expect(failed.estimatedTotal).toBe(141);
    expect(failed.overage).toBe(21);
    expect(formatBudgetRetryStatus(failed)).toContain("Budget retry failed");
  });
});
