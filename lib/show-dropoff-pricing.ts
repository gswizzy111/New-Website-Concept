// What a show drop-off is worth, with no database (browser-safe, tested in
// tests/intake/show-dropoff-pricing.test.ts). lib/show-dropoff-revenue.ts
// feeds it the admin's prices and each drop-off's order.
//
// Before it is entered: the tiers the customer picked at the table, at the
// admin's current prices (each listed card at its tier, or the one service
// picked; for 5+ cards, the card count times the one service). Once entered:
// its order's total (orders.total_cents, the order's own cards at the tier
// prices when it was created, plus any later edit), so the Show Dropoffs tab
// and the order always show the same amount. Cancelled drop-offs count
// nothing. Diamond is priced by declared value, which the form doesn't ask
// for, and 5+ cards with several services have no per-card split, so those
// are flagged as not fully priced until entered.

import type { RestorationTier } from "@/lib/restoration-tiers";

/** The drop-off fields pricing reads. */
export type PricedDropoff = {
  status: string;
  tiers: string[];
  five_plus: boolean;
  card_count: number | null;
  cards: { service?: string | null }[] | null;
};

/** The order a drop-off was entered as (show_dropoffs.order_id), when it still exists. */
export type LinkedOrder = { total_cents: number | null };

/** One service's per-card price in cents; null when it can't be priced per card (Diamond, unknown). */
export type PriceBook = { perCard: (service: string) => number | null };

export type DropoffFigure = {
  /** The amount counted, in cents; 0 for a cancelled drop-off. */
  cents: number;
  /** False when part of it couldn't be priced (Diamond, 5+ cards with several services or no count). */
  complete: boolean;
  /** True when the amount is the order's total (entered), false when it is the tiers picked, priced. */
  fromOrder: boolean;
};

/** The admin's prices: restoration tiers (restoration_settings) and PSA Prep's per-card price (store_config). */
export function makePriceBook(
  tiers: Pick<RestorationTier, "id" | "pricing_type" | "price_cents">[],
  prepCents: number,
): PriceBook {
  const byId = new Map(tiers.map((t) => [t.id as string, t]));
  return {
    perCard(service) {
      if (service === "prep") return prepCents;
      const tier = byId.get(service);
      if (!tier || tier.pricing_type === "percentage") return null;
      return tier.price_cents;
    },
  };
}

/** The tiers picked on one drop-off, priced. */
export function priceTiers(row: PricedDropoff, book: PriceBook): { cents: number; complete: boolean } {
  if (row.five_plus) {
    const price = row.tiers.length === 1 ? book.perCard(row.tiers[0]) : null;
    if (price === null || !row.card_count) return { cents: 0, complete: false };
    return { cents: price * row.card_count, complete: true };
  }
  let cents = 0;
  let complete = true;
  for (const card of row.cards ?? []) {
    // One service picked: every card is that service (as the signed text reads it)
    const service = card.service ?? (row.tiers.length === 1 ? row.tiers[0] : null);
    const price = service ? book.perCard(service) : null;
    if (price === null) complete = false;
    else cents += price;
  }
  return { cents, complete };
}

/**
 * True when the customer later paid online on the order (added cards or a tier
 * upgrade: the webhook's "cards_added" / "tier_upgraded" history lines). Those
 * payments are in the order's total and, unlike the rest of a show drop-off
 * order, are counted in the dashboard and the revenue reports.
 */
export function paidOnlineLater(events: { event_type?: string | null }[] | null | undefined): boolean {
  return (events ?? []).some((e) => e.event_type === "cards_added" || e.event_type === "tier_upgraded");
}

/** The amount one drop-off counts: nothing if cancelled, its order's total once entered, else the tiers picked. */
export function dropoffFigure(row: PricedDropoff, book: PriceBook, order: LinkedOrder | null | undefined): DropoffFigure {
  if (row.status === "cancelled") return { cents: 0, complete: true, fromOrder: false };
  if (row.status === "entered" && order && typeof order.total_cents === "number") {
    return { cents: order.total_cents, complete: true, fromOrder: true };
  }
  return { ...priceTiers(row, book), fromOrder: false };
}
