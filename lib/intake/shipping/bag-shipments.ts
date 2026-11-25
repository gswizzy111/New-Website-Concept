import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { PREVIEW_MESSAGE, PREVIEW_MODE } from "@/lib/preview";
import { setOrderStatus } from "@/lib/order-status";
import { tierDisplayName } from "@/lib/intake/codes";
import { chunks, loadOrdersContext, type OrdersContext } from "@/lib/intake/tracking/context";
import { buildShipCheck, TRACK_BAG_COLUMNS, type TrackBagRow } from "@/lib/intake/tracking/summaries";
import type { ShipCheckResponse } from "@/lib/intake/tracking/types";
import {
  getReturnRates, isInternational, liveShippo, purchaseReturnLabel, returnAddress, returnInsuranceCents,
  type CustomsCard, type ReturnLabelOrder, type ShippoPort,
} from "@/lib/intake/shipping/bag-label";
import { sendReturnShippedEmail } from "@/lib/intake/shipping/shipped-email";
import {
  bagInsuranceFloorCents, cardList, CLAIM_STALE_MS, everyBagDelivered, everyBagShipped, LIVE_SHIPMENT_STATUSES,
  liveBags, orderStatusBlock, packageSummaries, SHIP_BACK_FROM, SHIPMENT_COLUMNS, shipmentView,
  type BagShipmentRow, type BuyBagLabelResponse, type MarkShippedResponse, type PackingNext, type PackingResponse,
} from "@/lib/intake/shipping/types";

/**
 * Per-bag return labels: "Ship each bag when done" (the owner, Nov 25 2026).
 * Server only; the routes check full-admin access and pass `by`.
 *
 *   loadPacking     GET  /api/admin/intake/bags/<id>/ship-label  (ship check + the bag's shipment)
 *   buyBagLabel     POST /api/admin/intake/bags/<id>/ship-label  (claim, then buy with Shippo)
 *   markBagShipped  POST /api/admin/intake/bags/<id>/shipped     (shipped email; order shipped back when every bag is)
 *   syncBagDeliveries                                            (sync-delivered: per shipment, then the order)
 *
 * Claim before buying, as the Stripe webhook claims a session: a 'claimed'
 * row (one live row per bag, unique index) is written before Shippo is
 * called, so two taps never buy two labels. Shippo saying no marks the claim
 * 'failed' and a retry works; no answer after the purchase was sent keeps the
 * claim (the label may exist) until staff check Shippo and retry on purpose.
 *
 * The old site (thecarddoc1.com) reads only the order's single return label:
 * the order's FIRST bag label is written to orders.return_label_url and
 * outbound_* when it is bought (so neither site sells a second whole-order
 * label); orders.tracking_number and the status change when the order is
 * shipped back (every bag with live cards shipped), so the admin order
 * page's "return label detected" auto-ship (both sites) never ships an order
 * with bags still in the shop. Preview mode refuses every write here.
 */

type Deps = { shippo?: ShippoPort; preview?: boolean; now?: () => Date };

export type ServiceAnswer<T> =
  | { ok: true; status: 200; body: T }
  | { ok: false; status: number; body: { error: string } & Record<string, unknown> };

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): ServiceAnswer<never> =>
  ({ ok: false, status, body: { error, ...extra } });

export const SHIPMENTS_MIGRATION_ERROR =
  "Per-bag labels need the database update supabase/migrations/20261125_bag_shipments.sql, which isn't applied yet. Nothing was bought.";

/** The bag_shipments table isn't in the database (yet). */
export function isMissingShipmentsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["42P01", "PGRST205"].includes(error.code ?? "")) return true;
  return /bag_shipments/.test(error.message ?? "") && /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

type OrderRow = ReturnLabelOrder & {
  id: string;
  order_number: string;
  status: string;
  return_label_url: string | null;
  tracking_number: string | null;
};
type ValueCard = { id: string; bag_id: string | null; status: string | null; card_name: string | null; estimated_value_cents: number | null };

type BagContext = {
  bag: TrackBagRow;
  order: OrderRow;
  ctx: OrdersContext;
  bags: TrackBagRow[];
  shipments: BagShipmentRow[];
  shipmentsReady: boolean;
};

/** Every shipment of some orders (paged), and whether the table exists. */
async function readShipments(admin: SupabaseClient, orderIds: readonly string[]): Promise<{ rows: BagShipmentRow[]; ready: boolean }> {
  try {
    const parts = await Promise.all(chunks([...new Set(orderIds)]).map((part) => fetchAll<BagShipmentRow>((from, to) =>
      admin.from("bag_shipments").select(SHIPMENT_COLUMNS).in("order_id", part).order("claimed_at").order("id").range(from, to))));
    return { rows: parts.flat(), ready: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingShipmentsTable({ message })) return { rows: [], ready: false };
    throw e;
  }
}

async function loadBagContext(admin: SupabaseClient, bagId: string): Promise<BagContext | null> {
  const { data: bag, error: bagErr } = await admin.from("tier_bags").select(TRACK_BAG_COLUMNS).eq("id", bagId).maybeSingle();
  if (bagErr) throw new Error(bagErr.message);
  if (!bag) return null;
  const orderId = (bag as TrackBagRow).order_id;
  const [ctx, orderRes, shipments] = await Promise.all([
    loadOrdersContext(admin, [orderId]),
    admin.from("orders").select("*").eq("id", orderId).maybeSingle(),
    readShipments(admin, [orderId]),
  ]);
  if (orderRes.error) throw new Error(orderRes.error.message);
  if (!orderRes.data) return null;
  return {
    bag: bag as TrackBagRow,
    order: orderRes.data as OrderRow,
    ctx,
    bags: [...ctx.bags.values()].filter((b) => b.order_id === orderId),
    shipments: shipments.rows,
    shipmentsReady: shipments.ready,
  };
}

const liveShipmentOf = (shipments: readonly BagShipmentRow[], bagId: string) =>
  shipments.find((s) => s.bag_id === bagId && LIVE_SHIPMENT_STATUSES.includes(s.status)) ?? null;

/** A label bought for the whole order (order page or old site), not by a bag: it covers every bag. */
function wholeOrderLabel(order: OrderRow, shipments: readonly BagShipmentRow[]) {
  if (!order.return_label_url) return null;
  if (shipments.some((s) => s.order_label && LIVE_SHIPMENT_STATUSES.includes(s.status))) return null;
  if (shipments.some((s) => s.label_url === order.return_label_url)) return null;
  return { labelUrl: order.return_label_url, trackingNumber: order.tracking_number ?? null };
}

function bagCheck(c: BagContext): ShipCheckResponse {
  const order = c.ctx.orders.get(c.order.id) ?? {
    id: c.order.id, order_number: c.order.order_number, customer_name: c.order.customer_name ?? null,
    customer_email: c.order.customer_email ?? null, status: c.order.status, restoration_tier: null,
  };
  return buildShipCheck({ scope: "bag", order, bags: [c.bag], cards: c.ctx.cards.filter((x) => x.bag_id === c.bag.id), ctx: c.ctx });
}

/** Why the ship check stops the label (plain sentences), or null when it is ready. */
export function shipCheckBlock(check: ShipCheckResponse): string | null {
  if (check.ready) return null;
  const live = check.cards.filter((c) => c.status !== "refunded");
  if (live.length === 0) return "Every card in this bag was refunded: there is nothing to ship.";
  const parts: string[] = [];
  const notDone = live.filter((c) => c.status === "not_done");
  const inSlot = live.filter((c) => c.status === "in_slot");
  if (notDone.length) parts.push(`${notDone.length === 1 ? "1 card isn't" : `${notDone.length} cards aren't`} marked done yet (${cardList(notDone.map((c) => c.name ?? c.code ?? "a card"), 3)}).`);
  if (inSlot.length) {
    const where = [...new Set(inSlot.map((c) => c.location?.name).filter(Boolean) as string[])];
    parts.push(`${inSlot.length === 1 ? "1 card is" : `${inSlot.length} cards are`} still in a holder${where.length ? ` (${cardList(where, 3)})` : ""}.`);
  }
  return parts.join(" ") || "The ship check isn't passing yet.";
}

const tierNamer = (c: BagContext) => (tier: string) => tierDisplayName(tier, c.ctx.tierNames);
const claimAge = (s: BagShipmentRow, now: Date) => now.getTime() - Date.parse(s.claimed_at);
const atTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

function claimMessage(s: BagShipmentRow, now: Date): { error: string; stale: boolean } {
  if (claimAge(s, now) < CLAIM_STALE_MS) {
    return { stale: false, error: "This bag's label is being bought right now. Wait a few seconds, then reload." };
  }
  return {
    stale: true,
    error: `A label purchase for this bag started at ${atTime(s.claimed_at)} and never finished, so it may or may not have been bought. Check Shippo's label history first; if this bag has no label there, buy again.`,
  };
}

/** Cards for this bag's customs form and its insurance share. */
async function readValueCards(admin: SupabaseClient, orderId: string): Promise<ValueCard[]> {
  return fetchAll<ValueCard>((from, to) =>
    admin.from("cards").select("id, bag_id, status, card_name, estimated_value_cents").eq("order_id", orderId).order("id").range(from, to));
}

/**
 * The cards declared on this bag's customs form: on an order with one bag,
 * every card of the order (exactly what the order page's label declares);
 * with several bags, this bag's cards.
 */
function customsCardsFor(valueCards: readonly ValueCard[], bagId: string, liveBagCount: number): CustomsCard[] {
  const cards = liveBagCount <= 1 ? valueCards : valueCards.filter((c) => c.bag_id === bagId);
  return cards.map((c) => ({ card_name: c.card_name ?? "", estimated_value_cents: c.estimated_value_cents ?? null }));
}

// ─── GET: the packing page ───────────────────────────────────────────────────

export async function loadPacking(
  admin: SupabaseClient,
  bagId: string,
  opts: { rates?: boolean } = {},
  deps: Deps = {},
): Promise<ServiceAnswer<PackingResponse>> {
  const now = deps.now?.() ?? new Date();
  let c: BagContext | null;
  try {
    c = await loadBagContext(admin, bagId);
  } catch (e) {
    return refuse(500, `Couldn't load this bag. (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!c) return refuse(404, "Bag not found");

  const check = bagCheck(c);
  const live = liveShipmentOf(c.shipments, c.bag.id);
  const failed = !live ? [...c.shipments].reverse().find((s) => s.bag_id === c.bag.id && s.status === "failed") ?? null : null;
  const orderLabel = live ? null : wholeOrderLabel(c.order, c.shipments);
  const addr = returnAddress(c.order);
  const statusBlock = orderStatusBlock(c.order.status);

  let next: PackingNext = "blocked";
  let blocked: string | null = null;
  if (live) {
    if (live.status === "claimed") {
      next = "wait";
      blocked = claimMessage(live, now).error;
    } else {
      next = live.status === "purchased" ? "print_and_ship" : live.status === "shipped" ? "shipped" : "delivered";
    }
  } else if (!c.shipmentsReady) blocked = SHIPMENTS_MIGRATION_ERROR.replace(" Nothing was bought.", "");
  else if (orderLabel) blocked = "This order's return label was already bought on the order page. It covers the whole order, so this bag doesn't need its own.";
  else if (statusBlock) blocked = statusBlock;
  else if (!check.ready) blocked = shipCheckBlock(check);
  else if (!addr?.street1) blocked = "No customer address on file";
  else next = "buy";
  const canBuy = next === "buy";

  const response: PackingResponse = {
    bag: { id: c.bag.id, code: c.bag.bag_code, tier: c.bag.tier, tierName: tierDisplayName(c.bag.tier, c.ctx.tierNames) },
    order: {
      id: c.order.id, orderNumber: String(c.order.order_number), customer: c.order.customer_name ?? null, status: c.order.status,
      international: isInternational(addr), hasAddress: !!addr?.street1,
    },
    check,
    shipment: live ? shipmentView(live) : null,
    lastFailure: failed ? { at: failed.claimed_at, error: failed.error ?? "The purchase failed." } : null,
    orderLabel,
    packages: packageSummaries(c.bags, c.ctx.cards, c.shipments, tierNamer(c)),
    shipmentsReady: c.shipmentsReady,
    canBuy,
    blocked,
    next,
  };

  if (opts.rates && canBuy) {
    try {
      const orderId = c.order.id;
      const liveCount = liveBags(c.bags, c.ctx.cards).bags.length;
      const quoted = await getReturnRates({
        order: c.order,
        customsCards: async () => customsCardsFor(await readValueCards(admin, orderId), c.bag.id, liveCount),
      }, deps.shippo ?? liveShippo);
      if (quoted.ok) response.rates = quoted.rates;
      else response.ratesError = quoted.error;
    } catch (e) {
      response.ratesError = `Failed to get rates: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { ok: true, status: 200, body: response };
}

// ─── POST ship-label: claim, then buy ────────────────────────────────────────

export async function buyBagLabel(
  admin: SupabaseClient,
  input: { bagId: string; by: string | null; rateObjectId?: string | null; insuranceDeclaredValueCents?: unknown; retryStaleClaim?: boolean },
  deps: Deps = {},
): Promise<ServiceAnswer<BuyBagLabelResponse>> {
  if (deps.preview ?? PREVIEW_MODE) return refuse(503, PREVIEW_MESSAGE);
  const port = deps.shippo ?? liveShippo;
  const now = () => deps.now?.() ?? new Date();

  let c: BagContext | null;
  try {
    c = await loadBagContext(admin, input.bagId);
  } catch (e) {
    return refuse(500, `Couldn't load this bag. Nothing was bought. (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!c) return refuse(404, "Bag not found");
  if (!c.shipmentsReady) return refuse(500, SHIPMENTS_MIGRATION_ERROR, { shipmentsReady: false });
  const { bag, order } = c;

  // Already bought (or being bought): never a second label
  const live = liveShipmentOf(c.shipments, bag.id);
  if (live && live.status !== "claimed") {
    return { ok: true, status: 200, body: { shipment: shipmentView(live), existing: true, orderLabel: !!live.order_label, message: "This bag's label was already bought." } };
  }
  if (live) {
    const claim = claimMessage(live, now());
    if (!claim.stale) return refuse(409, claim.error, { inProgress: true });
    if (input.retryStaleClaim !== true) return refuse(409, claim.error, { staleClaim: true, claimedAt: live.claimed_at });
    const { error: relErr } = await admin.from("bag_shipments")
      .update({ status: "failed", error: `Never finished; released by ${input.by ?? "staff"} to buy again.` })
      .eq("id", live.id).eq("status", "claimed");
    if (relErr) return refuse(500, `Couldn't release the unfinished purchase (${relErr.message}). Nothing was bought.`);
  }

  const orderLabel = wholeOrderLabel(order, c.shipments);
  if (orderLabel) {
    return refuse(409, "This order's return label was already bought on the order page. It covers the whole order, so this bag doesn't need its own.", { orderLabel });
  }
  const statusBlock = orderStatusBlock(order.status);
  if (statusBlock) return refuse(409, statusBlock);
  const check = bagCheck(c);
  const block = shipCheckBlock(check);
  if (block) return refuse(409, block, { check });
  if (!returnAddress(order)?.street1) return refuse(400, "No customer address on file");

  // Claim first: the unique index lets one live row per bag exist
  const { data: claimed, error: claimErr } = await admin.from("bag_shipments")
    .insert({ bag_id: bag.id, order_id: order.id, status: "claimed", created_by: input.by, claimed_at: now().toISOString() })
    .select(SHIPMENT_COLUMNS)
    .single();
  if (claimErr || !claimed) {
    if (claimErr?.code === "23505") {
      const again = await readShipments(admin, [order.id]).catch(() => ({ rows: [] as BagShipmentRow[], ready: true }));
      const other = liveShipmentOf(again.rows, bag.id);
      if (other && other.status !== "claimed") {
        return { ok: true, status: 200, body: { shipment: shipmentView(other), existing: true, orderLabel: !!other.order_label, message: "This bag's label was already bought." } };
      }
      return refuse(409, "This bag's label is being bought right now. Wait a few seconds, then reload.", { inProgress: true });
    }
    if (isMissingShipmentsTable(claimErr)) return refuse(500, SHIPMENTS_MIGRATION_ERROR, { shipmentsReady: false });
    return refuse(500, `Couldn't start the purchase (${claimErr?.message ?? "no row"}). Nothing was bought.`);
  }
  const claim = claimed as BagShipmentRow;
  const fail = async (error: string) => {
    const { error: e } = await admin.from("bag_shipments").update({ status: "failed", error: error.slice(0, 1000) }).eq("id", claim.id).eq("status", "claimed");
    if (e) console.error("[bag label] couldn't mark the claim failed:", e.message);
  };

  // What goes in the box: customs and the insurance share
  let valueCards: ValueCard[];
  try {
    valueCards = await readValueCards(admin, order.id);
  } catch (e) {
    const msg = `Couldn't read the bag's cards (${e instanceof Error ? e.message : String(e)}). Nothing was bought.`;
    await fail(msg);
    return refuse(500, msg);
  }
  const liveCount = liveBags(c.bags, c.ctx.cards).bags.length;
  const liveValueCards = valueCards.filter((x) => x.status !== "refunded");
  const bagValueCards = liveValueCards.filter((x) => x.bag_id === bag.id);
  const customsCards = async () => customsCardsFor(valueCards, bag.id, liveCount);
  const insuranceCents = returnInsuranceCents(bagInsuranceFloorCents(order, bagValueCards, liveValueCards, liveCount), input.insuranceDeclaredValueCents);

  // The rate: the one chosen on the page, else (one tap) the service the customer paid for, else the cheapest
  let rateObjectId = typeof input.rateObjectId === "string" && input.rateObjectId.trim() ? input.rateObjectId.trim() : null;
  let knownAmount: string | null = null;
  if (!rateObjectId) {
    let quoted;
    try {
      quoted = await getReturnRates({ order, customsCards }, port);
    } catch (e) {
      const msg = `Failed to get rates: ${e instanceof Error ? e.message : String(e)}`;
      await fail(msg);
      return refuse(500, msg);
    }
    if (!quoted.ok) {
      await fail(quoted.error);
      return refuse(quoted.status, quoted.error);
    }
    const pick = quoted.rates.find((r) => r.paid) ?? quoted.rates[0];
    rateObjectId = pick.objectId;
    knownAmount = pick.amount;
  }

  const bought = await purchaseReturnLabel({
    order, rateObjectId, insuranceCents, customsCards, metadata: `Bag ${bag.bag_code}`, knownAmount,
  }, port);
  if (!bought.ok) {
    if (bought.definite) {
      await fail(bought.error);
      return refuse(bought.status, bought.error);
    }
    // No clear answer once the purchase was sent: keep the claim, so nobody buys again blind
    await admin.from("bag_shipments").update({ error: bought.error.slice(0, 1000) }).eq("id", claim.id).eq("status", "claimed");
    return refuse(bought.status, `${bought.error} Shippo didn't answer clearly, so a label may or may not have been bought: check Shippo's label history before trying again.`, { uncertain: true });
  }

  // Save the label on the claim (only this claim: still 'claimed')
  const { data: saved, error: saveErr } = await admin.from("bag_shipments")
    .update({
      status: "purchased",
      label_url: bought.labelUrl,
      tracking_number: bought.trackingNumber,
      tracking_url: bought.trackingUrl,
      carrier: bought.carrier.provider,
      service: bought.carrier.service,
      shippo_transaction_id: bought.transactionId,
      shippo_rate_id: bought.rateId,
      cost_cents: bought.amountCents,
      insurance_cents: !bought.international && insuranceCents > 0 ? insuranceCents : null,
      purchased_at: now().toISOString(),
      error: null,
    })
    .eq("id", claim.id).eq("status", "claimed")
    .select(SHIPMENT_COLUMNS);
  const savedRow = (saved as BagShipmentRow[] | null)?.[0];
  if (saveErr || !savedRow) {
    console.error("[bag label] label bought but not saved:", saveErr?.message ?? "claim no longer open", bought.labelUrl);
    return refuse(500, `The label was bought but couldn't be saved on the bag (${saveErr?.message ?? "the purchase was released meanwhile"}). Don't buy another: open it here and keep the link: ${bought.labelUrl}`, { labelUrl: bought.labelUrl, unsaved: true });
  }
  let shipment = savedRow;

  // The order's first label is also its return label (the old site, the order page and the syncs read it)
  const outbound = {
    return_label_url: bought.labelUrl,
    outbound_tracking_number: bought.trackingNumber ?? null,
    outbound_carrier: bought.carrier.provider,
    outbound_service_level: bought.carrier.service,
    outbound_tracking_url: bought.trackingUrl,
  };
  let mirror = await admin.from("orders").update(outbound).eq("id", order.id).is("return_label_url", null).select("id");
  if (mirror.error) {
    console.error("[bag label] saving the order's label with carrier failed, retrying without:", mirror.error.message);
    mirror = await admin.from("orders").update({ return_label_url: bought.labelUrl }).eq("id", order.id).is("return_label_url", null).select("id");
  }
  if (mirror.error) console.error("[bag label] the order's return label wasn't saved:", mirror.error.message);
  const isOrderLabel = !mirror.error && (mirror.data?.length ?? 0) > 0;
  if (isOrderLabel) {
    const { data: marked, error: markErr } = await admin.from("bag_shipments").update({ order_label: true }).eq("id", shipment.id).select(SHIPMENT_COLUMNS);
    if (markErr) console.error("[bag label] couldn't mark the order's label:", markErr.message);
    else if ((marked as BagShipmentRow[] | null)?.[0]) shipment = (marked as BagShipmentRow[])[0];
  }

  const what = [bought.carrier.provider, bought.carrier.service].filter(Boolean).join(" ");
  const { error: eventErr } = await admin.from("order_events").insert({
    order_id: order.id,
    event_type: "bag_label_bought",
    description: `Return label bought for bag ${bag.bag_code}${what ? ` (${what})` : ""}.${bought.trackingNumber ? ` Tracking: ${bought.trackingNumber}` : ""}`,
    is_customer_visible: false,
    metadata: { bag_id: bag.id, shipment_id: shipment.id, by: input.by, order_label: isOrderLabel },
  });
  if (eventErr) console.error("[bag label] event not logged:", eventErr.message);

  return {
    ok: true,
    status: 200,
    body: { shipment: shipmentView(shipment), existing: false, orderLabel: isOrderLabel, message: "Label bought. Print it, pack the bag, then tap Mark shipped." },
  };
}

// ─── POST shipped: the email, then the order ─────────────────────────────────

export async function markBagShipped(
  admin: SupabaseClient,
  input: { bagId: string; by: string | null },
  deps: Deps = {},
): Promise<ServiceAnswer<MarkShippedResponse>> {
  if (deps.preview ?? PREVIEW_MODE) return refuse(503, PREVIEW_MESSAGE);
  const now = () => deps.now?.() ?? new Date();

  let c: BagContext | null;
  try {
    c = await loadBagContext(admin, input.bagId);
  } catch (e) {
    return refuse(500, `Couldn't load this bag. Nothing was changed. (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!c) return refuse(404, "Bag not found");
  if (!c.shipmentsReady) return refuse(500, SHIPMENTS_MIGRATION_ERROR.replace("Nothing was bought.", "Nothing was changed."), { shipmentsReady: false });
  const { bag, order } = c;
  const packages = (rows: readonly BagShipmentRow[]) => packageSummaries(c!.bags, c!.ctx.cards, rows, tierNamer(c!));

  const live = liveShipmentOf(c.shipments, bag.id);
  if (!live) return refuse(409, "Buy this bag's return label first.");
  if (live.status === "claimed") return refuse(409, "The label is still being bought. Wait a few seconds, then try again.");
  const already = (row: BagShipmentRow): ServiceAnswer<MarkShippedResponse> => ({
    ok: true,
    status: 200,
    body: {
      shipment: shipmentView(row), alreadyShipped: true, emailed: false, orderShipped: ["shipped_back", "delivered"].includes(order.status),
      orderStatus: order.status, packages: packages(c!.shipments.map((s) => (s.id === row.id ? row : s))),
      message: "This bag was already marked shipped. No second email was sent.",
    },
  });
  if (live.status !== "purchased") return already(live);

  // One tap wins: only the move purchased -> shipped sends the email
  const { data: won, error: winErr } = await admin.from("bag_shipments")
    .update({ status: "shipped", shipped_at: now().toISOString(), shipped_by: input.by })
    .eq("id", live.id).eq("status", "purchased")
    .select(SHIPMENT_COLUMNS);
  if (winErr) return refuse(500, `Couldn't mark it shipped (${winErr.message}). Try again.`);
  let shipment = (won as BagShipmentRow[] | null)?.[0];
  if (!shipment) {
    const again = await readShipments(admin, [order.id]).catch(() => ({ rows: [] as BagShipmentRow[], ready: true }));
    return already(liveShipmentOf(again.rows, bag.id) ?? live);
  }
  // Read the order's shipments again now: two bags marked at the same moment
  // must not each see the other as unshipped (then neither ships the order)
  const won1 = shipment;
  const fresh = await readShipments(admin, [order.id]).catch(() => null);
  const shipments = fresh?.rows.length
    ? fresh.rows.map((s) => (s.id === won1.id && s.status === "purchased" ? won1 : s))
    : c.shipments.map((s) => (s.id === won1.id ? won1 : s));

  const { bags: liveBagList } = liveBags(c.bags, c.ctx.cards);
  const multi = liveBagList.length > 1;
  const allShipped = everyBagShipped(c.bags, c.ctx.cards, shipments);
  const bagCards = c.ctx.cards.filter((x) => x.bag_id === bag.id && x.status !== "refunded");
  const names = cardList(bagCards.map((x) => x.card_name ?? "").filter(Boolean));
  const tracking = shipment.tracking_number;

  // The customer's shipped email, with this bag's tracking (the order page's email)
  let emailed = false;
  let emailFailed = false;
  if (order.customer_email && tracking) {
    const note = multi
      ? `This package has ${bagCards.length === 1 ? "1 of your cards" : `${bagCards.length} of your cards`}${names ? `: ${names}` : ""}. ${allShipped ? "It's the last package of your order." : "Your other cards will ship separately."}`
      : null;
    const sent = await sendReturnShippedEmail(order, { trackingNumber: tracking, trackingUrl: shipment.tracking_url }, note);
    emailed = sent.sent;
    emailFailed = !sent.sent;
    if (sent.sent) {
      const { data: stamped } = await admin.from("bag_shipments").update({ email_sent_at: now().toISOString() }).eq("id", shipment.id).select(SHIPMENT_COLUMNS);
      if ((stamped as BagShipmentRow[] | null)?.[0]) shipment = (stamped as BagShipmentRow[])[0];
    }
  }

  // The order's timeline: the customer sees each package of a split order
  const { error: eventErr } = await admin.from("order_events").insert({
    order_id: order.id,
    event_type: "bag_shipped",
    description: multi
      ? `Return package shipped with ${bagCards.length === 1 ? "1 of your cards" : `${bagCards.length} of your cards`}${names ? ` (${names})` : ""}.${tracking ? ` Tracking: ${tracking}` : ""}`
      : `Bag ${bag.bag_code} shipped.${tracking ? ` Tracking: ${tracking}` : ""}`,
    is_customer_visible: multi,
    metadata: { bag_id: bag.id, shipment_id: shipment.id, by: input.by, emailed },
  });
  if (eventErr) console.error("[bag shipped] event not logged:", eventErr.message);

  // Every bag with live cards gone: the order is shipped back (status button's code, no second email)
  let orderStatus = order.status;
  let orderShipped = ["shipped_back", "delivered"].includes(order.status);
  let notesEmailed: string | undefined;
  if (allShipped && SHIP_BACK_FROM.includes(order.status)) {
    const first = shipments.find((s) => s.order_label && s.tracking_number);
    const res = await setOrderStatus({
      orderId: order.id,
      status: "shipped_back",
      ...(first?.tracking_number ? { trackingNumber: first.tracking_number } : {}),
      onlyIfCurrent: order.status,
      customerEmail: false,
    }, admin);
    if (res.ok) {
      orderShipped = true;
      orderStatus = "shipped_back";
      if (res.notesEmailed) notesEmailed = res.notesEmailed;
    } else {
      console.error("[bag shipped] order not moved to shipped back:", res.error);
    }
  }

  const left = packages(shipments).filter((p) => p.status !== "shipped" && p.status !== "delivered").length;
  const loose = liveBags(c.bags, c.ctx.cards).looseCards.length;
  const message = [
    emailed ? "Marked shipped and the customer was emailed the tracking." : emailFailed ? "Marked shipped, but the customer's email didn't send." : "Marked shipped.",
    orderShipped && orderStatus === "shipped_back" && order.status !== "shipped_back" ? "Every bag has shipped: the order is Shipped Back." : "",
    !allShipped && left > 0 ? `${left === 1 ? "1 more bag" : `${left} more bags`} of this order still to ship.` : "",
    !allShipped && left === 0 && loose > 0
      ? `${loose === 1 ? "1 card" : `${loose} cards`} of this order ${loose === 1 ? "isn't" : "aren't"} in a bag (not received yet, or never bagged), so the order's status stays as it is.`
      : "",
  ].filter(Boolean).join(" ");

  return {
    ok: true,
    status: 200,
    body: {
      shipment: shipmentView(shipment), alreadyShipped: false, emailed, ...(emailFailed ? { emailFailed: true as const } : {}),
      orderShipped, orderStatus, ...(notesEmailed ? { notesEmailed } : {}), packages: packages(shipments), message,
    },
  };
}

// ─── The order page's route: no whole-order label while a bag label is live ──

/**
 * A bag of this order has a live label (or one being bought) not yet on the
 * order: the order page must not buy a whole-order label meanwhile. False
 * when the table isn't there yet (nothing to protect).
 */
export async function bagLabelInFlight(admin: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await admin.from("bag_shipments").select("id")
    .eq("order_id", orderId).in("status", [...LIVE_SHIPMENT_STATUSES]).limit(1);
  if (error) {
    if (!isMissingShipmentsTable(error)) console.error("[return-label] couldn't check bag labels:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// ─── Delivered (sync-delivered) ──────────────────────────────────────────────

type DeliveryCard = { id: string; order_id: string; bag_id: string | null; status: string | null; awaiting_arrival: boolean | null; completed: boolean | null };
type DeliveryBag = { id: string; order_id: string; bag_code: string; tier: string };

/**
 * The bag shipments in Shippo's tracking map: each shipped one whose tracking
 * says DELIVERED becomes delivered; an order whose every bag with live cards
 * is delivered (and that is Shipped Back) becomes Delivered with the usual
 * event (`markOrdersDelivered`). `orderIds` (the orders the caller would mark
 * from orders.tracking_number) are checked too; `bagOrderIds` in the answer
 * are those with bag shipments, which the caller must leave to this function.
 * Never throws (before the migration it does nothing).
 */
export async function syncBagDeliveries(
  admin: SupabaseClient,
  trackingToStatus: ReadonlyMap<string, string>,
  orderIds: readonly string[],
  markOrdersDelivered: (ids: string[]) => Promise<string[]>,
  deps: Deps = {},
): Promise<{ shipmentsDelivered: number; ordersDelivered: string[]; bagOrderIds: Set<string> }> {
  const empty = { shipmentsDelivered: 0, ordersDelivered: [] as string[], bagOrderIds: new Set<string>() };
  const now = deps.now?.() ?? new Date();
  try {
    let open: BagShipmentRow[];
    try {
      open = await fetchAll<BagShipmentRow>((from, to) =>
        admin.from("bag_shipments").select(SHIPMENT_COLUMNS).eq("status", "shipped").order("id").range(from, to));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!isMissingShipmentsTable({ message })) console.error("[sync-delivered] bag shipments not read:", message);
      return empty;
    }

    // 1. Each package
    const arrived = open.filter((s) => s.tracking_number && trackingToStatus.get(s.tracking_number) === "DELIVERED").map((s) => s.id);
    let shipmentsDelivered = 0;
    for (const ids of chunks(arrived, 50)) {
      const { data, error } = await admin.from("bag_shipments").update({ status: "delivered", delivered_at: now.toISOString() })
        .in("id", ids).eq("status", "shipped").select("id");
      if (error) console.error("[sync-delivered] bag shipment update failed:", error.message);
      shipmentsDelivered += data?.length ?? 0;
    }

    // 2. Their orders (and the caller's), once every package is in
    const candidates = [...new Set([...open.map((s) => s.order_id), ...orderIds])];
    const shipments = (await readShipments(admin, candidates)).rows;
    const bagOrderIds = new Set(shipments.filter((s) => LIVE_SHIPMENT_STATUSES.includes(s.status)).map((s) => s.order_id));
    const ids = [...bagOrderIds];
    if (ids.length === 0) return { shipmentsDelivered, ordersDelivered: [], bagOrderIds };
    const [orders, bags, cards] = await Promise.all([
      Promise.all(chunks(ids).map(async (part) => {
        const { data, error } = await admin.from("orders").select("id, status").in("id", part);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; status: string }[];
      })).then((p) => p.flat()),
      Promise.all(chunks(ids).map((part) => fetchAll<DeliveryBag>((from, to) =>
        admin.from("tier_bags").select("id, order_id, bag_code, tier").in("order_id", part).order("id").range(from, to)))).then((p) => p.flat()),
      Promise.all(chunks(ids).map((part) => fetchAll<DeliveryCard>((from, to) =>
        admin.from("cards").select("id, order_id, bag_id, status, awaiting_arrival, completed").in("order_id", part).order("id").range(from, to)))).then((p) => p.flat()),
    ]);
    const done = orders
      .filter((o) => o.status === "shipped_back")
      .filter((o) => everyBagDelivered(bags.filter((b) => b.order_id === o.id), cards.filter((x) => x.order_id === o.id), shipments.filter((s) => s.order_id === o.id)))
      .map((o) => o.id);
    const ordersDelivered = done.length ? await markOrdersDelivered(done) : [];
    return { shipmentsDelivered, ordersDelivered, bagOrderIds };
  } catch (e) {
    console.error("[sync-delivered] bag deliveries failed:", e instanceof Error ? e.message : e);
    return empty;
  }
}

/**
 * Bag shipments whose label has no tracking number yet (sync-return-tracking
 * fills them from Shippo by label URL). [] before the migration.
 */
export async function shipmentsMissingTracking(admin: SupabaseClient): Promise<Pick<BagShipmentRow, "id" | "order_id" | "label_url" | "status">[]> {
  try {
    return await fetchAll<Pick<BagShipmentRow, "id" | "order_id" | "label_url" | "status">>((from, to) =>
      admin.from("bag_shipments").select("id, order_id, label_url, status")
        .in("status", ["purchased", "shipped"]).is("tracking_number", null).not("label_url", "is", null)
        .order("id").range(from, to));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingShipmentsTable({ message })) console.error("[sync-return-tracking] bag shipments not read:", message);
    return [];
  }
}

/** How many bag shipments are out (shipped, not delivered yet); 0 before the migration. */
export async function countOpenBagShipments(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin.from("bag_shipments").select("id", { count: "exact", head: true }).eq("status", "shipped");
  if (error) {
    if (!isMissingShipmentsTable(error)) console.error("[sync-delivered] bag shipments not counted:", error.message);
    return 0;
  }
  return count ?? 0;
}
