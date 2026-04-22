import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

describe("middleware CSP nonce integration", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("exports a middleware function", async () => {
    // Dynamic import to ensure env vars are set before module loads
    const { middleware } = await import("../../middleware");
    expect(typeof middleware).toBe("function");
  });
});
