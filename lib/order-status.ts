import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_STATUSES } from "@/lib/constants";
import { resend, fromEmail, businessName, replyToAddress } from "@/lib/resend";
import { siteUrl } from "@/lib/site-url";
import { escapeHtml } from "@/lib/card-inquiries";
import { DONE_STATUSES, emailCompletionNotesOnce, type NotesEmailResult } from "@/lib/completion-notes-email";

/**
 * Changing an order's status: the order row, the customer-visible
 * 'Status updated to: <label>' event (the dashboard, fast-pass page and
 * backlog_compute() read that exact text), the customer email, the admin
 * "Cards Arrived" email and the completion notes email. Moved here unchanged
 * from POST /api/admin/orders/[id]/status so receiving (lib/intake/receiving.ts)
 * marks orders received through the same code. Callers check admin access.
 */

const CUSTOMER_MESSAGES: Partial<Record<string, string>> = {
  received: "Great news — we've received your cards and they're checked in!",
  in_progress: "Your cards are now being worked on by our team.",
  completed: "Your cards are finished and looking great!",
  shipped_back: "Your cards have been shipped back to you!",
  delivered: "Your cards have been delivered. We hope you love the results!",
  cancelled: "Your order has been cancelled. Please reach out if you have any questions.",
};

export type SetOrderStatusResult =
  | { ok: true; emailFailed?: true; notesEmailed?: NotesEmailResult; skipped?: true }
  | { ok: false; httpStatus: number; error: string };

/**
 * Set an order's status exactly as the admin status buttons do.
 * `onlyIfCurrent` (receiving only): change it only while the order still has
 * that status, so two people receiving at once log and email once; when it
 * no longer does, nothing happens and the result has `skipped: true`.
 * `customerEmail: false` (a bag's "Mark shipped", lib/intake/shipping): the
 * caller has just sent the customer the shipped email with the tracking, so
 * the status email is not sent too; everything else is unchanged.
 */
export async function setOrderStatus(
  input: { orderId: string; status: unknown; trackingNumber?: string; onlyIfCurrent?: string; customerEmail?: false },
  client?: SupabaseClient,
): Promise<SetOrderStatusResult> {
  const id = input.orderId;
  const { status } = input;
  const tracking_number = typeof input.trackingNumber === "string" ? input.trackingNumber.trim() : "";

  if (typeof status !== "string" || !Object.prototype.hasOwnProperty.call(ORDER_STATUSES, status)) {
    return { ok: false, httpStatus: 400, error: "Invalid status" };
  }

  const admin = client ?? createAdminClient();

  const { data: order, error: readErr } = await admin
    .from("orders")
    .select("customer_email, customer_name, order_number, status")
    .eq("id", id)
    .single();
  if (readErr || !order) {
    return { ok: false, httpStatus: readErr?.code === "PGRST116" ? 404 : 500, error: readErr?.code === "PGRST116" ? "Order not found" : "Couldn't read the order. Nothing was changed." };
  }
  const previousStatus = order.status as string;
  if (input.onlyIfCurrent !== undefined && previousStatus !== input.onlyIfCurrent) return { ok: true, skipped: true };

  // Build update payload — only include tracking_number if provided
  const updatePayload: Record<string, unknown> = { status };
  if (tracking_number) updatePayload.tracking_number = tracking_number;

  if (input.onlyIfCurrent !== undefined) {
    const { data: claimed, error } = await admin.from("orders").update(updatePayload).eq("id", id).eq("status", input.onlyIfCurrent).select("id");
    if (error) return { ok: false, httpStatus: 500, error: error.message };
    if (!claimed?.length) return { ok: true, skipped: true };
  } else {
    const { error } = await admin.from("orders").update(updatePayload).eq("id", id);
    if (error) return { ok: false, httpStatus: 500, error: error.message };
  }

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
  if (customerMessage && order.customer_email?.trim() && input.customerEmail !== false) {
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
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
            <h1 style="font-size:20px;font-weight:900">Cards have arrived!</h1>
            <p>Order <strong>#${order.order_number}</strong> from <strong>${escapeHtml(order.customer_name ?? "")}</strong> has been marked as received.</p>
            <a href="${appUrl}/admin/orders/${id}" style="display:inline-block;background:#c0392b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">View Order</a>
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

  return { ok: true, ...(emailFailed ? { emailFailed: true as const } : {}), ...(notesEmailed ? { notesEmailed } : {}) };
}
