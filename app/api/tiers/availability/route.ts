import { createAdminClient } from "@/lib/supabase/admin";
import { RESTORATION_TIERS, type RestorationTierId } from "@/lib/restoration-tiers";
import { isSoldOut } from "@/lib/site-config";
import { getRestorationsOpen, getSlotsOpenedAt } from "@/lib/store-config";
import { tierMaxSlots, tierSlotUsage } from "@/lib/tier-slots";

/**
 * GET /api/tiers/availability: whether each restoration tier is open and how
 * many slots it has left, so the order builder can warn before the customer
 * signs (components/order-builder/tier-availability.tsx). Counted exactly as
 * the tier page shows it and /api/checkout enforces it: the admin's is_open
 * and max_slots (restoration_settings, else TIER_MAX_SLOTS), and one slot per
 * paid order or checkout under an hour old (SLOT_HOLD_MINUTES) since the slots opened
 * (lib/tier-slots.ts). Counts only, never anything about an order or a
 * customer. Never cached: a slot can go at any moment.
 *
 * { restorations_open, tiers: { <tier id>: { open, slots_left } } }
 * slots_left is null when the tier has no limit or the count can't be read.
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const [restorationsOpen, slotsOpenedAt] = await Promise.all([getRestorationsOpen(), getSlotsOpenedAt()]);
  const admin = createAdminClient();

  const { data: settings, error } = await admin
    .from("restoration_settings")
    .select("tier, is_open, max_slots");
  if (error) {
    console.error("Tier settings unavailable:", error.message);
    return Response.json({ error: "Tier availability is unavailable right now." }, { status: 503, headers: NO_STORE });
  }
  const settingsMap: Record<string, { is_open?: boolean | null; max_slots?: number | null }> =
    Object.fromEntries((settings ?? []).map((s) => [s.tier, s]));

  const tierIds = Object.keys(RESTORATION_TIERS) as RestorationTierId[];
  const maxSlotsOf = (id: RestorationTierId) => tierMaxSlots(id, settingsMap[id]?.max_slots);

  // Slots taken, one per order (the same count as the tier page and checkout);
  // null when it can't be read, so no tier is reported full by mistake
  let usage: Record<string, number> | null = null;
  if (restorationsOpen && tierIds.some((id) => maxSlotsOf(id) !== null)) {
    try {
      usage = await tierSlotUsage(admin, slotsOpenedAt);
    } catch (err) {
      console.error("Tier slot count failed:", err);
    }
  }

  const tiers = Object.fromEntries(tierIds.map((id) => {
    const max = maxSlotsOf(id);
    return [id, {
      open: settingsMap[id]?.is_open !== false,
      slots_left: max !== null && usage ? Math.max(0, max - (usage[id] ?? 0)) : null,
    }];
  }));

  return Response.json(
    { restorations_open: restorationsOpen && !isSoldOut(), tiers },
    { headers: NO_STORE },
  );
}
