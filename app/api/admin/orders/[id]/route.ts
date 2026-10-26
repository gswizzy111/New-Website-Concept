import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Check every record that keeps an order before deleting anything. Signed
  // records are permanent (Terms Section 35.7), and consents, notices and
  // high-value agreements block the delete in the database (ON DELETE RESTRICT)
  const counts = await Promise.all([
    admin.from("signatures").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("order_agreements").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("high_value_agreements").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("consents").select("id", { count: "exact", head: true }).eq("order_id", id),
    admin.from("order_notices").select("id", { count: "exact", head: true }).eq("order_id", id),
  ]);
  const failed = counts.find((c) => c.error);
  if (failed) {
    console.error("Order delete check failed:", failed.error?.message);
    return Response.json({ error: "Couldn't check this order's records, so nothing was deleted. Try again." }, { status: 500 });
  }
  const [sigs, legacy, highValue, consents, notices] = counts.map((c) => c.count ?? 0);
  if (sigs + legacy + highValue > 0) {
    return Response.json({
      error: "This order has signed agreements, which are kept permanently, so it can't be deleted. Set its status to Cancelled instead.",
    }, { status: 409 });
  }
  if (consents + notices > 0) {
    return Response.json({
      error: "This order has recorded consents or notices, which are kept permanently, so it can't be deleted. Set its status to Cancelled instead.",
    }, { status: 409 });
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
