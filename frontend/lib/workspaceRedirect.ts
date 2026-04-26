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
  logoutRedirectPending: boolean;
};

type LoggedOutRedirectInput = {
  authLoading: boolean;
  hasUser: boolean;
  pathname: string;
  projectSlug: string | null;
  logoutRedirectPending: boolean;
};

type ApplyProjectsFetchResultInput = {
  requestId: number;
  latestRequestId: number;
  requestUserId: string | null;
  currentUserId: string | null;
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
  logoutRedirectPending,
}: UnauthenticatedRootRedirectInput): boolean {
  if (authLoading) return false;
  if (hasUser) return false;
  if (projectSlug) return false;
  if (logoutRedirectPending) return false;
  return true;
}

export function shouldRedirectLoggedOutUserToRoot({
  authLoading,
  hasUser,
  pathname,
  projectSlug,
  logoutRedirectPending,
}: LoggedOutRedirectInput): boolean {
  if (authLoading) return false;
  if (hasUser) return false;
  if (isAuthRoute(pathname)) return false;
  if (!logoutRedirectPending) return false;
  if (!projectSlug) return false;
  return true;
}

export function shouldApplyProjectsFetchResult({
  requestId,
  latestRequestId,
  requestUserId,
  currentUserId,
}: ApplyProjectsFetchResultInput): boolean {
  if (requestId !== latestRequestId) return false;
  if (!requestUserId) return false;
  if (requestUserId !== currentUserId) return false;
  return true;
}
