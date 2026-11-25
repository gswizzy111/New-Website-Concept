import { createAdminClient } from "@/lib/supabase/admin";
import { shippo } from "@/lib/shippo";
import { isAdmin } from "@/lib/admin-auth";
import { fetchAll } from "@/lib/fetch-all";
import { shipmentsMissingTracking } from "@/lib/intake/shipping/bag-shipments";

type LabelOrder = { id: string; order_number: string; return_label_url: string | null };

export async function POST() {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all shipped_back orders with no tracking number but with a return label URL
  // (paged: a select returns at most 1,000 rows), and bag labels with no tracking yet
  const [ordersToFix, bagsToFix] = await Promise.all([
    fetchAll<LabelOrder>((from, to) => admin
      .from("orders")
      .select("id, order_number, return_label_url")
      .eq("status", "shipped_back")
      .is("tracking_number", null)
      .not("return_label_url", "is", null)
      .order("id")
      .range(from, to)).catch((err) => { console.error("[sync-return-tracking] orders not read:", err instanceof Error ? err.message : err); return [] as LabelOrder[]; }),
    shipmentsMissingTracking(admin),
  ]);

  if (ordersToFix.length === 0 && bagsToFix.length === 0) {
    return Response.json({ updated: 0, noLabel: 0, message: "Nothing to sync." });
  }

  // Also count orders with no label at all (can't auto-fix these)
  const { count: noLabelCount } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "shipped_back")
    .is("tracking_number", null)
    .is("return_label_url", null);

  // Build a map of labelUrl → trackingNumber by paginating through Shippo transactions
  const labelToTracking = new Map<string, string>();
  for (let page = 1; page <= 15; page++) {
    try {
      const txList = await shippo.transactions.list({ page, results: 100 });
      for (const tx of txList.results ?? []) {
        if (tx.labelUrl && tx.trackingNumber) {
          labelToTracking.set(tx.labelUrl, tx.trackingNumber);
        }
      }
      if (!txList.next) break;
    } catch {
      break;
    }
  }

  // Match and update each order
  const results: { order_number: string; tracking: string | null; status: "updated" | "no_match" }[] = [];

  for (const order of ordersToFix) {
    const tracking = order.return_label_url ? labelToTracking.get(order.return_label_url) ?? null : null;

    if (tracking) {
      await Promise.all([
        admin.from("orders").update({ tracking_number: tracking }).eq("id", order.id),
        admin.from("order_events").insert({
          order_id: order.id,
          event_type: "tracking_synced",
          description: `Return tracking number synced from Shippo: ${tracking}`,
          is_customer_visible: true,
        }),
      ]);
      results.push({ order_number: order.order_number, tracking, status: "updated" });
    } else {
      results.push({ order_number: order.order_number, tracking: null, status: "no_match" });
    }
  }

  // Bag labels (orders shipped bag by bag): the same match, on the bag's shipment
  if (bagsToFix.length > 0) {
    const numbers = new Map<string, string>();
    const orderIds = [...new Set(bagsToFix.map((s) => s.order_id))];
    for (let i = 0; i < orderIds.length; i += 100) {
      const { data } = await admin.from("orders").select("id, order_number").in("id", orderIds.slice(i, i + 100));
      for (const o of data ?? []) numbers.set(o.id as string, String(o.order_number));
    }
    for (const s of bagsToFix) {
      const orderNumber = numbers.get(s.order_id) ?? "";
      const tracking = s.label_url ? labelToTracking.get(s.label_url) ?? null : null;
      if (!tracking) {
        results.push({ order_number: orderNumber, tracking: null, status: "no_match" });
        continue;
      }
      const { data: filled, error } = await admin.from("bag_shipments")
        .update({ tracking_number: tracking }).eq("id", s.id).is("tracking_number", null).select("id");
      if (error || !filled?.length) continue;
      await admin.from("order_events").insert({
        order_id: s.order_id,
        event_type: "tracking_synced",
        description: `Return tracking number synced from Shippo: ${tracking}`,
        is_customer_visible: s.status === "shipped",
      });
      results.push({ order_number: orderNumber, tracking, status: "updated" });
    }
  }

  const updated = results.filter((r) => r.status === "updated").length;
  const noMatch = results.filter((r) => r.status === "no_match").length;

  return Response.json({
    updated,
    noMatch,
    noLabel: noLabelCount ?? 0,
    results,
  });
}
