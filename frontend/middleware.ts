import { NextResponse, type NextRequest } from "next/server";
import { isAppDomainHost, isAuthRoute } from "./lib/domains";
import { createSupabaseMiddlewareClient } from "./lib/supabase/middleware";
import { generateNonce } from "./lib/cspNonce";
import { applySecurityHeaders } from "./lib/applySecurityHeaders";

export async function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const host = request.headers.get("host") ?? "";
  if (!isAppDomainHost(host)) {
    const response = NextResponse.next();
    applySecurityHeaders(response, nonce);
    response.headers.set("x-nonce", nonce);
    return response;
  }

  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/p/")) {
    const slug = pathname.slice(3).trim();
    if (slug.length > 0) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("project", slug);
      const response = NextResponse.redirect(redirectUrl, 301);
      applySecurityHeaders(response, nonce);
      response.headers.set("x-nonce", nonce);
      return response;
    }
  }

  if (
    pathname === "/new" ||
    pathname.startsWith("/new/") ||
    pathname === "/register" ||
    pathname.startsWith("/register/")
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    const response = NextResponse.redirect(redirectUrl, 301);
    applySecurityHeaders(response, nonce);
    response.headers.set("x-nonce", nonce);
    return response;
  }

  const authRoute = isAuthRoute(pathname);

  const { supabase, getResponse } = createSupabaseMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && authRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    const response = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(response, nonce);
    response.headers.set("x-nonce", nonce);
    return response;
  }

  const response = getResponse();
  applySecurityHeaders(response, nonce);
  response.headers.set("x-nonce", nonce);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
