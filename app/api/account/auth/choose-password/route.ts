import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const Body = z.object({ password: z.string().min(8, "Password must be at least 8 characters.") });

// Right after confirming an account that had been signed up more than once
// (see the confirm route): the signed-in owner sets their password without
// the old one, once.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (!user.app_metadata?.choose_password) {
    return Response.json({ error: "Change your password from Settings." }, { status: 403 });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await createAdminClient().auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, choose_password: false },
  });
  await supabase.auth.signOut({ scope: "others" });
  return Response.json({ ok: true });
}
