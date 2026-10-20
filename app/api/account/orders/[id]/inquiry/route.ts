import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail } from "@/lib/resend";
import { ORDER_STATUSES } from "@/lib/constants";
import type { OrderStatus } from "@/lib/constants";
import { INQUIRY_TYPE, OPEN_CASE_STATUSES, escapeHtml, orderLabel } from "@/lib/card-inquiries";

// "Where's my card?": opens an inquiry case for this order (one open at a time)
// and lets the shop know by email.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, order_number, status, customer_name, customer_email, customer_phone")
    .eq("id", id)
    .single();

  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (order.customer_email?.toLowerCase() !== user.email?.toLowerCase()) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.status === "cancelled" || order.status === "awaiting_payment") {
    return Response.json({ error: "This order isn't active." }, { status: 400 });
  }

  const ref = String(order.order_number);

  // Already asked and not answered yet: don't open a second one.
  const { data: open } = await admin
    .from("cases")
    .select("id, created_at")
    .eq("type", INQUIRY_TYPE)
    .eq("order_ref", ref)
    .in("status", OPEN_CASE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return Response.json({ askedAt: open.created_at });

  const label = orderLabel(order.order_number);
  const statusLabel = ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status;
  const name = order.customer_name || "The customer";

  const { data: created, error } = await admin
    .from("cases")
    .insert({
      type: INQUIRY_TYPE,
      title: `Where's my card? (Order ${label})`,
      description: `${name} asked for an update from their account. Order status when they asked: ${statusLabel}.`,
      priority: "normal",
      status: "open",
      customer_name: order.customer_name || null,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone || null,
      order_ref: ref,
    })
    .select("id, created_at")
    .single();

  if (error || !created) {
    console.error("Failed to create card inquiry:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? process.env.BUSINESS_SHIPPING_EMAIL ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://thecarddoc1.com";
  if (adminEmail) {
    try {
      await resend.emails.send({
        from: fromEmail,
        to: adminEmail,
        subject: `Where's my card? — Order ${label}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:900">A customer is asking for an update</h1>
            <p><strong>${escapeHtml(name)}</strong> pressed "Where's my card?" on order <strong>${escapeHtml(label)}</strong>.</p>
            <p style="color:#666;font-size:14px">${escapeHtml(order.customer_email ?? "")}${order.customer_phone ? ` · ${escapeHtml(order.customer_phone)}` : ""}</p>
            <p style="font-size:14px"><strong>Order status:</strong> ${escapeHtml(statusLabel)}</p>
            <a href="${appUrl}/admin/cases/${created.id}" style="display:inline-block;background:#a23200;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">Reply to customer</a>
          </div>
        `,
      });
    } catch (err) {
      console.error("Failed to send card inquiry admin email:", err);
    }
  }

  return Response.json({ askedAt: created.created_at });
}
