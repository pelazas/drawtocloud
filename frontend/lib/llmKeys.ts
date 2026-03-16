import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function getAuthHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type LlmKeyStatus = {
  has_key: boolean;
  provider: string | null;
  model: string | null;
};

export async function getLlmKeyStatus(): Promise<LlmKeyStatus> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/llm-key`, { headers });
  if (!response.ok) {
    throw new Error("Failed to fetch LLM key status");
  }
  return response.json();
}

export async function saveLlmKey(
  provider: string,
  apiKey: string,
  model?: string | null,
): Promise<void> {
  const headers = {
    ...(await getAuthHeader()),
    "Content-Type": "application/json",
  };

  const response = await fetch(`${API_URL}/api/llm-key`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider, api_key: apiKey, model: model || undefined }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { detail?: { message?: string } })?.detail?.message ?? "Failed to save LLM key");
  }
}

export async function deleteLlmKey(): Promise<void> {
  const headers = await getAuthHeader();
  const response = await fetch(`${API_URL}/api/llm-key`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    throw new Error("Failed to delete LLM key");
  }
}
