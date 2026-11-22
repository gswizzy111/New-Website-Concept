import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { sendAccountInviteEmail } from "@/lib/dropoff-confirmation-email";

/**
 * Send Sign-up Email (admin order page): emails the customer a thank-you with
 * a link to make an account under the order's email, where they can track it.
 * Logged on the order's timeline either way.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, order_number, customer_name, customer_email")
    .eq("id", id)
    .maybeSingle();
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

  const email = (order.customer_email ?? "").trim();
  if (!email) return Response.json({ error: "This order has no email. Add the customer's email first." }, { status: 400 });

  const sendError = await sendAccountInviteEmail({ order_number: order.order_number, customer_name: order.customer_name, customer_email: email });
  await admin.from("order_events").insert({
    order_id: order.id,
    event_type: sendError ? "email_failed" : "account_invite_sent",
    description: sendError
      ? `Sign-up email could not be sent: ${sendError.slice(0, 300)}`
      : `Sign-up email sent to ${email}`,
    is_customer_visible: false,
  });
  if (sendError) {
    console.error(`Sign-up email failed (order ${order.id}):`, sendError);
    return Response.json({ error: `The email didn't send: ${sendError.slice(0, 200)}` }, { status: 502 });
  }
  return Response.json({ ok: true });
}
