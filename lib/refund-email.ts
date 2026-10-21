import { businessName } from "@/lib/resend";

// Customer email sent when an admin issues a refund (restoration and kit orders).
export function refundEmailHtml({
  orderNumber,
  firstName,
  amountFormatted,
  isFullRefund,
  customNote,
}: {
  orderNumber: string;
  firstName: string;
  amountFormatted: string;
  isFullRefund: boolean;
  customNote?: string;
}) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e4e2;">
        <!-- Header -->
        <tr><td style="background:#191816;padding:28px 32px;">
          <p style="margin:0;font-size:20px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">${businessName}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#191816;">Refund Processed</p>
          <p style="margin:0 0 24px;font-size:14px;color:#74716e;">Order #${orderNumber}</p>

          <p style="margin:0 0 20px;font-size:15px;color:#44423f;line-height:1.6;">Hi ${firstName},</p>

          ${customNote ? `<div style="background:#fbfaf9;border-left:4px solid #191816;border-radius:4px;padding:14px 16px;margin:0 0 20px;">
            <p style="margin:0;font-size:14px;color:#44423f;line-height:1.6;">${customNote.replace(/\n/g, "<br>")}</p>
          </div>` : ""}

          <p style="margin:0 0 20px;font-size:15px;color:#44423f;line-height:1.6;">
            A ${isFullRefund ? "full" : "partial"} refund of <strong>${amountFormatted}</strong> has been processed to your original payment method.
            It typically takes <strong>5–10 business days</strong> to appear on your statement, depending on your bank.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf9;border-radius:8px;padding:16px;margin-bottom:24px;">
            <tr>
              <td style="font-size:13px;color:#74716e;">Refund amount</td>
              <td align="right" style="font-size:15px;font-weight:800;color:#191816;">${amountFormatted}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#74716e;padding-top:6px;">Order number</td>
              <td align="right" style="font-size:13px;color:#44423f;padding-top:6px;">#${orderNumber}</td>
            </tr>
          </table>

          <p style="margin:0 0 24px;font-size:14px;color:#44423f;line-height:1.6;">
            If you have any questions, just reply to this email and we'll get back to you.
          </p>

          <p style="margin:0;font-size:14px;color:#44423f;">Thanks,<br /><strong>${businessName}</strong></p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #f1f0ee;">
          <p style="margin:0;font-size:12px;color:#a19e9a;text-align:center;">${businessName} · thecarddoc1.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
