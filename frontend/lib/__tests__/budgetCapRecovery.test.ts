import { describe, expect, it } from "vitest";
import {
  buildBudgetCapRecoveryAssistantMessage,
  parseBudgetRecoveryMetadata,
  parseBudgetCapRecoveryDetails,
  parseGenerationSnapshotHydration,
} from "../budgetCapRecovery";

describe("budgetCapRecovery", () => {
  it("parses structured budget_cap_unmet payload and computes overage when omitted", () => {
    const details = parseBudgetCapRecoveryDetails({
      error: "budget_cap_unmet",
      budget_cap: 1500,
      estimated_total: 1750,
    });

    expect(details).toEqual({
      budgetCap: 1500,
      estimatedTotal: 1750,
      overage: 250,
    });
  });

  it("builds assistant guidance message with concrete overage values", () => {
    const message = buildBudgetCapRecoveryAssistantMessage({
      budgetCap: 1500,
      estimatedTotal: 1750,
      overage: 250,
    });

    expect(message).toContain("$1,750.00/mo");
    expect(message).toContain("$250.00 over your $1,500.00 budget");
    expect(message).toContain("retry");
    expect(message).toContain("accept");
  });

  it("extracts hydration state from generation_snapshot payload", () => {
    const snapshot = parseGenerationSnapshotHydration({
      type: "generation_snapshot",
      nodes: [{ id: "node-1" }],
      edges: [{ id: "edge-1", source: "node-1", target: "node-1" }],
      cost_estimate: {
        region: "us-east-1",
        monthly_total: 1750,
        items: [{ node_id: "node-1", label: "Node 1", cost: 1750, estimated: false }],
      },
    });

    expect(snapshot).toEqual({
      nodes: [{ id: "node-1" }],
      edges: [{ id: "edge-1", source: "node-1", target: "node-1" }],
      costEstimatePayload: {
        region: "us-east-1",
        monthly_total: 1750,
        items: [{ node_id: "node-1", label: "Node 1", cost: 1750, estimated: false }],
      },
    });
  });

  it("normalizes budget recovery metadata from websocket payloads", () => {
    const metadata = parseBudgetRecoveryMetadata({
      budget_recovery: {
        status: "pending",
        budget_cap: 5,
        estimated_total: 65,
        overage: 60,
      },
    });

    expect(metadata).toEqual({
      status: "pending",
      budgetCap: 5,
      estimatedTotal: 65,
      overage: 60,
    });
  });
});
