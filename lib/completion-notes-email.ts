import type { SupabaseClient } from "@supabase/supabase-js";
import { resend, fromEmail, businessName, replyToAddress } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";

/**
 * The "Your restoration is complete!" email that carries the admin's notes.
 * It goes once per order, when the work is done: when the order becomes
 * Completed (or later), or when notes are saved on an order that already is.
 * Saving notes earlier, or again, doesn't email the customer. Each send is
 * logged as an order_events row of type NOTES_EMAILED.
 */
export const DONE_STATUSES = ["completed", "shipped_back", "delivered"];
export const NOTES_EMAILED = "completion_notes_emailed";

export type NotesEmailResult = "sent" | "already_sent" | "not_done" | "no_notes" | "failed";

export async function emailCompletionNotesOnce(admin: SupabaseClient, orderId: string): Promise<NotesEmailResult> {
  const { data: order } = await admin
    .from("orders")
    .select("customer_name, customer_email, order_number, status, admin_notes")
    .eq("id", orderId)
    .maybeSingle();
  const notes = ((order?.admin_notes as string | null) ?? "").trim();
  if (!order?.customer_email || !notes) return "no_notes";
  if (!DONE_STATUSES.includes(order.status as string)) return "not_done";

  const { count, error: countErr } = await admin
    .from("order_events")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("event_type", NOTES_EMAILED);
  if (countErr) {
    console.error("[notes email] could not check earlier sends:", countErr.message);
    return "failed";
  }
  if ((count ?? 0) > 0) return "already_sent";

  const firstName = (order.customer_name as string | null)?.split(" ")[0] || "there";
  const orderTrackingUrl = `${siteUrl()}/orders/${order.order_number}`;
  const contact = escapeHtml(replyToAddress);

  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: order.customer_email as string,
      subject: `Restoration complete — notes from The Card Doc`,
      html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:900;margin-bottom:4px">Your restoration is complete!</h1>
            <p>Hi ${escapeHtml(firstName)}, we finished working on your cards and wanted to share our notes.</p>

            <div style="background:#fbfaf9;border:1px solid #e6e4e2;border-radius:12px;padding:20px;margin:20px 0">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#74716e">Restoration Notes</p>
              <p style="margin:0;font-size:15px;color:#111;white-space:pre-wrap;">${escapeHtml(notes)}</p>
            </div>

            <a href="${orderTrackingUrl}" style="display:inline-block;background:#c34104;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:24px">View Your Order →</a>

            <p style="font-size:14px;color:#666;">Questions? Reply to this email or reach out at <a href="mailto:${contact}" style="color:#c34104">${contact}</a>.</p>
            <p style="font-size:13px;color:#999">${businessName}</p>
          </div>
        `,
    });
    if (error) {
      console.error("[notes email] Resend refused it:", error.message);
      return "failed";
    }
  } catch (err) {
    console.error("[notes email] failed:", err);
    return "failed";
  }

  const { error: logErr } = await admin.from("order_events").insert({
    order_id: orderId,
    event_type: NOTES_EMAILED,
    description: "Restoration notes emailed to the customer",
    is_customer_visible: false,
  });
  if (logErr) console.error("[notes email] sent but not logged:", logErr.message);
  return "sent";
}
