import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPartner } from "@/lib/partner-portal";

const Body = z.object({
  quantity: z.number().int().min(1).max(10_000),
  notes: z.string().max(1000).nullable().optional(),
  product_type: z.enum(["kit", "polish", "spray"]).optional().default("kit"),
});

export async function POST(request: Request) {
  const partner = await getPartner();
  if (!partner) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error = field === "product_type" ? "Invalid product type" : field === "notes" ? "Notes are too long." : "Invalid quantity";
    return Response.json({ error }, { status: 400 });
  }
  const { quantity, notes, product_type } = parsed.data;

  // Checks the allocation and logs the sale in one step, with the partner's
  // row locked, so two sales at once can't go over it
  const { data: result, error } = await createAdminClient().rpc("partner_log_sale", {
    p_partner_id: partner.id,
    p_product_type: product_type,
    p_quantity: quantity,
    p_notes: notes?.trim() || null,
  });
  if (error) {
    console.error("Logging a partner sale failed:", error.message);
    return Response.json({ error: "Could not log the sale. Please try again." }, { status: 500 });
  }
  if (result === "over_allocation") {
    return Response.json({ error: `Cannot exceed allocated ${product_type} count` }, { status: 400 });
  }
  if (result !== "ok") return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true });
}
