import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, LEGACY_ADMIN_COOKIE, createAdminSession } from "@/lib/admin-session";
import { getRealAdminSession } from "@/lib/admin-auth";
import { ADMIN_SIGNED_IN_MESSAGE } from "@/app/workshop/setup/messages";
import { setWorkshopPassword } from "@/lib/workshop-users";

export const dynamic = "force-dynamic";

/**
 * The workshop setup link's form (/workshop/setup?token=): the worker
 * chooses their password and is signed in. The link works once and for 7
 * days; using it ends any other session of theirs.
 * POST { token, password } → { ok: true, username, signedIn } | 400 { error }
 *   | 409 { error, adminSignedIn: true }: a full admin is signed in in this
 *     browser; their session is kept and nothing is set (the link stays unused)
 */
export async function POST(request: Request) {
  // Never replace a full admin's session with a worker's (an admin in "View as Support" counts)
  if ((await getRealAdminSession())?.role === "admin") {
    return Response.json({ error: ADMIN_SIGNED_IN_MESSAGE, adminSignedIn: true }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const text = await request.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    const v = text.length <= 2_000 ? JSON.parse(text) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) body = v as Record<string, unknown>;
  } catch {
    // answered below
  }
  const result = await setWorkshopPassword({ token: body.token, password: body.password });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store" } });

  // Signed in at once, like after the sign-in form (ends with the browser, 12 hours at most)
  try {
    const token = await createAdminSession({ role: "workshop", workshopUserId: result.workerId }, request.headers.get("user-agent"));
    const jar = await cookies();
    jar.set(ADMIN_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    jar.delete(LEGACY_ADMIN_COOKIE);
  } catch (e) {
    console.error("Workshop setup: starting the session failed:", e instanceof Error ? e.message : e);
    return Response.json({ ok: true, username: result.username, signedIn: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ ok: true, username: result.username, signedIn: true }, { headers: { "Cache-Control": "no-store" } });
}
