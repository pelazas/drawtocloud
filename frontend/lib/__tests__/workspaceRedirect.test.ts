import { describe, expect, it } from "vitest";
import {
  shouldRedirectOnProjectReady,
  shouldRedirectUnauthenticatedRootToLogin,
} from "../workspaceRedirect";

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

describe("shouldRedirectUnauthenticatedRootToLogin", () => {
  it("returns false while auth state is still loading", () => {
    expect(
      shouldRedirectUnauthenticatedRootToLogin({
        authLoading: true,
        hasUser: false,
        projectSlug: null,
      })
    ).toBe(false);
  });

  it("returns false when a user exists", () => {
    expect(
      shouldRedirectUnauthenticatedRootToLogin({
        authLoading: false,
        hasUser: true,
        projectSlug: null,
      })
    ).toBe(false);
  });

  it("returns false when a project slug is present", () => {
    expect(
      shouldRedirectUnauthenticatedRootToLogin({
        authLoading: false,
        hasUser: false,
        projectSlug: "shared-slug",
      })
    ).toBe(false);
  });

  it("returns true for unauthenticated root access", () => {
    expect(
      shouldRedirectUnauthenticatedRootToLogin({
        authLoading: false,
        hasUser: false,
        projectSlug: null,
      })
    ).toBe(true);
  });
});
