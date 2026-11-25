import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isMissingIntakeSchema } from "@/lib/intake/completed";
import { packCodePath, tierDisplayName, tierRank } from "@/lib/intake/codes";
import { chunks } from "@/lib/intake/tracking/context";
import { isMissingShipmentsTable } from "@/lib/intake/shipping/bag-shipments";
import { CLAIM_STALE_MS, LABEL_ORDER_STATUSES, LIVE_SHIPMENT_STATUSES, liveBags, SENT_SHIPMENT_STATUSES } from "@/lib/intake/shipping/types";

/**
 * The bags waiting to ship ("ship each bag when done", owner, Nov 25 2026),
 * for the ship queue: every bag that hasn't left the shop and
 *   - is finished (every card that goes back is done), or
 *   - has a label bought but not marked shipped ('purchased'), or being
 *     bought ('claimed'), whatever the order's status now (a bought label
 *     never drops off the list: print it and Mark shipped, or void it), or
 *   - belongs to a paid order already Completed.
 * Orders in the shop: received, in progress, completed (LABEL_ORDER_STATUSES),
 * paid. A bag of an order whose return label was bought for the whole order
 * (order page, old site) isn't listed: that label covers it, and the order
 * stays in the whole-order list (it isn't in `orderIdsWithBags`).
 *
 * Never throws: a failed read is `error` (list whole orders as before).
 * Before the bag_shipments migration `ready` is false and nothing is listed
 * per bag. Reads only; paged (lib/fetch-all.ts) and chunked.
 */

export type ShipQueueCard = { id: string; name: string; set: string | null; year: string | null; valueCents: number | null; done: boolean };

export type ShipQueueBag = {
  bagId: string;
  bagCode: string;
  tier: string;
  tierName: string;
  /** /admin/receiving/pack/<Bag ID> */
  packHref: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  customerName: string | null;
  customerEmail: string | null;
  createdAt: string;
  address: { street1?: string; street2?: string | null; city?: string; state?: string; zip?: string; country?: string } | null;
  /** The cards that go back in this bag (refunded left out), in card order. */
  cards: ShipQueueCard[];
  cardCount: number;
  doneCount: number;
  finished: boolean;
  /** The bag's label when one is bought and not shipped yet ('purchased'), or being bought ('claimed'). */
  shipment: {
    status: "claimed" | "purchased";
    trackingNumber: string | null;
    labelUrl: string | null;
    claimedAt: string;
    purchasedAt: string | null;
    /** A 'claimed' purchase that never finished (older than 2 minutes): the packing page sorts it out. */
    stale: boolean;
  } | null;
};

export type ShipQueue = {
  ready: boolean;
  bags: ShipQueueBag[];
  /** Orders listed bag by bag here: leave them out of the whole-order list. */
  orderIdsWithBags: Set<string>;
  error: string | null;
};

type OrderRow = {
  id: string; order_number: string; customer_name: string | null; customer_email: string | null; status: string; payment_status: string | null;
  return_label_url: string | null; ship_from_address: ShipQueueBag["address"]; created_at: string;
};
type BagRow = { id: string; order_id: string; bag_code: string; tier: string; batch: number | null };
type CardRow = {
  id: string; order_id: string; bag_id: string | null; card_name: string | null; card_set: string | null; card_year: string | null;
  card_seq: number | null; estimated_value_cents: number | null; completed: boolean | null; status: string | null; awaiting_arrival: boolean | null;
};
type ShipmentRow = {
  id: string; bag_id: string; order_id: string; status: string; tracking_number: string | null; label_url: string | null;
  order_label: boolean | null; claimed_at: string; purchased_at: string | null;
};

const ORDER_COLUMNS = "id, order_number, customer_name, customer_email, status, payment_status, return_label_url, ship_from_address, created_at";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LIVE = LIVE_SHIPMENT_STATUSES as readonly string[];
const SENT = SENT_SHIPMENT_STATUSES as readonly string[];

async function inChunks<T>(ids: readonly string[], read: (part: string[]) => Promise<T[]>): Promise<T[]> {
  return (await Promise.all(chunks([...new Set(ids)]).map(read))).flat();
}

export async function loadShipQueueBags(admin: SupabaseClient, deps: { now?: () => Date } = {}): Promise<ShipQueue> {
  const now = deps.now?.() ?? new Date();
  const none = (error: string | null, ready = false): ShipQueue => ({ ready, bags: [], orderIdsWithBags: new Set(), error });

  // Paid orders in the shop, and every bag label bought (or being bought) and not shipped, whatever its order's status
  let inShop: OrderRow[];
  let unsent: ShipmentRow[];
  try {
    [inShop, unsent] = await Promise.all([
      fetchAll<OrderRow>((from, to) => admin.from("orders").select(ORDER_COLUMNS)
        .in("status", [...LABEL_ORDER_STATUSES]).eq("payment_status", "paid")
        .order("created_at", { ascending: true }).order("id").range(from, to)),
      fetchAll<ShipmentRow>((from, to) => admin.from("bag_shipments")
        .select("id, bag_id, order_id, status, tracking_number, label_url, order_label, claimed_at, purchased_at")
        .in("status", ["claimed", "purchased"]).not("bag_id", "is", null).order("id").range(from, to)),
    ]);
  } catch (e) {
    const message = errText(e);
    return isMissingShipmentsTable({ message }) ? none(null) : none(message);
  }
  const inShopIds = new Set(inShop.map((o) => o.id));
  const others = [...new Set(unsent.map((s) => s.order_id).filter((id) => !inShopIds.has(id)))];

  let orders: OrderRow[];
  let bags: BagRow[];
  try {
    const extra = await inChunks(others, async (part) => {
      const { data, error } = await admin.from("orders").select(ORDER_COLUMNS).in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as OrderRow[];
    });
    orders = [...inShop, ...extra]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    if (orders.length === 0) return none(null, true);
    bags = await inChunks(orders.map((o) => o.id), (part) => fetchAll<BagRow>((from, to) =>
      admin.from("tier_bags").select("id, order_id, bag_code, tier, batch").in("order_id", part).order("id").range(from, to)));
  } catch (e) {
    const message = errText(e);
    return isMissingIntakeSchema({ message }) ? none(null) : none(message);
  }
  const bagOrderIds = [...new Set(bags.map((b) => b.order_id))];
  if (bagOrderIds.length === 0) return none(null, true);

  let cards: CardRow[];
  let shipments: ShipmentRow[];
  try {
    [cards, shipments] = await Promise.all([
      inChunks(bagOrderIds, (part) => fetchAll<CardRow>((from, to) =>
        admin.from("cards")
          .select("id, order_id, bag_id, card_name, card_set, card_year, card_seq, estimated_value_cents, completed, status, awaiting_arrival")
          .in("order_id", part).order("id").range(from, to))),
      inChunks(bagOrderIds, (part) => fetchAll<ShipmentRow>((from, to) =>
        admin.from("bag_shipments").select("id, bag_id, order_id, status, tracking_number, label_url, order_label, claimed_at, purchased_at")
          .in("order_id", part).not("bag_id", "is", null).order("id").range(from, to))),
    ]);
  } catch (e) {
    const message = errText(e);
    if (isMissingShipmentsTable({ message })) return none(null);
    return none(isMissingIntakeSchema({ message }) ? null : message);
  }

  const out: ShipQueueBag[] = [];
  const orderIdsWithBags = new Set<string>();
  for (const order of orders) {
    const orderBags = bags.filter((b) => b.order_id === order.id);
    if (orderBags.length === 0) continue;
    const orderCards = cards.filter((c) => c.order_id === order.id);
    const own = shipments.filter((s) => s.order_id === order.id);
    const inShopOrder = inShopIds.has(order.id);
    // A label bought for the whole order (order page, old site): it covers every bag
    const wholeOrderLabel = !!order.return_label_url
      && !own.some((s) => s.label_url === order.return_label_url)
      && !own.some((s) => s.order_label && LIVE.includes(s.status));
    if (wholeOrderLabel) continue;
    const { bags: live } = liveBags(orderBags, orderCards);
    if (live.length === 0) continue;
    if (inShopOrder) orderIdsWithBags.add(order.id);

    for (const bag of [...live].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (a.batch ?? 1) - (b.batch ?? 1))) {
      const s = own.find((x) => x.bag_id === bag.id && LIVE.includes(x.status)) ?? null;
      if (s && SENT.includes(s.status)) continue;
      // Out of the shop (shipped back by hand, delivered, cancelled): only a label still to print or void
      if (!inShopOrder && !s) continue;
      const inBag = orderCards
        .filter((c) => c.bag_id === bag.id && c.status !== "refunded")
        .sort((a, b) => (a.card_seq ?? 1e9) - (b.card_seq ?? 1e9) || a.id.localeCompare(b.id));
      const doneCount = inBag.filter((c) => !!c.completed).length;
      const finished = inBag.length > 0 && doneCount === inBag.length;
      if (!finished && !s && order.status !== "completed") continue;
      out.push({
        bagId: bag.id,
        bagCode: bag.bag_code,
        tier: bag.tier,
        tierName: tierDisplayName(bag.tier),
        packHref: packCodePath(bag.bag_code),
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.status,
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        createdAt: order.created_at,
        address: order.ship_from_address ?? null,
        cards: inBag.map((c) => ({
          id: c.id, name: c.card_name ?? "", set: c.card_set, year: c.card_year, valueCents: c.estimated_value_cents, done: !!c.completed,
        })),
        cardCount: inBag.length,
        doneCount,
        finished,
        shipment: s
          ? {
              status: s.status === "claimed" ? "claimed" : "purchased",
              trackingNumber: s.tracking_number,
              labelUrl: s.label_url,
              claimedAt: s.claimed_at,
              purchasedAt: s.purchased_at,
              stale: s.status === "claimed" && now.getTime() - Date.parse(s.claimed_at) >= CLAIM_STALE_MS,
            }
          : null,
      });
    }
  }
  return { ready: true, bags: out, orderIdsWithBags, error: null };
}
