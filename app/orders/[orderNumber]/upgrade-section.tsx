import { getLiveTiers } from "@/lib/live-tiers";
import { UPGRADE_LADDER, upgradeTargets } from "@/lib/restoration-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { UpgradeForm } from "./upgrade-form";

interface Props {
  orderNumber: string;
  customerEmail: string;
  currentTier: RestorationTierId | null;
  /** Kept for the order page; the difference is priced per card from the admin's prices */
  currentSubtotalCents?: number;
  cardCount: number;
}

/**
 * Upgrade offers for an order awaiting its cards, priced from the tier prices
 * the admin set (restoration_settings), as the upgrade route charges them.
 * Only single-tier orders on the ladder can upgrade (not Diamond, Fast Pass,
 * prep or mixed-tier orders).
 */
export async function UpgradeSection({ orderNumber, customerEmail, currentTier, cardCount }: Props) {
  if (!currentTier || !UPGRADE_LADDER.includes(currentTier)) return null;
  const tiers = await getLiveTiers();
  const current = tiers.find((t) => t.id === currentTier);
  if (!current) return null;
  const upgradeTiers = upgradeTargets(current, tiers);
  if (upgradeTiers.length === 0) return null;
  return <UpgradeForm orderNumber={orderNumber} customerEmail={customerEmail} currentTier={current} upgradeTiers={upgradeTiers} cardCount={cardCount} />;
}
