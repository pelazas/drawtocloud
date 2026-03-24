import { NextResponse, type NextRequest } from "next/server";
import { isAppDomainHost, isAuthRoute } from "./lib/domains";
import { createSupabaseMiddlewareClient } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!isAppDomainHost(host)) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/p/")) {
    const slug = pathname.slice(3).trim();
    if (slug.length > 0) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("project", slug);
      return NextResponse.redirect(redirectUrl, 301);
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
    return NextResponse.redirect(redirectUrl, 301);
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
    return NextResponse.redirect(redirectUrl);
  }

  return getResponse();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
