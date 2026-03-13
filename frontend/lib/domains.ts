const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function normalizeHost(rawHost: string): string {
  return rawHost.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
}

function envDomain(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeHost(value);
  return normalized.length > 0 ? normalized : null;
}

const APP_DOMAIN = envDomain(process.env.NEXT_PUBLIC_APP_DOMAIN);
const LANDING_DOMAIN = envDomain(process.env.NEXT_PUBLIC_LANDING_DOMAIN);

export function isAuthRoute(pathname: string): boolean {
  return pathname === "/login" || pathname === "/register" || pathname.startsWith("/auth/callback");
}

export function isAppDomainHost(host: string): boolean {
  const normalized = normalizeHost(host);

  if (APP_DOMAIN) {
    return normalized === APP_DOMAIN;
  }

  if (LANDING_DOMAIN) {
    return normalized !== LANDING_DOMAIN;
  }

  return LOCAL_HOSTS.has(normalized);
}
