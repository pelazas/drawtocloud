import { describe, expect, it } from "vitest";
import {
  GenerationApiError,
  isQuotaExceededError,
  parseDiscoveryStartResponse,
  resolveProjectRedirectPath,
  shouldFallbackToDiscoveryWs,
} from "../generationStart";

describe("generation start discovery helpers", () => {
  it("resolves workspace query redirect path", () => {
    expect(resolveProjectRedirectPath("my-project-slug")).toBe("/?project=my-project-slug");
  });

  it("throws when redirect slug is missing", () => {
    expect(() => resolveProjectRedirectPath(null)).toThrow("shareable link");
  });

  it("parses valid discovery start response with trace_id", () => {
    const parsed = parseDiscoveryStartResponse({
      project_id: "project-1",
      share_slug: "my-project-slug",
      trace_id: "trace-1",
      generation_status: "idle",
    });

    expect(parsed).toEqual({
      project_id: "project-1",
      share_slug: "my-project-slug",
      trace_id: "trace-1",
      generation_status: "idle",
    });
  });

  it("parses valid discovery start response without trace_id", () => {
    const parsed = parseDiscoveryStartResponse({
      project_id: "project-2",
      share_slug: "my-project-slug-2",
      generation_status: "idle",
    });

    expect(parsed).toEqual({
      project_id: "project-2",
      share_slug: "my-project-slug-2",
      generation_status: "idle",
    });
  });

  it("falls back to websocket path for unknown discovery endpoint status", () => {
    expect(shouldFallbackToDiscoveryWs(404)).toBe(true);
    expect(shouldFallbackToDiscoveryWs(405)).toBe(true);
    expect(shouldFallbackToDiscoveryWs(500)).toBe(false);
  });

  it("detects quota exhausted api errors", () => {
    const error = new GenerationApiError("No quota left", 400, "quota_exhausted");
    expect(isQuotaExceededError(error)).toBe(true);
  });

  it("does not treat non-quota errors as quota exhausted", () => {
    const error = new Error("network failure");
    expect(isQuotaExceededError(error)).toBe(false);
  });
});
