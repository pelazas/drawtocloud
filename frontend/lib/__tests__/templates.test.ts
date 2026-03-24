import { describe, expect, it } from "vitest";
import { parseCloneTemplateResponse, parseTemplateDetailResponse, parseTemplatesResponse } from "../templates";

describe("template API response parsers", () => {
  it("parses valid template list payload", () => {
    const parsed = parseTemplatesResponse([
      {
        title: "ECS + RDS",
        share_slug: "tmpl0001",
        thumbnail_url: "https://cdn.example/t1.png",
        description: "Scale-ready web app with managed DB",
      },
      { title: "Lambda", share_slug: "tmpl0002", thumbnail_url: null, description: "Serverless API and jobs" },
    ]);

    expect(parsed).toEqual([
      {
        title: "ECS + RDS",
        share_slug: "tmpl0001",
        thumbnail_url: "https://cdn.example/t1.png",
        description: "Scale-ready web app with managed DB",
      },
      { title: "Lambda", share_slug: "tmpl0002", thumbnail_url: null, description: "Serverless API and jobs" },
    ]);
  });

  it("filters malformed template rows", () => {
    const parsed = parseTemplatesResponse([
      { title: "Valid", share_slug: "tmpl0001", thumbnail_url: null, description: "Valid row" },
      { title: "Missing slug" },
      "invalid",
    ]);

    expect(parsed).toEqual([{ title: "Valid", share_slug: "tmpl0001", thumbnail_url: null, description: "Valid row" }]);
  });

  it("parses valid clone response", () => {
    expect(parseCloneTemplateResponse({ share_slug: "clone0001" })).toEqual({ share_slug: "clone0001" });
  });

  it("returns null for invalid clone response", () => {
    expect(parseCloneTemplateResponse({})).toBeNull();
    expect(parseCloneTemplateResponse("nope")).toBeNull();
  });

  it("parses valid template detail response", () => {
    const parsed = parseTemplateDetailResponse({
      title: "ECS + RDS",
      share_slug: "tmpl0001",
      thumbnail_url: "https://cdn.example/t1.png",
      nodes: [{ id: "vpc", type: "service", position: { x: 0, y: 0 }, data: { label: "VPC", category: "network" } }],
      edges: [{ id: "e1", source: "vpc", target: "alb" }],
      terraform_files: [{ filename: "main.tf", content: "resource {}" }],
      cost_estimate: { monthly_total: 42, breakdown: [] },
      arch_description: { overview: "Sample architecture" },
    });

    expect(parsed).toEqual({
      title: "ECS + RDS",
      share_slug: "tmpl0001",
      thumbnail_url: "https://cdn.example/t1.png",
      nodes: [{ id: "vpc", type: "service", position: { x: 0, y: 0 }, data: { label: "VPC", category: "network" } }],
      edges: [{ id: "e1", source: "vpc", target: "alb" }],
      terraform_files: [{ filename: "main.tf", content: "resource {}", description: "" }],
      cost_estimate: { monthly_total: 42, breakdown: [] },
      arch_description: { overview: "Sample architecture" },
    });
  });

  it("returns null for invalid template detail response", () => {
    expect(parseTemplateDetailResponse({ title: "Missing slug" })).toBeNull();
    expect(parseTemplateDetailResponse({ title: "X", share_slug: "s", nodes: "bad" })).toBeNull();
  });
});
