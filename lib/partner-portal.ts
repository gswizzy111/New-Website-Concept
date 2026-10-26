import { cache } from "react";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { newToken, sha256, TOKEN_PATTERN } from "@/lib/admin-session";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { PARTNER_PASSCODE_MIN } from "@/lib/partner-portal-rules";

export { PARTNER_PASSCODE_MIN };

/**
 * The partner portal (/partners): stores selling our kits sign in with a
 * passcode. Passcodes are stored as PBKDF2 hashes (partners.passcode_hash).
 * The cookie holds a random session ID whose SHA-256 is in partner_sessions,
 * never the partner's ID. Setting a new passcode ends the partner's sessions.
 *
 * The old site (until the domain switch) reads the same partners table and
 * signs partners in by the plaintext partners.passcode, so that column is
 * still written (KEEP_PLAINTEXT_PASSCODE). A partner created on the old site
 * has no hash yet: their first sign-in here checks the plaintext once and
 * saves the hash. After the switch: set KEEP_PLAINTEXT_PASSCODE to false and
 * clear the plaintext column (see the owner notes for the SQL).
 */
export const PARTNER_SESSION_COOKIE = "partner_portal_session";
// Before sessions the cookie held the partner's ID (and still does on the old site); cleared on sign-in and sign-out
export const LEGACY_PARTNER_COOKIE = "partner_session";
export const PARTNER_SESSION_DAYS = 30;
export const KEEP_PLAINTEXT_PASSCODE = true;

type Admin = ReturnType<typeof createAdminClient>;

export type Partner = {
  id: string;
  name: string;
  store_name: string | null;
  kits_allocated: number | null;
  polish_allocated: number | null;
  spray_allocated: number | null;
};

type PasscodeRow = { id: string; passcode: string | null; passcode_hash?: string | null };

async function sameText(a: string, b: string) {
  // Compare digests so the comparison takes the same time whatever the input
  return (await sha256(a)) === (await sha256(b));
}

async function passcodeRows(admin: Admin): Promise<PasscodeRow[]> {
  // "*" so a missing passcode_hash column (migration not run yet) reads as no hash
  const { data, error } = await admin.from("partners").select("*");
  if (error) throw new Error(`Could not read partners: ${error.message}`);
  return (data ?? []) as PasscodeRow[];
}

async function matches(row: PasscodeRow, passcode: string) {
  if (row.passcode_hash) return verifyPassword(passcode, row.passcode_hash);
  return !!row.passcode && (await sameText(row.passcode, passcode));
}

/**
 * The partner this passcode belongs to, or null. Checks the stored hash when
 * there is one, else the plaintext (partners made on the old site), and then
 * saves the hash.
 */
export async function findPartnerByPasscode(admin: Admin, passcode: string): Promise<string | null> {
  for (const row of await passcodeRows(admin)) {
    if (!(await matches(row, passcode))) continue;
    if (!row.passcode_hash) {
      const { error } = await admin
        .from("partners")
        .update({ passcode_hash: await hashPassword(passcode) })
        .eq("id", row.id)
        .is("passcode_hash", null);
      if (error) console.error("Saving a partner passcode hash failed:", error.message);
    }
    return row.id;
  }
  return null;
}

/** Whether another partner already signs in with this passcode. */
export async function passcodeInUse(admin: Admin, passcode: string, exceptId?: string): Promise<boolean> {
  for (const row of await passcodeRows(admin)) {
    if (row.id !== exceptId && (await matches(row, passcode))) return true;
  }
  return false;
}

/** The columns to write for a new passcode. */
export async function passcodeColumns(passcode: string) {
  return {
    passcode_hash: await hashPassword(passcode),
    // The old site signs partners in by this column until the switch
    ...(KEEP_PLAINTEXT_PASSCODE ? { passcode } : {}),
  };
}

export async function createPartnerSession(partnerId: string) {
  const token = newToken();
  const admin = createAdminClient();
  // Expired sessions are no use to anyone: clear them out while we're here
  await admin.from("partner_sessions").delete().lt("expires_at", new Date().toISOString());
  const { error } = await admin.from("partner_sessions").insert({
    token_hash: await sha256(token),
    partner_id: partnerId,
    expires_at: new Date(Date.now() + PARTNER_SESSION_DAYS * 86400_000).toISOString(),
  });
  if (error) throw new Error(`Could not start partner session: ${error.message}`);
  const jar = await cookies();
  jar.set(PARTNER_SESSION_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: PARTNER_SESSION_DAYS * 86400,
  });
  jar.delete(LEGACY_PARTNER_COOKIE);
}

/** The partner signed in on this request, if any (looked up once per request). */
export const getPartner = cache(async (): Promise<Partner | null> => {
  const jar = await cookies();
  const token = jar.get(PARTNER_SESSION_COOKIE)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const { data } = await createAdminClient()
    .from("partner_sessions")
    .select("partners(id, name, store_name, kits_allocated, polish_allocated, spray_allocated)")
    .eq("token_hash", await sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const raw = data?.partners as unknown;
  return ((Array.isArray(raw) ? raw[0] : raw) as Partner | null) ?? null;
});

export async function endPartnerSession() {
  const jar = await cookies();
  const token = jar.get(PARTNER_SESSION_COOKIE)?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await createAdminClient().from("partner_sessions").delete().eq("token_hash", await sha256(token));
  }
  jar.delete(PARTNER_SESSION_COOKIE);
  jar.delete(LEGACY_PARTNER_COOKIE);
}

/** Signs a partner out everywhere (after a new passcode is set). Throws if that fails. */
export async function endSessionsForPartner(admin: Admin, partnerId: string) {
  const { error } = await admin.from("partner_sessions").delete().eq("partner_id", partnerId);
  if (error) throw new Error(`Could not end partner sessions: ${error.message}`);
}
