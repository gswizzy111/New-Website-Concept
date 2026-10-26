import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPassword } from "@/lib/account-links";
import { z } from "zod";

const Body = z.object({
  token_hash: z.string().min(10).optional(),
  /** The account id, on links for a flagged account (check=1) */
  uid: z.string().uuid().optional(),
  password: z.string().min(1).optional(),
  new_password: z.string().min(8, "Your new password must be at least 8 characters.").optional(),
  /** Save a password after the link was used (see below) */
  finish: z.boolean().optional(),
});

const EXPIRED = "This link has expired or was already used. Sign in to get a new one.";
// How long after confirming a password can still be chosen from that session
const FINISH_WINDOW_S = 15 * 60;

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * The confirm link's button: verifying the one-time token confirms the email
 * and signs the customer in (session cookies set by the server client).
 *
 * An account signed up more than once with different passwords is flagged
 * (app_metadata.signup_conflict): someone else may know its password. Its
 * links carry uid and check=1, and the page sends either the account's
 * password (checked before the link is used up) or a new password. However
 * the flagged account gets confirmed, the person who owns the inbox ends up
 * with a password nobody else chose: if neither was proven, the old password
 * is replaced with a random one at once (from this session, which stays
 * signed in; every other session is signed out) and they choose one next.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "This link is incomplete." }, { status: 400 });
  const { token_hash, uid, password, new_password, finish } = parsed.data;
  const supabase = await createClient();

  // Choosing the password after the link was used: only from the session the
  // link just opened, while the account still needs one.
  if (finish) {
    if (!new_password) return Response.json({ error: "Choose a new password." }, { status: 400 });
    const user = await freshConfirmUser(supabase);
    if (!user) return Response.json({ error: "Please use Forgot password to choose a new password." }, { status: 403 });
    return savePassword(supabase, user, new_password);
  }

  if (!token_hash) return Response.json({ error: "This link is incomplete." }, { status: 400 });

  // The account's password, checked before the link is used up
  if (password) {
    const { data: found } = uid ? await createAdminClient().auth.admin.getUserById(uid) : { data: null };
    const email = found?.user?.email;
    if (!email) return Response.json({ error: EXPIRED }, { status: 400 });
    const result = await checkPassword(email, password);
    if (result === "error") {
      return Response.json({ error: "We couldn't check your password just now. Please try again in a minute." }, { status: 503 });
    }
    if (result === "mismatch") {
      return Response.json({ error: "That isn't the password on this account. Try again, or choose a new password.", code: "WRONG_PASSWORD" }, { status: 400 });
    }
  }

  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash });
  if (error || !data.user) {
    // Reloaded after confirming, before choosing a password: carry on
    if (await freshConfirmUser(supabase)) return Response.json({ choosePassword: true });
    return Response.json({ error: EXPIRED }, { status: 400 });
  }
  const user = data.user;
  if (uid && user.id !== uid) {
    await supabase.auth.signOut();
    return Response.json({ error: "This link doesn't match its account. Open the link from your email again." }, { status: 400 });
  }

  if (new_password) return savePassword(supabase, user, new_password);

  if (user.app_metadata?.signup_conflict) {
    if (password) {
      // Proved the password: keep it, sign everyone else out
      await supabase.auth.signOut({ scope: "others" });
      await clearConflict(user);
      return Response.json({ ok: true });
    }
    // Confirmed without proving the password (an older link, or a request
    // that skipped the page's check): lock out the old password now
    const locked = await lockOldPassword(supabase);
    if (!locked) return Response.json({ error: "We couldn't finish setting up your account. Please use Forgot password." }, { status: 500 });
    return Response.json({ choosePassword: true });
  }
  return Response.json({ ok: true });
}

/** The signed-in user, if this session was opened by a confirm link in the
 * last 15 minutes and the account still needs a password chosen. */
async function freshConfirmUser(supabase: Supa): Promise<User | null> {
  const { data: claimsData } = await supabase.auth.getClaims();
  const amr = (claimsData?.claims?.amr ?? []) as { method: string; timestamp: number }[];
  const fresh = amr.length > 0 && amr.every((a) => a.method !== "password") &&
    Math.max(...amr.map((a) => a.timestamp)) > Date.now() / 1000 - FINISH_WINDOW_S;
  if (!fresh) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user?.app_metadata?.signup_conflict ? user : null;
}

/** Replaces the password with a random one from this session (which stays
 * signed in; Supabase signs out every other session). */
async function lockOldPassword(supabase: Supa): Promise<boolean> {
  const { error } = await supabase.auth.updateUser({ password: randomBytes(32).toString("base64url") + "aA1!" });
  if (error) console.error("Locking out a contested password failed:", error.message);
  return !error;
}

// Saves the chosen password from this session (which stays signed in). For a
// flagged account the old password is locked out first, so a refused choice
// never leaves it working.
async function savePassword(supabase: Supa, user: User, newPassword: string) {
  const flagged = !!user.app_metadata?.signup_conflict;
  if (flagged && !(await lockOldPassword(supabase))) {
    return Response.json({ error: "We couldn't save a password just now. Please use Forgot password.", confirmed: true }, { status: 500 });
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    const message = error.code === "weak_password"
      ? "That password is too easy to guess. Please choose a longer or less common one."
      : error.code === "same_password"
        ? "Please choose a password you haven't used for this account."
        : error.message;
    // The email is confirmed and this browser is signed in: the page asks again.
    return Response.json({ error: message, code: "PASSWORD_REJECTED", confirmed: true }, { status: 400 });
  }
  await supabase.auth.signOut({ scope: "others" });
  if (flagged) await clearConflict(user);
  return Response.json({ ok: true });
}

async function clearConflict(user: User) {
  const { error } = await createAdminClient().auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, signup_conflict: false },
  });
  if (error) console.error("Clearing signup_conflict failed:", error.message);
}
