import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { TIER_MAX_SLOTS } from "@/lib/site-config";

type Admin = ReturnType<typeof createAdminClient>;

/** A checkout still pending in Stripe this long holds its cards' slots; older ones are abandoned. */
export const SLOT_HOLD_MINUTES = 30;

/**
 * A tier's slot limit in cards: the admin's max_slots (restoration_settings),
 * else the site-config fallback, else none (null).
 */
export function tierMaxSlots(tierId: string, dbMaxSlots: number | null | undefined): number | null {
  return dbMaxSlots ?? TIER_MAX_SLOTS[tierId] ?? null;
}

/**
 * The slots each restoration tier has taken, in cards: every card on a paid
 * order, plus cards on checkouts started in the last 30 minutes, placed since
 * the slots last opened (store_config slots_opened_at; null: all time). A card
 * counts toward its own tier (mixed-tier orders count each tier's cards; older
 * cards without a tier count toward the order's tier). Refunded cards free
 * their slot. A tier's max_slots (restoration_settings) is a number of cards.
 * Throws if the counts can't be read.
 */
export async function tierSlotUsage(admin: Admin, slotsOpenedAt: string | null): Promise<Record<string, number>> {
  const pendingSinceMs = Date.now() - SLOT_HOLD_MINUTES * 60 * 1000;
  const pendingSince = new Date(pendingSinceMs).toISOString();

  // One grouped count in the database (supabase/migrations/20261027_checkout.sql)
  const { data, error } = await admin.rpc("tier_slot_usage", { p_since: slotsOpenedAt, p_pending_since: pendingSince });
  if (!error) {
    const usage: Record<string, number> = {};
    for (const row of (data ?? []) as { tier: string; cards: number }[]) usage[row.tier] = Number(row.cards) || 0;
    return usage;
  }
  console.warn("tier_slot_usage unavailable, counting cards directly:", error.message);

  // Before the migration: the same count, read card by card
  type Row = { id: string; tier: string | null; status: string | null; orders: { restoration_tier: string | null; payment_status: string | null; status: string | null; created_at: string } | null };
  const rows = await fetchAll<Row>((from, to) => {
    let q = admin
      .from("cards")
      .select("id, tier, status, orders!inner(restoration_tier, payment_status, status, created_at)")
      .in("orders.payment_status", ["paid", "pending"]);
    if (slotsOpenedAt) q = q.gte("orders.created_at", slotsOpenedAt);
    return q.order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });
  const usage: Record<string, number> = {};
  for (const row of rows) {
    const order = row.orders;
    if (!order || row.status === "refunded") continue;
    const tier = row.tier ?? order.restoration_tier;
    if (!tier) continue;
    const holds = order.payment_status === "paid"
      || (order.payment_status === "pending" && order.status !== "cancelled" && new Date(order.created_at).getTime() >= pendingSinceMs);
    if (holds) usage[tier] = (usage[tier] ?? 0) + 1;
  }
  return usage;
}
