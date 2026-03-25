import {
  ALL_AWS_REGIONS,
  REGION_LABELS,
  detectClosestRegionsFromCoordinates,
  detectRecommendedRegions,
  detectRecommendedRegionsByIp,
} from "../regionDetect";
import { describe, expect, it } from "vitest";

describe("detectRecommendedRegions", () => {
  it("returns 3 regions for America/New_York", () => {
    const result = detectRecommendedRegions("America/New_York");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("us-east-1");
  });

  it("returns 3 regions for Europe/Berlin", () => {
    const result = detectRecommendedRegions("Europe/Berlin");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("eu-central-1");
  });

  it("returns 3 regions for Asia/Tokyo", () => {
    const result = detectRecommendedRegions("Asia/Tokyo");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("ap-northeast-1");
  });

  it("returns 3 regions for Australia/Sydney", () => {
    const result = detectRecommendedRegions("Australia/Sydney");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("ap-southeast-2");
  });

  it("falls back to us-east-1 for unknown timezone", () => {
    const result = detectRecommendedRegions("Unknown/Zone");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("us-east-1");
  });

  it("falls back to us-east-1 for undefined", () => {
    const result = detectRecommendedRegions(undefined as unknown as string);
    expect(result[0]).toBe("us-east-1");
  });

  it("ALL_AWS_REGIONS has at least 15 regions", () => {
    expect(ALL_AWS_REGIONS.length).toBeGreaterThanOrEqual(15);
  });

  it("REGION_LABELS maps every region to a friendly name", () => {
    for (const region of ALL_AWS_REGIONS) {
      expect(REGION_LABELS[region]).toBeDefined();
    }
  });

  it("ranks closest regions from latitude/longitude", () => {
    const fromFrankfurt = detectClosestRegionsFromCoordinates(50.1109, 8.6821);
    expect(fromFrankfurt).toHaveLength(3);
    expect(fromFrankfurt[0]).toBe("eu-central-1");
  });

  it("uses IP geolocation when available", async () => {
    const regions = await detectRecommendedRegionsByIp({
      fetcher: async () =>
        ({
          ok: true,
          json: async () => ({ latitude: 40.7128, longitude: -74.006 }),
        }) as Response,
      fallbackTimezone: "Europe/Berlin",
    });

    expect(regions).toHaveLength(3);
    expect(regions[0]).toBe("us-east-1");
  });

  it("falls back to timezone mapping when IP lookup fails", async () => {
    const regions = await detectRecommendedRegionsByIp({
      fetcher: async () => {
        throw new Error("network");
      },
      fallbackTimezone: "Europe/Berlin",
    });

    expect(regions).toHaveLength(3);
    expect(regions[0]).toBe("eu-central-1");
  });
});
