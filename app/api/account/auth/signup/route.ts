import { createAdminClient } from "@/lib/supabase/admin";
import { sendAccountLink } from "@/lib/account-links";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().trim().min(1).max(100),
});

// Creates the account unconfirmed and emails a confirm link. Orders are matched
// to accounts by email, so nobody can see orders until they prove they own it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password, name } = parsed.data;
  const admin = createAdminClient();

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { name },
  });

  if (createError) {
    const exists = /already|exists|registered/i.test(createError.message);
    if (!exists) return Response.json({ error: createError.message }, { status: 400 });
    // Already signed up: a confirmed account signs in; an unconfirmed one gets a new link
    const { data: existing } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (existing?.user?.email_confirmed_at) {
      return Response.json({ error: "An account with that email already exists. Sign in, or reset your password." }, { status: 400 });
    }
  }

  const sent = await sendAccountLink("confirm", email, name);
  if (!sent) return Response.json({ error: "We couldn't send the confirmation email. Please try again." }, { status: 500 });
  return Response.json({ ok: true, confirmationSent: true });
}
