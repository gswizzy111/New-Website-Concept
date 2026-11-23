import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { receiveCards } from "@/lib/intake/receiving";
import { isOurCardPhoto, MAX_RECEIVING_PHOTOS } from "@/lib/intake/photos";
import { isMissingSchema } from "@/app/admin/receiving/_components/schema";
import { DAY, UUID, adminName, fail, paymentBlock, smallJson } from "../../guard";

/**
 * In-person drop-off: add a card the customer brought to their existing order
 * (never a new order), with its tier and receiving photos, and by default
 * receive it at once (Card ID, bag, due date). The same card row as
 * POST /api/admin/orders/[id]/cards, plus the tier (that route doesn't keep
 * one) and the photos as receiving photos (the customer's photos stay empty).
 *
 * POST { card_name, card_set?, card_year?, card_number?, tier,
 *        receiving_photo_urls?: string[], receive?: boolean (default true),
 *        receivedOn?: "YYYY-MM-DD", allowUnpaid?: boolean }
 * Refunded orders are refused; receiving on an order that isn't paid needs
 * allowUnpaid: true (sent after staff confirm), checked before the card is added.
 * → 200 { ok: true, card_id, received: boolean, summary? } | 4xx/5xx { error, card_id? }
 */
const TIERS = ["prep", "regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass"] as const;
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const Body = z.object({
  card_name: z.string().trim().min(1, "Enter the card's name.").max(200),
  card_set: text(200),
  card_year: text(20),
  card_number: text(40),
  tier: z.enum(TIERS, { error: "Pick the card's tier." }),
  receiving_photo_urls: z.array(z.string().max(500).refine(isOurCardPhoto, "Only photos uploaded here can be added."))
    .max(MAX_RECEIVING_PHOTOS).optional().default([]),
  receive: z.boolean().optional().default(true),
  receivedOn: z.string().regex(DAY, "Pick a valid received date.").optional(),
  allowUnpaid: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const parsed = Body.safeParse(await smallJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const d = parsed.data;

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, status, payment_status").eq("id", orderId).maybeSingle();
  if (!order) return fail(404, "Order not found");
  if (order.status === "cancelled") return fail(400, "This order is cancelled.");
  // Refunded: never; not paid: only when receiving was confirmed anyway
  const blocked = paymentBlock(order.payment_status as string | null, d.receive ? d.allowUnpaid : true);
  if (blocked) return blocked;

  const { data: card, error } = await admin.from("cards").insert({
    order_id: orderId,
    card_name: d.card_name,
    card_set: d.card_set,
    card_year: d.card_year,
    ...(d.card_number ? { card_number: d.card_number } : {}),
    estimated_value_cents: null,
    notes: null,
    photo_urls: [],
    service_ids: [],
    completed: false,
    tier: d.tier,
    receiving_photo_urls: [...new Set(d.receiving_photo_urls)],
  }).select("id").single();
  if (error || !card) {
    if (isMissingSchema(error)) return fail(503, "Adding cards here needs the intake database update first.");
    console.error("[intake add card] insert error:", error);
    return fail(500, error?.message ?? "Failed to add card");
  }

  await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "card_added_at_receiving",
    description: `Card added at receiving: ${d.card_name} by ${who.by}`,
    metadata: { card_id: card.id, tier: d.tier, by: who.by },
    is_customer_visible: false,
  });

  if (!d.receive) return Response.json({ ok: true, card_id: card.id, received: false });

  const result = await receiveCards(admin, { orderId, cardIds: [card.id], receivedOn: d.receivedOn, by: who.by });
  if (!result.ok) {
    return Response.json({ error: `The card was added, but receiving it failed: ${result.error}`, card_id: card.id }, { status: result.status });
  }
  if (order.payment_status !== "paid") {
    await admin.from("order_events").insert({
      order_id: orderId,
      event_type: "received_unpaid",
      description: `Card received on an order that isn't paid (payment status: ${order.payment_status ?? "none"}), confirmed by ${who.by}`,
      metadata: { by: who.by, payment_status: order.payment_status ?? null, card_ids: [card.id] },
      is_customer_visible: false,
    });
  }
  return Response.json({ ...result, ok: true, card_id: card.id, received: true });
}
