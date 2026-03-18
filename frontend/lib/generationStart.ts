import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type StartGenerationResponse = {
  project_id: string;
  share_slug: string | null;
  trace_id: string;
  generation_status: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function withAccessToken(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  return {
    ...payload,
    access_token: data.session?.access_token,
  };
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

  const body = (await response.json()) as
    | StartGenerationResponse
    | { detail?: { error?: string; message?: string } };

  if (!response.ok) {
    const detail = (body as { detail?: { error?: string; message?: string } }).detail;
    throw new Error(detail?.message ?? detail?.error ?? "Failed to start generation");
  }

  return body as StartGenerationResponse;
}
