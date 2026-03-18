import { withAccessToken } from "./generationStart";

export type TemplateSummary = {
  title: string;
  share_slug: string;
  thumbnail_url: string | null;
};

export type CloneTemplateResponse = {
  share_slug: string;
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
      return [{ title: item.title.trim(), share_slug: item.share_slug.trim(), thumbnail_url }];
    });
}

export function parseCloneTemplateResponse(body: unknown): CloneTemplateResponse | null {
  if (!isRecord(body)) return null;
  if (typeof body.share_slug !== "string" || !body.share_slug.trim()) return null;
  return { share_slug: body.share_slug.trim() };
}

export async function fetchTemplates(): Promise<TemplateSummary[]> {
  const response = await fetch(`${API_URL}/api/templates`);
  const body = (await response.json().catch(() => [])) as unknown;

  if (!response.ok) {
    throw new Error(parseErrorMessage(body));
  }
  return parseTemplatesResponse(body);
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
