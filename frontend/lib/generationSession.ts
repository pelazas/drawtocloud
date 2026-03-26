import type { CanvasSession } from "./projects";

type ResolveGenerationProjectIdOptions = {
  forceNewProject?: boolean;
};

export function resolveGenerationProjectId(
  canvasSession: CanvasSession | null,
  options?: ResolveGenerationProjectIdOptions
): string | undefined {
  if (options?.forceNewProject) return undefined;
  if (!canvasSession) return undefined;

  if (canvasSession.mode === "existing") {
    return canvasSession.project.id;
  }

  return canvasSession.projectId ?? undefined;
}
