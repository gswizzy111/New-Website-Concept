import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";

export const KIT_STATUSES = {
  paid:        { label: "Payment Received" },
  processing:  { label: "Processing" },
  shipped:     { label: "Shipped" },
  delivered:   { label: "Delivered" },
} as const;

export type KitStatus = keyof typeof KIT_STATUSES;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { status } = await request.json().catch(() => ({}));

  if (typeof status !== "string" || !Object.hasOwn(KIT_STATUSES, status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = createAdminClient();
  // A cancelled order has been refunded: it can't be moved back into the queue
  const { data: updated, error } = await admin
    .from("shop_orders")
    .update({ status })
    .eq("id", id)
    .or("status.is.null,status.neq.cancelled")
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!updated?.length) {
    const { data: row } = await admin.from("shop_orders").select("status").eq("id", id).maybeSingle();
    if (row?.status === "cancelled") return Response.json({ error: "This order was cancelled." }, { status: 409 });
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
