import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderBuilder } from "@/components/order-builder/builder";
import { isSoldOut, TIER_SELECTION_ENABLED } from "@/lib/site-config";
import { getRestorationsOpen } from "@/lib/store-config";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { RestorationSoldOut } from "./sold-out";
import { PixelViewContent } from "@/components/pixel-view-content";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function RestorationPage({ searchParams }: PageProps) {
  // Master toggle — if restorations are closed, redirect to tier-selection (shows prices + waitlist)
  const restorationsOpen = await getRestorationsOpen();
  if (!restorationsOpen) {
    redirect("/tier-selection");
  }

  // Get tier from query params
  const params = await searchParams;
  const tierParam = params.tier as string | undefined;

  // If tier selection is enabled and no tier selected, redirect to tier selection page
  if (TIER_SELECTION_ENABLED && !tierParam) {
    redirect("/tier-selection");
  }

  if (isSoldOut()) {
    return <RestorationSoldOut />;
  }

  const supabase = await createClient();
  const { data: services } = await supabase
    .from("services")
    .select("id, name, short_description, full_description, price_cents, turnaround_days, display_order, active")
    .eq("active", true)
    .order("display_order");

  return (
    <Suspense>
      <PixelViewContent contentName="Restoration Order" contentCategory="Restoration" />
      <OrderBuilder services={services ?? []} selectedTier={tierParam as RestorationTierId | undefined} />
    </Suspense>
  );
}
