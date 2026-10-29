import { getLiveTiers } from "@/lib/live-tiers";
import { OrderBuilderClient } from "./order-builder-client";
import type { Service } from "@/lib/types";
import type { RestorationTierId } from "@/lib/restoration-tiers";

/**
 * The restoration order builder (/order and /restoration). Loads the tiers
 * with the admin's names and prices (restoration_settings), so every price
 * shown is the one the checkout charges.
 */
export async function OrderBuilder({ services, selectedTier }: { services: Service[]; selectedTier?: RestorationTierId }) {
  const tiers = await getLiveTiers();
  return <OrderBuilderClient services={services} selectedTier={selectedTier} tiers={tiers} />;
}
