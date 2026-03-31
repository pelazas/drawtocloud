import { describe, expect, it } from "vitest";
import { buildCostOverlayPresentation } from "../costOverlayPresentation";

describe("buildCostOverlayPresentation", () => {
  it("hides overlay when there is no estimate", () => {
    expect(buildCostOverlayPresentation(null).hidden).toBe(true);
  });

  it("keeps overlay visible for unpriced zero-total estimates", () => {
    const presentation = buildCostOverlayPresentation({
      region: "us-east-1",
      monthly_total: 0,
      items: [
        { node_id: "n1", label: "Unknown", cost: 0, estimated: true, unpriced: true },
      ],
    });

    expect(presentation.hidden).toBe(false);
    expect(presentation.totalLabel).toBe("~$0/mo");
    expect(presentation.note).toBe("Some services could not be priced yet.");
  });

  it("shows normal totals for priced estimates", () => {
    const presentation = buildCostOverlayPresentation({
      region: "us-east-1",
      monthly_total: 48.6,
      items: [{ node_id: "n1", label: "Lambda", cost: 48.6, estimated: true }],
    });

    expect(presentation.hidden).toBe(false);
    expect(presentation.totalLabel).toBe("$49/mo");
    expect(presentation.note).toBeNull();
  });
});
