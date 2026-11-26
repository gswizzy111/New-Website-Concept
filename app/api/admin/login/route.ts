import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPassword } from "@/lib/crypto";
import { ADMIN_SESSION_COOKIE, LEGACY_ADMIN_COOKIE, createAdminSession, type SessionOwner } from "@/lib/admin-session";
import { clearAttempts, takeAttempt, waitMessage } from "@/lib/attempt-limit";

const Body = z.object({
  username: z.string().trim().max(100).optional(),
  email: z.string().trim().max(320).optional(),
  password: z.string().min(1).max(200),
  // Which email login: accountants (the default) or customer support
  as: z.enum(["accountant", "support"]).optional(),
});

// A hash that matches nothing, so an unknown username takes as long to refuse
// as a wrong password (no telling which usernames exist)
const NO_MATCH_HASH = "AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// Failed sign-ins allowed per username (or accountant or support email) before it has to
// wait. Counted per name, never per IP. Each try reserves its place before the
// password is checked, and is counted together with the others (its own
// included), so a burst of tries at once can't slip past (takeAttempt). A
// successful sign-in clears the count.
const LOGIN_RULE = { max: 10, windowMinutes: 15 };

function tooMany(minutes: number) {
  return Response.json({ error: waitMessage(minutes) }, { status: 429 });
}

async function startSession(who: SessionOwner, request: Request) {
  const token = await createAdminSession(who, request.headers.get("user-agent"));
  const jar = await cookies();
  // No max-age: the session ends when the browser closes (and after 12 hours at most)
  jar.set(ADMIN_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  jar.delete(LEGACY_ADMIN_COOKIE);
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter your username and password." }, { status: 400 });
  const { username, email, password, as } = parsed.data;
  const admin = createAdminClient();

  // ── Customer support login (email + password) ────────────────────────────
  if (email && as === "support") {
    const login = email.toLowerCase();
    const { wait } = await takeAttempt("support-login", login, LOGIN_RULE);
    if (wait > 0) return tooMany(wait);
    const { data: member } = await admin
      .from("support_access")
      .select("id, password_hash")
      .eq("email", login)
      .not("password_hash", "is", null)
      .maybeSingle();
    const valid = await verifyPassword(password, member?.password_hash ?? NO_MATCH_HASH);
    if (!member || !valid) {
      return Response.json({ error: "Incorrect email or password." }, { status: 401 });
    }
    await clearAttempts("support-login", login);
    await startSession({ role: "support", supportId: member.id }, request);
    await admin.from("support_access").update({ last_login_at: new Date().toISOString() }).eq("id", member.id);
    return Response.json({ ok: true, role: "support" });
  }

  // ── Accountant login (email + password) ──────────────────────────────────
  if (email) {
    const login = email.toLowerCase();
    const { wait } = await takeAttempt("accountant-login", login, LOGIN_RULE);
    if (wait > 0) return tooMany(wait);
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

  // ── Admin or workshop login (username + password) ────────────────────────
  // Workshop logins (workshop_users) share the username box and the attempt
  // count per username, but are never admin_users rows, so they can never
  // sign in as a full admin here or on the other site. A username can't be
  // both (lib/workshop-users.ts refuses it, and so does the database); the
  // admin account is checked first all the same. A failed try checks both
  // hashes, so it takes as long whichever kind of account the name is.
  if (!username) return Response.json({ error: "Enter your username and password." }, { status: 400 });
  const login = username.toLowerCase();
  const { wait } = await takeAttempt("admin-login", login, LOGIN_RULE);
  if (wait > 0) return tooMany(wait);
  const [{ data: user }, { data: worker }] = await Promise.all([
    admin
      .from("admin_users")
      .select("id, password_hash")
      .eq("username", login)
      .eq("active", true)
      .maybeSingle(),
    // Errors (say, before 20261126_workshop_users.sql is applied) count as no worker
    admin
      .from("workshop_users")
      .select("id, password_hash")
      .eq("username", login)
      .eq("active", true)
      .not("password_hash", "is", null)
      .maybeSingle(),
  ]);
  if (user && (await verifyPassword(password, user.password_hash ?? NO_MATCH_HASH))) {
    await clearAttempts("admin-login", login);
    await startSession({ role: "admin", adminUserId: user.id }, request);
    await admin.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    return Response.json({ ok: true, role: "admin" });
  }
  if (!user) await verifyPassword(password, NO_MATCH_HASH);
  const workerValid = await verifyPassword(password, (worker?.password_hash as string | null | undefined) ?? NO_MATCH_HASH);
  if (!worker || !workerValid) {
    return Response.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  await clearAttempts("admin-login", login);
  await startSession({ role: "workshop", workshopUserId: worker.id as string }, request);
  await admin.from("workshop_users").update({ last_login_at: new Date().toISOString() }).eq("id", worker.id);
  return Response.json({ ok: true, role: "workshop" });
}
