import type { createAdminClient } from "@/lib/supabase/admin";
import { shippo } from "@/lib/shippo";

type Admin = ReturnType<typeof createAdminClient>;

const MAX_PAGES = 20;
// Shippo pages fetched at once. Sequential paging took 40–50s and the daily
// run was cut off; in waves it finishes in a fraction of that.
const WAVE = 5;
// Ids per update, so the request URL stays short however big the backlog is.
const CHUNK = 50;

export const DELIVERED_EVENT = "Marked Delivered — confirmed via Shippo transaction tracking.";

/** Shippo's answer for a page number past the last page (404 "Invalid page."). */
function isPastLastPage(err: unknown): boolean {
  const e = err as { statusCode?: unknown; body?: unknown; message?: unknown } | null;
  return e?.statusCode === 404 && /invalid page/i.test(`${e.body ?? ""} ${e.message ?? ""}`);
}

/**
 * trackingNumber → Shippo tracking status for the account's most recent
 * labels (up to 2,000). The transaction object carries trackingStatus
 * directly, so no per-order tracking call is needed.
 */
export async function getShippoTrackingStatuses(): Promise<Map<string, string>> {
  const trackingToStatus = new Map<string, string>();
  for (let first = 1; first <= MAX_PAGES; first += WAVE) {
    const pages = Array.from({ length: Math.min(WAVE, MAX_PAGES - first + 1) }, (_, i) => first + i);
    const lists = await Promise.all(
      pages.map((page) => shippo.transactions.list({ page, results: 100 }).catch((err) => {
        // A wave can ask for pages past the last one: Shippo answers those
        // 404 "Invalid page.", which is the end of the list, not a failure
        if (isPastLastPage(err)) return { results: [], next: null };
        console.error(`[sync-delivered] Shippo page ${page} failed:`, err instanceof Error ? err.message : err);
        return null;
      }))
    );
    for (const list of lists) {
      for (const tx of list?.results ?? []) {
        if (tx.trackingNumber && tx.trackingStatus) trackingToStatus.set(tx.trackingNumber, tx.trackingStatus);
      }
    }
    // Stop at the last page (or at a failed page, as the sequential loop did)
    if (lists.some((list) => !list || !list.next)) break;
  }
  return trackingToStatus;
}

function chunks<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));
}

/**
 * Marks restoration orders delivered and logs one customer-visible event for
 * each. Only rows that are still open change, so two runs that overlap never
 * mark an order twice or add a second event. Returns the order numbers marked.
 */
export async function markRestorationsDelivered(admin: Admin, orderIds: string[]): Promise<string[]> {
  const marked: string[] = [];
  for (const ids of chunks(orderIds)) {
    const { data, error } = await admin
      .from("orders")
      .update({ status: "delivered" })
      .in("id", ids)
      .not("status", "in", '("delivered","cancelled")')
      .select("id, order_number");
    if (error) {
      console.error("[sync-delivered] order update failed:", error.message);
      continue;
    }
    if (!data?.length) continue;
    const { error: eventError } = await admin.from("order_events").insert(
      data.map((o) => ({ order_id: o.id, event_type: "status_updated", description: DELIVERED_EVENT, is_customer_visible: true }))
    );
    if (eventError) console.error("[sync-delivered] order event insert failed:", eventError.message);
    marked.push(...data.map((o) => o.order_number as string));
  }
  return marked;
}

/**
 * Moves kit orders to `status` when they are in one of `from` (or, with no
 * `from`, any status but delivered/cancelled). Returns the order numbers moved.
 */
export async function moveKitOrders(admin: Admin, orderIds: string[], status: "shipped" | "delivered", from?: string[]): Promise<string[]> {
  const moved: string[] = [];
  for (const ids of chunks(orderIds)) {
    let query = admin.from("shop_orders").update({ status }).in("id", ids);
    query = from ? query.in("status", from) : query.not("status", "in", '("delivered","cancelled")');
    const { data, error } = await query.select("order_number");
    if (error) {
      console.error(`[sync-delivered] kit update to ${status} failed:`, error.message);
      continue;
    }
    moved.push(...(data ?? []).map((o) => String(o.order_number)));
  }
  return moved;
}
