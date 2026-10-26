import { getLiveTiers } from "@/lib/live-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { AddCardsForm } from "./add-cards-form";

interface Props {
  orderNumber: string;
  customerEmail: string;
  tier: RestorationTierId;
  /** Cards already on the order (with the added ones, it sets the bulk percent) */
  cardsOnOrder: number;
}

/**
 * Add more cards to an order before it arrives, at the order's tier price as
 * the admin set it (restoration_settings), the price the add-cards route
 * charges. Orders without a restoration tier (prep) can't add cards here.
 */
export async function AddCardsSection({ orderNumber, customerEmail, tier, cardsOnOrder }: Props) {
  const tierInfo = (await getLiveTiers()).find((t) => t.id === tier);
  if (!tierInfo) return null;
  return <AddCardsForm orderNumber={orderNumber} customerEmail={customerEmail} tierInfo={tierInfo} cardsOnOrder={cardsOnOrder} />;
}
