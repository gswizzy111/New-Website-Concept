import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { TIER_MAX_SLOTS } from "@/lib/site-config";

type Admin = ReturnType<typeof createAdminClient>;

/** A checkout still pending in Stripe this long holds its slots; older ones are abandoned. */
export const SLOT_HOLD_MINUTES = 30;

/**
 * A tier's slot limit in orders: the admin's max_slots (restoration_settings),
 * else the site-config fallback, else none (null).
 */
export function tierMaxSlots(tierId: string, dbMaxSlots: number | null | undefined): number | null {
  return dbMaxSlots ?? TIER_MAX_SLOTS[tierId] ?? null;
}

/**
 * The slots each restoration tier has taken. One slot is one order, whatever
 * its card count. An order counts in its tier (orders.restoration_tier); an
 * order with cards on several tiers (no restoration_tier) counts once in each
 * of its cards' tiers. Counted: paid orders (fully refunded ones are no longer
 * 'paid') and, unless `paidOnly`, checkouts still in progress (pending, not
 * cancelled, started in the last 30 minutes), placed since the slots last
 * opened (store_config slots_opened_at; null: all time). A tier's max_slots
 * (restoration_settings) is a number of orders. Throws if it can't be read.
 */
export async function tierSlotUsage(
  admin: Admin,
  slotsOpenedAt: string | null,
  { paidOnly = false }: { paidOnly?: boolean } = {},
): Promise<Record<string, number>> {
  const pendingSinceMs = Date.now() - SLOT_HOLD_MINUTES * 60 * 1000;
  const pendingSince = paidOnly ? null : new Date(pendingSinceMs).toISOString();

  // One grouped count in the database (supabase/migrations/20261027_checkout.sql).
  // POST: a GET would send a null p_pending_since as the text 'null'.
  const { data, error } = await admin.rpc("tier_slot_orders", { p_since: slotsOpenedAt, p_pending_since: pendingSince });
  if (!error) {
    const usage: Record<string, number> = {};
    for (const row of (data ?? []) as { tier: string; orders: number }[]) usage[row.tier] = Number(row.orders) || 0;
    return usage;
  }
  console.warn("tier_slot_orders unavailable, counting orders directly:", error.message);

  // Before the migration: the same count, read order by order
  type Row = { id: string; restoration_tier: string | null; payment_status: string | null; status: string | null; created_at: string; cards: { tier: string | null }[] | null };
  const rows = await fetchAll<Row>((from, to) => {
    let q = admin
      .from("orders")
      .select("id, restoration_tier, payment_status, status, created_at, cards(tier)")
      .in("payment_status", paidOnly ? ["paid"] : ["paid", "pending"]);
    if (slotsOpenedAt) q = q.gte("created_at", slotsOpenedAt);
    return q.order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });
  const usage: Record<string, number> = {};
  for (const order of rows) {
    const holds = order.payment_status === "paid"
      || (!paidOnly && order.payment_status === "pending" && order.status !== "cancelled" && new Date(order.created_at).getTime() >= pendingSinceMs);
    if (!holds) continue;
    const tiers = order.restoration_tier
      ? [order.restoration_tier]
      : [...new Set((order.cards ?? []).map((c) => c.tier).filter((t): t is string => !!t))];
    for (const tier of tiers) usage[tier] = (usage[tier] ?? 0) + 1;
  }
  return usage;
}
