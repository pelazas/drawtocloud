import { describe, expect, it } from "vitest";
import { parseCloneTemplateResponse, parseTemplatesResponse } from "../templates";

describe("template API response parsers", () => {
  it("parses valid template list payload", () => {
    const parsed = parseTemplatesResponse([
      { title: "ECS + RDS", share_slug: "tmpl0001", thumbnail_url: "https://cdn.example/t1.png" },
      { title: "Lambda", share_slug: "tmpl0002", thumbnail_url: null },
    ]);

    expect(parsed).toEqual([
      { title: "ECS + RDS", share_slug: "tmpl0001", thumbnail_url: "https://cdn.example/t1.png" },
      { title: "Lambda", share_slug: "tmpl0002", thumbnail_url: null },
    ]);
  });

  it("filters malformed template rows", () => {
    const parsed = parseTemplatesResponse([
      { title: "Valid", share_slug: "tmpl0001", thumbnail_url: null },
      { title: "Missing slug" },
      "invalid",
    ]);

    expect(parsed).toEqual([{ title: "Valid", share_slug: "tmpl0001", thumbnail_url: null }]);
  });

  it("parses valid clone response", () => {
    expect(parseCloneTemplateResponse({ share_slug: "clone0001" })).toEqual({ share_slug: "clone0001" });
  });

  it("returns null for invalid clone response", () => {
    expect(parseCloneTemplateResponse({})).toBeNull();
    expect(parseCloneTemplateResponse("nope")).toBeNull();
  });
});
