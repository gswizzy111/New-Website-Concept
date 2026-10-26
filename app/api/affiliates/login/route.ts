import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPassword } from "@/lib/crypto";
import { createCreatorSession, literalCode } from "@/lib/creator-portal";
import { attemptWait, clearAttempts, recordAttempt, waitMessage } from "@/lib/attempt-limit";

const Body = z.object({
  code: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

// A hash that matches nothing, so an unknown code takes as long to refuse as a wrong password
const NO_MATCH_HASH = "AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// Failed sign-ins allowed per code before it has to wait. Counted per code,
// never per IP. Each try is counted before the password is checked (so a
// burst of tries at once can't slip past); signing in clears the count.
const LOGIN_RULE = { max: 10, windowMinutes: 15 };

// Creators sign in with their code and the password they set from their
// setup link. Codes are public (customers type them at checkout), so the
// code alone opens nothing.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter your creator code and password." }, { status: 400 });
  const { code, password } = parsed.data;
  const wait = await attemptWait("creator-login", code, LOGIN_RULE);
  if (wait > 0) return Response.json({ error: waitMessage(wait) }, { status: 429 });

  const admin = createAdminClient();
  const { data: affiliate } = await admin
    .from("affiliates")
    .select("id, password_hash")
    .ilike("code", literalCode(code))
    .maybeSingle();
  if (affiliate && !affiliate.password_hash) {
    return Response.json(
      { error: "Your creator portal isn't set up yet. Ask The Card Doc for your setup link.", code: "NOT_SET_UP" },
      { status: 403 }
    );
  }
  await recordAttempt("creator-login", code);
  const valid = await verifyPassword(password, affiliate?.password_hash ?? NO_MATCH_HASH);
  if (!affiliate || !valid) {
    return Response.json({ error: "Incorrect code or password." }, { status: 401 });
  }
  await clearAttempts("creator-login", code);
  await createCreatorSession(affiliate.id, request.headers.get("user-agent"));
  return Response.json({ ok: true });
}
