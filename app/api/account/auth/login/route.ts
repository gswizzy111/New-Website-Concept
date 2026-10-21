import { createClient } from "@/lib/supabase/server";
import { sendAccountLink } from "@/lib/account-links";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const NOT_CONFIRMED = "Please confirm your email first. We just sent you a new confirmation link.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Enter your email and password." }, { status: 400 });

  const email = parsed.data.email.trim().toLowerCase();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });

  if (error) {
    if (/not confirmed/i.test(error.message)) {
      await sendAccountLink("confirm", email);
      return Response.json({ error: NOT_CONFIRMED, code: "EMAIL_NOT_CONFIRMED" }, { status: 403 });
    }
    return Response.json({ error: "Incorrect email or password." }, { status: 400 });
  }

  // Accounts are tied to orders by email: an unconfirmed address gets no access
  if (!data.user?.email_confirmed_at) {
    await supabase.auth.signOut();
    await sendAccountLink("confirm", email);
    return Response.json({ error: NOT_CONFIRMED, code: "EMAIL_NOT_CONFIRMED" }, { status: 403 });
  }
  return Response.json({ ok: true });
}
