import { createAdminClient } from "@/lib/supabase/admin";
import { getShippoTrackingStatuses, markRestorationsDelivered, moveKitOrders } from "@/lib/sync-delivered";

// Runs daily at 2pm UTC via netlify/functions/cron-sync-delivered.mjs.
// Checks Shippo transaction tracking and updates restoration + kit order statuses.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: restorationOrders }, { data: kitOrders }] = await Promise.all([
    admin
      .from("orders")
      .select("id, order_number, tracking_number")
      .not("tracking_number", "is", null)
      .not("status", "in", '("delivered","cancelled")'),
    admin
      .from("shop_orders")
      .select("id, order_number, tracking_number, status")
      .not("tracking_number", "is", null)
      .not("status", "in", '("delivered","cancelled","paid")'),
  ]);

  const allOrders = [...(restorationOrders ?? []), ...(kitOrders ?? [])];
  if (allOrders.length === 0) {
    console.log("[cron/sync-delivered] No orders to check.");
    return Response.json({ updated: 0, checked: 0 });
  }

  const trackingToStatus = await getShippoTrackingStatuses();
  const statusOf = (o: { tracking_number: string | null }) => trackingToStatus.get(o.tracking_number!);

  // Restoration orders — only DELIVERED transition
  const restorations = await markRestorationsDelivered(
    admin,
    (restorationOrders ?? []).filter((o) => statusOf(o) === "DELIVERED").map((o) => o.id)
  );
  for (const n of restorations) console.log(`[cron/sync-delivered] R${n} → delivered`);

  // Kit orders — TRANSIT → shipped, DELIVERED → delivered. Not PRE_TRANSIT:
  // a label bought at checkout sits in that state until the kit is dropped off
  const [kitsDelivered, kitsShipped] = await Promise.all([
    moveKitOrders(admin, (kitOrders ?? []).filter((o) => statusOf(o) === "DELIVERED").map((o) => o.id), "delivered"),
    moveKitOrders(
      admin,
      (kitOrders ?? []).filter((o) => statusOf(o) === "TRANSIT").map((o) => o.id),
      "shipped",
      ["processing"]
    ),
  ]);
  for (const n of kitsDelivered) console.log(`[cron/sync-delivered] K${n} → delivered`);
  for (const n of kitsShipped) console.log(`[cron/sync-delivered] K${n} → shipped`);

  const updated = restorations.length + kitsDelivered.length + kitsShipped.length;
  const checked = (restorationOrders?.length ?? 0) + (kitOrders?.length ?? 0);
  console.log(`[cron/sync-delivered] checked ${checked}, updated ${updated}`);
  return Response.json({ updated, checked });
}
