import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { getShippoTrackingStatuses, markRestorationsDelivered, moveKitOrders } from "@/lib/sync-delivered";
import { countOpenBagShipments, syncBagDeliveries } from "@/lib/intake/shipping/bag-shipments";

type TrackedOrder = { id: string; order_number: string; tracking_number: string | null };

// Runs daily at 2pm UTC via netlify/functions/cron-sync-delivered.mjs.
// Checks Shippo transaction tracking and updates restoration + kit order statuses.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Paged: a select returns at most 1,000 rows
  const [restorationOrders, kitOrders, openBags] = await Promise.all([
    fetchAll<TrackedOrder>((from, to) => admin
      .from("orders")
      .select("id, order_number, tracking_number")
      .not("tracking_number", "is", null)
      .not("status", "in", '("delivered","cancelled")')
      .order("id")
      .range(from, to)).catch((err) => { console.error("[cron/sync-delivered] orders not read:", err instanceof Error ? err.message : err); return [] as TrackedOrder[]; }),
    fetchAll<TrackedOrder & { status: string }>((from, to) => admin
      .from("shop_orders")
      .select("id, order_number, tracking_number, status")
      .not("tracking_number", "is", null)
      .not("status", "in", '("delivered","cancelled","paid")')
      .order("id")
      .range(from, to)).catch((err) => { console.error("[cron/sync-delivered] kit orders not read:", err instanceof Error ? err.message : err); return [] as (TrackedOrder & { status: string })[]; }),
    // Packages of orders shipped in several bags (bag_shipments)
    countOpenBagShipments(admin),
  ]);

  const allOrders = [...restorationOrders, ...kitOrders];
  if (allOrders.length === 0 && openBags === 0) {
    console.log("[cron/sync-delivered] No orders to check.");
    return Response.json({ updated: 0, checked: 0 });
  }

  const trackingToStatus = await getShippoTrackingStatuses();
  const statusOf = (o: { tracking_number: string | null }) => trackingToStatus.get(o.tracking_number!);

  // Orders shipped bag by bag: each package, then the order once every one is delivered
  const bags = await syncBagDeliveries(
    admin,
    trackingToStatus,
    restorationOrders.map((o) => o.id),
    (ids) => markRestorationsDelivered(admin, ids, { onlyFrom: ["shipped_back"] }),
  );
  for (const n of bags.ordersDelivered) console.log(`[cron/sync-delivered] R${n} → delivered (every bag)`);

  // Restoration orders — only DELIVERED transition. Skipped this run when the
  // bag shipments couldn't be read: an order shipped bag by bag carries only
  // its last package's tracking, so it would be marked from that alone
  if (bags.failed) console.error("[cron/sync-delivered] bag shipments unreadable: restoration orders not checked by tracking number this run");
  const restorations = bags.failed ? [] : await markRestorationsDelivered(
    admin,
    restorationOrders.filter((o) => !bags.bagOrderIds.has(o.id) && statusOf(o) === "DELIVERED").map((o) => o.id)
  );
  for (const n of restorations) console.log(`[cron/sync-delivered] R${n} → delivered`);

  // Kit orders — TRANSIT → shipped, DELIVERED → delivered. Not PRE_TRANSIT:
  // a label bought at checkout sits in that state until the kit is dropped off
  const [kitsDelivered, kitsShipped] = await Promise.all([
    moveKitOrders(admin, kitOrders.filter((o) => statusOf(o) === "DELIVERED").map((o) => o.id), "delivered"),
    moveKitOrders(
      admin,
      kitOrders.filter((o) => statusOf(o) === "TRANSIT").map((o) => o.id),
      "shipped",
      ["processing"]
    ),
  ]);
  for (const n of kitsDelivered) console.log(`[cron/sync-delivered] K${n} → delivered`);
  for (const n of kitsShipped) console.log(`[cron/sync-delivered] K${n} → shipped`);

  const updated = restorations.length + bags.ordersDelivered.length + kitsDelivered.length + kitsShipped.length;
  const checked = restorationOrders.length + kitOrders.length;
  console.log(`[cron/sync-delivered] checked ${checked}, updated ${updated}, bag packages delivered ${bags.shipmentsDelivered}`);
  return Response.json({ updated, checked, packagesDelivered: bags.shipmentsDelivered, ...(bags.failed ? { bagSyncFailed: true } : {}) });
}
