/**
 * Workshop logins (lib/workshop-users.ts) and their sessions
 * (lib/admin-session.ts), against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs). No real database.
 *
 * - A worker is a workshop_users row, never an admin_users row, and a
 *   username is never both.
 * - Setup links: one-time, 7 days, only their SHA-256 stored.
 * - A workshop session is role 'workshop' with workshop_id; it ends when the
 *   worker is turned off, reset or signed out everywhere, and the lookup
 *   refuses a worker who is off or has no password even if a row is left.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

const ADMIN_ID = "00000000-0000-4000-8000-0000000ad001";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let mock: Mock;
let db: SupabaseClient;
let users: typeof import("@/lib/workshop-users");
let sessions: typeof import("@/lib/admin-session");

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      admin_users: [{ id: ADMIN_ID, username: "owner", password_hash: "x:y", active: true, created_at: "2026-11-01T00:00:00Z" }],
      admin_sessions: [],
      workshop_users: [],
    },
  });
  // lib/admin-session.ts talks to the database through createAdminClient()
  process.env.NEXT_PUBLIC_SUPABASE_URL = mock.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.NEXT_PUBLIC_APP_URL = "https://staff.example.com";
  db = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  users = await import("@/lib/workshop-users");
  sessions = await import("@/lib/admin-session");
});

after(async () => {
  await mock?.close();
});

const tokenOf = (setupUrl: string) => new URL(setupUrl).searchParams.get("token")!;

async function add(username: string, name?: string) {
  const r = await users.createWorkshopUser({ username, name, by: "owner" }, db);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("unreachable");
  return r;
}

test("adding a worker makes a one-time 7-day setup link and stores only its SHA-256", async () => {
  const before = Date.now();
  const r = await add("  Maria.R ", "  Maria   Reyes ");
  assert.equal(r.worker.username, "maria.r");
  assert.equal(r.worker.name, "Maria Reyes");
  assert.equal(r.worker.active, true);
  assert.equal(r.worker.hasPassword, false);
  assert.equal(r.worker.setupPending, true);
  assert.equal(r.worker.createdBy, "owner");
  assert.match(r.setupUrl, /^https:\/\/staff\.example\.com\/workshop\/setup\?token=[a-f0-9]{64}$/);
  const days = (Date.parse(r.expiresAt) - before) / 86_400_000;
  assert.ok(days > 6.99 && days < 7.01, `expires in ${days} days`);

  const row = mock.store.table("workshop_users").find((u) => u.username === "maria.r")!;
  const token = tokenOf(r.setupUrl);
  assert.equal(row.setup_token_hash, sha(token));
  assert.ok(!JSON.stringify(mock.store.table("workshop_users")).includes(token), "the token itself is never stored");
  // Never an admin_users row
  assert.equal(mock.store.table("admin_users").length, 1);
  // The view never carries a hash or a token
  assert.ok(!JSON.stringify(r.worker).includes(String(row.setup_token_hash)));
  assert.ok(!("password_hash" in r.worker));
});

test("usernames: the shape, and never a worker's or an admin's already", async () => {
  for (const bad of ["", "a", "has space", "UPPER CASE", "-dash-first", "x".repeat(33), "emoji🙂", "semi;colon", "per%cent"]) {
    const r = await users.createWorkshopUser({ username: bad, by: "owner" }, db);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.equal(r.status, 400, bad);
  }
  await add("sam");
  const dup = await users.createWorkshopUser({ username: "SAM", by: "owner" }, db);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.status, 409);
  // An admin's username, in any letter case, is refused: the sign-in form takes either
  const admin = await users.createWorkshopUser({ username: "Owner", by: "owner" }, db);
  assert.equal(admin.ok, false);
  if (!admin.ok) assert.equal(admin.status, 409);
  assert.equal(mock.store.table("workshop_users").filter((u) => u.username === "owner").length, 0);
  // A name that's too long
  const long = await users.createWorkshopUser({ username: "longname", name: "n".repeat(61), by: "owner" }, db);
  assert.equal(long.ok, false);
});

test("the setup link sets the password once, and never after it expires", async () => {
  const r = await add("jo");
  const token = tokenOf(r.setupUrl);

  const short = await users.setWorkshopPassword({ token, password: "short" }, db);
  assert.equal(short.ok, false);
  const wrong = await users.setWorkshopPassword({ token: "f".repeat(64), password: "a-good-long-password" }, db);
  assert.equal(wrong.ok, false);
  const junk = await users.setWorkshopPassword({ token: "not-a-token", password: "a-good-long-password" }, db);
  assert.equal(junk.ok, false);

  const ok = await users.setWorkshopPassword({ token, password: "a-good-long-password" }, db);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  if (ok.ok) assert.equal(ok.username, "jo");
  const row = mock.store.table("workshop_users").find((u) => u.username === "jo")!;
  assert.match(String(row.password_hash), /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, "PBKDF2 salt:hash");
  assert.equal(row.setup_token_hash, null);

  const again = await users.setWorkshopPassword({ token, password: "another-long-password" }, db);
  assert.equal(again.ok, false, "a link works once");

  // An expired link
  const late = await add("late");
  const lateRow = mock.store.table("workshop_users").find((u) => u.username === "late")!;
  await db.from("workshop_users").update({ setup_token_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", lateRow.id as string);
  const expired = await users.setWorkshopPassword({ token: tokenOf(late.setupUrl), password: "a-good-long-password" }, db);
  assert.equal(expired.ok, false);

  // A worker who was turned off can't use their link
  const off = await add("off");
  await users.setWorkshopUserActive(off.worker.id, false, db);
  const offUse = await users.setWorkshopPassword({ token: tokenOf(off.setupUrl), password: "a-good-long-password" }, db);
  assert.equal(offUse.ok, false);
});

async function signIn(workerId: string) {
  const token = await sessions.createAdminSession({ role: "workshop", workshopUserId: workerId }, "test");
  return token;
}

test("a workshop session is role 'workshop', names the worker, and is never an admin", async () => {
  const r = await add("kim", "Kim");
  await users.setWorkshopPassword({ token: tokenOf(r.setupUrl), password: "kims-long-password" }, db);
  const token = await signIn(r.worker.id);
  const row = mock.store.table("admin_sessions").find((s) => s.token_hash === sha(token))!;
  assert.equal(row.role, "workshop");
  assert.equal(row.workshop_id, r.worker.id);
  assert.equal(row.admin_user_id ?? null, null);
  assert.ok(!JSON.stringify(mock.store.table("admin_sessions")).includes(token), "only the token's SHA-256 is stored");
  const hours = (Date.parse(String(row.expires_at)) - Date.now()) / 3_600_000;
  assert.ok(hours > 11.9 && hours <= 12, `${hours} hours`);

  const session = await sessions.lookupAdminSession(token);
  assert.deepEqual(session, { role: "workshop", username: "kim", workshopUserId: r.worker.id, name: "Kim" });
});

test("turning a worker off ends their sessions, and the lookup refuses them even if a row is left", async () => {
  const r = await add("lee");
  await users.setWorkshopPassword({ token: tokenOf(r.setupUrl), password: "lees-long-password" }, db);
  const phone = await signIn(r.worker.id);
  const desk = await signIn(r.worker.id);
  // Someone else's session stays
  const other = await add("other");
  await users.setWorkshopPassword({ token: tokenOf(other.setupUrl), password: "others-long-password" }, db);
  const otherToken = await signIn(other.worker.id);
  const adminToken = await sessions.createAdminSession({ role: "admin", adminUserId: ADMIN_ID }, "test");

  const off = await users.setWorkshopUserActive(r.worker.id, false, db);
  assert.equal(off.ok, true);
  if (off.ok) {
    assert.equal(off.endedSessions, 2);
    assert.equal(off.worker.active, false);
    assert.ok(off.worker.deactivatedAt);
  }
  assert.equal(await sessions.lookupAdminSession(phone), null);
  assert.equal(await sessions.lookupAdminSession(desk), null);
  assert.equal(mock.store.table("admin_sessions").filter((s) => s.workshop_id === r.worker.id).length, 0);
  assert.equal((await sessions.lookupAdminSession(otherToken))?.username, "other");
  assert.equal((await sessions.lookupAdminSession(adminToken))?.role, "admin");

  // A session row written anyway (say, a race) doesn't count while they're off
  const stray = await signIn(r.worker.id);
  assert.equal(await sessions.lookupAdminSession(stray), null);

  // Back on: they can sign in again (their password still works)
  const on = await users.setWorkshopUserActive(r.worker.id, true, db);
  assert.equal(on.ok, true);
  if (on.ok) assert.equal(on.worker.deactivatedAt, null);
  assert.equal((await sessions.lookupAdminSession(stray))?.username, "lee");
});

test("sign out everywhere deletes every session of that worker only", async () => {
  const r = await add("pat");
  await users.setWorkshopPassword({ token: tokenOf(r.setupUrl), password: "pats-long-password" }, db);
  const a = await signIn(r.worker.id);
  const b = await signIn(r.worker.id);
  const kim = mock.store.table("workshop_users").find((u) => u.username === "kim")!;
  const kimToken = await signIn(kim.id as string);
  const out = await users.signOutWorkshopUserEverywhere(r.worker.id, db);
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.endedSessions, 2);
  assert.equal(await sessions.lookupAdminSession(a), null);
  assert.equal(await sessions.lookupAdminSession(b), null);
  assert.equal((await sessions.lookupAdminSession(kimToken))?.username, "kim");
  // endSessionsFor (lib/admin-session.ts) does the same for a worker
  const c = await signIn(r.worker.id);
  const ended = await sessions.endSessionsFor({ workshopUserId: r.worker.id });
  assert.equal(ended.ended, 1);
  assert.equal(await sessions.lookupAdminSession(c), null);
});

test("Reset makes a new link, clears the password and signs them out at once", async () => {
  const r = await add("ana");
  const first = tokenOf(r.setupUrl);
  await users.setWorkshopPassword({ token: first, password: "anas-long-password" }, db);
  const live = await signIn(r.worker.id);
  assert.equal((await sessions.lookupAdminSession(live))?.username, "ana");

  const reset = await users.newSetupLink(r.worker.id, db);
  assert.equal(reset.ok, true);
  if (!reset.ok) return;
  assert.equal(reset.endedSessions, 1);
  assert.equal(reset.worker.hasPassword, false);
  assert.equal(reset.worker.setupPending, true);
  assert.equal(await sessions.lookupAdminSession(live), null);
  const row = mock.store.table("workshop_users").find((u) => u.username === "ana")!;
  assert.equal(row.password_hash, null);
  assert.equal(row.setup_token_hash, sha(tokenOf(reset.setupUrl)));

  // The new link works; the old one never again
  assert.equal((await users.setWorkshopPassword({ token: first, password: "anas-new-password" }, db)).ok, false);
  assert.equal((await users.setWorkshopPassword({ token: tokenOf(reset.setupUrl), password: "anas-new-password" }, db)).ok, true);
});

test("unknown workers are 404s, and the list never shows hashes", async () => {
  const missing = "00000000-0000-4000-8000-00000000dead";
  for (const r of [
    await users.newSetupLink(missing, db),
    await users.setWorkshopUserActive(missing, false, db),
    await users.signOutWorkshopUserEverywhere(missing, db),
    await users.renameWorkshopUser(missing, "x", db),
  ]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
  }
  const list = await users.listWorkshopUsers(db);
  assert.equal(list.ok, true);
  if (!list.ok) return;
  assert.ok(list.workers.length >= 5);
  const text = JSON.stringify(list.workers);
  assert.ok(!/password_hash|setup_token_hash/.test(text));
  for (const u of mock.store.table("workshop_users")) {
    if (u.password_hash) assert.ok(!text.includes(String(u.password_hash)));
    if (u.setup_token_hash) assert.ok(!text.includes(String(u.setup_token_hash)));
  }
  // Renaming changes the display name only (the username is what the logs record)
  const kim = list.workers.find((w) => w.username === "kim")!;
  const renamed = await users.renameWorkshopUser(kim.id, "Kim P.", db);
  assert.equal(renamed.ok, true);
  if (renamed.ok) {
    assert.equal(renamed.worker.name, "Kim P.");
    assert.equal(renamed.worker.username, "kim");
  }
});
