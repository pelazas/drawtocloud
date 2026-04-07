import { getSupabaseBrowserClient } from "./supabase/browser";

export type StartGenerationResponse = {
  project_id: string;
  share_slug: string | null;
  trace_id: string;
  generation_status: string;
};

export class GenerationApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GenerationApiError";
    this.status = status;
    this.code = code;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function withAccessToken(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  if (!data.session?.access_token) {
    throw new GenerationApiError("Session expired — please sign in again.", 401, "unauthenticated");
  }

  return {
    ...payload,
    access_token: data.session.access_token,
  };
}

type ErrorDetail = { detail?: { error?: string; message?: string } };

function parseErrorMessage(body: unknown): string {
  const detail = (body as ErrorDetail).detail;
  if (detail?.message) return detail.message;
  if (detail?.error) return detail.error;
  return "Request failed";
}

function parseErrorCode(body: unknown): string | undefined {
  const detail = (body as ErrorDetail).detail;
  if (typeof detail?.error === "string" && detail.error.trim()) return detail.error;
  return undefined;
}

export function isQuotaExceededError(error: unknown): boolean {
  return error instanceof GenerationApiError && error.code === "quota_exhausted";
}

export function resolveProjectRedirectPath(shareSlug: string | null): string {
  if (!shareSlug) {
    throw new Error("Server did not return a shareable link.");
  }
  return `/?project=${encodeURIComponent(shareSlug)}`;
}

export async function startGenerationViaHttp(
  answers: Record<string, string | string[] | number>,
  projectId?: string | null
): Promise<StartGenerationResponse> {
  const payload = await withAccessToken({
    answers,
    project_id: projectId ?? undefined,
  });

  const response = await fetch(`${API_URL}/api/generations/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response
    .json()
    .catch(() => ({}))) as
    | StartGenerationResponse
    | { detail?: { error?: string; message?: string } };

  if (!response.ok) {
    throw new GenerationApiError(parseErrorMessage(body), response.status, parseErrorCode(body));
  }

  return body as StartGenerationResponse;
}
