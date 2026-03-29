import { withAccessToken } from "./generationStart";
import type { ArchDescription, TerraformFile } from "@/components/OutputPanel";
import type { CostBreakdown } from "@/lib/projects";
import type { Edge, Node } from "reactflow";

export type TemplateSummary = {
  title: string;
  share_slug: string;
  thumbnail_url: string | null;
  description: string | null;
};

export type CloneTemplateResponse = {
  share_slug: string;
};

export type TemplateDetail = {
  title: string;
  share_slug: string;
  thumbnail_url: string | null;
  nodes: Node[];
  edges: Edge[];
  terraform_files: TerraformFile[];
  arch_description: ArchDescription | null;
  cost_estimate: CostBreakdown | null;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type ErrorDetail = { detail?: { error?: string; message?: string } };
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function parseErrorMessage(body: unknown): string {
  const detail = (body as ErrorDetail).detail;
  if (detail?.message) return detail.message;
  if (detail?.error) return detail.error;
  return "Request failed";
}

export function parseTemplatesResponse(body: unknown): TemplateSummary[] {
  if (!Array.isArray(body)) return [];

  return body
    .filter(isRecord)
    .flatMap((item) => {
      if (typeof item.title !== "string" || !item.title.trim()) return [];
      if (typeof item.share_slug !== "string" || !item.share_slug.trim()) return [];
      const thumbnail_url = typeof item.thumbnail_url === "string" && item.thumbnail_url.trim()
        ? item.thumbnail_url
        : null;
      const description = typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : null;
      return [{ title: item.title.trim(), share_slug: item.share_slug.trim(), thumbnail_url, description }];
    });
}

export function parseCloneTemplateResponse(body: unknown): CloneTemplateResponse | null {
  if (!isRecord(body)) return null;
  if (typeof body.share_slug !== "string" || !body.share_slug.trim()) return null;
  return { share_slug: body.share_slug.trim() };
}

export function parseTemplateDetailResponse(body: unknown): TemplateDetail | null {
  if (!isRecord(body)) return null;
  if (typeof body.title !== "string" || !body.title.trim()) return null;
  if (typeof body.share_slug !== "string" || !body.share_slug.trim()) return null;
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges) || !Array.isArray(body.terraform_files)) return null;

  const thumbnail_url = typeof body.thumbnail_url === "string" && body.thumbnail_url.trim()
    ? body.thumbnail_url.trim()
    : null;

  const terraform_files = body.terraform_files
    .filter(isRecord)
    .flatMap((entry) => {
      if (typeof entry.filename !== "string" || !entry.filename.trim()) return [];
      if (typeof entry.content !== "string") return [];
      const description = typeof entry.description === "string" ? entry.description : "";
      return [{ filename: entry.filename.trim(), content: entry.content, description }];
    });

  return {
    title: body.title.trim(),
    share_slug: body.share_slug.trim(),
    thumbnail_url,
    nodes: body.nodes.filter(isRecord) as unknown as Node[],
    edges: body.edges.filter(isRecord) as unknown as Edge[],
    terraform_files,
    arch_description: isRecord(body.arch_description) ? (body.arch_description as ArchDescription) : null,
    cost_estimate: isRecord(body.cost_estimate) ? (body.cost_estimate as unknown as CostBreakdown) : null,
  };
}

export async function fetchTemplates(): Promise<TemplateSummary[]> {
  const response = await fetch(`${API_URL}/api/templates`);
  const body = (await response.json().catch(() => [])) as unknown;

  if (!response.ok) {
    throw new Error(parseErrorMessage(body));
  }
  return parseTemplatesResponse(body);
}

export async function fetchTemplateDetail(slug: string): Promise<TemplateDetail> {
  const response = await fetch(`${API_URL}/api/templates/${encodeURIComponent(slug)}`);
  const body = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    throw new Error(parseErrorMessage(body));
  }

  const parsed = parseTemplateDetailResponse(body);
  if (!parsed) {
    throw new Error("Template detail endpoint returned an invalid payload.");
  }

  return parsed;
}

export async function cloneTemplate(templateSlug: string): Promise<CloneTemplateResponse> {
  const payload = await withAccessToken({});
  const response = await fetch(`${API_URL}/api/templates/${encodeURIComponent(templateSlug)}/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    throw new Error(parseErrorMessage(body));
  }

  const parsed = parseCloneTemplateResponse(body);
  if (!parsed) {
    throw new Error("Template clone endpoint returned an invalid payload.");
  }
  return parsed;
}
