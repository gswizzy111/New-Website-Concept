import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrepOrderForm } from "./prep-order-form";

export const dynamic = "force-dynamic";

async function getPrepPrices() {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("store_config")
      .select("key, value")
      .in("key", ["prep_standard_price_cents", "prep_pre_grade_price_cents", "prep_slab_crack_price_cents", "prep_open"]);
    const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    return {
      standardPriceCents: parseInt(map.prep_standard_price_cents ?? "2500", 10),
      preGradePriceCents: parseInt(map.prep_pre_grade_price_cents ?? "500", 10),
      slabCrackPriceCents: parseInt(map.prep_slab_crack_price_cents ?? "700", 10),
      isOpen: (map.prep_open ?? "true") !== "false",
    };
  } catch {
    return { standardPriceCents: 2500, preGradePriceCents: 500, slabCrackPriceCents: 700, isOpen: true };
  }
}

export default async function PrepOrderPage() {
  const prices = await getPrepPrices();

  // Same switch as /prep and the prep checkout API: while prep is paused, send the
  // customer to /prep (which says so) before they fill in the whole order
  if (!prices.isOpen) {
    redirect("/prep");
  }

  return (
    <PrepOrderForm
      standardPriceCents={prices.standardPriceCents}
      preGradePriceCents={prices.preGradePriceCents}
      slabCrackPriceCents={prices.slabCrackPriceCents}
    />
  );
}
