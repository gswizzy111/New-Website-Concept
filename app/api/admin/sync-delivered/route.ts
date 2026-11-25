import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { getShippoTrackingStatuses, markRestorationsDelivered } from "@/lib/sync-delivered";
import { isAdmin } from "@/lib/admin-auth";
import { countOpenBagShipments, syncBagDeliveries } from "@/lib/intake/shipping/bag-shipments";

type TrackedOrder = { id: string; order_number: string; tracking_number: string | null };

export async function POST() {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // All orders that aren't already done and have a tracking number (paged:
  // a select returns at most 1,000 rows), and packages of orders shipped bag by bag
  const [orders, openBags] = await Promise.all([
    fetchAll<TrackedOrder>((from, to) => admin
      .from("orders")
      .select("id, order_number, tracking_number")
      .not("tracking_number", "is", null)
      .not("status", "in", '("delivered","cancelled")')
      .order("id")
      .range(from, to)).catch((err) => { console.error("[sync-delivered] orders not read:", err instanceof Error ? err.message : err); return [] as TrackedOrder[]; }),
    countOpenBagShipments(admin),
  ]);

  if (orders.length === 0 && openBags === 0) {
    return Response.json({ updated: 0, checked: 0, message: "Nothing to sync." });
  }

  const trackingToStatus = await getShippoTrackingStatuses();

  // Orders shipped bag by bag: each package, then the order once every one is delivered
  const bags = await syncBagDeliveries(
    admin,
    trackingToStatus,
    orders.map((o) => o.id),
    (ids) => markRestorationsDelivered(admin, ids, { onlyFrom: ["shipped_back"] }),
  );

  // Match orders to Shippo tracking status and update the delivered ones.
  // Not when the bag shipments couldn't be read: an order shipped bag by bag
  // carries only its last package's tracking, so it would be marked from that
  // alone (the next run catches up)
  const delivered: string[] = [];
  const noMatch: string[] = [];

  if (bags.failed) {
    console.error("[sync-delivered] bag shipments unreadable: orders not checked by tracking number this run");
  } else {
    for (const order of orders) {
      if (bags.bagOrderIds.has(order.id)) continue;
      const status = trackingToStatus.get(order.tracking_number!);
      if (!status) noMatch.push(order.order_number);
      else if (status === "DELIVERED") delivered.push(order.id);
    }
  }

  const updated = [...await markRestorationsDelivered(admin, delivered), ...bags.ordersDelivered];

  return Response.json({
    updated: updated.length,
    checked: bags.failed ? 0 : orders.length,
    results: updated.map((n) => ({ order_number: n, status: "updated" })),
    noMatch: noMatch.length,
    packagesDelivered: bags.shipmentsDelivered,
    ...(bags.failed ? { bagSyncFailed: true, message: "The per-bag shipments couldn't be read, so orders weren't checked this time. Try again in a minute." } : {}),
  });
}
