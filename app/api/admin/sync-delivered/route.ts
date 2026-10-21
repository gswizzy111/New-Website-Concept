import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getShippoTrackingStatuses, markRestorationsDelivered } from "@/lib/sync-delivered";

export async function POST() {
  const jar = await cookies();
  if (jar.get("admin_auth")?.value !== process.env.ADMIN_PASSWORD) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // All orders that aren't already done and have a tracking number
  const { data: orders } = await admin
    .from("orders")
    .select("id, order_number, tracking_number")
    .not("tracking_number", "is", null)
    .not("status", "in", '("delivered","cancelled")');

  if (!orders || orders.length === 0) {
    return Response.json({ updated: 0, checked: 0, message: "Nothing to sync." });
  }

  const trackingToStatus = await getShippoTrackingStatuses();

  // Match orders to Shippo tracking status and update the delivered ones
  const delivered: string[] = [];
  const noMatch: string[] = [];

  for (const order of orders) {
    const status = trackingToStatus.get(order.tracking_number!);
    if (!status) noMatch.push(order.order_number);
    else if (status === "DELIVERED") delivered.push(order.id);
  }

  const updated = await markRestorationsDelivered(admin, delivered);

  return Response.json({
    updated: updated.length,
    checked: orders.length,
    results: updated.map((n) => ({ order_number: n, status: "updated" })),
    noMatch: noMatch.length,
  });
}
