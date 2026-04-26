import { describe, expect, it } from "vitest";
import { shouldRedirectLoggedOutUserToRoot } from "../workspaceRedirect";

describe("shouldRedirectLoggedOutUserToRoot", () => {
  it("returns false while auth state is still loading", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: true,
        hasUser: false,
        pathname: "/",
        projectSlug: null,
        logoutRedirectPending: false,
      })
    ).toBe(false);
  });

  it("returns false when a user exists", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: true,
        pathname: "/",
        projectSlug: null,
        logoutRedirectPending: false,
      })
    ).toBe(false);
  });

  it("returns false when on an auth route", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/login",
        projectSlug: null,
        logoutRedirectPending: true,
      })
    ).toBe(false);
  });

  it("returns false when on an auth callback route", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/auth/callback",
        projectSlug: "abc123",
        logoutRedirectPending: true,
      })
    ).toBe(false);
  });

  it("returns false without a logout redirect in progress", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/",
        projectSlug: "abc123",
        logoutRedirectPending: false,
      })
    ).toBe(false);
  });

  it("returns true for a logout redirect in progress on a project page", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/",
        projectSlug: "abc123",
        logoutRedirectPending: true,
      })
    ).toBe(true);
  });
});
