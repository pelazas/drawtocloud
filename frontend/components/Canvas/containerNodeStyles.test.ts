import { describe, expect, it } from "vitest";

import {
  colorForContainerType,
  defaultContainerSize,
  getContainerNodeStyles,
  hexToRgba,
  normalizeContainerType,
} from "./containerNodeStyles";

describe("containerNodeStyles", () => {
  it("defaults unknown container types to vpc", () => {
    expect(normalizeContainerType("unknown")).toBe("vpc");
    expect(colorForContainerType(undefined)).toBe("#3b82f6");
    expect(defaultContainerSize(null)).toEqual({ width: 700, height: 500 });
  });

  it("returns per-type colors and sizes", () => {
    expect(colorForContainerType("az")).toBe("#6366f1");
    expect(colorForContainerType("subnet")).toBe("#14b8a6");
    expect(defaultContainerSize("az")).toEqual({ width: 500, height: 400 });
    expect(defaultContainerSize("subnet")).toEqual({ width: 400, height: 300 });
  });

  it("converts hex colors to rgba strings", () => {
    expect(hexToRgba("#3b82f6", 0.04)).toBe("rgba(59, 130, 246, 0.04)");
  });

  it("builds selection styles from the container type", () => {
    expect(getContainerNodeStyles("az", false)).toEqual({
      borderColor: "#6366f199",
      background: "rgba(99, 102, 241, 0.04)",
      labelColor: "#6366f1",
    });

    expect(getContainerNodeStyles("subnet", true)).toEqual({
      borderColor: "#14b8a699",
      background: "rgba(20, 184, 166, 0.04)",
      labelColor: "#14b8a6",
      boxShadow: "0 0 0 1px rgba(20, 184, 166, 0.3), inset 0 0 20px rgba(20, 184, 166, 0.05)",
    });
  });
});
