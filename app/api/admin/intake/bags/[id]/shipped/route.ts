import { createAdminClient } from "@/lib/supabase/admin";
import { adminName, UUID } from "@/app/api/admin/intake/orders/guard";
import { markBagShipped } from "@/lib/intake/shipping/bag-shipments";

/**
 * POST → MarkShippedResponse: "Mark shipped" for one bag whose return label
 * was bought (POST ship-label). Sends the customer the usual shipped email
 * with this bag's tracking, once (a second tap answers alreadyShipped and
 * sends nothing). When every bag of the order with live cards has shipped,
 * the order becomes Shipped Back through lib/order-status.ts (no second
 * customer email). Full admins only; no body.
 */

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Bag not found" }, { status: 404, headers: noStore });
  const answer = await markBagShipped(createAdminClient(), { bagId: id, by: who.by });
  return Response.json(answer.body, { status: answer.status, headers: noStore });
}
