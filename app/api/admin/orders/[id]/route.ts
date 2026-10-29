import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // Order ids are uuids: anything else can't be an order (Postgres would refuse
  // it with 22P02, which reads like a failed check)
  if (!ORDER_ID.test(id)) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }
  const admin = createAdminClient();

  // Check every record that keeps an order before deleting anything. Signed
  // records are permanent (Terms Section 35.7), and consents, notices and
  // high-value agreements block the delete in the database (ON DELETE RESTRICT).
  // Refunds stay in the ledger (refunds.order_id is ON DELETE SET NULL), so an
  // order with any is kept too: otherwise the dashboard and reports would count
  // refunds that no longer trace back to an order
  const [orderRead, ...counts] = await Promise.all([
    admin.from("orders").select("status, payment_status, stripe_session_id, total_cents, refunded_cents").eq("id", id).single(),
    admin.from("signatures").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("order_agreements").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("high_value_agreements").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("consents").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("order_notices").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("refunds").select("id", { count: "exact", head: true }).eq("order_id", id),
  ]);
  if (orderRead.error?.code === "PGRST116" || orderRead.error?.code === "22P02") {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }
  const failed = orderRead.error ? orderRead : counts.find((c) => c.error);
  if (failed || !orderRead.data) {
    console.error("Order delete check failed:", failed?.error?.message);
    return Response.json({ error: "Couldn't check this order's records, so nothing was deleted. Try again." }, { status: 500 });
  }
  const order = orderRead.data;
  const [sigs, legacy, highValue, consents, notices, refunds] = counts.map((c) => c.count ?? 0);

  // What the admin can do instead: a full refund with Issue Refund cancels the
  // order (the refund route sets it to Cancelled). Shown only while that's possible
  const stillPaid = order.payment_status === "paid" || order.payment_status === "partially_refunded";
  const leftCents = (order.total_cents ?? 0) - (order.refunded_cents ?? 0);
  const instead = stillPaid && order.stripe_session_id && leftCents > 0 && order.status !== "cancelled"
    ? " To cancel it, give a full refund with Issue Refund."
    : "";
  const refuse = (reason: string) => Response.json({ error: reason + instead }, { status: 409 });

  if (sigs + legacy + highValue > 0) {
    return refuse("This order has signed agreements, which are kept permanently, so it can't be deleted.");
  }
  if (consents + notices > 0) {
    return refuse("This order has recorded consents or notices, which are kept permanently, so it can't be deleted.");
  }
  if (refunds > 0 || (order.refunded_cents ?? 0) > 0) {
    return refuse("This order has refunds on record, which are kept, so it can't be deleted.");
  }

  // One statement: the database removes the order's cards, history and service
  // lines with it (ON DELETE CASCADE), or nothing at all if anything blocks it
  const { error } = await admin.from("orders").delete().eq("id", id);
  if (error) {
    console.error("Failed to delete order:", error);
    return Response.json({ error: "Failed to delete order" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
