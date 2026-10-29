import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { STAGES } from "@/app/admin/orders/[id]/stages";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const stage = typeof body?.stage === "string" ? body.stage.trim() : "";
  const cardId = typeof body?.card_id === "string" ? body.card_id.trim() : "";

  if (!stage || !cardId) {
    return Response.json({ error: "stage and card_id are required" }, { status: 400 });
  }
  if (!STAGES.includes(stage)) {
    return Response.json({ error: "Unknown stage" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: card } = await admin.from("cards").select("id").eq("id", cardId).eq("order_id", id).maybeSingle();
  if (!card) return Response.json({ error: "Card not found on this order" }, { status: 404 });

  // Encode card_id in the description so no schema change is needed
  const { error } = await admin.from("order_events").insert({
    order_id: id,
    event_type: "stage_update",
    description: `Stage: ${stage} [card:${cardId}]`,
    is_customer_visible: false,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
