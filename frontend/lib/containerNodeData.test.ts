import { describe, expect, it } from "vitest";

import { buildContainerNodeData } from "./containerNodeData";

describe("buildContainerNodeData", () => {
  it("omits subnetKind for non-subnet containers", () => {
    expect(buildContainerNodeData("region", "Region", "network", "private")).toEqual({
      label: "Region",
      category: "network",
      containerType: "region",
    });
  });

  it("includes normalized subnetKind for subnet containers", () => {
    expect(buildContainerNodeData("subnet", "Private Subnet", "network", undefined)).toEqual({
      label: "Private Subnet",
      category: "network",
      containerType: "subnet",
      subnetKind: "private",
    });
  });
});
