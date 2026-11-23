import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureCardCodes, receiveCards } from "@/lib/intake/receiving";
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
 *        receivedOn?: "YYYY-MM-DD", allowUnpaid?: boolean, requestId?: uuid }
 * requestId (one per card entered) makes a resent request (double tap, retry)
 * answer with the card it already added instead of adding it again.
 * Refunded orders are refused; receiving on an order that isn't paid needs
 * allowUnpaid: true (sent after staff confirm), checked before the card is added.
 * A card added without receiving it, to an order whose other cards are already
 * in, is flagged awaiting_arrival (out of the backlog until it is received).
 * → 200 { ok: true, card_id, received: false, card_code }
 *   | 200 { ok: true, card_id, received: true, summary, ...ReceiveResult }
 *   | 409 { error, unpaid: true } (not paid, no allowUnpaid) | 409 { error } (refunded or cancelled)
 *   | 4xx/5xx { error, card_id? } (card_id: added, but receiving it failed)
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
  requestId: z.string().regex(UUID).optional(),
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
  const [{ data: order, error: orderError }, { data: arrived, error: arrivedError }] = await Promise.all([
    admin.from("orders").select("id, status, payment_status").eq("id", orderId).maybeSingle(),
    // Whether some of the order's cards are already in (then a card not received now is still on the way)
    admin.from("cards").select("id").eq("order_id", orderId).not("received_at", "is", null).limit(1),
  ]);
  if (orderError) return fail(500, `Couldn't read the order: ${orderError.message}`);
  if (!order) return fail(404, "Order not found");
  if (arrivedError) {
    if (isMissingSchema(arrivedError)) return fail(503, "Adding cards here needs the intake database update first.");
    return fail(500, `Couldn't read the order's cards: ${arrivedError.message}`);
  }
  if (order.status === "cancelled") return fail(409, "This order is cancelled.");
  // Refunded: never; not paid: only when receiving was confirmed anyway
  const blocked = paymentBlock(order.payment_status as string | null, d.receive ? d.allowUnpaid : true);
  if (blocked) return blocked;
  // A card that isn't received now on an order whose other cards are in stays out
  // of the backlog until it arrives, like the order's other missing cards
  const othersArrived = (arrived ?? []).length > 0;

  // The same submission sent again: answer with the card it added, add nothing
  if (d.requestId) {
    const { data: earlier } = await admin
      .from("order_events")
      .select("metadata")
      .eq("order_id", orderId)
      .eq("event_type", "card_added_at_receiving")
      .eq("metadata->>request_id", d.requestId)
      .limit(1);
    const earlierId = (earlier?.[0]?.metadata as { card_id?: string } | null)?.card_id;
    if (earlierId) {
      const { data: prev } = await admin.from("cards").select("id, card_code, received_at").eq("id", earlierId).maybeSingle();
      if (prev) {
        return Response.json({
          ok: true, duplicate: true, card_id: prev.id, card_code: prev.card_code ?? null, received: !!prev.received_at,
          ...(prev.received_at ? { summary: "It was already added (the request was sent twice)." } : {}),
        });
      }
    }
  }

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
    awaiting_arrival: !d.receive && othersArrived,
  }).select("id").single();
  if (error || !card) {
    if (isMissingSchema(error)) return fail(503, "Adding cards here needs the intake database update first.");
    console.error("[intake add card] insert error:", error?.code, error?.message);
    return fail(500, error?.message ?? "Failed to add card");
  }

  const { error: logError } = await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "card_added_at_receiving",
    description: `Card added at receiving: ${d.card_name} by ${who.by}`,
    metadata: { card_id: card.id, tier: d.tier, by: who.by, ...(d.requestId ? { request_id: d.requestId } : {}) },
    is_customer_visible: false,
  });
  if (logError) console.error("[intake add card] not logged:", logError.message);

  if (!d.receive) {
    // Its Card ID now (the next number on the order), so it can be labelled later
    let code: string | null = null;
    try {
      code = (await ensureCardCodes(admin, orderId)).get(card.id)?.code ?? null;
    } catch (e) {
      console.error("[intake add card] Card ID not assigned yet:", e instanceof Error ? e.message : e);
    }
    return Response.json({ ok: true, card_id: card.id, card_code: code, received: false });
  }

  const result = await receiveCards(admin, { orderId, cardIds: [card.id], receivedOn: d.receivedOn, by: who.by });
  if (!result.ok) {
    if (othersArrived) {
      // Not received after all: keep it out of the backlog like the order's other missing cards
      const { error: flagError } = await admin.from("cards").update({ awaiting_arrival: true }).eq("id", card.id).is("received_at", null);
      if (flagError) console.error("[intake add card] not flagged as on the way:", flagError.message);
    }
    return Response.json({ error: `The card was added, but receiving it failed: ${result.error}`, card_id: card.id }, { status: result.status });
  }
  if (order.payment_status !== "paid" && result.receivedCardIds.length) {
    const { error: unpaidLogError } = await admin.from("order_events").insert({
      order_id: orderId,
      event_type: "received_unpaid",
      description: `Card received on an order that isn't paid (payment status: ${order.payment_status ?? "none"}), confirmed by ${who.by}`,
      metadata: { by: who.by, payment_status: order.payment_status ?? null, card_ids: [card.id] },
      is_customer_visible: false,
    });
    if (unpaidLogError) console.error("[intake add card] unpaid receipt not logged:", unpaidLogError.message);
  }
  return Response.json({ ...result, ok: true, card_id: card.id, received: true, summary: result.eventText });
}
