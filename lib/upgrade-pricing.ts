import { bulkDiscountPercent, bulkPriceCents } from "@/lib/bulk-pricing";
import { TAX_RATE } from "@/lib/item-pricing";

/** A card on an order being upgraded (cards.tier, status, service_price_cents). */
export type UpgradeCard = { tier: string | null; status: string | null; service_price_cents: number | null };

/**
 * What a card is taken to have been charged for its current tier: its own
 * price when it is on the order's tier, else (older cards without a price or
 * tier, or cards an earlier upgrade didn't reprice) the current tier's price.
 */
export function upgradeBaseCents(card: UpgradeCard, currentTierId: string, currentPriceCents: number): number {
  return card.tier === currentTierId && card.service_price_cents != null ? card.service_price_cents : currentPriceCents;
}

/**
 * What moving an order's cards up to a dearer tier costs: for every card not
 * refunded, the new tier's price minus what the card was charged
 * (upgradeBaseCents), with the order's bulk percent off, plus sales tax. The
 * upgrade route charges it, the order page shows it (upgrade-section.tsx), and
 * the Stripe webhook splits it over the cards the same way.
 */
export function upgradeFee(cards: UpgradeCard[], currentTierId: string, currentPriceCents: number, newPriceCents: number) {
  const charged = cards.filter((c) => c.status !== "refunded");
  const listCents = charged.reduce((sum, c) => sum + Math.max(0, newPriceCents - upgradeBaseCents(c, currentTierId, currentPriceCents)), 0);
  const bulkPercent = bulkDiscountPercent(charged.length);
  const chargeCents = bulkPriceCents(listCents, bulkPercent);
  const taxCents = Math.round(chargeCents * TAX_RATE);
  return { cardCount: charged.length, bulkPercent, chargeCents, taxCents, totalCents: chargeCents + taxCents };
}
