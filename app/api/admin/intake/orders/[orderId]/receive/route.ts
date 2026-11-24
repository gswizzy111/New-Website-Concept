import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { receiveCards } from "@/lib/intake/receiving";
import { ensureShelfSlot } from "@/lib/intake/tracking/shelf";
import { DAY, UUID, adminName, fail, paymentBlock, smallJson } from "../../guard";

/**
 * Receive the cards that physically arrived (some or all of the order's).
 * Gives them Card IDs, puts each tier in its own bag with its due date, and
 * moves an order that was awaiting cards to "Cards Received" (the same way the
 * status buttons do). Cards not listed stay not received.
 *
 * An order that isn't paid (payment_status not 'paid') needs allowUnpaid: true,
 * sent only after staff confirm; a refunded order is refused.
 *
 * POST { cardIds: uuid[] (1-500), receivedOn?: "YYYY-MM-DD" (default today, New York), allowUnpaid?: boolean }
 * → 200 { ok: true, summary, receivedCardIds, alreadyReceived, bags: ReceivedBag[], markedAwaiting,
 *         orderStatusChanged, emailFailed, eventText } (ReceiveResult in lib/intake/receiving.ts)
 *         + shelves: { bagCode, dueDate, location: { code, name } | null }[] (each received bag with a
 *           due date: its shelf slot, made with ensureShelfSlot; null if that failed, the cards are received anyway)
 *   | 400 { error, needsTier?: { cardId, seq, name }[] }
 *   | 409 { error, payment: "unpaid", unpaid: true } | 409 { error, payment: "refunded" } | 4xx/5xx { error }
 */
const Body = z.object({
  cardIds: z.array(z.string().regex(UUID, "Card not found")).min(1, "Tick at least one card.").max(500),
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

  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("id, payment_status").eq("id", orderId).maybeSingle();
  if (error) return fail(500, `Couldn't read the order: ${error.message}`);
  if (!order) return fail(404, "Order not found");
  const blocked = paymentBlock(order.payment_status as string | null, parsed.data.allowUnpaid);
  if (blocked) return blocked;

  const result = await receiveCards(admin, {
    orderId,
    cardIds: [...new Set(parsed.data.cardIds)],
    receivedOn: parsed.data.receivedOn,
    by: who.by,
  });
  if (!result.ok) {
    // needsTier: the cards that need a tier first ({ cardId, seq, name })
    return Response.json({ error: result.error, ...(result.needsTier ? { needsTier: result.needsTier } : {}) }, { status: result.status });
  }
  if (order.payment_status !== "paid" && result.receivedCardIds.length) {
    // Who chose to receive on an order that isn't paid (only when cards were actually received now)
    const { error: logError } = await admin.from("order_events").insert({
      order_id: orderId,
      event_type: "received_unpaid",
      description: `Cards received on an order that isn't paid (payment status: ${order.payment_status ?? "none"}), confirmed by ${who.by}`,
      metadata: { by: who.by, payment_status: order.payment_status ?? null, card_ids: result.receivedCardIds },
      is_customer_visible: false,
    });
    if (logError) console.error("[intake receive] unpaid receipt not logged:", logError.message);
  }
  return Response.json({ ...result, summary: result.eventText, shelves: await shelvesFor(admin, result.bags) });
}

/**
 * The shelf slot each received bag goes in (one per due date, made where
 * missing). Best effort: a failure never fails the receipt, its bag just gets
 * location null (the receiving page shows the shelf box again on load).
 */
async function shelvesFor(admin: ReturnType<typeof createAdminClient>, bags: { code: string; dueDate: string | null }[]) {
  const slots = new Map<string, Promise<{ code: string; name: string } | null>>();
  const slot = (day: string) => {
    let p = slots.get(day);
    if (!p) {
      p = ensureShelfSlot(admin, day)
        .then((loc) => (loc ? { code: loc.code, name: loc.name } : null))
        .catch((e: unknown) => {
          console.error("[intake receive] shelf slot not made:", e instanceof Error ? e.message : e);
          return null;
        });
      slots.set(day, p);
    }
    return p;
  };
  return Promise.all(bags.filter((b) => b.dueDate).map(async (b) => ({ bagCode: b.code, dueDate: b.dueDate, location: await slot(b.dueDate!) })));
}
