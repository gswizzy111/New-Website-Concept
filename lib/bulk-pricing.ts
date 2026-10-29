import type { RestorationTierId } from "@/lib/restoration-tiers";

/**
 * Bulk pricing: an order of 10+ cards gets 10% off the per-card price, 20+
 * cards 15% off. Restoration: Diamond (priced as a share of the card's value)
 * is excluded. PSA Prep: off the per-card prep fee of cards under $1,500 only;
 * cards $1,500 and over (2% of value) are excluded the same way, and neither
 * are the add-ons (Pre-Grade Assessment, slab removal), shipping or insurance.
 * Excluded cards still count toward the 10 or 20. Like creator
 * and loyalty codes, it never stacks: an order gets whichever discount is
 * biggest. The Restorations and Prep pages, the order builder, the prep order
 * form and both checkout APIs all price from here.
 */
export const BULK_TIERS = [
  { minCards: 20, percent: 15 },
  { minCards: 10, percent: 10 },
] as const;

export type BulkPlan = "single" | "10" | "20";

export const BULK_PLANS: { id: BulkPlan; label: string; percent: number; minCards: number }[] = [
  { id: "single", label: "Individual", percent: 0, minCards: 1 },
  { id: "10", label: "10+ cards", percent: 10, minCards: 10 },
  { id: "20", label: "20+ cards", percent: 15, minCards: 20 },
];

const EXCLUDED_TIERS: RestorationTierId[] = ["elite"];

export function isBulkEligible(tierId: RestorationTierId | string | null | undefined): boolean {
  return !!tierId && !EXCLUDED_TIERS.includes(tierId as RestorationTierId);
}

/** The bulk discount percent for an order with this many cards (0 below 10). */
export function bulkDiscountPercent(cardCount: number): number {
  return BULK_TIERS.find((t) => cardCount >= t.minCards)?.percent ?? 0;
}

/** The bulk discount on `baseCents` (the per-card prices it applies to), rounded once for the order. */
export function bulkDiscountCentsOf(baseCents: number, percent: number): number {
  return percent > 0 ? Math.round(baseCents * percent / 100) : 0;
}

/** A per-card price after a bulk discount, in cents. */
export function bulkPriceCents(priceCents: number, percent: number): number {
  return Math.round(priceCents * (100 - percent) / 100);
}

/**
 * Cards added to an existing order: the order's new size decides the bulk
 * percent, taken off the added cards (cards already paid for keep their price).
 */
export function addedCardsBulkPercent(tierId: RestorationTierId | string | null | undefined, cardsOnOrder: number, adding: number): number {
  return isBulkEligible(tierId) ? bulkDiscountPercent(cardsOnOrder + adding) : 0;
}
