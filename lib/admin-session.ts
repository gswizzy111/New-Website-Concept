import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin, accountant and support sign-in sessions. Each admin has their own
 * username and password (admin_users); accountants (accountant_access) and
 * customer support staff (support_access) sign in with their email. The
 * cookie holds a random session ID, never a password, and the database keeps
 * only its SHA-256. A session ends when the
 * browser closes (the cookie has no max-age), on sign-out, or after
 * SESSION_HOURS, whichever comes first, so every new visit asks for the
 * password again. Both sites share the database, so the same logins work on
 * both; each site's cookie only works on that site. Support logins exist on
 * this site only: the other site's code doesn't know the 'support' role.
 *
 * Workshop logins (role 'workshop', workshop_users) are hired help for the
 * Scan page, the Desk and Receiving: they sign in with a username and
 * password like admins, but they are deliberately NOT admin_users rows (the
 * other site treats every admin_users row as a full admin, and doesn't know
 * the 'workshop' role, so its session lookup refuses these sessions). What
 * they may open is lib/workshop-access.ts (default deny).
 */
export const ADMIN_SESSION_COOKIE = "admin_session";
// The cookie from before per-admin logins held the password itself; cleared on sign-in and sign-out.
export const LEGACY_ADMIN_COOKIE = "admin_auth";
export const SESSION_HOURS = 12;

export type AdminRole = "admin" | "accountant" | "support" | "workshop";
export type AdminSession = {
  role: AdminRole;
  /** The admin's username; for accountants and support staff, their email. */
  username: string;
  /** admin_users.id (admins only) */
  adminUserId?: string;
  /** support_access.id and the person's name (support staff only) */
  supportId?: string;
  /** support staff: their name; workshop logins: their display name, if set */
  name?: string;
  /** workshop_users.id (workshop logins only); `username` is what their actions record */
  workshopUserId?: string;
  /** An admin looking at the admin as support sees it ("View as Support") */
  preview?: boolean;
};

/**
 * "View as Support": an admin can switch their own session to see exactly
 * what support staff see. The cookie only ever narrows an admin session to
 * the support role; on any other session it does nothing. It ends with the
 * browser, on sign-out, or from the banner's Exit button.
 */
export const VIEW_AS_COOKIE = "admin_view_as";
export function withViewAs(session: AdminSession | null, viewAs: string | null | undefined): AdminSession | null {
  if (session?.role !== "admin" || viewAs !== "support") return session;
  return { ...session, role: "support", name: session.username, preview: true };
}

/** Who signed in: the argument createAdminSession and endSessionsFor take. */
export type SessionOwner =
  | { role: "admin"; adminUserId: string }
  | { role: "accountant"; accountantId: string }
  | { role: "support"; supportId: string }
  | { role: "workshop"; workshopUserId: string };

/**
 * What a support session may open; everything else under /admin sends them
 * to SUPPORT_HOME and every other admin API refuses them (middleware.ts).
 * Each of those pages and routes checks the role again itself.
 */
export const SUPPORT_PAGES = ["/admin/support", "/admin/cases", "/admin/email-problems"];
export const SUPPORT_APIS = [
  "/api/admin/support",
  "/api/admin/cases",
  "/api/admin/email-problems",
  "/api/admin/orders/resend-confirmations",
];

function toHex(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random 64-hex token (session IDs and password reset links). */
export function newToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** What the database stores instead of a token. */
export async function sha256(token: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Starts a session and returns the token to put in the cookie. */
export async function createAdminSession(
  who: SessionOwner,
  userAgent?: string | null
): Promise<string> {
  const token = newToken();
  const admin = createAdminClient();
  // Old sessions are no use to anyone: clear them out while we're here
  await admin.from("admin_sessions").delete().lt("expires_at", new Date().toISOString());
  const { error } = await admin.from("admin_sessions").insert({
    token_hash: await sha256(token),
    role: who.role,
    admin_user_id: who.role === "admin" ? who.adminUserId : null,
    accountant_id: who.role === "accountant" ? who.accountantId : null,
    ...(who.role === "support" ? { support_id: who.supportId } : {}),
    // Named only for workshop sessions, so other sign-ins never depend on the column
    ...(who.role === "workshop" ? { workshop_id: who.workshopUserId } : {}),
    expires_at: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(),
    user_agent: userAgent?.slice(0, 300) ?? null,
  });
  if (error) throw new Error(`Could not start admin session: ${error.message}`);
  return token;
}

/** The session a cookie token belongs to, if it is live and its account still has access. */
export async function lookupAdminSession(token: string | null | undefined): Promise<AdminSession | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  return (await lookupSessionByHash(await sha256(token)))?.session ?? null;
}

/** The live session stored under a token's SHA-256, and when it expires (epoch ms). */
async function lookupSessionByHash(tokenHash: string): Promise<{ session: AdminSession; expiresAt: number } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("admin_sessions")
    .select("role, admin_user_id, support_id, expires_at, admin_users(username, active), accountant_access(email, password_hash), support_access(name, email, password_hash)")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  const expiresAt = Date.parse(data.expires_at as string);
  type Joined<T> = T | T[] | null;
  const one = <T,>(v: Joined<T>) => (Array.isArray(v) ? v[0] ?? null : v);
  if (data.role === "admin") {
    const user = one(data.admin_users as Joined<{ username: string; active: boolean }>);
    return user?.active ? { session: { role: "admin", username: user.username, adminUserId: data.admin_user_id as string }, expiresAt } : null;
  }
  if (data.role === "accountant") {
    const acct = one(data.accountant_access as Joined<{ email: string; password_hash: string | null }>);
    // Revoking an accountant (clearing their password) ends their sessions too
    return acct?.password_hash ? { session: { role: "accountant", username: acct.email }, expiresAt } : null;
  }
  if (data.role === "support") {
    const member = one(data.support_access as Joined<{ name: string; email: string; password_hash: string | null }>);
    // Removing someone from Support Access deletes the row, and its sessions with it
    return member?.password_hash
      ? { session: { role: "support", username: member.email, name: member.name, supportId: data.support_id as string }, expiresAt }
      : null;
  }
  if (data.role === "workshop") {
    const session = await lookupWorkshopSession(tokenHash);
    return session ? { session, expiresAt } : null;
  }
  return null;
}

/**
 * A workshop session's worker, read separately so that no other sign-in's
 * lookup names workshop_id or workshop_users (they work before
 * 20261126_workshop_users.sql is applied). Only a worker who is switched on
 * and has a password counts: turning someone off, or Reset (which clears the
 * password), ends their sessions here at once even if deleting the rows failed.
 */
async function lookupWorkshopSession(tokenHash: string): Promise<AdminSession | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_sessions")
    .select("workshop_id, workshop_users(id, username, name, active, password_hash)")
    .eq("token_hash", tokenHash)
    .eq("role", "workshop")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data?.workshop_id) return null;
  type Worker = { id: string; username: string; name: string | null; active: boolean; password_hash: string | null };
  const raw = data.workshop_users as Worker | Worker[] | null;
  const worker = Array.isArray(raw) ? raw[0] ?? null : raw;
  if (!worker?.active || !worker.password_hash || worker.id !== data.workshop_id) return null;
  return {
    role: "workshop",
    username: worker.username,
    workshopUserId: worker.id,
    ...(worker.name ? { name: worker.name } : {}),
  };
}

/**
 * For middleware.ts only: lookupAdminSession, remembered for up to
 * MIDDLEWARE_SESSION_TTL_MS in this edge instance's memory.
 *
 * The middleware runs on Netlify's edge, near the person, so its database
 * lookup crossed to the database's region on every admin request before the
 * page even started (about 0.1 s in the US, 0.4 s from Pakistan). The cache is
 * keyed by the token's SHA-256 (never the token), holds live sessions only
 * (never "no session"), and an entry never outlives the session's own
 * expires_at.
 *
 * Only the middleware's backstop is cached. Every page and route still checks
 * the session in the database itself (getAdminSession in lib/admin-auth.ts),
 * so signing out, a password change or a removed account take effect there at
 * once; the middleware's gate and its accountant/support redirects can lag by
 * MIDDLEWARE_SESSION_TTL_MS at most. Never trust anything the middleware
 * passes on in place of that check.
 */
const MIDDLEWARE_SESSION_TTL_MS = 5 * 60_000;
const MIDDLEWARE_SESSION_MAX = 500;
const middlewareSessions = new Map<string, { session: AdminSession; until: number }>();

export async function lookupAdminSessionForMiddleware(token: string | null | undefined): Promise<AdminSession | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const hit = middlewareSessions.get(tokenHash);
  if (hit && hit.until > now) return hit.session;
  middlewareSessions.delete(tokenHash);

  const found = await lookupSessionByHash(tokenHash);
  if (!found) return null;
  // Bounded: drop expired entries, then the oldest, before adding one
  if (middlewareSessions.size >= MIDDLEWARE_SESSION_MAX) {
    for (const [key, entry] of middlewareSessions) if (entry.until <= now) middlewareSessions.delete(key);
    const oldest = middlewareSessions.keys().next();
    if (middlewareSessions.size >= MIDDLEWARE_SESSION_MAX && !oldest.done) middlewareSessions.delete(oldest.value);
  }
  // A bad expires_at gives NaN, which never counts as fresh
  middlewareSessions.set(tokenHash, { session: found.session, until: Math.min(now + MIDDLEWARE_SESSION_TTL_MS, found.expiresAt) });
  return found.session;
}

/** Ends the session behind a cookie token (sign-out). */
export async function endAdminSession(token: string | null | undefined) {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  const admin = createAdminClient();
  await admin.from("admin_sessions").delete().eq("token_hash", await sha256(token));
}

/**
 * Signs a person out everywhere after their password changes, except the
 * session behind `keepToken` (the browser that just changed it).
 */
export async function endSessionsFor(
  who: { adminUserId: string } | { accountantId: string } | { supportId: string } | { workshopUserId: string },
  keepToken?: string | null
): Promise<{ ended: number; error: string | null }> {
  const admin = createAdminClient();
  let query = admin.from("admin_sessions").delete({ count: "exact" });
  query = "adminUserId" in who
    ? query.eq("admin_user_id", who.adminUserId)
    : "accountantId" in who
      ? query.eq("accountant_id", who.accountantId)
      : "supportId" in who
        ? query.eq("support_id", who.supportId)
        : query.eq("workshop_id", who.workshopUserId).eq("role", "workshop");
  if (keepToken && TOKEN_PATTERN.test(keepToken)) query = query.neq("token_hash", await sha256(keepToken));
  const { count, error } = await query;
  return { ended: count ?? 0, error: error?.message ?? null };
}
