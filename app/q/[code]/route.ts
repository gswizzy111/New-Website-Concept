import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/admin-auth";
import { normalizeCode } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

function redirect(request: Request, to: string) {
  const res = NextResponse.redirect(new URL(to, request.url), 302);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

/**
 * Where a scanned card or bag QR code goes (`/q/<CODE>`, printed on the bag
 * labels and tags). Public on purpose, so the phone camera can open it, but it
 * shows nothing itself and tells a signed-out visitor nothing: without a full
 * admin session it never looks the code up, it sends them to sign in and back
 * here (`/admin/login?next=/q/<CODE>`). Signed in, a known code redirects to
 * its admin page; an unknown code gets a plain "not found" page. Codes match
 * in any letter case.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeCode(raw);
  if (!code) return notFound();

  // Signed out (or not a full admin): sign in first, then back to this scan
  const session = await getAdminSession();
  if (session?.role !== "admin") return redirect(request, `/admin/login?next=${encodeURIComponent(`/q/${code}`)}`);

  let found: Awaited<ReturnType<typeof resolveCode>> = null;
  try {
    found = await resolveCode(createAdminClient(), code);
  } catch (e) {
    // A database problem (say the intake tables aren't there yet) reads as "not found" too
    console.error("[qr] code lookup failed:", e instanceof Error ? e.message : e);
  }
  if (!found) return notFound();
  return redirect(request, found.kind === "card" ? `/admin/receiving/card/${found.id}` : `/admin/receiving/bag/${found.id}`);
}

function notFound() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Code not found | The Card Doc</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
         background: #f4f5f7; color: #13224a; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { background: #fff; border: 1px solid #e3e5ea; border-radius: 12px; padding: 28px 24px; max-width: 360px; width: 100%; box-sizing: border-box; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 900; }
  p { margin: 0 0 20px; font-size: 15px; line-height: 1.45; color: #4b5470; }
  a { display: flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 8px; background: #13224a; color: #fff;
      font-weight: 700; font-size: 15px; text-decoration: none; }
  a:focus-visible { outline: 3px solid #f5c518; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>Code not found</h1>
  <p>This QR code doesn't match a card or a bag. The label may be from a deleted bag, or the code was mistyped.</p>
  <a href="/admin/receiving">Open Receiving</a>
</main>
</body>
</html>`;
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}
