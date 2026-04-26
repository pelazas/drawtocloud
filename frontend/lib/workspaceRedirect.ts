import { isAuthRoute } from "./domains";

type ProjectReadyRedirectInput = {
  shareSlug: string | null;
  projectSlug: string | null;
  currentProjectId: string | null;
  readyProjectId: string | null;
};

type UnauthenticatedRootRedirectInput = {
  authLoading: boolean;
  hasUser: boolean;
  projectSlug: string | null;
};

type LoggedOutRedirectInput = {
  authLoading: boolean;
  hasUser: boolean;
  pathname: string;
};

export function shouldRedirectOnProjectReady({
  shareSlug,
  projectSlug,
  currentProjectId,
  readyProjectId,
}: ProjectReadyRedirectInput): boolean {
  if (!shareSlug) return false;
  if (shareSlug === projectSlug) return false;
  if (!currentProjectId) return true;
  if (!readyProjectId) return false;
  if (readyProjectId === currentProjectId) return false;
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

export function shouldRedirectLoggedOutUserToRoot({
  authLoading,
  hasUser,
  pathname,
}: LoggedOutRedirectInput): boolean {
  if (authLoading) return false;
  if (hasUser) return false;
  if (isAuthRoute(pathname)) return false;
  return true;
}
