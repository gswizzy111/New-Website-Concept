import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";

/** Turns the site-wide "sold out, join the waitlist?" pop-up on or off (store_config sold_out_popup). */
export async function PATCH(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ on: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("store_config")
    .upsert({ key: "sold_out_popup", value: String(parsed.data.on), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, on: parsed.data.on });
}
