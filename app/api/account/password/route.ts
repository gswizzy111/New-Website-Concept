import { createClient as createSupabase } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const Body = z.object({
  current_password: z.string().min(1),
  // Supabase refuses passwords over 72 characters
  new_password: z.string().min(8, "New password must be at least 8 characters.").max(72, "New password must be at most 72 characters."),
});

// Change password from Settings: the current password is checked first (on a
// throwaway client, so the signed-in session isn't touched). Once it's
// changed, every other session on the account is signed out; this one stays.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return Response.json({ error: "Please log in again." }, { status: 401 });

  const check = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: checked, error: wrong } = await check.auth.signInWithPassword({ email: user.email, password: parsed.data.current_password });
  if (wrong) return Response.json({ error: "Your current password is incorrect." }, { status: 400 });
  // The check opened a session of its own: close it
  if (checked.session) await check.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password: parsed.data.new_password });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  // Anyone else signed in to this account (another device, or someone who
  // knew the old password) is signed out
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) console.error("Signing out other sessions after a password change failed:", signOutError.message);
  return Response.json({ ok: true });
}
