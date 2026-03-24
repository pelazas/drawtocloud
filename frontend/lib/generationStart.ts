import { getSupabaseBrowserClient } from "./supabase/browser";
import wsClient from "./websocket";

export type StartGenerationResponse = {
  project_id: string;
  share_slug: string | null;
  trace_id: string;
  generation_status: string;
};

export type DiscoveryStartResponse = {
  project_id: string;
  share_slug: string | null;
  generation_status: string;
  trace_id?: string;
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

export function shouldFallbackToDiscoveryWs(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

export function parseDiscoveryStartResponse(body: unknown): DiscoveryStartResponse | null {
  if (!isRecord(body)) return null;
  if (typeof body.project_id !== "string" || !body.project_id.trim()) return null;
  if (typeof body.generation_status !== "string" || !body.generation_status.trim()) return null;

  const shareSlug = typeof body.share_slug === "string" && body.share_slug.trim() ? body.share_slug : null;
  const traceId = typeof body.trace_id === "string" && body.trace_id.trim() ? body.trace_id : undefined;

  return {
    project_id: body.project_id,
    share_slug: shareSlug,
    generation_status: body.generation_status,
    ...(traceId ? { trace_id: traceId } : {}),
  };
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
    throw new Error(parseErrorMessage(body));
  }

  return body as StartGenerationResponse;
}

async function startDiscoveryViaHttp(
  answers: Record<string, string | string[] | number>,
  projectId?: string | null
): Promise<DiscoveryStartResponse | null> {
  const payload = await withAccessToken({
    answers,
    project_id: projectId ?? undefined,
  });

  const response = await fetch(`${API_URL}/api/generations/discovery-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    if (shouldFallbackToDiscoveryWs(response.status)) {
      return null;
    }
    throw new Error(parseErrorMessage(body));
  }

  const parsed = parseDiscoveryStartResponse(body);
  if (!parsed) {
    throw new Error("Discovery start endpoint returned an invalid payload.");
  }
  return parsed;
}

function startDiscoveryViaWebSocket(
  answers: Record<string, string | string[] | number>,
  projectId?: string | null
): Promise<DiscoveryStartResponse> {
  const timeoutMs = 15_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanupFns: Array<() => void> = [];
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Timed out while creating discovery project.")));
    }, timeoutMs);

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanupFns.forEach((cleanup) => cleanup());
      action();
    }

    const unsubscribeMessages = wsClient.onMessage((raw: unknown) => {
      if (!isRecord(raw)) return;
      const type = raw.type;
      if (type === "error") {
        const message = typeof raw.message === "string" ? raw.message : "Failed to start discovery session.";
        finish(() => reject(new Error(message)));
        return;
      }

      if (type !== "project_ready") return;
      const projectIdValue = typeof raw.project_id === "string" ? raw.project_id : null;
      const shareSlug = typeof raw.share_slug === "string" ? raw.share_slug : null;
      if (!projectIdValue) {
        finish(() => reject(new Error("Discovery start did not return a project ID.")));
        return;
      }

      finish(() =>
        resolve({
          project_id: projectIdValue,
          share_slug: shareSlug,
          trace_id: typeof raw.trace_id === "string" ? raw.trace_id : "ws-discovery",
          generation_status: "idle",
        })
      );
    });
    cleanupFns.push(unsubscribeMessages);

    wsClient.connect();
    const unsubscribeOpen = wsClient.onOpen(() => {
      void (async () => {
        try {
          const payload = await withAccessToken({
            type: "chat_discovery_start",
            ...answers,
            project_id: projectId ?? undefined,
          });
          wsClient.send(payload);
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error("Failed to start discovery session.")));
        }
      })();
    });
    cleanupFns.push(unsubscribeOpen);
  });
}

export async function startDiscoverySession(
  answers: Record<string, string | string[] | number>,
  projectId?: string | null
): Promise<DiscoveryStartResponse> {
  const viaHttp = await startDiscoveryViaHttp(answers, projectId);
  if (viaHttp) return viaHttp;
  return startDiscoveryViaWebSocket(answers, projectId);
}
