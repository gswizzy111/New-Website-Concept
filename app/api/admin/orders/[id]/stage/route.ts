import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { STAGES } from "@/lib/restoration-stages";
import { setCardStage } from "@/lib/intake/stages";

/**
 * One card to one of the 8 steps (the order page's Restoration Stages
 * buttons). Body `{ stage, card_id }`, answer `{ ok, emailed }`. The email
 * rule is the step picker's (setCardStage in lib/intake/stages.ts): only a
 * step past the furthest the card reached this round emails the customer
 * and shows on their order page; going back or re-entering a step is staff
 * only; a card already at that step changes nothing.
 */
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
  if (!(STAGES as readonly string[]).includes(stage)) {
    return Response.json({ error: "Unknown stage" }, { status: 400 });
  }

  const by = (await getAdminSession())?.username ?? null;
  const result = await setCardStage(createAdminClient(), { orderId: id, cardId, stage, by });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, emailed: result.emailed });
}
