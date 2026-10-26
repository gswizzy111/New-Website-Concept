import { sendAccountLink } from "@/lib/account-links";
import { attemptWait, recordAttempt } from "@/lib/attempt-limit";
import { z } from "zod";

const Body = z.object({ email: z.string().email() });

// A few reset emails per address per hour (counted per address, never per IP)
const EMAIL_RULE = { max: 3, windowMinutes: 60 };

// Emails a reset link when the account exists. Always answers the same way,
// so the form can't be used to find out who has an account. After too many
// links to one address lately, nothing is sent or minted (a new token would
// cancel the link already in the inbox), and the answer is still the same.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  if ((await attemptWait("account-reset-email", email, EMAIL_RULE)) === 0) {
    if (await sendAccountLink("reset", email)) await recordAttempt("account-reset-email", email);
  }
  return Response.json({ ok: true });
}
