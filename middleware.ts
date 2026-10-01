import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PREVIEW_MODE, PREVIEW_MESSAGE } from "@/lib/preview";

// ─── COMING SOON MODE ───────────────────────────────────────────────────────
// Set to false and push to bring the full site back.
const COMING_SOON = false;
// ────────────────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminCookie = request.cookies.get("admin_auth")?.value;
  // Full admin: exact password match (never matches when no password is set).
  // Accountant: act_<uuid> prefix (DB verified at page/route level).
  const isAdminSession =
    (!!adminPassword && adminCookie === adminPassword) || !!adminCookie?.startsWith("act_");

  // Preview mode: checkout, payments, shipping and customer accounts are off.
  // The admin area works read-only behind its password (when ADMIN_PASSWORD is
  // set): admin pages and GET admin APIs run, every other API call answers
  // "not functional yet", and Supabase writes are refused in lib/preview.ts.
  if (PREVIEW_MODE) {
    const adminOpen = !!adminPassword;
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
    const isAdminApi = pathname.startsWith("/api/admin/");

    if (pathname.startsWith("/api/")) {
      const isAuthRoute = pathname === "/api/admin/login" || pathname === "/api/admin/logout";
      if (adminOpen && isAuthRoute) return NextResponse.next();
      if (adminOpen && isAdminApi && request.method === "GET") {
        return isAdminSession
          ? NextResponse.next()
          : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.json({ error: PREVIEW_MESSAGE }, { status: 503 });
    }
    const PRIVATE = ["/accountant", "/account", "/affiliates", "/partners", "/cases", "/orders"];
    if (
      (isAdminPage && !adminOpen) ||
      PRIVATE.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      return NextResponse.rewrite(new URL("/not-available", request.url));
    }
  }

  // Admin auth (always runs)
  if (pathname.startsWith("/admin")) {
    if (pathname.startsWith("/admin/login")) return NextResponse.next();
    if (!isAdminSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  // Account portal — protect all routes except login/signup
  if (
    pathname.startsWith("/account") &&
    !pathname.startsWith("/account/login") &&
    !pathname.startsWith("/account/signup")
  ) {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const loginUrl = new URL("/account/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Coming soon — rewrite all public pages to homepage.
  // /privacy must always be accessible (Meta Platform Terms require it to be public).
  if (COMING_SOON && pathname !== "/" && pathname !== "/privacy" && !pathname.startsWith("/privacy/")) {
    return NextResponse.rewrite(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.webp).*)",
  ],
};
