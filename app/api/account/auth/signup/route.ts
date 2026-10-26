import { createAdminClient } from "@/lib/supabase/admin";
import { CONFIRM_SUBJECT, emailAccountLink, mintAccountToken } from "@/lib/account-links";
import { fromAddress } from "@/lib/resend";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().trim().min(1).max(100),
});

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

  // One token per request: minting another would cancel the link we email.
  const minted = await mintAccountToken("confirm", email);
  if (!minted) return Response.json({ error: "We couldn't send the confirmation email. Please try again." }, { status: 500 });
  // Already signed up and confirmed: sign in instead.
  if (minted.user.email_confirmed_at) {
    return Response.json({ error: "An account with that email already exists. Sign in, or reset your password." }, { status: 400 });
  }
  // Signed up before but never confirmed: the password stays the one chosen
  // first, and the account is flagged so whoever confirms it (the owner of the
  // inbox) chooses a new password then. That stops someone who signs up with a
  // stranger's email from keeping a way in once the stranger confirms.
  if (existingAccount) {
    await adminSupabase.auth.admin.updateUserById(minted.user.id, {
      app_metadata: { ...minted.user.app_metadata, signup_conflict: true },
    });
  }

  const greet = existingAccount ? (minted.user.user_metadata?.name as string | undefined) : name;
  const sent = await emailAccountLink("confirm", email, minted.tokenHash, greet);
  if (!sent) return Response.json({ error: "We couldn't send the confirmation email. Please try again." }, { status: 500 });
  return Response.json({ ok: true, confirmationSent: true, sentFrom: fromAddress, subject: CONFIRM_SUBJECT });
}
