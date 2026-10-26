import { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_STATUSES } from "@/lib/constants";
import { resend, fromEmail, businessName, replyToAddress } from "@/lib/resend";
import { isAdmin } from "@/lib/admin-auth";
import { siteUrl } from "@/lib/site-url";
import { escapeHtml } from "@/lib/card-inquiries";
import { DONE_STATUSES, emailCompletionNotesOnce, type NotesEmailResult } from "@/lib/completion-notes-email";

const CUSTOMER_MESSAGES: Partial<Record<string, string>> = {
  received: "Great news — we've received your cards and they're checked in!",
  in_progress: "Your cards are now being worked on by our team.",
  completed: "Your cards are finished and looking great!",
  shipped_back: "Your cards have been shipped back to you!",
  delivered: "Your cards have been delivered. We hope you love the results!",
  cancelled: "Your order has been cancelled. Please reach out if you have any questions.",
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { status } = body;
  const tracking_number = typeof body.tracking_number === "string" ? body.tracking_number.trim() : "";

  if (typeof status !== "string" || !Object.prototype.hasOwnProperty.call(ORDER_STATUSES, status)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: order, error: readErr } = await admin
    .from("orders")
    .select("customer_email, customer_name, order_number, status")
    .eq("id", id)
    .single();
  if (readErr || !order) {
    return Response.json({ error: readErr?.code === "PGRST116" ? "Order not found" : "Couldn't read the order. Nothing was changed." }, { status: readErr?.code === "PGRST116" ? 404 : 500 });
  }
  const previousStatus = order.status as string;

  // Build update payload — only include tracking_number if provided
  const updatePayload: Record<string, unknown> = { status };
  if (tracking_number) updatePayload.tracking_number = tracking_number;

  const { error } = await admin.from("orders").update(updatePayload).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const eventDescription = tracking_number && status === "shipped_back"
    ? `Status updated to: Shipped Back — Tracking: ${tracking_number}`
    : `Status updated to: ${ORDER_STATUSES[status as keyof typeof ORDER_STATUSES].label}`;

  const { error: eventErr } = await admin.from("order_events").insert({
    order_id: id,
    event_type: "status_updated",
    description: eventDescription,
    is_customer_visible: true,
  });
  if (eventErr) console.error("Failed to log status change:", eventErr.message);

  const appUrl = siteUrl();
  const contact = escapeHtml(replyToAddress);
  let emailFailed = false;
  const statusLabel = ORDER_STATUSES[status as keyof typeof ORDER_STATUSES].label;
  const customerMessage = CUSTOMER_MESSAGES[status];

  // Email customer on meaningful status changes (walk-in and manual orders can have no email)
  if (customerMessage && order.customer_email?.trim()) {
    const firstName = escapeHtml(order.customer_name?.split(" ")[0] || "there");
    const trackingUrl = `${appUrl}/orders/${order.order_number}`;

    const trackingBlock = (status === "shipped_back" && tracking_number)
      ? `
        <div style="background:#fbfaf9;border:1px solid #e6e4e2;border-radius:12px;padding:20px;margin:20px 0">
          <p style="margin:0 0 6px;font-size:13px;color:#2d2b29;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Tracking Number</p>
          <p style="margin:0;font-family:monospace;font-size:20px;font-weight:900;color:#1e1d1a;letter-spacing:0.05em">${escapeHtml(tracking_number)}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#2d2b29">Copy this number and paste it on your carrier's website to track your package.</p>
        </div>
      `
      : "";

    try {
      const { error: sendErr } = await resend.emails.send({
        from: fromEmail,
        to: order.customer_email,
        subject: status === "shipped_back"
          ? `Your cards are on the way! — Order #${order.order_number}`
          : `Update on your order — ${statusLabel}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:900;margin-bottom:4px">Order Update</h1>
            <p style="color:#666;margin-top:0">Order <strong>#${order.order_number}</strong></p>
            <p>Hi ${firstName},</p>
            <p>${customerMessage}</p>
            ${trackingBlock}
            <div style="background:#f9f9f9;border:1px solid #eee;border-radius:12px;padding:16px;margin:20px 0">
              <p style="margin:0;font-size:13px;color:#666">Current status</p>
              <p style="margin:4px 0 0;font-weight:700;font-size:16px">${statusLabel}</p>
            </div>
            <a href="${trackingUrl}" style="display:inline-block;background:#c34104;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Track Your Order</a>
            <p style="font-size:13px;color:#666;margin-top:24px">Questions? Email us at <a href="mailto:${contact}" style="color:#c34104">${contact}</a></p>
            <p style="font-size:13px;color:#999">${businessName}</p>
          </div>
        `,
      });
      if (sendErr) {
        emailFailed = true;
        console.error("Failed to send status email:", sendErr.message);
      }
    } catch (err) {
      emailFailed = true;
      console.error("Failed to send status email:", err);
    }
  }

  // Notify admin when cards arrive
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? process.env.BUSINESS_SHIPPING_EMAIL ?? "";
  if (status === "received" && adminEmail) {
    try {
      const { error: adminSendErr } = await resend.emails.send({
        from: fromEmail,
        to: adminEmail,
        subject: `📦 Cards Arrived — Order #${order.order_number} from ${order.customer_name ?? ""}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:900">Cards have arrived!</h1>
            <p>Order <strong>#${order.order_number}</strong> from <strong>${escapeHtml(order.customer_name ?? "")}</strong> has been marked as received.</p>
            <a href="${appUrl}/admin/orders/${id}" style="display:inline-block;background:#c34104;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">View Order</a>
          </div>
        `,
      });
      if (adminSendErr) console.error("Failed to send admin received email:", adminSendErr.message);
    } catch (err) {
      console.error("Failed to send admin received email:", err);
    }
  }

  // The work is done: the customer gets the restoration notes (once)
  let notesEmailed: NotesEmailResult | null = null;
  if (DONE_STATUSES.includes(status) && !DONE_STATUSES.includes(previousStatus)) {
    notesEmailed = await emailCompletionNotesOnce(admin, id);
  }

  return Response.json({ ok: true, ...(emailFailed ? { emailFailed: true } : {}), ...(notesEmailed ? { notesEmailed } : {}) });
}
