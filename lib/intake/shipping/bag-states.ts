import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { trackingHref, type BagShipState } from "@/lib/intake/packing-view";
import { chunks } from "@/lib/intake/tracking/context";
import { isMissingShipmentsTable, LIVE_SHIPMENT_STATUSES } from "@/lib/intake/shipping/types";

/**
 * Each bag's live label (claimed, purchased, shipped or delivered), for the
 * pages that show where a finished bag is: the scan landing (a shipped bag
 * says "Shipped · <tracking>" instead of the Ready to ship bin step) and the
 * Bags board's Ready to ship section (shipped bags leave it; "Label bought,
 * not shipped"). Reads only; paged and chunked. Never throws: before the
 * bag_shipments migration (table missing) or on a failed read it answers no
 * labels, so those pages behave as they did without per-bag labels. Rows with
 * no bag (the order page's claim on its whole-order label) are left out.
 */

type Row = { bag_id: string; status: string; tracking_number: string | null; tracking_url: string | null; carrier: string | null };

const COLUMNS = "bag_id, status, tracking_number, tracking_url, carrier";
const LIVE = LIVE_SHIPMENT_STATUSES as readonly string[];

export async function loadBagShipStates(
  admin: SupabaseClient,
  by: { orderId: string } | { bagIds: readonly string[] },
): Promise<Map<string, BagShipState>> {
  const out = new Map<string, BagShipState>();
  let rows: Row[];
  try {
    const live = () => admin.from("bag_shipments").select(COLUMNS).in("status", [...LIVE]).not("bag_id", "is", null);
    if ("orderId" in by) {
      rows = await fetchAll<Row>((from, to) => live().eq("order_id", by.orderId).order("id").range(from, to));
    } else {
      const ids = [...new Set(by.bagIds)];
      rows = (await Promise.all(chunks(ids).map((part) =>
        fetchAll<Row>((from, to) => live().in("bag_id", part).order("id").range(from, to))))).flat();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingShipmentsTable({ message })) console.warn("[intake] bag labels not read:", message);
    return out;
  }
  for (const r of rows) {
    if (!LIVE.includes(r.status)) continue;
    out.set(r.bag_id, {
      status: r.status as BagShipState["status"],
      trackingNumber: r.tracking_number,
      trackingHref: trackingHref({ trackingNumber: r.tracking_number, carrier: r.carrier, trackingUrl: r.tracking_url }),
    });
  }
  return out;
}
