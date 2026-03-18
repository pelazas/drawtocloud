import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type SetupPdfStatus = "none" | "generating" | "ready" | "failed" | "outdated";

export type SetupPdfState = {
  status: SetupPdfStatus;
  progress: number;
  error: string | null;
  generatedAt: string | null;
  sourceRevision: string | null;
};

export type SetupPdfGenerateResponse = {
  project_id: string;
  setup_pdf_status: SetupPdfStatus;
  setup_pdf_progress: number;
  setup_pdf_error: string | null;
};

export type SetupPdfDownloadResponse = {
  project_id: string;
  setup_pdf_status: SetupPdfStatus;
  download_url: string;
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Missing access token. Please sign in again.");
  }

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function parseError(body: unknown): string {
  if (!body || typeof body !== "object") return "Request failed";
  const detail = (body as { detail?: { message?: string; error?: string } }).detail;
  return detail?.message ?? detail?.error ?? "Request failed";
}

export async function generateSetupPdf(projectId: string): Promise<SetupPdfGenerateResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/setup-pdf/generate`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(parseError(body));
  }

  return body as SetupPdfGenerateResponse;
}

export async function fetchSetupPdfDownloadUrl(projectId: string): Promise<SetupPdfDownloadResponse> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/setup-pdf/download`, {
    method: "GET",
    headers: await getAuthHeaders(),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(parseError(body));
  }

  return body as SetupPdfDownloadResponse;
}

export function emptySetupPdfState(): SetupPdfState {
  return {
    status: "none",
    progress: 0,
    error: null,
    generatedAt: null,
    sourceRevision: null,
  };
}
