import { createAdminClient } from "@/lib/supabase/admin";
import { adminName, UUID } from "@/app/api/admin/intake/orders/guard";
import { buyBagLabel, loadPacking } from "@/lib/intake/shipping/bag-shipments";

/**
 * The packing page's return label for ONE bag ("ship each bag when done").
 * Full admins only. Contract: lib/intake/INTERFACES.md "Packing" and
 * lib/intake/shipping/types.ts.
 *
 * GET [?rates=1] → PackingResponse: the bag's ship check, its shipment (or
 *   the order page's whole-order label), every package of the order, and
 *   with ?rates=1 the Shippo rates (the customer's paid service flagged).
 * POST { rateObjectId?, insuranceDeclaredValueCents?, retryStaleClaim? } →
 *   { shipment, existing, orderLabel, message }. Claims the bag first, so
 *   two taps buy one label; repeating answers the label already bought.
 *   Refused (409) when the ship check fails, the order already has a
 *   whole-order label, or a purchase is in progress / unfinished.
 */

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Bag not found" }, { status: 404, headers: noStore });
  const rates = new URL(req.url).searchParams.get("rates") === "1";
  const answer = await loadPacking(createAdminClient(), id, { rates });
  return Response.json(answer.body, { status: answer.status, headers: noStore });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Bag not found" }, { status: 404, headers: noStore });

  const text = await req.text().catch(() => "");
  let body: Record<string, unknown> = {};
  if (text.trim()) {
    if (text.length > 10_000) return Response.json({ error: "Request too large." }, { status: 400, headers: noStore });
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "The request wasn't valid JSON." }, { status: 400, headers: noStore });
    }
  }
  if (body.rateObjectId !== undefined && body.rateObjectId !== null && (typeof body.rateObjectId !== "string" || body.rateObjectId.length > 100)) {
    return Response.json({ error: "rateObjectId must be a Shippo rate id." }, { status: 400, headers: noStore });
  }

  const answer = await buyBagLabel(createAdminClient(), {
    bagId: id,
    by: who.by,
    rateObjectId: (body.rateObjectId as string | null | undefined) ?? null,
    insuranceDeclaredValueCents: body.insuranceDeclaredValueCents,
    retryStaleClaim: body.retryStaleClaim === true,
  });
  return Response.json(answer.body, { status: answer.status, headers: noStore });
}
