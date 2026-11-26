import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPassword } from "@/lib/crypto";
import { newToken, sha256, TOKEN_PATTERN } from "@/lib/admin-session";
import { passwordProblem } from "@/lib/admin-password";
import { siteUrl } from "@/lib/site-url";
import { likeExact } from "@/lib/like-exact";

/**
 * Workshop logins (the admin's Team page): hired help who scan cards, work
 * the Desk and receive orders (what they may open: lib/workshop-access.ts).
 * They live in workshop_users, never in admin_users: the other site shares
 * the database and treats every admin_users row as a full admin. A username
 * is never both (checked here, and by a trigger in
 * 20261126_workshop_users.sql).
 *
 * No emails: the admin adds a worker and gets a one-time setup link (7 days)
 * to hand them, where they choose their own password (/workshop/setup). Only
 * the link's SHA-256 is stored. Reset makes a new link, clears the password
 * and signs them out everywhere; turning someone off signs them out
 * everywhere too (and the session lookup refuses a worker who is off or has
 * no password, so it holds even if deleting the sessions failed).
 *
 * Server only. Every function takes the Supabase client so the tests can
 * pass the in-memory stand-in; the routes use the default.
 */

export const WORKSHOP_SETUP_DAYS = 7;
/** Lower case letters, digits and . _ - (starting with a letter or digit), 2 to 32 long. */
export const WORKSHOP_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const WORKSHOP_NAME_MAX = 60;

const COLUMNS = "id, username, name, active, password_hash, setup_token_hash, setup_token_expires_at, created_at, created_by, last_login_at, deactivated_at";

type Row = {
  id: string;
  username: string;
  name: string | null;
  active: boolean;
  password_hash: string | null;
  setup_token_hash: string | null;
  setup_token_expires_at: string | null;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
  deactivated_at: string | null;
};

/** What the Team page and /api/admin/team show (never a hash or a token). */
export type WorkshopUserView = {
  id: string;
  username: string;
  name: string | null;
  /** false: turned off (can't sign in; their sessions were ended) */
  active: boolean;
  /** false until they use their setup link */
  hasPassword: boolean;
  /** a live, unused setup link exists */
  setupPending: boolean;
  setupExpiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
};

export type WorkshopResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** A new or reset worker's setup link, shown once (the database keeps only its SHA-256). */
export type SetupLink = { setupUrl: string; expiresAt: string };

export function toView(row: Row, now = Date.now()): WorkshopUserView {
  const expires = row.setup_token_expires_at ? Date.parse(row.setup_token_expires_at) : NaN;
  const pending = !!row.setup_token_hash && expires > now;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    active: row.active,
    hasPassword: !!row.password_hash,
    setupPending: pending,
    setupExpiresAt: pending ? row.setup_token_expires_at : null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    lastLoginAt: row.last_login_at,
    deactivatedAt: row.deactivated_at,
  };
}

/** The username as stored (trimmed, lower case), or why it can't be one. */
export function normalizeWorkshopUsername(input: unknown): { username: string } | { error: string } {
  const username = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!username) return { error: "Enter a username." };
  if (!WORKSHOP_USERNAME_PATTERN.test(username)) {
    return { error: "Usernames are 2 to 32 letters or digits (dots, dashes and underscores are fine), with no spaces." };
  }
  return { username };
}

/** The display name as stored (null when empty), or why it can't be one. */
export function normalizeWorkshopName(input: unknown): { name: string | null } | { error: string } {
  if (input === undefined || input === null) return { name: null };
  if (typeof input !== "string") return { error: "The name must be text." };
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length > WORKSHOP_NAME_MAX) return { error: `Keep the name to ${WORKSHOP_NAME_MAX} characters.` };
  return { name: name || null };
}

function setupUrl(token: string) {
  return `${siteUrl()}/workshop/setup?token=${token}`;
}

async function freshLink(): Promise<{ token: string; hash: string; expiresAt: string }> {
  const token = newToken();
  return { token, hash: await sha256(token), expiresAt: new Date(Date.now() + WORKSHOP_SETUP_DAYS * 86_400_000).toISOString() };
}

const MISSING_TABLE = /workshop_users|workshop_id/;
function dbError(message: string): { ok: false; status: number; error: string } {
  if (MISSING_TABLE.test(message) && /does not exist|schema cache|Could not find/i.test(message)) {
    return { ok: false, status: 503, error: "Workshop logins need the database update first (supabase/migrations/20261126_workshop_users.sql)." };
  }
  return { ok: false, status: 500, error: message };
}

/** Every workshop login, newest first. */
export async function listWorkshopUsers(db: SupabaseClient = createAdminClient()): Promise<WorkshopResult<{ workers: WorkshopUserView[] }>> {
  const { data, error } = await db.from("workshop_users").select(COLUMNS).order("created_at", { ascending: false }).limit(500);
  if (error) return dbError(error.message);
  const now = Date.now();
  return { ok: true, workers: ((data ?? []) as Row[]).map((r) => toView(r, now)) };
}

async function readWorker(db: SupabaseClient, id: string): Promise<WorkshopResult<{ row: Row }>> {
  const { data, error } = await db.from("workshop_users").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return { ok: false, status: 404, error: "That worker wasn't found." };
  return { ok: true, row: data as Row };
}

/** Deletes every session of this worker (sign out everywhere). */
async function endWorkerSessions(db: SupabaseClient, id: string): Promise<{ ended: number; error: string | null }> {
  const { count, error } = await db
    .from("admin_sessions")
    .delete({ count: "exact" })
    .eq("role", "workshop")
    .eq("workshop_id", id);
  return { ended: count ?? 0, error: error?.message ?? null };
}

/**
 * Adds a worker and makes their setup link. Refused when the username is a
 * worker's already, or an admin's (admin_users, any letter case).
 */
export async function createWorkshopUser(
  input: { username: unknown; name?: unknown; by: string | null },
  db: SupabaseClient = createAdminClient(),
): Promise<WorkshopResult<{ worker: WorkshopUserView } & SetupLink>> {
  const u = normalizeWorkshopUsername(input.username);
  if ("error" in u) return { ok: false, status: 400, error: u.error };
  const n = normalizeWorkshopName(input.name);
  if ("error" in n) return { ok: false, status: 400, error: n.error };

  const [{ data: adminRow, error: adminErr }, { data: existing, error: existingErr }] = await Promise.all([
    db.from("admin_users").select("id").ilike("username", likeExact(u.username)).limit(1).maybeSingle(),
    db.from("workshop_users").select("id").eq("username", u.username).maybeSingle(),
  ]);
  if (adminErr) return { ok: false, status: 500, error: adminErr.message };
  if (existingErr) return dbError(existingErr.message);
  if (adminRow || existing) return { ok: false, status: 409, error: `The username "${u.username}" is taken. Pick another.` };

  const link = await freshLink();
  const { data, error } = await db
    .from("workshop_users")
    .insert({
      username: u.username,
      name: n.name,
      active: true,
      setup_token_hash: link.hash,
      setup_token_expires_at: link.expiresAt,
      created_by: input.by,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    // Two admins adding the same name at once, or the database's own admin-name check
    if (/duplicate|unique|admin username/i.test(error.message)) {
      return { ok: false, status: 409, error: `The username "${u.username}" is taken. Pick another.` };
    }
    return dbError(error.message);
  }
  return { ok: true, worker: toView(data as Row), setupUrl: setupUrl(link.token), expiresAt: link.expiresAt };
}

/**
 * Reset: a new one-time setup link (7 days) in place of any earlier one. It
 * clears the worker's password and signs them out everywhere, so the old
 * password stops working at once; they choose a new one with the link.
 */
export async function newSetupLink(
  id: string,
  db: SupabaseClient = createAdminClient(),
): Promise<WorkshopResult<{ worker: WorkshopUserView; endedSessions: number } & SetupLink>> {
  const found = await readWorker(db, id);
  if (!found.ok) return found;
  const link = await freshLink();
  const { data, error } = await db
    .from("workshop_users")
    .update({ password_hash: null, setup_token_hash: link.hash, setup_token_expires_at: link.expiresAt, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return { ok: false, status: 404, error: "That worker wasn't found." };
  const ended = await endWorkerSessions(db, id);
  if (ended.error) console.error("Workshop reset: ending sessions failed:", ended.error);
  return { ok: true, worker: toView(data as Row), endedSessions: ended.ended, setupUrl: setupUrl(link.token), expiresAt: link.expiresAt };
}

/** Turns a worker off (they can't sign in, and every session of theirs ends) or back on. */
export async function setWorkshopUserActive(
  id: string,
  active: boolean,
  db: SupabaseClient = createAdminClient(),
): Promise<WorkshopResult<{ worker: WorkshopUserView; endedSessions: number }>> {
  const found = await readWorker(db, id);
  if (!found.ok) return found;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("workshop_users")
    .update({ active, deactivated_at: active ? null : found.row.deactivated_at ?? now, updated_at: now })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return { ok: false, status: 404, error: "That worker wasn't found." };
  let endedSessions = 0;
  if (!active) {
    const ended = await endWorkerSessions(db, id);
    if (ended.error) return { ok: false, status: 500, error: `Turned off, but their sessions couldn't be ended (${ended.error}). They can't open anything; try again to clear them.` };
    endedSessions = ended.ended;
  }
  return { ok: true, worker: toView(data as Row), endedSessions };
}

/** Changes the display name (the username, which the logs record, never changes). */
export async function renameWorkshopUser(
  id: string,
  nameInput: unknown,
  db: SupabaseClient = createAdminClient(),
): Promise<WorkshopResult<{ worker: WorkshopUserView }>> {
  const n = normalizeWorkshopName(nameInput);
  if ("error" in n) return { ok: false, status: 400, error: n.error };
  const { data, error } = await db
    .from("workshop_users")
    .update({ name: n.name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return { ok: false, status: 404, error: "That worker wasn't found." };
  return { ok: true, worker: toView(data as Row) };
}

/** Signs a worker out on every device (deletes their sessions). */
export async function signOutWorkshopUserEverywhere(
  id: string,
  db: SupabaseClient = createAdminClient(),
): Promise<WorkshopResult<{ worker: WorkshopUserView; endedSessions: number }>> {
  const found = await readWorker(db, id);
  if (!found.ok) return found;
  const ended = await endWorkerSessions(db, id);
  if (ended.error) return dbError(ended.error);
  return { ok: true, worker: toView(found.row), endedSessions: ended.ended };
}

/**
 * The setup link's form: sets the worker's password and uses up the link
 * (found and cleared in one statement, so it works once). Any other session
 * of theirs ends. A worker who was turned off can't use a link.
 */
export async function setWorkshopPassword(
  input: { token: unknown; password: unknown },
  db: SupabaseClient = createAdminClient(),
): Promise<WorkshopResult<{ workerId: string; username: string }>> {
  const password = typeof input.password === "string" ? input.password : "";
  const problem = passwordProblem(password);
  if (problem) return { ok: false, status: 400, error: problem };
  const expired = "This setup link has expired or was already used. Ask for a new one.";
  const token = typeof input.token === "string" ? input.token : "";
  if (!TOKEN_PATTERN.test(token)) return { ok: false, status: 400, error: expired };

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("workshop_users")
    .update({ password_hash: await hashPassword(password), setup_token_hash: null, setup_token_expires_at: null, updated_at: now })
    .eq("setup_token_hash", await sha256(token))
    .eq("active", true)
    .gt("setup_token_expires_at", now)
    .select("id, username")
    .maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return { ok: false, status: 400, error: expired };
  const ended = await endWorkerSessions(db, data.id as string);
  if (ended.error) console.error("Workshop setup: ending old sessions failed:", ended.error);
  return { ok: true, workerId: data.id as string, username: data.username as string };
}
