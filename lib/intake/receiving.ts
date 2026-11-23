import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setOrderStatus } from "@/lib/order-status";
import { parseStageEvent } from "@/lib/restoration-stages";
import { isDay, nyToday } from "@/lib/intake/business-days";
import { BAG_COLUMNS, computeDueDate, loadHolidays, loadTurnarounds } from "@/lib/intake/due-dates";
import { nextCardSeqs, cardCode } from "@/lib/intake/codes";
import { planReceiving, type NeedsTier, type PlanBag, type PlanCard, type ReceivingPlan } from "@/lib/intake/receiving-plan";
import { refreshBagCompletion } from "@/lib/intake/stages";
import type { DueStatus } from "@/lib/intake/types";

/**
 * Receiving cards that physically arrived (mail-in or drop-off), server only.
 * Admin access is checked by the calling route. The rules are in
 * planReceiving (lib/intake/receiving-plan.ts); this loads, writes, and
 * retries once when someone else received the same order at the same moment
 * (the unique keys on Card IDs and bags refuse the second write: 23505).
 */

export type ReceivedBag = {
  id: string;
  code: string;
  tier: string;
  tierName: string;
  batch: number;
  created: boolean;
  cardIds: string[];
  receivedOn: string;
  dueDate: string | null;
  dueStatus: DueStatus;
};

export type ReceiveResult =
  | {
      ok: true;
      receivedCardIds: string[];
      alreadyReceived: string[];
      bags: ReceivedBag[];
      markedAwaiting: string[];
      /** The order moved from Awaiting Cards to Cards Received (status email sent like the status button). */
      orderStatusChanged: boolean;
      /** The customer status email failed (as the status route reports it). */
      emailFailed: boolean;
      /** The cards were saved but the order couldn't be moved to Cards Received (show it; the status button can retry). */
      statusError?: string;
      eventText: string;
    }
  | { ok: false; status: number; error: string; needsTier?: NeedsTier[] };

const RECEIVE_CARD_COLUMNS = "id, order_id, card_name, tier, status, completed, created_at, card_seq, card_code, received_at, awaiting_arrival, bag_id";

class Conflict extends Error {}
const isUnique = (e: { code?: string } | null | undefined) => e?.code === "23505";

/**
 * Give every card of the order a number and Card ID (after the highest used,
 * in (created_at, id) order); existing ones never change. Returns all of the
 * order's codes by card id. Throws Conflict on a concurrent assignment.
 */
async function assignCodes(admin: SupabaseClient, orderNumber: string, cards: Pick<PlanCard, "id" | "created_at" | "card_seq" | "card_code">[]) {
  const seqs = nextCardSeqs(cards).map((s) => ({ ...s, code: cardCode(orderNumber, s.seq) }));
  // A few at a time (a large order would otherwise fire hundreds of requests at once)
  for (let i = 0; i < seqs.length; i += 10) {
    const results = await Promise.all(seqs.slice(i, i + 10).map((s) =>
      admin.from("cards").update({ card_seq: s.seq, card_code: s.code }).eq("id", s.id).is("card_seq", null).select("id")));
    for (const r of results) {
      if (isUnique(r.error)) throw new Conflict("card code taken");
      if (r.error) throw new Error(`Couldn't save the Card IDs: ${r.error.message}`);
    }
    if (results.some((r) => !r.data?.length)) throw new Conflict("card numbered elsewhere");
  }
  return seqs;
}

/**
 * Card IDs for every card of an order (for pages and the Historical Order
 * Setup); assigns missing ones. Returns id -> { seq, code }.
 */
export async function ensureCardCodes(admin: SupabaseClient, orderId: string): Promise<Map<string, { seq: number; code: string }>> {
  for (let attempt = 0; ; attempt++) {
    const [{ data: order, error: oErr }, { data: cards, error: cErr }] = await Promise.all([
      admin.from("orders").select("order_number").eq("id", orderId).maybeSingle(),
      admin.from("cards").select("id, created_at, card_seq, card_code").eq("order_id", orderId),
    ]);
    if (oErr || cErr) throw new Error(`Couldn't read the order: ${(oErr ?? cErr)!.message}`);
    if (!order) throw new Error("Order not found");
    try {
      const fresh = await assignCodes(admin, order.order_number as string, (cards ?? []) as PlanCard[]);
      const out = new Map<string, { seq: number; code: string }>();
      for (const c of cards ?? []) if (c.card_seq != null && c.card_code) out.set(c.id as string, { seq: c.card_seq as number, code: c.card_code as string });
      for (const s of fresh) out.set(s.id, { seq: s.seq, code: s.code });
      return out;
    } catch (e) {
      if (e instanceof Conflict && attempt === 0) continue;
      throw e;
    }
  }
}

async function receiveOnce(
  admin: SupabaseClient,
  input: { orderId: string; cardIds: string[]; receivedOn: string; by: string | null; markOthersAwaiting: boolean },
): Promise<ReceiveResult> {
  const [{ data: order, error: oErr }, { data: cards, error: cErr }, { data: bags, error: bErr }, { data: names }] = await Promise.all([
    admin.from("orders").select("id, order_number, restoration_tier, status").eq("id", input.orderId).maybeSingle(),
    admin.from("cards").select(RECEIVE_CARD_COLUMNS).eq("order_id", input.orderId),
    admin.from("tier_bags").select(BAG_COLUMNS).eq("order_id", input.orderId),
    admin.from("restoration_settings").select("tier, display_name"),
  ]);
  const readErr = oErr ?? cErr ?? bErr;
  if (readErr) return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${readErr.message})` };
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (order.status === "cancelled") return { ok: false, status: 409, error: "This order is cancelled, so its cards can't be received." };

  const tierNames = Object.fromEntries((names ?? []).filter((r) => r.display_name).map((r) => [r.tier as string, r.display_name as string]));
  const planned = planReceiving({
    order: order as { id: string; order_number: string; restoration_tier: string | null; status: string },
    cards: (cards ?? []) as PlanCard[],
    bags: (bags ?? []) as PlanBag[],
    cardIds: input.cardIds,
    receivedOn: input.receivedOn,
    markOthersAwaiting: input.markOthersAwaiting,
    tierNames,
  });
  if (!planned.ok) return planned;
  const plan: ReceivingPlan = planned.plan;

  // 1. Card IDs for the whole order
  await assignCodes(admin, order.order_number as string, (cards ?? []) as PlanCard[]);

  if (!plan.bags.length) {
    return { ok: true, receivedCardIds: [], alreadyReceived: plan.alreadyReceived, bags: [], markedAwaiting: [], orderStatusChanged: false, emailFailed: false, eventText: "" };
  }

  // 2. Bags (new ones get their due date now, from today's tier settings)
  let turnarounds: Record<string, number | null> = {};
  let holidays: ReadonlySet<string> = new Set<string>();
  if (plan.bags.some((b) => !b.existingId)) [turnarounds, holidays] = await Promise.all([loadTurnarounds(admin), loadHolidays(admin)]);
  const existing = new Map((bags ?? []).map((b) => [b.id as string, b]));
  const created: string[] = [];
  const out: ReceivedBag[] = [];
  for (const b of plan.bags) {
    if (b.existingId) {
      const row = existing.get(b.existingId)!;
      out.push({ id: b.existingId, code: b.code, tier: b.tier, tierName: b.tierName, batch: b.batch, created: false, cardIds: b.cardIds, receivedOn: input.receivedOn, dueDate: row.due_date as string | null, dueStatus: row.due_status as DueStatus });
      continue;
    }
    const due = computeDueDate({ receivedOn: input.receivedOn, turnaroundDays: turnarounds[b.tier] ?? null, holidays });
    const { data: row, error } = await admin.from("tier_bags").insert({
      order_id: input.orderId, tier: b.tier, batch: b.batch, bag_code: b.code, received_on: input.receivedOn,
      ...due, source: "receiving", created_by: input.by,
    }).select("id").single();
    if (isUnique(error)) {
      await deleteEmptyBags(admin, created);
      throw new Conflict("bag taken");
    }
    if (error || !row) {
      await deleteEmptyBags(admin, created);
      return { ok: false, status: 500, error: `Couldn't create the ${b.tierName} bag. Nothing was received. (${error?.message ?? "no row"})` };
    }
    created.push(row.id as string);
    out.push({ id: row.id as string, code: b.code, tier: b.tier, tierName: b.tierName, batch: b.batch, created: true, cardIds: b.cardIds, receivedOn: input.receivedOn, dueDate: due.due_date, dueStatus: due.due_status });
  }

  // 3. The cards still not here leave the backlog first (before the order turns
  //    Cards Received), so the backlog never counts them even for a moment
  if (plan.markAwaiting.length) {
    const { error } = await admin.from("cards").update({ awaiting_arrival: true }).in("id", plan.markAwaiting).is("received_at", null);
    if (error) {
      await deleteEmptyBags(admin, created);
      return { ok: false, status: 500, error: `Couldn't save which cards are still missing. Nothing was received. (${error.message})` };
    }
  }

  // 4. The received cards
  const receivedAt = new Date().toISOString();
  const receivedIds: string[] = [];
  for (const b of out) {
    const { data, error } = await admin.from("cards")
      .update({ received_at: receivedAt, received_by: input.by, bag_id: b.id, awaiting_arrival: false })
      .in("id", b.cardIds)
      .is("received_at", null)
      .select("id");
    if (error) {
      await deleteEmptyBags(admin, created);
      // Nothing received: take back the awaiting flags set above, so a failed
      // receipt never leaves cards out of the backlog
      if (!receivedIds.length && plan.markAwaiting.length) {
        const { error: undoErr } = await admin.from("cards").update({ awaiting_arrival: false }).in("id", plan.markAwaiting).is("received_at", null);
        if (undoErr) console.error("[intake] awaiting flags not taken back:", undoErr.message);
      }
      return { ok: false, status: 500, error: `Couldn't save the ${b.tierName} cards as received. (${error.message})` };
    }
    const got = new Set((data ?? []).map((r) => r.id as string));
    b.cardIds = b.cardIds.filter((id) => got.has(id));
    receivedIds.push(...b.cardIds);
  }
  await deleteEmptyBags(admin, created);
  const bagsOut = out.filter((b) => b.cardIds.length);

  // 5. Awaiting Cards -> Cards Received through the status button's code (event text and emails unchanged)
  let orderStatusChanged = false;
  let emailFailed = false;
  let statusError: string | undefined;
  if (order.status === "awaiting_cards" && receivedIds.length) {
    const r = await setOrderStatus({ orderId: input.orderId, status: "received", onlyIfCurrent: "awaiting_cards" }, admin);
    if (r.ok) {
      orderStatusChanged = !r.skipped;
      emailFailed = !!r.emailFailed;
    } else {
      console.error("[intake] order not marked received:", r.error);
      statusError = `The cards were saved, but the order is still Awaiting Cards: ${r.error} Set it to Cards Received on the order page.`;
    }
  }

  // 6. The receiving log line (staff only)
  const eventText = receivedIds.length === plan.bags.reduce((n, b) => n + b.cardIds.length, 0)
    ? plan.eventText
    : `Received ${receivedIds.length} card${receivedIds.length === 1 ? "" : "s"}: ${bagsOut.map((b) => `${b.tierName} bag ${b.code} (${b.cardIds.length})`).join(", ")}`;
  if (receivedIds.length) {
    const { error } = await admin.from("order_events").insert({
      order_id: input.orderId,
      event_type: "cards_received",
      description: eventText,
      metadata: { card_ids: receivedIds, bag_ids: bagsOut.map((b) => b.id), received_on: input.receivedOn, awaiting_card_ids: plan.markAwaiting, by: input.by },
      is_customer_visible: false,
    });
    if (error) console.error("[intake] receiving not logged:", error.message);
  }

  return {
    ok: true,
    receivedCardIds: receivedIds,
    alreadyReceived: [...plan.alreadyReceived, ...plan.bags.flatMap((b) => b.cardIds).filter((id) => !receivedIds.includes(id))],
    bags: bagsOut,
    markedAwaiting: plan.markAwaiting,
    orderStatusChanged,
    emailFailed,
    ...(statusError ? { statusError } : {}),
    eventText: receivedIds.length ? eventText : "",
  };
}

/** Bags this call created that ended up with no cards (a failure or a race) are removed. */
async function deleteEmptyBags(admin: SupabaseClient, bagIds: string[]) {
  for (const id of bagIds) {
    const { count } = await admin.from("cards").select("id", { count: "exact", head: true }).eq("bag_id", id);
    if (count === 0) await admin.from("tier_bags").delete().eq("id", id);
  }
}

/**
 * Receive cards of an order that physically arrived.
 * - Every card of the order gets a Card ID.
 * - Each received card needs a tier (its own, else the order's); otherwise
 *   nothing is saved and `needsTier` says which cards need one.
 * - Received cards are grouped by tier into bags: an open bag of that tier
 *   received the same day is reused, else a new batch (CD-2549-P2) is made
 *   with its due date (tier max turnaround, business days from `receivedOn`).
 * - The order's other unreceived cards are flagged awaiting_arrival (out of
 *   the backlog) unless markOthersAwaiting is false.
 * - An order in Awaiting Cards becomes Cards Received exactly as the status
 *   button does it (same event text and emails); no other status changes.
 * - A staff-only order_events 'cards_received' line is written.
 */
export async function receiveCards(
  admin: SupabaseClient,
  input: { orderId: string; cardIds: string[]; receivedOn?: string; by: string | null; markOthersAwaiting?: boolean },
): Promise<ReceiveResult> {
  const today = nyToday();
  const receivedOn = input.receivedOn ?? today;
  if (!isDay(receivedOn)) return { ok: false, status: 400, error: "Pick a valid received date." };
  if (receivedOn > today) return { ok: false, status: 400, error: "The received date can't be in the future." };
  const args = { orderId: input.orderId, cardIds: input.cardIds, receivedOn, by: input.by, markOthersAwaiting: input.markOthersAwaiting ?? true };
  try {
    return await receiveOnce(admin, args);
  } catch (e) {
    if (!(e instanceof Conflict)) return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    return await receiveOnce(admin, args);
  } catch (e) {
    return { ok: false, status: e instanceof Conflict ? 409 : 500, error: e instanceof Conflict ? "Someone else is receiving this order right now. Reload and try again." : e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Undo receiving one card (a mistake), only before it has any stage step and
 * isn't done. Clears received_at/by and its bag; the card is flagged
 * awaiting_arrival if other cards of the order are received, otherwise no
 * card of the order stays flagged (back to "not received"). A bag left empty
 * is deleted; otherwise its completion is refreshed. Logged (staff only).
 */
export async function unreceiveCard(
  admin: SupabaseClient,
  input: { cardId: string; by: string | null },
): Promise<{ ok: true; bagDeleted: boolean } | { ok: false; status: number; error: string }> {
  const { data: card, error } = await admin.from("cards")
    .select("id, order_id, card_name, card_code, received_at, bag_id, completed")
    .eq("id", input.cardId).maybeSingle();
  if (error) return { ok: false, status: 500, error: `Couldn't read the card: ${error.message}` };
  if (!card) return { ok: false, status: 404, error: "Card not found" };
  if (!card.received_at) return { ok: false, status: 400, error: "This card isn't marked received." };
  if (card.completed) return { ok: false, status: 409, error: "This card is marked done, so it can't be un-received." };

  const [{ data: events, error: evErr }, { data: others, error: oErr }] = await Promise.all([
    admin.from("order_events").select("event_type, description, metadata").eq("order_id", card.order_id).eq("event_type", "stage_update"),
    admin.from("cards").select("id").eq("order_id", card.order_id).neq("id", card.id).not("received_at", "is", null).limit(1),
  ]);
  if (evErr || oErr) return { ok: false, status: 500, error: `Couldn't read the order: ${(evErr ?? oErr)!.message}` };
  if ((events ?? []).some((e) => parseStageEvent(e)?.card_id === card.id)) {
    return { ok: false, status: 409, error: "This card already has restoration steps, so it can't be un-received." };
  }
  const othersReceived = !!others?.length;

  const { error: updErr } = await admin.from("cards")
    .update({ received_at: null, received_by: null, bag_id: null, awaiting_arrival: othersReceived })
    .eq("id", card.id);
  if (updErr) return { ok: false, status: 500, error: `Couldn't un-receive the card: ${updErr.message}` };
  if (!othersReceived) {
    const { error: clrErr } = await admin.from("cards").update({ awaiting_arrival: false }).eq("order_id", card.order_id).eq("awaiting_arrival", true);
    if (clrErr) console.error("[intake] awaiting flags not cleared:", clrErr.message);
  }

  let bagDeleted = false;
  if (card.bag_id) {
    const { count } = await admin.from("cards").select("id", { count: "exact", head: true }).eq("bag_id", card.bag_id);
    if (count === 0) {
      const { error: delErr } = await admin.from("tier_bags").delete().eq("id", card.bag_id);
      bagDeleted = !delErr;
      if (delErr) console.error("[intake] empty bag not deleted:", delErr.message);
    } else {
      await refreshBagCompletion(admin, [card.bag_id as string]);
    }
  }

  await admin.from("order_events").insert({
    order_id: card.order_id,
    event_type: "card_unreceived",
    description: `Receiving undone for ${card.card_code ?? card.card_name ?? "a card"}${input.by ? ` by ${input.by}` : ""}`,
    metadata: { card_id: card.id, bag_id: card.bag_id, bag_deleted: bagDeleted, by: input.by },
    is_customer_visible: false,
  });
  return { ok: true, bagDeleted };
}
