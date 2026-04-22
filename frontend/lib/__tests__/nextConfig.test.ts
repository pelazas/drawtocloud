import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config.mjs";

describe("next.config.mjs security headers", () => {
  it("exports a headers async function", () => {
    expect(nextConfig).toBeDefined();
    expect(typeof nextConfig.headers).toBe("function");
  });

  it("returns X-Frame-Options: DENY", async () => {
    const headers = await nextConfig.headers();
    const source = headers.find((h: { source: string }) => h.source === "/:path*");
    expect(source).toBeDefined();
    const xFrame = source.headers.find((h: { key: string }) => h.key === "X-Frame-Options");
    expect(xFrame).toBeDefined();
    expect(xFrame.value).toBe("DENY");
  });

  it("returns X-Content-Type-Options: nosniff", async () => {
    const headers = await nextConfig.headers();
    const source = headers.find((h: { source: string }) => h.source === "/:path*");
    expect(source).toBeDefined();
    const xContentType = source.headers.find((h: { key: string }) => h.key === "X-Content-Type-Options");
    expect(xContentType).toBeDefined();
    expect(xContentType.value).toBe("nosniff");
  });

  it("returns Strict-Transport-Security header", async () => {
    const headers = await nextConfig.headers();
    const source = headers.find((h: { source: string }) => h.source === "/:path*");
    expect(source).toBeDefined();
    const hsts = source.headers.find((h: { key: string }) => h.key === "Strict-Transport-Security");
    expect(hsts).toBeDefined();
    expect(hsts.value).toContain("max-age=");
  });

  it("returns a Content-Security-Policy header", async () => {
    const headers = await nextConfig.headers();
    const source = headers.find((h: { source: string }) => h.source === "/:path*");
    expect(source).toBeDefined();
    const csp = source.headers.find((h: { key: string }) => h.key === "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp.value).toContain("default-src");
  });
});
