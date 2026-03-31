type ProjectReadyRedirectInput = {
  shareSlug: string | null;
  projectSlug: string | null;
  hasCurrentProject: boolean;
};

type UnauthenticatedRootRedirectInput = {
  authLoading: boolean;
  hasUser: boolean;
  projectSlug: string | null;
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

export function shouldRedirectUnauthenticatedRootToLogin({
  authLoading,
  hasUser,
  projectSlug,
}: UnauthenticatedRootRedirectInput): boolean {
  if (authLoading) return false;
  if (hasUser) return false;
  if (projectSlug) return false;
  return true;
}
