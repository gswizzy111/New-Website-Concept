import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const Body = z.object({ bagIds: z.array(z.string().uuid()).min(1).max(200) });

/**
 * POST { bagIds } → { printedAt }
 * Records that labels for these bags were sent to the printer
 * (tier_bags.label_printed_at, the latest print).
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "bagIds must be a list of bag ids" }, { status: 400 });

  const printedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("tier_bags")
    .update({ label_printed_at: printedAt })
    .in("id", [...new Set(parsed.data.bagIds)]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ printedAt }, { headers: { "Cache-Control": "private, no-store" } });
}
