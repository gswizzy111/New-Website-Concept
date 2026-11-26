import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { unreceiveCard } from "@/lib/intake/receiving";
import { UUID, staffActor, fail, smallJson } from "../../guard";

/**
 * Undo receiving one card (a mistake), only before any work step was
 * recorded for it: it leaves its bag and goes back to not received.
 *
 * POST { cardId: uuid } → 200 { ok: true, ... } | 4xx/5xx { error }
 */
const Body = z.object({ cardId: z.string().regex(UUID, "Card not found") });

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await staffActor();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const parsed = Body.safeParse(await smallJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");

  const admin = createAdminClient();
  const { data: card } = await admin.from("cards").select("id, order_id").eq("id", parsed.data.cardId).maybeSingle();
  if (!card || card.order_id !== orderId) return fail(404, "Card not found on this order");

  const result = await unreceiveCard(admin, { cardId: card.id, by: who.by });
  if (!result.ok) return fail(result.status, result.error);
  return Response.json(result);
}
