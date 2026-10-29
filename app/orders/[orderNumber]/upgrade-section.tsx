import { getLiveTiers } from "@/lib/live-tiers";
import { UPGRADE_LADDER, upgradeTargets } from "@/lib/restoration-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { upgradeFee, type UpgradeCard } from "@/lib/upgrade-pricing";
import { UpgradeForm, type UpgradeOffer } from "./upgrade-form";

interface Props {
  orderNumber: string;
  customerEmail: string;
  currentTier: RestorationTierId | null;
  /** Kept for the order page; the difference is priced per card (lib/upgrade-pricing.ts) */
  currentSubtotalCents?: number;
  /** Cards on the order, used only if their prices can't be read */
  cardCount: number;
}

/**
 * Upgrade offers for an order awaiting its cards, priced as the upgrade route
 * charges them: the admin's tier prices (restoration_settings) minus what each
 * card was charged. Only single-tier orders on the ladder can upgrade (not
 * Diamond, Fast Pass, prep or mixed-tier orders).
 */
export async function UpgradeSection({ orderNumber, customerEmail, currentTier, cardCount }: Props) {
  if (!currentTier || !UPGRADE_LADDER.includes(currentTier)) return null;
  const tiers = await getLiveTiers();
  const current = tiers.find((t) => t.id === currentTier);
  if (!current) return null;

  const { data: order, error } = await createAdminClient()
    .from("orders")
    .select("cards(tier, status, service_price_cents)")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error) console.error("Upgrade offers: order cards unavailable:", error.message);
  // Unreadable: every card at the current tier's price, as the route prices cards without their own
  const cards: UpgradeCard[] = (order?.cards as UpgradeCard[] | null | undefined)
    ?? Array.from({ length: cardCount }, () => ({ tier: null, status: null, service_price_cents: null }));

  const offers: UpgradeOffer[] = upgradeTargets(current, tiers)
    .map((tier) => {
      const fee = upgradeFee(cards, current.id, current.price_cents, tier.price_cents);
      return { tier, totalCents: fee.totalCents, chargeCents: fee.chargeCents, bulkPercent: fee.bulkPercent };
    })
    .filter((offer) => offer.chargeCents > 0);
  if (offers.length === 0) return null;
  return <UpgradeForm orderNumber={orderNumber} customerEmail={customerEmail} offers={offers} />;
}
