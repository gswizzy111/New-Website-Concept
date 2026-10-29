import { after } from "next/server";
import { z } from "zod";
import { takeAttempt } from "@/lib/attempt-limit";
import { KIT_CLUB_LINK_RULE, sendKitClubLink, subscriptionForEmail } from "@/lib/kit-club-link";

const Body = z.object({ email: z.string().trim().email() });

// "Manage your subscription": emails a one-time link to the address when it
// has a Kit Club subscription. Always answers the same way, and at once (the
// lookup and the email happen after the answer), so neither the answer nor
// how long it takes shows who subscribes; it shows nothing itself. A few
// emails per address per hour at most (counted per address, never per IP).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  after(async () => {
    try {
      const sub = await subscriptionForEmail(email);
      if (!sub) return;
      // The email's place is taken before the link is made, so requests sent
      // at once can't all get through; it's given back when nothing went out
      const attempt = await takeAttempt("kit-club-link-email", email, KIT_CLUB_LINK_RULE);
      if (attempt.wait > 0) return;
      if (!(await sendKitClubLink(email))) await attempt.release();
    } catch (err) {
      console.error("Kit Club manage link failed:", err instanceof Error ? err.message : err);
    }
  });
  return Response.json({ ok: true });
}
