import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const Body = z.object({ token_hash: z.string().min(10) });

// The confirm link's button: verifying the one-time token confirms the email
// and signs the customer in (session cookies set by the server client).
// An account that was signed up more than once before anyone confirmed it may
// have a password someone else chose (anyone can type any email). The person
// confirming has just proved they own the inbox, so that password is replaced
// with a random one, every other session is signed out, and they choose their
// own password next (choosePassword).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "This link is incomplete." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: parsed.data.token_hash });
  if (error) {
    return Response.json({ error: "This link has expired or was already used. Sign in to get a new one." }, { status: 400 });
  }

  const user = data.user;
  if (user?.app_metadata?.signup_conflict) {
    await supabase.auth.signOut({ scope: "others" });
    await createAdminClient().auth.admin.updateUserById(user.id, {
      password: randomBytes(32).toString("base64url"),
      app_metadata: { ...user.app_metadata, signup_conflict: false, choose_password: true },
    });
    return Response.json({ ok: true, choosePassword: true });
  }
  return Response.json({ ok: true });
}
