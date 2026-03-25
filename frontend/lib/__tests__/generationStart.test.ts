import { describe, expect, it } from "vitest";
import {
  GenerationApiError,
  isQuotaExceededError,
  resolveProjectRedirectPath,
} from "../generationStart";

describe("generation start helpers", () => {
  it("resolves workspace query redirect path", () => {
    expect(resolveProjectRedirectPath("my-project-slug")).toBe("/?project=my-project-slug");
  });

  it("throws when redirect slug is missing", () => {
    expect(() => resolveProjectRedirectPath(null)).toThrow("shareable link");
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
