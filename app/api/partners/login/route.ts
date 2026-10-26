import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPartnerSession, findPartnerByPasscode } from "@/lib/partner-portal";
import { takeAttempt, waitMessage } from "@/lib/attempt-limit";

const Body = z.object({ passcode: z.string().trim().min(1).max(200) });

// Partners sign in with a passcode alone (there is no name to count tries
// against, and never an IP), so every try at the portal is counted together.
// Each try is written down before it is counted and before the passcode is
// checked (takeAttempt), so a burst of tries sent at once can't slip past.
// Needs the auth_attempts table (supabase/migrations/20261027_attempt_limits.sql).
const LOGIN_RULE = { max: 20, windowMinutes: 15 };
const LIMIT_KEY = "partner-portal";

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Passcode required" }, { status: 400 });
  const { passcode } = parsed.data;

  const ticket = await takeAttempt("partner-login", LIMIT_KEY, LOGIN_RULE);
  if (ticket.wait > 0) return Response.json({ error: waitMessage(ticket.wait) }, { status: 429 });

  try {
    const partnerId = await findPartnerByPasscode(createAdminClient(), passcode);
    if (!partnerId) return Response.json({ error: "Invalid passcode" }, { status: 401 });
    await createPartnerSession(partnerId);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Partner sign-in failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Sign-in failed. Please try again." }, { status: 500 });
  }
}
