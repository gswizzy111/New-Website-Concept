import { createClient } from "@/lib/supabase/server";
import { CONFIRM_SUBJECT, sendAccountLink } from "@/lib/account-links";
import { fromAddress } from "@/lib/resend";
import { attemptWait, recordAttempt } from "@/lib/attempt-limit";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SENT = "Please confirm your email first. We just sent you a new confirmation link.";
const NOT_SENT = "Please confirm your email first. We couldn't send a new link just now. Please try again in a minute.";
// A few new links per address per hour (counted per address, never per IP)
const EMAIL_RULE = { max: 3, windowMinutes: 60 };

// An unconfirmed account gets a new confirm link when its password is right
// (which is also what the "Send it again" button on the sign-in page does).
// It only says a link was sent when the email actually went out, except
// after too many links lately: then nothing is sent or minted (a new token
// would cancel the link already in the inbox) and the answer stays the same.
async function notConfirmed(email: string) {
  let sent = true;
  if ((await attemptWait("account-confirm-email", email, EMAIL_RULE)) === 0) {
    sent = await sendAccountLink("confirm", email);
    if (sent) await recordAttempt("account-confirm-email", email);
  }
  return Response.json(
    { error: sent ? SENT : NOT_SENT, code: "EMAIL_NOT_CONFIRMED", confirmationSent: sent, sentFrom: fromAddress, subject: CONFIRM_SUBJECT },
    { status: 403 }
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Enter your email and password." }, { status: 400 });

  const email = parsed.data.email.trim().toLowerCase();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });

  if (error) {
    if (/not confirmed/i.test(error.message)) return notConfirmed(email);
    if (error.status === 429) {
      return Response.json({ error: "Too many attempts. Please wait a minute and try again.", code: "RATE_LIMITED" }, { status: 429 });
    }
    const wrongPassword = error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message);
    return Response.json({ error: "Incorrect email or password.", ...(wrongPassword ? { code: "INVALID_CREDENTIALS" } : {}) }, { status: 400 });
  }

  // Accounts are tied to orders by email: an unconfirmed address gets no access
  if (!data.user?.email_confirmed_at) {
    await supabase.auth.signOut();
    return notConfirmed(email);
  }
  return Response.json({ ok: true });
}
