import { businessName } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";

/**
 * The unpaid-order reminder (lib/checkout-reminder.ts): one email to a
 * restoration or prep customer who reached Stripe but didn't pay, with a
 * button back to that same Stripe payment page. Same look as the order
 * confirmation (lib/confirmation-email.ts). Transactional, about an order the
 * customer signed: no discounts, no pressure, no unsubscribe footer. Replies
 * go to lib/resend.ts's reply-to address.
 */
export type CheckoutReminderEmailInput = {
  orderNumber: string;
  customerName: string | null;
  /** Prep orders say "prep order", every other order "restoration order" */
  isPrep: boolean;
  cardCount: number;
  totalCents: number;
  /** The open Stripe Checkout page */
  paymentUrl: string;
  /** How long the Stripe page stays open from when checkout started */
  sessionLifetimeMinutes: number;
};

export const CHECKOUT_REMINDER_SUBJECT = "Your Card Doc order isn't finished yet";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "about an hour" for the 60-minute gift card sessions, "about 24 hours"
 * for Stripe's default: whatever the session was actually given. */
export function linkLifetimeText(minutes: number): string {
  if (minutes <= 90) return "about an hour";
  const hours = Math.round(minutes / 60);
  return `about ${hours} hours`;
}

export function checkoutReminderEmail(input: CheckoutReminderEmailInput): { subject: string; html: string; text: string } {
  const site = siteUrl();
  const siteHost = new URL(site).host;
  // Only something that looks like a first name is used; anything else (a
  // link, an address, digits, a very long word) becomes "there", so the email
  // can't be used to send someone else words of the sender's choosing
  const firstWord = (input.customerName ?? "").trim().split(/\s+/)[0] ?? "";
  const firstName = /^[\p{L}][\p{L}'’-]{0,29}$/u.test(firstWord) ? firstWord : "there";
  const kind = input.isPrep ? "prep order" : "restoration order";
  const cards = `${input.cardCount} ${input.cardCount === 1 ? "card" : "cards"}`;
  const summary = `You started a ${kind} (#${input.orderNumber}, ${cards}, ${money(input.totalCents)}) but didn't finish paying, so it isn't placed yet and you haven't been charged.`;
  const lifetime = linkLifetimeText(input.sessionLifetimeMinutes);
  const expiryLine = `This payment link works for ${lifetime} from when you started checkout. If it has expired, you can place your order again at`;

  const html = `
      <div style="display:none;max-height:0;overflow:hidden;opacity:0">You haven't been charged. Here's the link to finish your order.</div>
      <div style="font-family:Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;color:#111">
        <div style="background:#a23200;border-radius:12px 12px 0 0;padding:24px;text-align:center">
          <p style="margin:0;color:#fed8c4;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(businessName)}</p>
          <h1 style="font-family:Georgia,'Times New Roman',serif;margin:6px 0 0;color:#fff;font-size:28px;font-weight:900">Your order isn't finished yet</h1>
        </div>
        <div style="background:#fff;border:1px solid #e6e4e2;border-top:0;border-radius:0 0 12px 12px;padding:28px">
          <p style="color:#666;margin:0 0 4px;font-size:13px">Order number</p>
          <p style="margin:0 0 20px;font-size:22px;font-weight:900;color:#111">#${escapeHtml(input.orderNumber)}</p>
          <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 8px;font-size:15px;color:#333;line-height:1.6">${escapeHtml(summary)}</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${escapeHtml(input.paymentUrl)}" style="display:inline-block;background:#a23200;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:17px">Finish payment</a>
          </div>
          <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6">
            ${escapeHtml(expiryLine)} <a href="${escapeHtml(site)}" style="color:#a23200;font-weight:600">${escapeHtml(siteHost)}</a>.
          </p>
          <hr style="border:none;border-top:1px solid #e6e4e2;margin:24px 0">
          <p style="font-size:13px;color:#666;margin:0">Questions? Just reply to this email.</p>
        </div>
      </div>
    `;

  const text = [
    `Hi ${firstName},`,
    "",
    summary,
    "",
    `Finish payment: ${input.paymentUrl}`,
    "",
    `${expiryLine} ${site}`,
    "",
    "Questions? Just reply to this email.",
    "",
    businessName,
  ].join("\n");

  return { subject: CHECKOUT_REMINDER_SUBJECT, html, text };
}
