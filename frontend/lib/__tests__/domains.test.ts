import { describe, expect, it } from "vitest";
import { isAuthRoute } from "../domains";

describe("domain route helpers", () => {
  it("treats /login as auth route", () => {
    expect(isAuthRoute("/login")).toBe(true);
  });

  it("treats /auth/callback as auth route", () => {
    expect(isAuthRoute("/auth/callback")).toBe(true);
  });

  it("does not treat /register as auth route", () => {
    expect(isAuthRoute("/register")).toBe(false);
  });
});
