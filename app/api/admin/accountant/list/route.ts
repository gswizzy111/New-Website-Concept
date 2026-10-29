import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Only what the Accountant Access page shows: never the password hash or the
// invite token (a working setup link), just whether a password is set.
export async function GET() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("accountant_access")
    .select("id, name, email, password_hash, invite_token_expires_at, created_at, last_login_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Accountant list failed:", error.message);
    return Response.json({ error: "Couldn't load accountants." }, { status: 500 });
  }
  return Response.json(
    (data ?? []).map(({ password_hash, ...rest }) => ({ ...rest, has_password: !!password_hash }))
  );
}
