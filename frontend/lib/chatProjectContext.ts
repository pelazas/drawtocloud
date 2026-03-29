import type { CanvasSession } from "./projects";

export type ChatProjectContext = {
  projectId: string;
  shareSlug: string | null;
};

export type ChatProjectBootstrapState = {
  context: ChatProjectContext | null;
  pending: Promise<ChatProjectContext> | null;
};

type EnsureChatProjectContextOptions = {
  canvasSession: CanvasSession | null;
  bootstrapState: ChatProjectBootstrapState;
  createProject: (name: string) => Promise<{ project_id: string; share_slug: string }>;
  saveSnapshot: (projectId: string, nodes: unknown[], edges: unknown[]) => Promise<void>;
  nodes: unknown[];
  edges: unknown[];
  onProjectReady?: (projectId: string, shareSlug: string | null) => void;
  projectName?: string;
};

export function projectContextFromSession(canvasSession: CanvasSession | null): ChatProjectContext | null {
  if (canvasSession?.mode === "existing") {
    return {
      projectId: canvasSession.project.id,
      shareSlug: canvasSession.project.shareSlug ?? null,
    };
  }

  if (canvasSession?.mode === "new" && canvasSession.projectId) {
    return {
      projectId: canvasSession.projectId,
      shareSlug: canvasSession.shareSlug ?? null,
    };
  }

  return null;
}

export async function ensureChatProjectContext({
  canvasSession,
  bootstrapState,
  createProject,
  saveSnapshot,
  nodes,
  edges,
  onProjectReady,
  projectName = "Untitled Project",
}: EnsureChatProjectContextOptions): Promise<ChatProjectContext> {
  const fromSession = projectContextFromSession(canvasSession);
  if (fromSession) {
    return fromSession;
  }

  if (bootstrapState.context) {
    return bootstrapState.context;
  }

  if (bootstrapState.pending) {
    return bootstrapState.pending;
  }

  bootstrapState.pending = (async () => {
    const created = await createProject(projectName);
    await saveSnapshot(created.project_id, nodes, edges);
    const context = {
      projectId: created.project_id,
      shareSlug: created.share_slug,
    };
    bootstrapState.context = context;
    onProjectReady?.(context.projectId, context.shareSlug);
    return context;
  })().finally(() => {
    bootstrapState.pending = null;
  });

  return bootstrapState.pending;
}
