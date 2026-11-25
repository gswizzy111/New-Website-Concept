import "server-only";
import { resend, fromEmail, businessName, replyToAddress } from "@/lib/resend";
import { siteUrl } from "@/lib/site-url";
import { escapeHtml } from "@/lib/card-inquiries";

/**
 * The customer's "Your cards have been shipped!" email with the return
 * tracking number. Moved unchanged out of POST
 * /api/admin/orders/[id]/return-label (sent when the order page buys the
 * return label) so a bag's "Mark shipped" sends the same email with that
 * bag's tracking. `note` (plain text, optional) adds one paragraph under the
 * greeting; without it the email is exactly as before. Never throws: Resend
 * failures are logged and returned.
 */
export async function sendReturnShippedEmail(
  order: { customer_email?: string | null; customer_name?: string | null; order_number?: string | number | null },
  shipment: { trackingNumber: string; trackingUrl: string | null },
  note?: string | null,
): Promise<{ sent: boolean; error?: string }> {
  const trackingNumber = shipment.trackingNumber;
  const trackingUrl = shipment.trackingUrl;
  const firstName = escapeHtml((order.customer_name as string)?.split(" ")[0] || "there");
  const appUrl = siteUrl();
  const orderTrackingUrl = `${appUrl}/orders/${order.order_number}`;
  const contact = escapeHtml(replyToAddress);
  const noteHtml = note?.trim() ? `\n              <p>${escapeHtml(note.trim())}</p>` : "";

  try {
    const { error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: order.customer_email as string,
      subject: `Your restored cards are on the way! — ${businessName}`,
      html: `
            <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:900;margin-bottom:4px">Your cards have been shipped!</h1>
              <p>Hi ${firstName}, your restored cards are on their way back to you.</p>${noteHtml}

              <div style="background:#fbfaf9;border:1px solid #e6e4e2;border-radius:12px;padding:20px;margin:20px 0">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#2d2b29">Tracking Number</p>
                <p style="margin:0 0 10px;font-family:monospace;font-size:22px;font-weight:900;color:#1e1d1a;letter-spacing:0.05em">${escapeHtml(trackingNumber)}</p>
                ${trackingUrl
                  ? `<a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background:#2d2b29;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Track Your Package →</a>`
                  : ""}
              </div>

              <a href="${orderTrackingUrl}" style="display:inline-block;background:#c34104;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:24px">View Your Order →</a>

              <p style="font-size:14px;color:#666;">If you have any questions, reply to this email or reach out at <a href="mailto:${contact}" style="color:#c34104">${contact}</a>.</p>
              <p style="font-size:13px;color:#999">${businessName}</p>
            </div>
          `,
    });
    if (sendErr) {
      console.error("Failed to send shipping email:", sendErr.message);
      return { sent: false, error: sendErr.message };
    }
    return { sent: true };
  } catch (err) {
    console.error("Failed to send shipping email:", err);
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
