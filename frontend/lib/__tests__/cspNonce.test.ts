import { describe, it, expect } from "vitest";
import { generateNonce, applyNonceToCsp } from "../cspNonce";

describe("generateNonce", () => {
  it("returns a non-empty string", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("returns different values on successive calls", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe("applyNonceToCsp", () => {
  it("replaces 'unsafe-inline' with nonce in script-src", () => {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const nonce = "abc123";
    const result = applyNonceToCsp(csp, nonce);
    expect(result).toContain("script-src");
    expect(result).toContain("'nonce-abc123'");
    expect(result).toContain("'self'");
    expect(result).toContain("'unsafe-eval'");
    expect(result).not.toContain("'unsafe-inline'");
  });

  it("does not modify other directives", () => {
    const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'";
    const nonce = "abc123";
    const result = applyNonceToCsp(csp, nonce);
    expect(result).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("returns original CSP if no script-src directive exists", () => {
    const csp = "default-src 'self'; style-src 'self'";
    const nonce = "abc123";
    const result = applyNonceToCsp(csp, nonce);
    expect(result).toBe(csp);
  });
});
