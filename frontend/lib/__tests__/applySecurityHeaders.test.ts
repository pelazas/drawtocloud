import { describe, it, expect, vi } from "vitest";
import { applySecurityHeaders } from "../applySecurityHeaders";

describe("applySecurityHeaders", () => {
  it("replaces CSP header with nonce if present", () => {
    const response = {
      headers: {
        get: vi.fn((key: string) =>
          key === "Content-Security-Policy"
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'"
            : null
        ),
        set: vi.fn(),
      },
    } as unknown as import("next/server").NextResponse;

    applySecurityHeaders(response, "abc123");

    expect(response.headers.set).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("'nonce-abc123'")
    );
    const csp = (response.headers.set as ReturnType<typeof vi.fn>).mock.calls.find(
      ([key]: [string]) => key === "Content-Security-Policy"
    )?.[1] as string;
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("does nothing if no CSP header exists", () => {
    const response = {
      headers: {
        get: vi.fn(() => null),
        set: vi.fn(),
      },
    } as unknown as import("next/server").NextResponse;

    applySecurityHeaders(response, "abc123");

    expect(response.headers.set).not.toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.anything()
    );
  });
});
