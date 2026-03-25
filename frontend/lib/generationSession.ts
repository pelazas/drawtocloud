import type { CanvasSession } from "./projects";

export function resolveGenerationProjectId(
  canvasSession: CanvasSession | null,
  discoveryProjectId: string | null
): string | undefined {
  if (!canvasSession) return undefined;

  if (canvasSession.mode === "existing") {
    return canvasSession.project.id;
  }

  return canvasSession.projectId ?? discoveryProjectId ?? undefined;
}
