import { createAdminClient } from "@/lib/supabase/admin";
import { hashPassword } from "@/lib/crypto";
import { ADMIN_PASSWORD_MIN } from "@/lib/admin-password";
import { z } from "zod";

// The same minimum as admin passwords (and accountant password resets)
const Body = z.object({
  token: z.string().min(1),
  password: z.string()
    .min(ADMIN_PASSWORD_MIN, `Password must be at least ${ADMIN_PASSWORD_MIN} characters.`)
    .max(200, "That password is too long."),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const admin = createAdminClient();

  const { data: accountant } = await admin
    .from("accountant_access")
    .select("id, invite_token_expires_at")
    .eq("invite_token", token)
    .maybeSingle();

  if (!accountant) {
    return Response.json({ error: "Invalid or expired invite link." }, { status: 400 });
  }

  if (new Date(accountant.invite_token_expires_at) < new Date()) {
    return Response.json({ error: "This invite link has expired. Ask the admin to resend it." }, { status: 400 });
  }

  const password_hash = await hashPassword(password);

  // Only while the link is still unused (two tabs can't both set a password)
  const { data: saved, error } = await admin.from("accountant_access").update({
    password_hash,
    invite_token: null,
    invite_token_expires_at: null,
  }).eq("id", accountant.id).eq("invite_token", token).select("id");
  if (error) {
    console.error("Accountant setup failed:", error.message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  if (!saved?.length) {
    return Response.json({ error: "Invalid or expired invite link." }, { status: 400 });
  }

  return Response.json({ ok: true });
}
