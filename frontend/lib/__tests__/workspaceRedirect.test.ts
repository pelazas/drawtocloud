import { describe, expect, it } from "vitest";
import { shouldRedirectOnProjectReady } from "../workspaceRedirect";

describe("shouldRedirectOnProjectReady", () => {
  it("returns false when no share slug is provided", () => {
    expect(
      shouldRedirectOnProjectReady({
        shareSlug: null,
        projectSlug: null,
        hasCurrentProject: false,
      })
    ).toBe(false);
  });

  it("returns false when the share slug matches the current query slug", () => {
    expect(
      shouldRedirectOnProjectReady({
        shareSlug: "same-slug",
        projectSlug: "same-slug",
        hasCurrentProject: false,
      })
    ).toBe(false);
  });

  it("returns false when a current project is already loaded", () => {
    expect(
      shouldRedirectOnProjectReady({
        shareSlug: "new-slug",
        projectSlug: "old-slug",
        hasCurrentProject: true,
      })
    ).toBe(false);
  });

  it("returns true when a new slug is ready and no current project exists", () => {
    expect(
      shouldRedirectOnProjectReady({
        shareSlug: "new-slug",
        projectSlug: null,
        hasCurrentProject: false,
      })
    ).toBe(true);
  });
});
