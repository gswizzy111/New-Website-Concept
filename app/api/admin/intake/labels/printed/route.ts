import { z } from "zod";
import { adminOrWorkshopActor } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const Body = z.object({ bagIds: z.array(z.string().uuid()).min(1).max(200) });

/**
 * POST { bagIds } → { printedAt }
 * Records that labels for these bags were sent to the printer, and by whom
 * (tier_bags.label_printed_at and label_printed_by, the latest print). Full
 * admins and workshop logins.
 */
export async function POST(request: Request) {
  const actor = await adminOrWorkshopActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "bagIds must be a list of bag ids" }, { status: 400 });

  const printedAt = new Date().toISOString();
  const ids = [...new Set(parsed.data.bagIds)];
  const admin = createAdminClient();
  let { error } = await admin
    .from("tier_bags")
    .update({ label_printed_at: printedAt, label_printed_by: actor.by })
    .in("id", ids);
  // Before 20261126_workshop_users.sql adds label_printed_by: the time alone, as before
  if (error && /label_printed_by/.test(error.message)) {
    ({ error } = await admin.from("tier_bags").update({ label_printed_at: printedAt }).in("id", ids));
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ printedAt }, { headers: { "Cache-Control": "private, no-store" } });
}
