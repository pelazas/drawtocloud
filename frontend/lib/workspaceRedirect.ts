type ProjectReadyRedirectInput = {
  shareSlug: string | null;
  projectSlug: string | null;
  hasCurrentProject: boolean;
};

export function shouldRedirectOnProjectReady({
  shareSlug,
  projectSlug,
  hasCurrentProject,
}: ProjectReadyRedirectInput): boolean {
  if (!shareSlug) return false;
  if (shareSlug === projectSlug) return false;
  if (hasCurrentProject) return false;
  return true;
}
