import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../sanitizeHtml";

describe("sanitizeHtml", () => {
  it("removes script tags from HTML", () => {
    const dirty = '<p>hello</p><script>alert("xss")</script>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
  });

  it("removes event handlers from tags", () => {
    const dirty = '<img src="x" onerror="alert(1)">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("onerror");
  });

  it("preserves safe HTML elements", () => {
    const dirty = '<pre class="shiki"><code>resource "aws_s3_bucket" "b" {}</code></pre>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain("<pre");
    expect(clean).toContain("<code");
    expect(clean).toContain("aws_s3_bucket");
  });

  it("removes javascript: URLs", () => {
    const dirty = '<a href="javascript:alert(1)">click</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("javascript:");
  });

  it("removes iframe tags", () => {
    const dirty = '<iframe src="https://evil.com"></iframe>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<iframe");
  });
});
