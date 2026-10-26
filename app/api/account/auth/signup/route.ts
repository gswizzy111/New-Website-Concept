import { createAdminClient } from "@/lib/supabase/admin";
import { CONFIRM_SUBJECT, checkPassword, emailAccountLink, mintAccountToken } from "@/lib/account-links";
import { fromAddress } from "@/lib/resend";
import { attemptWait, recordAttempt } from "@/lib/attempt-limit";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters.").max(72, "Password must be at most 72 characters."),
  name: z.string().trim().min(1).max(100),
});

// A few confirmation emails per address per hour, so the form can't be used
// to flood someone's inbox (counted per address, never per IP)
const EMAIL_RULE = { max: 3, windowMinutes: 60 };
const EXISTS = "An account with that email already exists. Sign in, or reset your password.";
const NOT_SENT = "We couldn't send the confirmation email. Please try again.";

function sentReply() {
  return Response.json({ ok: true, confirmationSent: true, sentFrom: fromAddress, subject: CONFIRM_SUBJECT });
}

// Creates the account unconfirmed and emails a confirm link. Orders are matched
// to accounts by email, so nobody can see orders until they prove they own it.
// The reply says who the email comes from, so the page can tell people what to
// look for (and to check Spam).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password, name } = parsed.data;
  const adminSupabase = createAdminClient();
  const wait = await attemptWait("account-signup-email", email, EMAIL_RULE);

  const { error: createError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { name },
  });

  let existingAccount = false;
  if (createError) {
    const exists = /already|exists|registered/i.test(createError.message);
    if (!exists) return Response.json({ error: createError.message }, { status: 400 });
    existingAccount = true;
  }

  // Too many emails to this address lately: answer as if one was sent. (A
  // brand-new account always gets its first email: only an existing account
  // can have had several.)
  if (wait > 0 && existingAccount) {
    const limited = await limitedSignup(email, password);
    if (limited) return limited;
    // Couldn't read the account: carry on as usual rather than block sign-up
  }

  // One token per request: minting another would cancel the link we email.
  const minted = await mintAccountToken("confirm", email);
  if (!minted) return Response.json({ error: NOT_SENT }, { status: 500 });
  // Already signed up and confirmed: sign in instead.
  if (minted.user.email_confirmed_at) {
    return Response.json({ error: EXISTS }, { status: 400 });
  }
  // Signed up before but never confirmed. The password stays the one chosen
  // first. If this sign-up used a different password, someone else may know
  // the first one (anyone can type any email), so the account is flagged and
  // its confirm links ask for the account's password, or a new one, before
  // confirming. Checked before sending, and nothing is sent if flagging fails.
  // When Supabase can't say whether the password matched, it's flagged too.
  let check = !!minted.user.app_metadata?.signup_conflict;
  if (existingAccount && !check && (await checkPassword(email, password)) !== "match") {
    const { error: flagError } = await adminSupabase.auth.admin.updateUserById(minted.user.id, {
      app_metadata: { ...minted.user.app_metadata, signup_conflict: true },
    });
    if (flagError) {
      console.error("Flagging a repeat sign-up failed:", flagError.message);
      return Response.json({ error: NOT_SENT }, { status: 500 });
    }
    check = true;
  }

  const greet = existingAccount ? (minted.user.user_metadata?.name as string | undefined) : name;
  const sent = await emailAccountLink("confirm", email, minted.tokenHash, greet, check ? minted.user.id : undefined);
  if (!sent) return Response.json({ error: NOT_SENT }, { status: 500 });
  await recordAttempt("account-signup-email", email);
  return sentReply();
}

/**
 * A repeat sign-up for an address that has had too many emails: sends
 * nothing, and mints no new token (that would cancel the link already in the
 * inbox). Everything else happens as usual: a confirmed account is told to
 * sign in, and a different password still flags the account, so whichever
 * link gets used asks for a password the inbox owner chose. Null when the
 * account couldn't be read (the caller then carries on as usual).
 */
async function limitedSignup(email: string, password: string): Promise<Response | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("account_signup_state", { p_email: email });
  const account = Array.isArray(data)
    ? (data[0] as { user_id: string; confirmed: boolean; app_metadata: Record<string, unknown> | null } | undefined)
    : undefined;
  if (error || !account) {
    if (error) console.error("Reading the sign-up state failed:", error.message);
    return null;
  }
  if (account.confirmed) return Response.json({ error: EXISTS }, { status: 400 });
  if (!account.app_metadata?.signup_conflict && (await checkPassword(email, password)) !== "match") {
    const { error: flagError } = await admin.auth.admin.updateUserById(account.user_id, {
      app_metadata: { ...account.app_metadata, signup_conflict: true },
    });
    if (flagError) {
      console.error("Flagging a repeat sign-up failed:", flagError.message);
      return Response.json({ error: NOT_SENT }, { status: 500 });
    }
  }
  return sentReply();
}
