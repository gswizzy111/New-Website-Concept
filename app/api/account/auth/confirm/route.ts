import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passwordMatches } from "@/lib/account-links";
import { z } from "zod";

const Body = z.object({
  token_hash: z.string().min(10).optional(),
  email: z.string().email().optional(),
  password: z.string().min(1).optional(),
  new_password: z.string().min(8, "Your new password must be at least 8 characters.").optional(),
  /** Retry saving a new password after the link was used (see below) */
  finish: z.boolean().optional(),
});

const EXPIRED = "This link has expired or was already used. Sign in to get a new one.";
// How long after confirming a rejected new password can be retried
const FINISH_WINDOW_S = 15 * 60;

/**
 * The confirm link's button: verifying the one-time token confirms the email
 * and signs the customer in (session cookies set by the server client).
 *
 * Links for an account that was signed up more than once with different
 * passwords (app_metadata.signup_conflict) carry the email and check=1, and
 * the page sends either the account's password (checked before the link is
 * used up) or a new password (saved right after confirming). Either way the
 * person who owns the inbox ends up with a password nobody else chose, and
 * every other session is signed out.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "This link is incomplete." }, { status: 400 });
  const { token_hash, email, password, new_password, finish } = parsed.data;
  const supabase = await createClient();

  // A new password Supabase rejected right after confirming (too common, say):
  // try again, only from the session the confirm link just opened.
  if (finish) {
    if (!new_password) return Response.json({ error: "Choose a new password." }, { status: 400 });
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    const amr = (claims?.amr ?? []) as { method: string; timestamp: number }[];
    const fresh = amr.length > 0 && amr.every((a) => a.method !== "password") &&
      Math.max(...amr.map((a) => a.timestamp)) > Date.now() / 1000 - FINISH_WINDOW_S;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !fresh || !user.app_metadata?.signup_conflict) {
      return Response.json({ error: "Please use Forgot password to choose a new password." }, { status: 403 });
    }
    return savePassword(supabase, user, new_password);
  }

  if (!token_hash) return Response.json({ error: "This link is incomplete." }, { status: 400 });

  // The account's password, checked before the link is used up
  if (password) {
    if (!email) return Response.json({ error: "This link is incomplete." }, { status: 400 });
    if (!(await passwordMatches(email.trim().toLowerCase(), password))) {
      return Response.json({ error: "That isn't the password on this account. Try again, or choose a new password.", code: "WRONG_PASSWORD" }, { status: 400 });
    }
  }

  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash });
  if (error || !data.user) return Response.json({ error: EXPIRED }, { status: 400 });
  const user = data.user;
  if (email && user.email?.toLowerCase() !== email.trim().toLowerCase()) {
    await supabase.auth.signOut();
    return Response.json({ error: "This link doesn't match that email. Open the link from your email again." }, { status: 400 });
  }

  if (new_password) return savePassword(supabase, user, new_password);
  if (password && user.app_metadata?.signup_conflict) {
    await clearConflict(user.id, user.app_metadata);
    await supabase.auth.signOut({ scope: "others" });
  }
  return Response.json({ ok: true });
}

type Supa = Awaited<ReturnType<typeof createClient>>;
type AppMeta = Record<string, unknown>;

// Sets the password from the signed-in session (which keeps it signed in),
// then signs out every other session and clears the flag.
async function savePassword(supabase: Supa, user: { id: string; app_metadata: AppMeta }, newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    // The email is confirmed and this browser is signed in: the page asks again.
    return Response.json({ error: error.message, code: "PASSWORD_REJECTED", confirmed: true }, { status: 400 });
  }
  await supabase.auth.signOut({ scope: "others" });
  await clearConflict(user.id, user.app_metadata);
  return Response.json({ ok: true });
}

async function clearConflict(userId: string, appMetadata: AppMeta) {
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
    app_metadata: { ...appMetadata, signup_conflict: false },
  });
  if (error) console.error("Clearing signup_conflict failed:", error.message);
}
