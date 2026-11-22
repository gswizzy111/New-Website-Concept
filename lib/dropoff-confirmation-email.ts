import { resend, fromEmail, businessName } from "@/lib/resend";
import { siteUrl } from "@/lib/site-url";
import { escapeHtml } from "@/lib/card-inquiries";
import { trackingUrl } from "@/lib/customer-email";

/**
 * Invites the customer to make an account with the email the order is under.
 * Accounts list every order placed under their email (app/account/page.tsx),
 * with each card's progress and Request Update, so a drop-off or manual order
 * shows up there like a website order.
 */
export function accountInviteHtml(email: string): string {
  const appUrl = siteUrl();
  return `<div style="background:#f4f6ff;border:2px solid #c7d2fe;border-radius:12px;padding:24px;margin:24px 0">
      <p style="margin:0 0 6px;font-size:18px;font-weight:900;color:#1e2a6e">👤 Follow Your Cards Online</p>
      <p style="margin:0 0 16px;color:#2f3b7a;font-size:14px;line-height:1.6">
        Create a free account on our website with this email address (<strong>${escapeHtml(email)}</strong>).
        Your order will be waiting there: you can see each card's progress and request updates.
      </p>
      <a href="${escapeHtml(`${appUrl}/account/login?tab=signup`)}" style="display:inline-block;background:#1e2a6e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Create Your Account →</a>
      <p style="margin:12px 0 0;font-size:13px;color:#2f3b7a">Already have one? <a href="${escapeHtml(`${appUrl}/account/login`)}" style="color:#1e2a6e;font-weight:600">Log in</a> and it's under Restoration Orders.</p>
    </div>`;
}

export type DropoffConfirmationOrder = {
  order_number: string | number;
  customer_name: string | null;
  customer_email: string;
};

/**
 * The confirmation for cards dropped off in person: the order number, the
 * cards we logged, and how to follow them online. Returns Resend's error
 * message, or null when it was sent (Resend's send() never throws).
 */
export async function sendDropoffConfirmationEmail(
  order: DropoffConfirmationOrder,
  cardNames: string[],
): Promise<string | null> {
  const firstName = (order.customer_name ?? "").split(" ")[0] || "there";
  const orderNumber = String(order.order_number);
  const statusUrl = trackingUrl(order);
  const cardList = cardNames.length
    ? `<div style="background:#fbfaf9;border:1px solid #e6e4e2;border-radius:12px;padding:16px 20px;margin:0 0 8px">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#2d2b29">Your cards (${cardNames.length})</p>
        <ol style="margin:0;padding-left:20px;color:#333;font-size:14px;line-height:1.8">
          ${cardNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
        </ol>
      </div>`
    : "";

  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: order.customer_email,
      subject: `Drop-off Confirmed — ${businessName} #${orderNumber}`,
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;color:#111">
          <div style="background:#a23200;border-radius:12px 12px 0 0;padding:24px;text-align:center">
            <p style="margin:0;color:#fed8c4;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">${businessName}</p>
            <h1 style="font-family:Georgia,'Times New Roman',serif;margin:6px 0 0;color:#fff;font-size:28px;font-weight:900">Drop-off Confirmed ✓</h1>
          </div>
          <div style="background:#fff;border:1px solid #e6e4e2;border-top:0;border-radius:0 0 12px 12px;padding:28px">
            <p style="color:#666;margin:0 0 4px;font-size:13px">Order number</p>
            <p style="margin:0 0 20px;font-size:22px;font-weight:900;color:#111">#${escapeHtml(orderNumber)}</p>
            <p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.6">
              Hi ${escapeHtml(firstName)}! 👋 Thanks for dropping off your cards. They're with us now, logged under the order number above.
            </p>
            ${cardList}
            ${accountInviteHtml(order.customer_email)}
            <div style="text-align:center;margin:24px 0">
              <a href="${escapeHtml(statusUrl)}" style="display:inline-block;background:#111;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">View Your Order Status →</a>
            </div>
            <hr style="border:none;border-top:1px solid #e6e4e2;margin:24px 0">
            <p style="font-size:13px;color:#666;margin:0 0 6px">Questions? We're always happy to help:</p>
            <p style="font-size:13px;color:#333;margin:0">
              Instagram: <a href="https://instagram.com/the_card_doc" style="color:#a23200;font-weight:600">@the_card_doc</a>
            </p>
          </div>
        </div>
      `,
    });
    return error ? error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Just the sign-up invite, for any order (Send Sign-up Email on the admin
 * order page): thanks for the order, and make an account with this email to
 * track it. Returns Resend's error message, or null when it was sent.
 */
export async function sendAccountInviteEmail(order: DropoffConfirmationOrder): Promise<string | null> {
  const firstName = (order.customer_name ?? "").split(" ")[0] || "there";
  const orderNumber = String(order.order_number);
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: order.customer_email,
      subject: `Track Your Order — ${businessName} #${orderNumber}`,
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;color:#111">
          <div style="background:#a23200;border-radius:12px 12px 0 0;padding:24px;text-align:center">
            <p style="margin:0;color:#fed8c4;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">${businessName}</p>
            <h1 style="font-family:Georgia,'Times New Roman',serif;margin:6px 0 0;color:#fff;font-size:28px;font-weight:900">Thanks for Your Order!</h1>
          </div>
          <div style="background:#fff;border:1px solid #e6e4e2;border-top:0;border-radius:0 0 12px 12px;padding:28px">
            <p style="color:#666;margin:0 0 4px;font-size:13px">Order number</p>
            <p style="margin:0 0 20px;font-size:22px;font-weight:900;color:#111">#${escapeHtml(orderNumber)}</p>
            <p style="margin:0;font-size:15px;color:#333;line-height:1.6">
              Hi ${escapeHtml(firstName)}! 👋 Thanks for your order. Sign up on our website to track its status.
            </p>
            ${accountInviteHtml(order.customer_email)}
            <hr style="border:none;border-top:1px solid #e6e4e2;margin:24px 0">
            <p style="font-size:13px;color:#666;margin:0 0 6px">Questions? We're always happy to help:</p>
            <p style="font-size:13px;color:#333;margin:0">
              Instagram: <a href="https://instagram.com/the_card_doc" style="color:#a23200;font-weight:600">@the_card_doc</a>
            </p>
          </div>
        </div>
      `,
    });
    return error ? error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
