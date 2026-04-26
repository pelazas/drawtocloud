import { describe, expect, it } from "vitest";
import { shouldRedirectLoggedOutUserToRoot } from "../workspaceRedirect";

describe("shouldRedirectLoggedOutUserToRoot", () => {
  it("returns false while auth state is still loading", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: true,
        hasUser: false,
        pathname: "/",
      })
    ).toBe(false);
  });

  it("returns false when a user exists", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: true,
        pathname: "/",
      })
    ).toBe(false);
  });

  it("returns false when on an auth route", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/login",
      })
    ).toBe(false);
  });

  it("returns false when on an auth callback route", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/auth/callback",
      })
    ).toBe(false);
  });

  it("returns true for logged-out user on root path", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/",
      })
    ).toBe(true);
  });

  it("returns true for logged-out user on project page", () => {
    expect(
      shouldRedirectLoggedOutUserToRoot({
        authLoading: false,
        hasUser: false,
        pathname: "/?project=abc123",
      })
    ).toBe(true);
  });
});
