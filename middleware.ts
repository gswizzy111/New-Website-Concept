import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PREVIEW_MODE, PREVIEW_MESSAGE } from "@/lib/preview";
import { ADMIN_SESSION_COOKIE, lookupAdminSession } from "@/lib/admin-session";

// ─── COMING SOON MODE ───────────────────────────────────────────────────────
// Set to false and push to bring the full site back.
const COMING_SOON = false;
// ────────────────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin and accountant sign-in sessions (lib/admin-session.ts), looked up
  // only on admin paths. Each page and route checks the role again itself.
  const onAdminPath = pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
  const adminSession = onAdminPath && !PREVIEW_MODE
    ? await lookupAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
    : null;
  const isFullAdmin = adminSession?.role === "admin";
  const isAccountantSession = adminSession?.role === "accountant";
  const isAdminSession = !!adminSession;

  // Accountants get the tax reports and nothing else: no orders, customers or
  // settings. Any other admin page sends them back to the tax reports, and any
  // other admin API refuses them (the tax page re-checks the account itself).
  if (isAccountantSession) {
    const within = (base: string) => pathname === base || pathname.startsWith(base + "/");
    const isAuthRoute = pathname === "/api/admin/login" || pathname === "/api/admin/logout";
    if (pathname.startsWith("/api/admin/") && !isAuthRoute && !within("/api/admin/tax/export")) {
      return NextResponse.json({ error: "Not available to accountants" }, { status: 403 });
    }
    if (within("/admin") && !within("/admin/login") && !within("/admin/tax")) {
      return NextResponse.redirect(new URL("/admin/tax", request.url));
    }
  }

  // Preview mode: checkout, payments, shipping, customer accounts and the
  // admin area are off. Every API call answers "not functional yet" and
  // Supabase writes are refused in lib/preview.ts (signing in to the admin
  // writes a session, so it can't work here).
  if (PREVIEW_MODE) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: PREVIEW_MESSAGE }, { status: 503 });
    }
    const PRIVATE = ["/admin", "/accountant", "/account", "/affiliates", "/partners", "/cases", "/orders"];
    if (PRIVATE.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.rewrite(new URL("/not-available", request.url));
    }
  }

  // Admin APIs: each route checks its own role too; this backstop keeps a
  // route that forgets from being open to everyone.
  if (pathname.startsWith("/api/admin/")) {
    const isAuthRoute = pathname === "/api/admin/login" || pathname === "/api/admin/logout";
    if (!isAuthRoute && !isAdminSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Admin auth (always runs)
  if (pathname.startsWith("/admin")) {
    if (pathname.startsWith("/admin/login")) return NextResponse.next();
    if (!isAdminSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  // Customer accounts. Orders are matched to accounts by email, so only a
  // signed-in customer with a confirmed email gets past here.
  const ACCOUNT_PUBLIC = ["/account/login", "/account/signup", "/account/forgot-password", "/account/reset-password", "/account/confirm"];
  const isAccountPage = (pathname === "/account" || pathname.startsWith("/account/")) && !ACCOUNT_PUBLIC.some((p) => pathname.startsWith(p));
  const isAccountApi = pathname.startsWith("/api/account/") && !pathname.startsWith("/api/account/auth/")
    // Checkout pages ask for prefill details; the route answers 204 when signed out
    && !(pathname === "/api/account/profile" && request.method === "GET");
  if (isAccountPage || isAccountApi) {
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
    const confirmed = !!user?.email_confirmed_at;
    if (isAccountApi && !confirmed) {
      return NextResponse.json({ error: "Please log in again." }, { status: 401 });
    }
    if (!user) {
      const loginUrl = new URL("/account/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (!confirmed) {
      const loginUrl = new URL("/account/login", request.url);
      loginUrl.searchParams.set("unconfirmed", "1");
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
