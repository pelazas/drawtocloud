import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseErrorMessage(body: unknown): string {
  if (!isRecord(body)) return "Request failed";

  const detail = (body as { detail?: unknown }).detail;
  if (isRecord(detail)) {
    const message = detail.message;
    if (typeof message === "string" && message) return message;

    const error = detail.error;
    if (typeof error === "string" && error) return error;
  }

  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join(", ");
    }
  }

  return "Request failed";
}

async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Missing access token. Please sign in again.");
  }

  return token;
}

export type CreateProjectResponse = {
  project_id: string;
  share_slug: string;
};

function parseCreateProjectResponse(body: unknown): CreateProjectResponse | null {
  if (!isRecord(body)) return null;
  if (!isNonEmptyString(body.project_id)) return null;
  if (!isNonEmptyString(body.share_slug)) return null;

  return {
    project_id: body.project_id.trim(),
    share_slug: body.share_slug.trim(),
  };
}

export async function createProject(name: string): Promise<CreateProjectResponse> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new Error(parseErrorMessage(body));
  }

  const parsed = parseCreateProjectResponse(body);
  if (!parsed) {
    throw new Error("Invalid create project response");
  }

  return parsed;
}

export async function saveSnapshot(
  projectId: string,
  nodes: unknown[],
  edges: unknown[],
  options?: { structureChanged?: boolean }
): Promise<void> {
  const token = await getAccessToken();
  const payload: Record<string, unknown> = { nodes, edges };
  if (options?.structureChanged !== undefined) {
    payload.structure_changed = options.structureChanged;
  }
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/snapshot`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as unknown;
    throw new Error(parseErrorMessage(body));
  }
}

export async function renameProject(projectId: string, title: string): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as unknown;
    throw new Error(parseErrorMessage(body));
  }
}
