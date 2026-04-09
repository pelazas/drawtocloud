import { describe, expect, it } from "vitest";

import {
  colorForContainerType,
  defaultContainerSize,
  getContainerNodeStyles,
  hexToRgba,
  normalizeSubnetKind,
  normalizeContainerType,
} from "./containerNodeStyles";

describe("containerNodeStyles", () => {
  it("defaults unknown container types to vpc", () => {
    expect(normalizeContainerType("unknown")).toBe("vpc");
    expect(colorForContainerType(undefined)).toBe("#3b82f6");
    expect(defaultContainerSize(null)).toEqual({ width: 700, height: 500 });
  });

  it("returns per-type colors and sizes", () => {
    expect(colorForContainerType("region")).toBe("#8b5cf6");
    expect(colorForContainerType("az")).toBe("#ef4444");
    expect(colorForContainerType("subnet")).toBe("#14b8a6");
    expect(defaultContainerSize("region")).toEqual({ width: 860, height: 640 });
    expect(defaultContainerSize("az")).toEqual({ width: 500, height: 400 });
    expect(defaultContainerSize("subnet")).toEqual({ width: 400, height: 300 });
  });

  it("normalizes unknown subnet kinds to private", () => {
    expect(normalizeSubnetKind("public")).toBe("public");
    expect(normalizeSubnetKind("private")).toBe("private");
    expect(normalizeSubnetKind("dmz")).toBe("private");
    expect(normalizeSubnetKind(undefined)).toBe("private");
  });

  it("converts hex colors to rgba strings", () => {
    expect(hexToRgba("#3b82f6", 0.04)).toBe("rgba(59, 130, 246, 0.04)");
  });

  it("builds selection styles from the container type", () => {
    expect(getContainerNodeStyles("az", false)).toEqual({
      borderColor: "#ef444499",
      background: "rgba(239, 68, 68, 0.04)",
      labelColor: "#ef4444",
    });

    expect(getContainerNodeStyles("subnet", true)).toEqual({
      borderColor: "#14b8a699",
      background: "rgba(20, 184, 166, 0.04)",
      labelColor: "#14b8a6",
      badgeLabel: "PRIVATE",
      badgeColor: "#bfdbfe",
      boxShadow: "0 0 0 1px rgba(20, 184, 166, 0.3), inset 0 0 20px rgba(20, 184, 166, 0.05)",
    });
  });

  it("adds stronger styles for active drag targets", () => {
    expect(getContainerNodeStyles("vpc", false, true)).toEqual({
      borderColor: "#3b82f6cc",
      background: "rgba(59, 130, 246, 0.1)",
      labelColor: "#3b82f6",
      boxShadow: "0 0 0 1px rgba(59, 130, 246, 0.35), inset 0 0 24px rgba(59, 130, 246, 0.08)",
    });
  });

  it("adds subtype styling for public subnets", () => {
    expect(getContainerNodeStyles("subnet", false, false, "public")).toEqual({
      borderColor: "#14b8a699",
      background: "rgba(20, 184, 166, 0.08)",
      labelColor: "#14b8a6",
      badgeLabel: "PUBLIC",
      badgeColor: "#99f6e4",
    });
  });
});
