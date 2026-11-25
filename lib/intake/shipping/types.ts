import type { ShipCheckResponse } from "@/lib/intake/tracking/types";

/**
 * Per-bag return labels ("ship each bag when it's done", owner, Nov 25 2026):
 * the shapes of the packing API (GET/POST /api/admin/intake/bags/<id>/ship-label,
 * POST /api/admin/intake/bags/<id>/shipped) and the pure rules behind them.
 * Pure: no database, safe in client components and tests. Server code is in
 * bag-label.ts (the Shippo purchase shared with the order page's route) and
 * bag-shipments.ts (claims, Mark shipped, delivered).
 */

export const BAG_SHIPMENT_STATUSES = ["claimed", "purchased", "shipped", "delivered", "failed", "voided"] as const;
export type BagShipmentStatus = (typeof BAG_SHIPMENT_STATUSES)[number];
/** The statuses that hold the bag's one live shipment (the unique index in 20261125_bag_shipments.sql). */
export const LIVE_SHIPMENT_STATUSES: readonly BagShipmentStatus[] = ["claimed", "purchased", "shipped", "delivered"];
/** The bag has left the shop. */
export const SENT_SHIPMENT_STATUSES: readonly BagShipmentStatus[] = ["shipped", "delivered"];
/** A claim older than this with no answer is stale: the purchase may or may not have gone through. */
export const CLAIM_STALE_MS = 2 * 60_000;

export const SHIPMENT_COLUMNS =
  "id, bag_id, order_id, status, carrier, service, tracking_number, tracking_url, label_url, shippo_transaction_id, shippo_rate_id, cost_cents, insurance_cents, order_label, claimed_at, purchased_at, shipped_at, delivered_at, email_sent_at, created_by, shipped_by, error";

export type BagShipmentRow = {
  id: string;
  bag_id: string;
  order_id: string;
  status: BagShipmentStatus;
  carrier: string | null;
  service: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  shippo_transaction_id: string | null;
  shippo_rate_id: string | null;
  cost_cents: number | null;
  insurance_cents: number | null;
  order_label: boolean;
  claimed_at: string;
  purchased_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  email_sent_at: string | null;
  created_by: string | null;
  shipped_by: string | null;
  error: string | null;
};

export type BagShipment = {
  id: string;
  bagId: string;
  orderId: string;
  status: BagShipmentStatus;
  /** "USPS" */
  carrier: string | null;
  /** "Priority Mail" */
  service: string | null;
  trackingNumber: string | null;
  /** The carrier's tracking page (Shippo's tracking_url_provider). */
  trackingUrl: string | null;
  /** The 4x6 label PDF: print this. */
  labelUrl: string | null;
  costCents: number | null;
  insuranceCents: number | null;
  /** Also the order's return label (orders.return_label_url): the order's first. */
  orderLabel: boolean;
  claimedAt: string;
  purchasedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdBy: string | null;
  shippedBy: string | null;
  emailSentAt: string | null;
  error: string | null;
};

export function shipmentView(r: BagShipmentRow): BagShipment {
  return {
    id: r.id, bagId: r.bag_id, orderId: r.order_id, status: r.status,
    carrier: r.carrier, service: r.service, trackingNumber: r.tracking_number, trackingUrl: r.tracking_url,
    labelUrl: r.label_url, costCents: r.cost_cents, insuranceCents: r.insurance_cents, orderLabel: !!r.order_label,
    claimedAt: r.claimed_at, purchasedAt: r.purchased_at, shippedAt: r.shipped_at, deliveredAt: r.delivered_at,
    createdBy: r.created_by, shippedBy: r.shipped_by, emailSentAt: r.email_sent_at, error: r.error,
  };
}

/** A rate offered for a return label (the order page's GET return-label shape). */
export type ShipRate = {
  objectId: string;
  provider: string;
  service: string;
  amount: string;
  currency: string;
  days: number | null;
  /** The service the customer paid for at checkout. */
  paid: boolean;
};

/** Every bag of the order that has live (non-refunded) cards, with how far it got. */
export type PackageSummary = {
  bagId: string;
  bagCode: string;
  tierName: string;
  cardCount: number;
  doneCount: number;
  status: BagShipmentStatus | "none";
  trackingNumber: string | null;
};

/** What the packing page should offer next. */
export type PackingNext = "buy" | "print_and_ship" | "shipped" | "delivered" | "blocked" | "wait";

/** GET /api/admin/intake/bags/<bagId>/ship-label[?rates=1] */
export type PackingResponse = {
  bag: { id: string; code: string; tier: string; tierName: string };
  order: { id: string; orderNumber: string; customer: string | null; status: string; international: boolean; hasAddress: boolean };
  check: ShipCheckResponse;
  /** The bag's live shipment (claimed / purchased / shipped / delivered). */
  shipment: BagShipment | null;
  /** The newest failed attempt, when there is no live shipment. */
  lastFailure: { at: string; error: string } | null;
  /** A return label bought for the whole order on the order page (or the old site): it covers this bag, so no bag label is sold. */
  orderLabel: { labelUrl: string; trackingNumber: string | null } | null;
  packages: PackageSummary[];
  /** False until supabase/migrations/20261125_bag_shipments.sql is applied. */
  shipmentsReady: boolean;
  canBuy: boolean;
  /** Why a label can't be bought now (plain sentence), else null. */
  blocked: string | null;
  next: PackingNext;
  rates?: ShipRate[];
  ratesError?: string;
};

/** POST /api/admin/intake/bags/<bagId>/ship-label body (all optional: {} = one tap). */
export type BuyBagLabelRequest = { rateObjectId?: string; insuranceDeclaredValueCents?: number; retryStaleClaim?: boolean };

/** POST /api/admin/intake/bags/<bagId>/ship-label 200. */
export type BuyBagLabelResponse = { shipment: BagShipment; existing: boolean; orderLabel: boolean; message: string };

/** POST /api/admin/intake/bags/<bagId>/shipped 200. */
export type MarkShippedResponse = {
  shipment: BagShipment;
  alreadyShipped: boolean;
  emailed: boolean;
  emailFailed?: true;
  orderShipped: boolean;
  orderStatus: string;
  notesEmailed?: string;
  packages: PackageSummary[];
  message: string;
};

/** Order statuses a bag label may be bought in (the cards are in the shop, or partly sent back). */
export const LABEL_ORDER_STATUSES: readonly string[] = ["received", "in_progress", "completed", "shipped_back"];
/** Order statuses that move to shipped_back when the last bag ships. */
export const SHIP_BACK_FROM: readonly string[] = ["received", "in_progress", "completed"];

/** Why the order's status doesn't allow a bag label, or null. */
export function orderStatusBlock(status: string): string | null {
  if (LABEL_ORDER_STATUSES.includes(status)) return null;
  if (status === "delivered") return "This order is already delivered.";
  if (status === "cancelled") return "This order is cancelled.";
  if (status === "awaiting_payment" || status === "awaiting_cards") return "This order's cards haven't been received.";
  return `A return label can't be bought while the order is "${status}".`;
}

type CardLike = { id: string; bag_id: string | null; status: string | null; awaiting_arrival?: boolean | null; received_at?: string | null; completed?: boolean | null };
type BagLike = { id: string; bag_code: string; tier: string };

/** Bags with at least one non-refunded card ("non-refunded bags"), and live received cards in no bag. */
export function liveBags<B extends BagLike>(bags: readonly B[], cards: readonly CardLike[]): { bags: B[]; looseCards: CardLike[] } {
  const live = cards.filter((c) => c.status !== "refunded");
  const withCards = new Set(live.map((c) => c.bag_id).filter(Boolean) as string[]);
  return {
    bags: bags.filter((b) => withCards.has(b.id)),
    // Received through the shop but never bagged (awaiting cards never arrived: they don't ship)
    looseCards: live.filter((c) => !c.bag_id && !c.awaiting_arrival),
  };
}

/**
 * Every bag with live cards, with its live shipment's status. `tierName` turns
 * a tier key into its display name.
 */
export function packageSummaries<B extends BagLike>(
  bags: readonly B[],
  cards: readonly CardLike[],
  shipments: readonly BagShipmentRow[],
  tierName: (tier: string) => string,
): PackageSummary[] {
  const { bags: live } = liveBags(bags, cards);
  return live.map((b) => {
    const own = cards.filter((c) => c.bag_id === b.id && c.status !== "refunded");
    const s = shipments.find((x) => x.bag_id === b.id && LIVE_SHIPMENT_STATUSES.includes(x.status)) ?? null;
    return {
      bagId: b.id, bagCode: b.bag_code, tierName: tierName(b.tier), cardCount: own.length,
      doneCount: own.filter((c) => !!c.completed).length,
      status: s?.status ?? "none", trackingNumber: s?.tracking_number ?? null,
    };
  });
}

/**
 * Whether the order has gone back: every bag with live cards has a shipped
 * (or delivered) shipment and no live, received card sits outside a bag.
 */
export function everyBagShipped(bags: readonly BagLike[], cards: readonly CardLike[], shipments: readonly BagShipmentRow[]): boolean {
  const { bags: live, looseCards } = liveBags(bags, cards);
  if (live.length === 0 || looseCards.length > 0) return false;
  return live.every((b) => shipments.some((s) => s.bag_id === b.id && SENT_SHIPMENT_STATUSES.includes(s.status)));
}

/** Every bag with live cards has a delivered shipment. */
export function everyBagDelivered(bags: readonly BagLike[], cards: readonly CardLike[], shipments: readonly BagShipmentRow[]): boolean {
  const { bags: live, looseCards } = liveBags(bags, cards);
  if (live.length === 0 || looseCards.length > 0) return false;
  return live.every((b) => shipments.some((s) => s.bag_id === b.id && s.status === "delivered"));
}

/**
 * The paid return insurance floor for one bag's label. The order's insured
 * value (round trip or return insurance) is the floor today; when the order
 * ships in several bags, each bag is insured for its own cards' declared
 * values (capped at the order's insured value), or for the whole value when
 * one of its cards has no declared value (never under-insured).
 */
export function bagInsuranceFloorCents(
  order: { insurance_type?: string | null; insurance_declared_value_cents?: number | null },
  bagCards: readonly { estimated_value_cents?: number | null }[],
  liveBagCount: number,
): number {
  const paid = (order.insurance_type === "round_trip" || order.insurance_type === "return") && (order.insurance_declared_value_cents ?? 0) > 0
    ? (order.insurance_declared_value_cents as number)
    : 0;
  if (paid === 0 || liveBagCount <= 1 || bagCards.length === 0) return paid;
  if (bagCards.some((c) => !(typeof c.estimated_value_cents === "number" && c.estimated_value_cents > 0))) return paid;
  const sum = bagCards.reduce((s, c) => s + (c.estimated_value_cents as number), 0);
  return Math.min(paid, sum);
}

/**
 * The customer order page's return tracking: one entry per package when the
 * order ships in more than one (or when its only shipped package isn't the
 * order's tracking number yet); [] means "show the order's single tracking
 * number as before".
 */
export function returnPackagesToShow<S extends { status: string; tracking_number: string | null }>(
  orderTrackingNumber: string | null,
  shipments: readonly S[],
): S[] {
  const sent = shipments.filter((s) => (SENT_SHIPMENT_STATUSES as readonly string[]).includes(s.status) && !!s.tracking_number);
  if (sent.length === 0) return [];
  if (sent.length === 1 && orderTrackingNumber && sent[0].tracking_number === orderTrackingNumber) return [];
  return sent;
}

/** "Charizard, Blastoise, Venusaur and 2 more" (at most `max` names). */
export function cardList(names: readonly string[], max = 5): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length <= max) return clean.join(", ");
  return `${clean.slice(0, max).join(", ")} and ${clean.length - max} more`;
}
