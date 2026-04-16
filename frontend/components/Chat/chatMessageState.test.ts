import { describe, expect, it } from "vitest";

import type { CanvasMessage } from "@/lib/projects";
import {
  latestPendingBudgetRecoveryMessageIndex,
  latestPlanMessageIndex,
} from "./chatMessageState";

const makeMessage = (overrides: Partial<CanvasMessage> = {}): CanvasMessage => ({
  role: "assistant",
  content: "test message",
  ...overrides,
});

describe("latestPlanMessageIndex", () => {
  it("returns -1 when no messages", () => {
    expect(latestPlanMessageIndex([])).toBe(-1);
  });

  it("returns -1 when no plan-ready messages", () => {
    const messages: CanvasMessage[] = [
      makeMessage({ role: "user", content: "hello" }),
      makeMessage({ role: "assistant", content: "hi", planReady: false }),
    ];

    expect(latestPlanMessageIndex(messages)).toBe(-1);
  });

  it("returns the latest assistant plan-ready message index", () => {
    const messages: CanvasMessage[] = [
      makeMessage({ role: "assistant", content: "first", planReady: true }),
      makeMessage({ role: "user", content: "reply" }),
      makeMessage({ role: "assistant", content: "second", planReady: true }),
    ];

    expect(latestPlanMessageIndex(messages)).toBe(2);
  });
});

describe("latestPendingBudgetRecoveryMessageIndex", () => {
  it("returns -1 when no messages", () => {
    expect(latestPendingBudgetRecoveryMessageIndex([])).toBe(-1);
  });

  it("returns the latest pending assistant recovery index", () => {
    const messages: CanvasMessage[] = [
      makeMessage({
        role: "assistant",
        content: "first",
        budgetRecovery: { status: "pending" },
      }),
      makeMessage({ role: "assistant", content: "second" }),
    ];

    expect(latestPendingBudgetRecoveryMessageIndex(messages)).toBe(0);
  });

  it("suppresses pending recovery when a terminal state appears later", () => {
    const messages: CanvasMessage[] = [
      makeMessage({
        role: "assistant",
        content: "pending",
        budgetRecovery: { status: "pending" },
      }),
      makeMessage({
        role: "assistant",
        content: "accepted",
        budgetRecovery: { status: "accepted" },
      }),
    ];

    expect(latestPendingBudgetRecoveryMessageIndex(messages)).toBe(-1);
  });
});
