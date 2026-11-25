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
  findLabelByMetadata, getReturnRates, isInternational, liveShippo, purchaseReturnLabel, returnAddress, returnInsuranceCents,
  type BoughtLabel, type CustomsCard, type ReturnLabelOrder, type ShippoPort,
} from "@/lib/intake/shipping/bag-label";
import { sendReturnShippedEmail } from "@/lib/intake/shipping/shipped-email";
import {
  appendNote, bagInsuranceFloorCents, cardList, CLAIM_STALE_MS, everyBagDelivered, everyBagShipped, latestSentShipment,
  LIVE_SHIPMENT_STATUSES, liveBags, orderStatusBlock, packageSummaries, SHIP_BACK_FROM, SHIPMENT_COLUMNS, shipmentView,
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
 * claim (the label may exist): once it is stale, Shippo's history is read
 * ("Bag <code>" metadata) and a label found there is saved instead of buying
 * another. A label bought but not saved stays on its claim and is saved by
 * the next tap. The order page's whole-order label claims the ORDER (a row
 * with no bag, lib/intake/shipping/order-label.ts): each side checks for the
 * other's claim after writing its own, so the two never both buy.
 *
 * The old site (thecarddoc1.com) reads only the order's single return label:
 * the order's FIRST bag label is written to orders.return_label_url and
 * outbound_* when it is bought (so neither site sells a second whole-order
 * label); orders.tracking_number (the LAST bag's tracking) and the status
 * change when the order is shipped back (every bag with live cards shipped),
 * so the admin order page's "return label detected" auto-ship (both sites)
 * never ships an order with bags still in the shop, and "delivered from
 * orders.tracking_number" (both sites) waits for the last package. Preview
 * mode refuses every write here.
 */

type Deps = { shippo?: ShippoPort; preview?: boolean; now?: () => Date };

export type ServiceAnswer<T> =
  | { ok: true; status: 200; body: T }
  | { ok: false; status: number; body: { error: string } & Record<string, unknown> };

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): ServiceAnswer<never> =>
  ({ ok: false, status, body: { error, ...extra } });

export const SHIPMENTS_MIGRATION_ERROR =
  "Per-bag labels need the database update supabase/migrations/20261125_bag_shipments.sql, which isn't applied yet. Nothing was bought.";

const ORDER_LABEL_ERROR =
  "This order's return label was already bought on the order page. It covers the whole order, so this bag doesn't need its own.";

/** After "Mark shipped", the tap that did it may still be emailing and shipping the order back: leave it that long. */
const SHIP_BACK_SETTLE_MS = 60_000;

/** The bag_shipments table isn't in the database (yet). */
export function isMissingShipmentsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["42P01", "PGRST205"].includes(error.code ?? "")) return true;
  return /bag_shipments/.test(error.message ?? "") && /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type OrderRow = ReturnLabelOrder & {
  id: string;
  inbound_method?: string | null;
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

/**
 * Every BAG shipment of some orders (paged), and whether the table exists.
 * The order page's claims (rows with no bag) are left out: they are read
 * with readOrderClaim.
 */
async function readShipments(admin: SupabaseClient, orderIds: readonly string[]): Promise<{ rows: BagShipmentRow[]; ready: boolean }> {
  try {
    const parts = await Promise.all(chunks([...new Set(orderIds)]).map((part) => fetchAll<BagShipmentRow>((from, to) =>
      admin.from("bag_shipments").select(SHIPMENT_COLUMNS).in("order_id", part).not("bag_id", "is", null)
        .order("claimed_at").order("id").range(from, to))));
    return { rows: parts.flat(), ready: true };
  } catch (e) {
    const message = errText(e);
    if (isMissingShipmentsTable({ message })) return { rows: [], ready: false };
    throw e;
  }
}

/** The order page's live claim on the order's whole-order label (a bag_shipments row with no bag), if any. */
export type OrderClaimRow = Omit<BagShipmentRow, "bag_id"> & { bag_id: null };

export async function readOrderClaim(admin: SupabaseClient, orderId: string): Promise<{ row: OrderClaimRow | null; ready: boolean; error: string | null }> {
  const { data, error } = await admin.from("bag_shipments").select(SHIPMENT_COLUMNS)
    .eq("order_id", orderId).is("bag_id", null).in("status", [...LIVE_SHIPMENT_STATUSES]).order("claimed_at").limit(1);
  if (error) {
    if (isMissingShipmentsTable(error)) return { row: null, ready: false, error: null };
    return { row: null, ready: true, error: error.message };
  }
  return { row: ((data ?? [])[0] as OrderClaimRow | undefined) ?? null, ready: true, error: null };
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
function wholeOrderLabel(order: Pick<OrderRow, "return_label_url" | "tracking_number">, shipments: readonly BagShipmentRow[]) {
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

/** The route's words, plus why for a drop-off (the customer usually picks it up). */
const noAddress = (order: { inbound_method?: unknown }) =>
  order.inbound_method === "dropoff"
    ? "No customer address on file: this is a drop-off order, so the customer may be picking it up."
    : "No customer address on file";

const tierNamer = (c: BagContext) => (tier: string) => tierDisplayName(tier, c.ctx.tierNames);
const claimAge = (s: { claimed_at: string }, now: Date) => now.getTime() - Date.parse(s.claimed_at);
export const atTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// ─── Claims that bought a label they couldn't save ───────────────────────────

type ClaimLike = Pick<BagShipmentRow,
  "label_url" | "tracking_number" | "tracking_url" | "carrier" | "service" | "shippo_transaction_id" | "shippo_rate_id" | "cost_cents" | "error">;

const UNSAVED_NOTE = "Bought but not saved: ";

/**
 * The label a claim's purchase bought but couldn't save: the label fields
 * kept on the claim, else the URL in its "Bought but not saved: <url>" note.
 * Saving that one is the only right next step: buying again would be a
 * second label for the same package.
 */
export function boughtOnClaim(row: ClaimLike): BoughtLabel | null {
  if (row.label_url) {
    return {
      labelUrl: row.label_url, trackingNumber: row.tracking_number, trackingUrl: row.tracking_url,
      carrier: { provider: row.carrier, service: row.service }, transactionId: row.shippo_transaction_id,
      rateId: row.shippo_rate_id ?? "", amountCents: row.cost_cents, international: false,
    };
  }
  const notes = [...(row.error ?? "").matchAll(/Bought but not saved: (https?:\/\/[^\s|]+)/g)];
  const url = notes.at(-1)?.[1];
  if (!url) return null;
  return {
    labelUrl: url, trackingNumber: null, trackingUrl: null, carrier: { provider: null, service: null },
    transactionId: null, rateId: "", amountCents: null, international: false,
  };
}

/** The columns a bought label fills on its shipment row. */
export const labelColumns = (b: BoughtLabel) => ({
  label_url: b.labelUrl,
  tracking_number: b.trackingNumber,
  tracking_url: b.trackingUrl,
  carrier: b.carrier.provider,
  service: b.carrier.service,
  shippo_transaction_id: b.transactionId,
  shippo_rate_id: b.rateId || null,
  cost_cents: b.amountCents,
});

/**
 * Best effort when a bought label couldn't be saved: keep it on the claim
 * row (whatever its status now) with a "Bought but not saved: <url>" note
 * added to its error, so the next tap saves it instead of buying again.
 */
export async function keepUnsavedLabel(admin: SupabaseClient, claimId: string, label: BoughtLabel, insuranceCents: number | null): Promise<void> {
  const { data: cur } = await admin.from("bag_shipments").select("error").eq("id", claimId).maybeSingle();
  const error = appendNote((cur as { error: string | null } | null)?.error ?? null, `${UNSAVED_NOTE}${label.labelUrl}`);
  const { error: e1 } = await admin.from("bag_shipments").update({ ...labelColumns(label), insurance_cents: insuranceCents, error }).eq("id", claimId);
  if (!e1) return;
  const { error: e2 } = await admin.from("bag_shipments").update({ error }).eq("id", claimId);
  if (e2) console.error("[bag label] couldn't keep the unsaved label on its claim:", e2.message, label.labelUrl);
}

/** Give a claim up after a purchase that never finished: 'failed', with the note added to its error (never replacing it). */
export async function releaseClaim(admin: SupabaseClient, row: { id: string; error: string | null }, note: string): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await admin.from("bag_shipments")
    .update({ status: "failed", error: appendNote(row.error, note) })
    .eq("id", row.id).eq("status", "claimed");
  return { ok: !error, error: error?.message ?? null };
}

/** Drop a claim that never reached Shippo (the other route holds the order): deleted, else marked failed. */
export async function dropClaim(admin: SupabaseClient, claim: { id: string; error: string | null }, note: string): Promise<void> {
  const { error } = await admin.from("bag_shipments").delete().eq("id", claim.id).eq("status", "claimed");
  if (!error) return;
  const released = await releaseClaim(admin, claim, note);
  if (!released.ok) console.error("[bag label] couldn't drop a claim that bought nothing:", released.error);
}

function claimMessage(s: BagShipmentRow, now: Date): { error: string; stale: boolean } {
  if (boughtOnClaim(s)) {
    return { stale: false, error: "This bag's label was bought but couldn't be saved. Tap Buy again to save it: nothing new is bought." };
  }
  if (claimAge(s, now) < CLAIM_STALE_MS) {
    return { stale: false, error: "This bag's label is being bought right now. Wait a few seconds, then reload." };
  }
  return {
    stale: true,
    error: `A label purchase for this bag started at ${atTime(s.claimed_at)} and never finished, so it may or may not have been bought. Check Shippo's label history first; if this bag has no label there, buy again.${s.error ? ` (Last note: ${s.error})` : ""}`,
  };
}

/** Cards for this bag's customs form and its insurance share. */
async function readValueCards(admin: SupabaseClient, orderId: string): Promise<ValueCard[]> {
  return fetchAll<ValueCard>((from, to) =>
    admin.from("cards").select("id, bag_id, status, card_name, estimated_value_cents").eq("order_id", orderId).order("id").range(from, to));
}

/**
 * The cards declared on this bag's customs form: when the bag is the whole
 * order (one bag with live cards, and no live card outside a bag), every
 * card of the order, exactly what the order page's label declares;
 * otherwise only this bag's cards (an unreceived card isn't in the box).
 */
function customsCardsFor(valueCards: readonly ValueCard[], bagId: string, bagIsWholeOrder: boolean): CustomsCard[] {
  const cards = bagIsWholeOrder ? valueCards : valueCards.filter((c) => c.bag_id === bagId);
  return cards.map((c) => ({ card_name: c.card_name ?? "", estimated_value_cents: c.estimated_value_cents ?? null }));
}

/** One bag with live cards and no live card outside a bag: the bag ships the whole order. */
function bagIsWholeOrder(c: BagContext): boolean {
  const { bags, looseCards } = liveBags(c.bags, c.ctx.cards);
  return bags.length <= 1 && looseCards.length === 0;
}

const bagMetadata = (bag: { bag_code: string }) => `Bag ${bag.bag_code}`;

// ─── Shipped back: every bag has gone ────────────────────────────────────────

type ShipBack = {
  orderShipped: boolean;
  orderStatus: string;
  /** This call moved the order to Shipped Back. */
  changed: boolean;
  /** The status email (with the last package's tracking) went to the customer. */
  statusEmailed: boolean;
  notesEmailed?: string;
  /** Why it didn't happen (or what didn't work), for the message. */
  problem: string | null;
};

const isSentBack = (status: string) => status === "shipped_back" || status === "delivered";

/**
 * When every bag with live cards has shipped (and no live card is outside a
 * bag): the order -> Shipped Back through the status button's code, from
 * received / in progress / completed only, with the LAST package's tracking
 * (orders.tracking_number: both sites mark an order delivered from it).
 * `emailSent`: the customer already got that package's shipped email, so the
 * status email isn't sent too; otherwise it is (with the tracking).
 * Idempotent (`onlyIfCurrent`); a status changed meanwhile is read again.
 */
async function shipBackIfDone(
  admin: SupabaseClient,
  c: BagContext,
  shipments: readonly BagShipmentRow[],
  last: { shipment: BagShipmentRow | null; emailSent: boolean },
): Promise<ShipBack> {
  let status = c.order.status;
  const none = (problem: string | null = null): ShipBack => ({ orderShipped: isSentBack(status), orderStatus: status, changed: false, statusEmailed: false, problem });
  if (!SHIP_BACK_FROM.includes(status) || !everyBagShipped(c.bags, c.ctx.cards, shipments)) return none();
  const tracking = (last.shipment ?? latestSentShipment(shipments))?.tracking_number ?? null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await setOrderStatus({
      orderId: c.order.id,
      status: "shipped_back",
      ...(tracking ? { trackingNumber: tracking } : {}),
      onlyIfCurrent: status,
      ...(last.emailSent ? { customerEmail: false as const } : {}),
    }, admin);
    if (!res.ok) {
      console.error("[bag shipped] order not moved to shipped back:", res.error);
      return none(`Every bag has shipped, but the order couldn't be set to Shipped Back (${res.error}). Reload this page to try again.`);
    }
    if (!res.skipped) {
      const statusEmailed = !last.emailSent && !!c.order.customer_email?.trim() && !res.emailFailed;
      return {
        orderShipped: true, orderStatus: "shipped_back", changed: true, statusEmailed,
        ...(res.notesEmailed ? { notesEmailed: res.notesEmailed } : {}),
        problem: !last.emailSent && res.emailFailed ? "The customer's shipped-back email didn't send." : null,
      };
    }
    // Not changed: the status moved meanwhile. Read it again
    const { data, error } = await admin.from("orders").select("status").eq("id", c.order.id).maybeSingle();
    if (error || !data) return none(`Every bag has shipped, but the order's status couldn't be read again${error ? ` (${error.message})` : ""}. Reload this page.`);
    status = (data as { status: string }).status;
    if (isSentBack(status)) return none();
    if (!SHIP_BACK_FROM.includes(status)) return none(`Every bag has shipped, but the order is "${status}" now, so it wasn't set to Shipped Back.`);
  }
  return none("Every bag has shipped, but the order's status kept changing, so it wasn't set to Shipped Back. Reload this page to try again.");
}

/**
 * The ship-back step again, for a page load or a repeated "Mark shipped":
 * a failed or skipped one is never left silent. Not while the tap that
 * marked the last bag shipped may still be at it (one email, one event).
 */
async function retryShipBack(admin: SupabaseClient, c: BagContext, shipments: readonly BagShipmentRow[], now: Date): Promise<ShipBack> {
  const unchanged: ShipBack = { orderShipped: isSentBack(c.order.status), orderStatus: c.order.status, changed: false, statusEmailed: false, problem: null };
  if (!SHIP_BACK_FROM.includes(c.order.status) || !everyBagShipped(c.bags, c.ctx.cards, shipments)) return unchanged;
  const last = latestSentShipment(shipments);
  if (!last) return unchanged;
  if (last.shipped_at && now.getTime() - Date.parse(last.shipped_at) < SHIP_BACK_SETTLE_MS) return unchanged;
  return shipBackIfDone(admin, c, shipments, { shipment: last, emailSent: !!last.email_sent_at });
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
    return refuse(500, `Couldn't load this bag. (${errText(e)})`);
  }
  if (!c) return refuse(404, "Bag not found");

  // Every bag has gone but the order isn't Shipped Back (that step failed or
  // was skipped): do it now, so it is never left behind silently
  let notice: string | undefined;
  if (c.shipmentsReady && !(deps.preview ?? PREVIEW_MODE)) {
    const back = await retryShipBack(admin, c, c.shipments, now);
    if (back.orderStatus !== c.order.status) c = { ...c, order: { ...c.order, status: back.orderStatus } };
    if (back.problem) notice = back.problem;
    else if (back.changed) notice = "Every bag has shipped: the order is now Shipped Back.";
  }
  const ctx = c;

  const check = bagCheck(ctx);
  const live = liveShipmentOf(ctx.shipments, ctx.bag.id);
  const failed = !live ? [...ctx.shipments].reverse().find((s) => s.bag_id === ctx.bag.id && s.status === "failed") ?? null : null;
  const orderLabel = live ? null : wholeOrderLabel(ctx.order, ctx.shipments);
  const addr = returnAddress(ctx.order);
  const statusBlock = orderStatusBlock(ctx.order.status);

  let next: PackingNext = "blocked";
  let blocked: string | null = null;
  if (live) {
    if (live.status === "claimed") {
      next = "wait";
      blocked = claimMessage(live, now).error;
    } else {
      next = live.status === "purchased" ? "print_and_ship" : live.status === "shipped" ? "shipped" : "delivered";
    }
  } else if (!ctx.shipmentsReady) blocked = SHIPMENTS_MIGRATION_ERROR.replace(" Nothing was bought.", "");
  else if (orderLabel) blocked = ORDER_LABEL_ERROR;
  else if (statusBlock) blocked = statusBlock;
  else if (!check.ready) blocked = shipCheckBlock(check);
  else if (!addr?.street1) blocked = noAddress(ctx.order);
  else next = "buy";
  const canBuy = next === "buy";

  const response: PackingResponse = {
    bag: { id: ctx.bag.id, code: ctx.bag.bag_code, tier: ctx.bag.tier, tierName: tierDisplayName(ctx.bag.tier, ctx.ctx.tierNames) },
    order: {
      id: ctx.order.id, orderNumber: String(ctx.order.order_number), customer: ctx.order.customer_name ?? null, status: ctx.order.status,
      international: isInternational(addr), hasAddress: !!addr?.street1,
    },
    check,
    shipment: live ? shipmentView(live) : null,
    lastFailure: failed ? { at: failed.claimed_at, error: failed.error ?? "The purchase failed." } : null,
    orderLabel,
    packages: packageSummaries(ctx.bags, ctx.ctx.cards, ctx.shipments, tierNamer(ctx)),
    shipmentsReady: ctx.shipmentsReady,
    canBuy,
    blocked,
    next,
    ...(live?.status === "claimed" && boughtOnClaim(live) ? { unsavedLabel: { labelUrl: boughtOnClaim(live)!.labelUrl } } : {}),
    ...(notice ? { notice } : {}),
  };

  if (opts.rates && canBuy) {
    try {
      const quoted = await getReturnRates({
        order: ctx.order,
        customsCards: async () => customsCardsFor(await readValueCards(admin, ctx.order.id), ctx.bag.id, bagIsWholeOrder(ctx)),
      }, deps.shippo ?? liveShippo);
      if (quoted.ok) response.rates = quoted.rates;
      else response.ratesError = quoted.error;
    } catch (e) {
      response.ratesError = `Failed to get rates: ${errText(e)}`;
    }
  }
  return { ok: true, status: 200, body: response };
}

// ─── POST ship-label: claim, then buy ────────────────────────────────────────

/**
 * Save a bought label on its claim (only while it is still 'claimed'), then
 * the order's first label to orders.return_label_url / outbound_*, and the
 * order's timeline. `recovered`: bought earlier by a purchase that never
 * finished (kept on the claim, or found in Shippo's history); nothing new
 * was bought now.
 */
async function finishBagPurchase(
  admin: SupabaseClient,
  c: BagContext,
  claim: BagShipmentRow,
  label: BoughtLabel,
  opts: { by: string | null; insuranceCents: number | null; now: () => Date; recovered: boolean },
): Promise<ServiceAnswer<BuyBagLabelResponse>> {
  const { bag, order } = c;
  const { data: saved, error: saveErr } = await admin.from("bag_shipments")
    .update({
      status: "purchased",
      ...labelColumns(label),
      insurance_cents: opts.insuranceCents,
      purchased_at: opts.now().toISOString(),
      error: null,
    })
    .eq("id", claim.id).eq("status", "claimed")
    .select(SHIPMENT_COLUMNS);
  const savedRow = (saved as BagShipmentRow[] | null)?.[0];
  if (saveErr || !savedRow) {
    console.error("[bag label] label bought but not saved:", saveErr?.message ?? "claim no longer open", label.labelUrl);
    // Kept on the claim, so the next tap saves it instead of buying again
    await keepUnsavedLabel(admin, claim.id, label, opts.insuranceCents);
    return refuse(500, `The label was bought but couldn't be saved on the bag (${saveErr?.message ?? "the purchase was released meanwhile"}). Don't buy another: open it here and keep the link: ${label.labelUrl}`, { labelUrl: label.labelUrl, unsaved: true });
  }
  let shipment = savedRow;

  // The order's first label is also its return label (the old site, the order page and the syncs read it)
  const outbound = {
    return_label_url: label.labelUrl,
    outbound_tracking_number: label.trackingNumber ?? null,
    outbound_carrier: label.carrier.provider,
    outbound_service_level: label.carrier.service,
    outbound_tracking_url: label.trackingUrl,
  };
  let mirror = await admin.from("orders").update(outbound).eq("id", order.id).is("return_label_url", null).select("id");
  if (mirror.error) {
    console.error("[bag label] saving the order's label with carrier failed, retrying without:", mirror.error.message);
    mirror = await admin.from("orders").update({ return_label_url: label.labelUrl }).eq("id", order.id).is("return_label_url", null).select("id");
  }
  if (mirror.error) console.error("[bag label] the order's return label wasn't saved:", mirror.error.message);
  const isOrderLabel = !mirror.error && (mirror.data?.length ?? 0) > 0;
  if (isOrderLabel) {
    const { data: marked, error: markErr } = await admin.from("bag_shipments").update({ order_label: true }).eq("id", shipment.id).select(SHIPMENT_COLUMNS);
    if (markErr) console.error("[bag label] couldn't mark the order's label:", markErr.message);
    else if ((marked as BagShipmentRow[] | null)?.[0]) shipment = (marked as BagShipmentRow[])[0];
  }

  const what = [label.carrier.provider, label.carrier.service].filter(Boolean).join(" ");
  const { error: eventErr } = await admin.from("order_events").insert({
    order_id: order.id,
    event_type: "bag_label_bought",
    description: `Return label bought for bag ${bag.bag_code}${what ? ` (${what})` : ""}.${label.trackingNumber ? ` Tracking: ${label.trackingNumber}` : ""}${opts.recovered ? " Saved after an unfinished purchase: nothing new was bought." : ""}`,
    is_customer_visible: false,
    metadata: { bag_id: bag.id, shipment_id: shipment.id, by: opts.by, order_label: isOrderLabel, ...(opts.recovered ? { recovered: true } : {}) },
  });
  if (eventErr) console.error("[bag label] event not logged:", eventErr.message);

  return {
    ok: true,
    status: 200,
    body: {
      shipment: shipmentView(shipment),
      existing: opts.recovered,
      orderLabel: isOrderLabel,
      message: opts.recovered
        ? "This bag's label had been bought but wasn't saved. It's saved now, and nothing new was bought. Print it, pack the bag, then tap Mark shipped."
        : "Label bought. Print it, pack the bag, then tap Mark shipped.",
    },
  };
}

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
    return refuse(500, `Couldn't load this bag. Nothing was bought. (${errText(e)})`);
  }
  if (!c) return refuse(404, "Bag not found");
  if (!c.shipmentsReady) return refuse(500, SHIPMENTS_MIGRATION_ERROR, { shipmentsReady: false });
  const ctx = c;
  const { bag, order } = ctx;

  // Already bought (or being bought): never a second label
  const live = liveShipmentOf(ctx.shipments, bag.id);
  if (live && live.status !== "claimed") {
    return { ok: true, status: 200, body: { shipment: shipmentView(live), existing: true, orderLabel: !!live.order_label, message: "This bag's label was already bought." } };
  }
  if (live) {
    // A purchase that bought a label it couldn't save: save that one
    const kept = boughtOnClaim(live);
    if (kept) return finishBagPurchase(admin, ctx, live, kept, { by: input.by, insuranceCents: live.insurance_cents, now, recovered: true });
    const claim = claimMessage(live, now());
    if (!claim.stale) return refuse(409, claim.error, { inProgress: true });
    // Stale: Shippo's history says whether that purchase bought a label
    const saved = new Set([...ctx.shipments.map((s) => s.label_url), order.return_label_url].filter(Boolean) as string[]);
    const lookup = await findLabelByMetadata(port, bagMetadata(bag), live.claimed_at, saved);
    if (lookup.kind === "found") return finishBagPurchase(admin, ctx, live, lookup.label, { by: input.by, insuranceCents: null, now, recovered: true });
    if (lookup.kind === "pending") return refuse(409, "Shippo is still making this bag's label. Wait a minute, then reload.", { inProgress: true });
    if (input.retryStaleClaim !== true) {
      const error = lookup.kind === "none"
        ? `A label purchase for this bag started at ${atTime(live.claimed_at)} and never finished. Shippo has no label for it, so buying again is safe.`
        : claim.error;
      return refuse(409, error, { staleClaim: true, claimedAt: live.claimed_at });
    }
    const released = await releaseClaim(admin, live,
      `Never finished; released by ${input.by ?? "staff"} to buy again${lookup.kind === "none" ? " (Shippo had no label for it)" : ""}.`);
    if (!released.ok) return refuse(500, `Couldn't release the unfinished purchase (${released.error}). Nothing was bought.`);
  }

  const orderLabel = wholeOrderLabel(order, ctx.shipments);
  if (orderLabel) return refuse(409, ORDER_LABEL_ERROR, { orderLabel });
  const statusBlock = orderStatusBlock(order.status);
  if (statusBlock) return refuse(409, statusBlock);
  const check = bagCheck(ctx);
  const block = shipCheckBlock(check);
  if (block) return refuse(409, block, { check });
  if (!returnAddress(order)?.street1) return refuse(400, noAddress(order));

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

  // The order page's whole-order label, checked AFTER our claim (it checks
  // for ours after its own), so the two can never both buy: its claim, and
  // a label it (or the old site) saved on the order since this bag was read
  const [orderClaim, freshOrder, freshShipments] = await Promise.all([
    readOrderClaim(admin, order.id),
    admin.from("orders").select("return_label_url, tracking_number").eq("id", order.id).maybeSingle(),
    readShipments(admin, [order.id]).catch((e: unknown) => new Error(errText(e))),
  ]);
  const checkErr = orderClaim.error ?? freshOrder.error?.message ?? (freshShipments instanceof Error ? freshShipments.message : null)
    ?? (freshOrder.data ? null : "the order wasn't found");
  if (checkErr) {
    await dropClaim(admin, claim, `Released: the order's label couldn't be checked (${checkErr}).`);
    return refuse(500, `Couldn't check the order's return label (${checkErr}). Nothing was bought.`);
  }
  if (orderClaim.row) {
    await dropClaim(admin, claim, "Released: the order page was buying the order's label.");
    const kept = boughtOnClaim(orderClaim.row);
    return refuse(409, kept
      ? "A return label for the whole order was bought on the order page but not saved yet. Open the order page and buy there: it saves that label, which covers every bag."
      : "A return label for the whole order is being bought on the order page right now. Reload in a moment: that label covers every bag.", { inProgress: true });
  }
  const sinceRead = wholeOrderLabel(freshOrder.data as Pick<OrderRow, "return_label_url" | "tracking_number">, (freshShipments as { rows: BagShipmentRow[] }).rows);
  if (sinceRead) {
    await dropClaim(admin, claim, "Released: the order already has a whole-order label.");
    return refuse(409, ORDER_LABEL_ERROR, { orderLabel: sinceRead });
  }

  const fail = async (error: string) => {
    const released = await releaseClaim(admin, claim, error.slice(0, 1000));
    if (!released.ok) console.error("[bag label] couldn't mark the claim failed:", released.error);
  };

  // What goes in the box: customs and the insurance share
  let valueCards: ValueCard[];
  try {
    valueCards = await readValueCards(admin, order.id);
  } catch (e) {
    const msg = `Couldn't read the bag's cards (${errText(e)}). Nothing was bought.`;
    await fail(msg);
    return refuse(500, msg);
  }
  const liveCount = liveBags(ctx.bags, ctx.ctx.cards).bags.length;
  const liveValueCards = valueCards.filter((x) => x.status !== "refunded");
  const bagValueCards = liveValueCards.filter((x) => x.bag_id === bag.id);
  const wholeOrder = bagIsWholeOrder(ctx);
  const customsCards = async () => customsCardsFor(valueCards, bag.id, wholeOrder);
  const insuranceCents = returnInsuranceCents(bagInsuranceFloorCents(order, bagValueCards, liveValueCards, liveCount), input.insuranceDeclaredValueCents);

  // The rate: the one chosen on the page, else (one tap) the service the customer paid for, else the cheapest
  let rateObjectId = typeof input.rateObjectId === "string" && input.rateObjectId.trim() ? input.rateObjectId.trim() : null;
  let knownAmount: string | null = null;
  if (!rateObjectId) {
    let quoted;
    try {
      quoted = await getReturnRates({ order, customsCards }, port);
    } catch (e) {
      const msg = `Failed to get rates: ${errText(e)}`;
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
    order, rateObjectId, insuranceCents, customsCards, metadata: bagMetadata(bag), knownAmount,
  }, port);
  if (!bought.ok) {
    if (bought.definite) {
      await fail(bought.error);
      return refuse(bought.status, bought.error);
    }
    // No clear answer once the purchase was sent: keep the claim, so nobody buys again blind
    const { error: noteErr } = await admin.from("bag_shipments")
      .update({ error: appendNote(claim.error, bought.error.slice(0, 1000)) }).eq("id", claim.id).eq("status", "claimed");
    if (noteErr) console.error("[bag label] couldn't note the unclear answer:", noteErr.message);
    return refuse(bought.status, `${bought.error} Shippo didn't answer clearly, so a label may or may not have been bought: check Shippo's label history before trying again.`, { uncertain: true });
  }

  const label: BoughtLabel = bought;
  return finishBagPurchase(admin, ctx, claim, label, {
    by: input.by,
    insuranceCents: !bought.international && insuranceCents > 0 ? insuranceCents : null,
    now,
    recovered: false,
  });
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
    return refuse(500, `Couldn't load this bag. Nothing was changed. (${errText(e)})`);
  }
  if (!c) return refuse(404, "Bag not found");
  if (!c.shipmentsReady) return refuse(500, SHIPMENTS_MIGRATION_ERROR.replace("Nothing was bought.", "Nothing was changed."), { shipmentsReady: false });
  const ctx = c;
  const { bag, order } = ctx;
  const packages = (rows: readonly BagShipmentRow[]) => packageSummaries(ctx.bags, ctx.ctx.cards, rows, tierNamer(ctx));

  const live = liveShipmentOf(ctx.shipments, bag.id);
  if (!live) return refuse(409, "Buy this bag's return label first.");
  if (live.status === "claimed") {
    return refuse(409, boughtOnClaim(live)
      ? "This bag's label was bought but isn't saved yet: tap Buy again to save it (nothing new is bought), then Mark shipped."
      : "The label is still being bought. Wait a few seconds, then try again.");
  }
  // Already shipped (another tap, or earlier): nothing new for the bag, but
  // the order's ship-back step runs again if it failed or was skipped
  const already = async (row: BagShipmentRow): Promise<ServiceAnswer<MarkShippedResponse>> => {
    const fresh = await readShipments(admin, [order.id]).catch(() => null);
    const rows = fresh?.rows.length ? fresh.rows : ctx.shipments.map((s) => (s.id === row.id ? row : s));
    const back = await retryShipBack(admin, ctx, rows, now());
    return {
      ok: true,
      status: 200,
      body: {
        shipment: shipmentView(row), alreadyShipped: true, emailed: false, orderShipped: back.orderShipped,
        orderStatus: back.orderStatus, ...(back.notesEmailed ? { notesEmailed: back.notesEmailed } : {}), packages: packages(rows),
        message: [
          "This bag was already marked shipped. No second email was sent.",
          back.changed ? "Every bag has shipped: the order is now Shipped Back." : "",
          back.problem ?? "",
        ].filter(Boolean).join(" "),
      },
    };
  };
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
    : ctx.shipments.map((s) => (s.id === won1.id ? won1 : s));

  const { bags: liveBagList } = liveBags(ctx.bags, ctx.ctx.cards);
  const multi = liveBagList.length > 1;
  const allShipped = everyBagShipped(ctx.bags, ctx.ctx.cards, shipments);
  const bagCards = ctx.ctx.cards.filter((x) => x.bag_id === bag.id && x.status !== "refunded");
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

  // Every bag with live cards gone: the order is shipped back with THIS
  // (the last) package's tracking. The status email goes only when this
  // bag's shipped email didn't (failed, or skipped)
  const back = await shipBackIfDone(admin, ctx, shipments, { shipment, emailSent: emailed });

  const left = packages(shipments).filter((p) => p.status !== "shipped" && p.status !== "delivered").length;
  const loose = liveBags(ctx.bags, ctx.ctx.cards).looseCards.length;
  const message = [
    emailed ? "Marked shipped and the customer was emailed the tracking." : emailFailed ? "Marked shipped, but the customer's email didn't send." : "Marked shipped.",
    back.changed ? "Every bag has shipped: the order is Shipped Back." : "",
    back.changed && back.statusEmailed ? "The customer was sent the order's shipped-back email instead." : "",
    back.problem ?? "",
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
      orderShipped: back.orderShipped, orderStatus: back.orderStatus, ...(back.notesEmailed ? { notesEmailed: back.notesEmailed } : {}),
      packages: packages(shipments), message,
    },
  };
}

// ─── The order page: no whole-order label while a bag label is live ──────────

/**
 * Whether a bag of this order has a live label (bought, being bought,
 * shipped): `null` when that couldn't be read (the caller must not buy).
 * False when the table isn't there yet (nothing to protect).
 */
export async function bagLabelsLive(admin: SupabaseClient, orderId: string): Promise<{ live: boolean; error: string | null }> {
  const { data, error } = await admin.from("bag_shipments").select("id")
    .eq("order_id", orderId).not("bag_id", "is", null).in("status", [...LIVE_SHIPMENT_STATUSES]).limit(1);
  if (error) {
    if (isMissingShipmentsTable(error)) return { live: false, error: null };
    return { live: false, error: error.message };
  }
  return { live: (data?.length ?? 0) > 0, error: null };
}

/**
 * A bag of this order has a live label (or one being bought): the order
 * page must not buy a whole-order label. False when the table isn't there
 * yet; a read error counts as live (don't buy blind).
 */
export async function bagLabelInFlight(admin: SupabaseClient, orderId: string): Promise<boolean> {
  const res = await bagLabelsLive(admin, orderId);
  if (res.error) console.error("[return-label] couldn't check bag labels:", res.error);
  return res.live || !!res.error;
}

/**
 * The admin order page's "delivered from orders.tracking_number" must wait:
 * the order ships bag by bag (live bag labels) and not every package is
 * delivered yet (the order's tracking number is only the last package's).
 * True on a read error (the sync decides later); false before the migration.
 */
export async function bagShipmentsHoldDelivery(admin: SupabaseClient, orderId: string): Promise<boolean> {
  const { data, error } = await admin.from("bag_shipments").select("status")
    .eq("order_id", orderId).not("bag_id", "is", null).in("status", [...LIVE_SHIPMENT_STATUSES]);
  if (error) {
    if (isMissingShipmentsTable(error)) return false;
    console.error("[order page] bag shipments not read, delivered left to the sync:", error.message);
    return true;
  }
  const rows = (data ?? []) as { status: string }[];
  return rows.length > 0 && !rows.every((r) => r.status === "delivered");
}

// ─── Delivered (sync-delivered) ──────────────────────────────────────────────

type DeliveryCard = { id: string; order_id: string; bag_id: string | null; status: string | null; awaiting_arrival: boolean | null; completed: boolean | null };
type DeliveryBag = { id: string; order_id: string; bag_code: string; tier: string };

export type BagDeliveries = {
  shipmentsDelivered: number;
  ordersDelivered: string[];
  /** Orders shipped wholly bag by bag: the caller must not mark them from orders.tracking_number. */
  bagOrderIds: Set<string>;
  /**
   * Something couldn't be read or written (not "the table isn't there
   * yet"): `bagOrderIds` may be incomplete, so the caller must skip its
   * orders.tracking_number pass this run (fail closed; the next run retries).
   */
  failed: boolean;
};

/**
 * The bag shipments in Shippo's tracking map: each shipped one whose tracking
 * says DELIVERED becomes delivered. An order counts as shipped bag by bag
 * (`bagOrderIds`) only when every bag with live cards has a shipped or
 * delivered shipment (and no live card is outside a bag); one shipped partly
 * by hand is left to the caller's orders.tracking_number check. Such an
 * order that is Shipped Back becomes Delivered (`markOrdersDelivered`, the
 * usual event) once every package is delivered. `orderIds` (the orders the
 * caller would mark from orders.tracking_number) are checked too. Never
 * throws; before the migration it does nothing (and isn't `failed`).
 */
export async function syncBagDeliveries(
  admin: SupabaseClient,
  trackingToStatus: ReadonlyMap<string, string>,
  orderIds: readonly string[],
  markOrdersDelivered: (ids: string[]) => Promise<string[]>,
  deps: Deps = {},
): Promise<BagDeliveries> {
  const now = deps.now?.() ?? new Date();
  const answer = (over: Partial<BagDeliveries> = {}): BagDeliveries =>
    ({ shipmentsDelivered: 0, ordersDelivered: [], bagOrderIds: new Set<string>(), failed: false, ...over });
  let open: BagShipmentRow[];
  try {
    open = await fetchAll<BagShipmentRow>((from, to) =>
      admin.from("bag_shipments").select(SHIPMENT_COLUMNS).eq("status", "shipped").not("bag_id", "is", null).order("id").range(from, to));
  } catch (e) {
    const message = errText(e);
    if (isMissingShipmentsTable({ message })) {
      console.warn("[sync-delivered] bag_shipments isn't in the database (20261125_bag_shipments.sql not applied): no bag shipments, orders go by their tracking number as before.");
      return answer();
    }
    console.error("[sync-delivered] bag shipments not read:", message);
    return answer({ failed: true });
  }

  let shipmentsDelivered = 0;
  let failed = false;
  try {
    // 1. Each package
    const arrived = open.filter((s) => s.tracking_number && trackingToStatus.get(s.tracking_number) === "DELIVERED").map((s) => s.id);
    for (const ids of chunks(arrived, 50)) {
      const { data, error } = await admin.from("bag_shipments").update({ status: "delivered", delivered_at: now.toISOString() })
        .in("id", ids).eq("status", "shipped").select("id");
      if (error) {
        console.error("[sync-delivered] bag shipment update failed:", error.message);
        failed = true;
      }
      shipmentsDelivered += data?.length ?? 0;
    }

    // 2. Their orders (and the caller's), once every package is in
    const candidates = [...new Set([...open.map((s) => s.order_id), ...orderIds])];
    const read = await readShipments(admin, candidates);
    if (!read.ready) return answer({ shipmentsDelivered });
    const shipments = read.rows;
    const ids = [...new Set(shipments.filter((s) => LIVE_SHIPMENT_STATUSES.includes(s.status)).map((s) => s.order_id))];
    if (ids.length === 0) return answer({ shipmentsDelivered, failed });
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
    const of = <T extends { order_id: string }>(rows: readonly T[], id: string) => rows.filter((r) => r.order_id === id);
    // Shipped wholly bag by bag: every bag with live cards has gone in its own package
    const bagOrderIds = new Set(ids.filter((id) => everyBagShipped(of(bags, id), of(cards, id), of(shipments, id))));
    const done = orders
      .filter((o) => o.status === "shipped_back" && bagOrderIds.has(o.id))
      .filter((o) => everyBagDelivered(of(bags, o.id), of(cards, o.id), of(shipments, o.id)))
      .map((o) => o.id);
    const ordersDelivered = done.length ? await markOrdersDelivered(done) : [];
    return answer({ shipmentsDelivered, ordersDelivered, bagOrderIds, failed });
  } catch (e) {
    console.error("[sync-delivered] bag deliveries failed:", errText(e));
    return answer({ shipmentsDelivered, failed: true });
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
        .in("status", ["purchased", "shipped"]).not("bag_id", "is", null).is("tracking_number", null).not("label_url", "is", null)
        .order("id").range(from, to));
  } catch (e) {
    const message = errText(e);
    if (!isMissingShipmentsTable({ message })) console.error("[sync-return-tracking] bag shipments not read:", message);
    return [];
  }
}

/**
 * sync-return-tracking: of these orders, those shipped bag by bag (a live
 * bag label) and their LAST package to leave (null while none has), whose
 * tracking the order carries (never the first label's, which is
 * orders.return_label_url). `failed`: couldn't be read (fill no order this
 * run); before the migration nothing is a bag order.
 */
export async function latestShippedBags(
  admin: SupabaseClient,
  orderIds: readonly string[],
): Promise<{ failed: boolean; byOrder: Map<string, BagShipmentRow | null> }> {
  const byOrder = new Map<string, BagShipmentRow | null>();
  if (orderIds.length === 0) return { failed: false, byOrder };
  let rows: BagShipmentRow[];
  try {
    const read = await readShipments(admin, orderIds);
    if (!read.ready) {
      console.warn("[sync-return-tracking] bag_shipments isn't in the database (20261125_bag_shipments.sql not applied): no bag orders, filled from return_label_url as before.");
      return { failed: false, byOrder };
    }
    rows = read.rows;
  } catch (e) {
    console.error("[sync-return-tracking] bag shipments not read:", errText(e));
    return { failed: true, byOrder };
  }
  for (const id of new Set(rows.filter((s) => LIVE_SHIPMENT_STATUSES.includes(s.status)).map((s) => s.order_id))) {
    byOrder.set(id, latestSentShipment(rows.filter((s) => s.order_id === id)));
  }
  return { failed: false, byOrder };
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
