import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/admin-session";

/**
 * Attempt limits for sign-ins and for emails anyone can trigger (sign-up,
 * forgot password, resend confirmation). Counted per account name or email
 * address, never per IP: the privacy policy doesn't cover IP addresses. Only
 * a SHA-256 of the name is stored (auth_attempts), so the table holds no
 * usernames or emails. Old rows are cleared as new ones come in.
 *
 * A database problem never blocks anyone: the limit fails open and logs.
 */
export type AttemptKind =
  | "admin-login"
  | "accountant-login"
  | "creator-login"
  | "partner-login"
  | "account-signup-email"
  | "account-reset-email"
  | "account-confirm-email"
  | "kit-club-link-email";

export type AttemptRule = { max: number; windowMinutes: number };

async function keyHash(kind: AttemptKind, key: string) {
  return sha256(`${kind}:${key.trim().toLowerCase()}`);
}

/**
 * Minutes until another attempt is allowed (0 = allowed now). Counts the
 * attempts recorded for this kind and name within the window.
 */
export async function attemptWait(kind: AttemptKind, key: string, rule: AttemptRule): Promise<number> {
  try {
    const since = new Date(Date.now() - rule.windowMinutes * 60_000).toISOString();
    const { data, error } = await createAdminClient()
      .from("auth_attempts")
      .select("created_at")
      .eq("kind", kind)
      .eq("key_hash", await keyHash(kind, key))
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(rule.max);
    if (error) throw error;
    if (!data || data.length < rule.max) return 0;
    // Allowed again once the oldest counted attempt leaves the window
    const freeAt = new Date(data[0].created_at).getTime() + rule.windowMinutes * 60_000;
    return Math.max(1, Math.ceil((freeAt - Date.now()) / 60_000));
  } catch (err) {
    console.error(`Attempt limit check failed (${kind}):`, err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Counts one attempt (a failed sign-in, or an email sent). */
export async function recordAttempt(kind: AttemptKind, key: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("auth_attempts").insert({ kind, key_hash: await keyHash(kind, key) });
    if (error) throw error;
    // Housekeeping: nothing is counted past a day
    await admin.from("auth_attempts").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  } catch (err) {
    console.error(`Recording an attempt failed (${kind}):`, err instanceof Error ? err.message : err);
  }
}

/** Forgets the failed attempts for this name (after a successful sign-in). */
export async function clearAttempts(kind: AttemptKind, key: string): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("auth_attempts")
      .delete()
      .eq("kind", kind)
      .eq("key_hash", await keyHash(kind, key));
    if (error) throw error;
  } catch (err) {
    console.error(`Clearing attempts failed (${kind}):`, err instanceof Error ? err.message : err);
  }
}

/** "Too many attempts" text for a wait in minutes. */
export function waitMessage(minutes: number) {
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
