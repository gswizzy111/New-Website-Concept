import { z } from "zod";
import { attemptWait, recordAttempt } from "@/lib/attempt-limit";
import { KIT_CLUB_LINK_RULE, sendKitClubLink, subscriptionForEmail } from "@/lib/kit-club-link";

const Body = z.object({ email: z.string().trim().email() });

// "Manage your subscription": emails a one-time link to the address when it
// has a Kit Club subscription. Always answers the same way, so the form
// can't be used to find out who subscribes, and shows nothing itself. A few
// emails per address per hour at most (counted per address, never per IP).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  if ((await attemptWait("kit-club-link-email", email, KIT_CLUB_LINK_RULE)) === 0) {
    const sub = await subscriptionForEmail(email);
    if (sub && (await sendKitClubLink(email))) await recordAttempt("kit-club-link-email", email);
  }
  return Response.json({ ok: true });
}
