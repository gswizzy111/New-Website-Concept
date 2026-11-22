import { createAdminClient } from "@/lib/supabase/admin";
import { getLiveTiers, tierPrice } from "@/lib/live-tiers";
import type { DropoffService } from "@/lib/show-dropoffs";

/** PSA Prep's per-card price as the admin set it (store_config), else $25. */
export async function getPrepCardCents(): Promise<number> {
  let prepCents = 2500;
  try {
    const { data } = await createAdminClient()
      .from("store_config")
      .select("value")
      .eq("key", "prep_standard_price_cents")
      .maybeSingle();
    const n = parseInt(data?.value ?? "", 10);
    if (Number.isFinite(n) && n > 0) prepCents = n;
  } catch {
    // Settings unavailable: the default price
  }
  return prepCents;
}

/**
 * The services a show drop-off can be for: every restoration tier with the
 * admin's current names and prices (restoration_settings), then PSA Prep at
 * its per-card price (store_config). Server only.
 */
export async function getDropoffServices(): Promise<DropoffService[]> {
  const [tiers, prepCents] = await Promise.all([getLiveTiers(), getPrepCardCents()]);
  return [
    ...tiers.map((t) => ({ id: t.id, name: t.name, price: tierPrice(t) })),
    { id: "prep" as const, name: "PSA Prep", price: `$${(prepCents / 100).toFixed(prepCents % 100 ? 2 : 0)} per card` },
  ];
}
