import { resend, fromEmail, businessName } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";

/**
 * Dated confirmation that a subscription was cancelled (Terms Section 26.3).
 * Returns whether Resend accepted it (it reports failures instead of throwing).
 */
export async function sendCancellationEmail(to: string, name: string | null, cancelledAt: Date): Promise<boolean> {
  const when = cancelledAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/New_York" });
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to,
      subject: `Your Monthly Kit Club subscription is cancelled — ${businessName}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;font-size:15px;line-height:1.6;color:#222">
      <p>Hi ${escapeHtml((name ?? "").split(" ")[0] || "there")},</p>
      <p>Your Monthly Kit Club subscription was cancelled on ${when} ET. You won't be charged again. If a kit was already paid for, it still ships.</p>
      <p>Questions? Reply to this email or write to thecarddoc1@gmail.com.</p>
      <p style="color:#666;font-size:13px">${businessName}</p>
    </div>`,
    });
    if (error) {
      console.error("Cancellation email failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Cancellation email failed:", err);
    return false;
  }
}
