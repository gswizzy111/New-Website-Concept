import { after } from "next/server";
import { sendAccountLink } from "@/lib/account-links";
import { takeAttempt } from "@/lib/attempt-limit";
import { z } from "zod";

const Body = z.object({ email: z.string().email() });

// A few reset emails per address per hour (counted per address, never per IP)
const EMAIL_RULE = { max: 3, windowMinutes: 60 };

// Emails a reset link when the account exists. Always answers the same way,
// and at once (the email goes out after the answer), so neither the answer
// nor how long it takes shows who has an account. After too many links to
// one address lately, nothing is sent or minted (a new token would cancel the
// link already in the inbox), and the answer is still the same.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  after(async () => {
    try {
      // The email's place is taken before minting, so requests sent at once
      // can't all get through; it's given back when nothing went out
      const attempt = await takeAttempt("account-reset-email", email, EMAIL_RULE);
      if (attempt.wait > 0) return;
      if (!(await sendAccountLink("reset", email))) await attempt.release();
    } catch (err) {
      console.error("Password reset email failed:", err instanceof Error ? err.message : err);
    }
  });
  return Response.json({ ok: true });
}
