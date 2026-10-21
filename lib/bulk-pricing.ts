import type { RestorationTierId } from "@/lib/restoration-tiers";

/**
 * Bulk restoration pricing: an order of 10+ cards gets 10% off the per-card
 * price, 20+ cards 15% off. Diamond (priced as a share of the card's value)
 * is excluded. Like creator and loyalty codes, it never stacks: an order gets
 * whichever discount is biggest. The Restorations page, the order builder and
 * the checkout API all price from here.
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

/** A per-card price after a bulk discount, in cents. */
export function bulkPriceCents(priceCents: number, percent: number): number {
  return Math.round(priceCents * (100 - percent) / 100);
}
