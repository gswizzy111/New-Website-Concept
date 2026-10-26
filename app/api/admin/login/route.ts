import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPassword } from "@/lib/crypto";
import { ADMIN_SESSION_COOKIE, LEGACY_ADMIN_COOKIE, createAdminSession } from "@/lib/admin-session";
import { attemptWait, clearAttempts, recordAttempt, waitMessage } from "@/lib/attempt-limit";

const Body = z.object({
  username: z.string().trim().max(100).optional(),
  email: z.string().trim().max(320).optional(),
  password: z.string().min(1).max(200),
});

// A hash that matches nothing, so an unknown username takes as long to refuse
// as a wrong password (no telling which usernames exist)
const NO_MATCH_HASH = "AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// Failed sign-ins allowed per username (or accountant email) before it has to
// wait. Counted per name, never per IP. Each try is counted before the
// password is checked (so a burst of tries at once can't slip past) and a
// successful sign-in clears the count.
const LOGIN_RULE = { max: 10, windowMinutes: 15 };

function tooMany(minutes: number) {
  return Response.json({ error: waitMessage(minutes) }, { status: 429 });
}

async function startSession(
  who: { role: "admin"; adminUserId: string } | { role: "accountant"; accountantId: string },
  request: Request
) {
  const token = await createAdminSession(who, request.headers.get("user-agent"));
  const jar = await cookies();
  // No max-age: the session ends when the browser closes (and after 12 hours at most)
  jar.set(ADMIN_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  jar.delete(LEGACY_ADMIN_COOKIE);
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter your username and password." }, { status: 400 });
  const { username, email, password } = parsed.data;
  const admin = createAdminClient();

  // ── Accountant login (email + password) ──────────────────────────────────
  if (email) {
    const login = email.toLowerCase();
    const wait = await attemptWait("accountant-login", login, LOGIN_RULE);
    if (wait > 0) return tooMany(wait);
    await recordAttempt("accountant-login", login);
    const { data: accountant } = await admin
      .from("accountant_access")
      .select("id, password_hash")
      .eq("email", login)
      .not("password_hash", "is", null)
      .maybeSingle();
    const valid = await verifyPassword(password, accountant?.password_hash ?? NO_MATCH_HASH);
    if (!accountant || !valid) {
      return Response.json({ error: "Incorrect email or password." }, { status: 401 });
    }
    await clearAttempts("accountant-login", login);
    await startSession({ role: "accountant", accountantId: accountant.id }, request);
    await admin.from("accountant_access").update({ last_login_at: new Date().toISOString() }).eq("id", accountant.id);
    return Response.json({ ok: true, role: "accountant" });
  }

  // ── Admin login (username + password) ────────────────────────────────────
  if (!username) return Response.json({ error: "Enter your username and password." }, { status: 400 });
  const login = username.toLowerCase();
  const wait = await attemptWait("admin-login", login, LOGIN_RULE);
  if (wait > 0) return tooMany(wait);
  await recordAttempt("admin-login", login);
  const { data: user } = await admin
    .from("admin_users")
    .select("id, password_hash")
    .eq("username", login)
    .eq("active", true)
    .maybeSingle();
  const valid = await verifyPassword(password, user?.password_hash ?? NO_MATCH_HASH);
  if (!user || !valid) {
    return Response.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  await clearAttempts("admin-login", login);
  await startSession({ role: "admin", adminUserId: user.id }, request);
  await admin.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
  return Response.json({ ok: true, role: "admin" });
}
