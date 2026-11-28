import { SMS_MANUAL_CONSENT_TEXT, SMS_ORDER_CONSENT_TEXT, type SmsConsentSource } from "@/lib/sms/consent-text";
import { toE164 } from "@/lib/sms/phone";

/**
 * Order text updates at checkout (pure: no network, no database). The
 * restoration, PSA prep and admin manual order forms send `smsOptIn: true`
 * only when their unchecked-by-default box is ticked; each route calls
 * orderSmsConsent() once its order row exists and hands the result to
 * recordOrderSmsConsentLater() (lib/sms-checkout-server.ts), which saves it
 * after the answer has gone out. Nothing here can stop or slow an order.
 */

/** Where an order's consent can come from (the waitlist has its own). */
export type OrderSmsSource = Exclude<SmsConsentSource, "waitlist">;

/** What recordSmsConsent() (lib/sms/consents.ts) takes for one order. */
export type OrderSmsConsent = {
  phone: string;
  email: string | null;
  source: OrderSmsSource;
  consentText: string;
  orderId: string;
};

/**
 * The consent to record for a new order, or null when there's nothing to
 * record: the box wasn't ticked (only a real `true` counts), there's no order
 * id, or the phone isn't a number we can text (US/Canada, lib/sms/phone.ts).
 * The customer's own box stores SMS_ORDER_CONSENT_TEXT; an order the admin
 * enters (`byAdmin`, the default for "manual_order") stores
 * SMS_MANUAL_CONSENT_TEXT, the words the admin's box shows.
 */
export function orderSmsConsent(i: {
  smsOptIn: unknown;
  phone: string | null | undefined;
  email?: string | null;
  orderId: string | null | undefined;
  source: OrderSmsSource;
  byAdmin?: boolean;
}): OrderSmsConsent | null {
  if (i.smsOptIn !== true) return null;
  if (!i.orderId) return null;
  const phone = typeof i.phone === "string" ? i.phone.trim() : "";
  if (!toE164(phone)) return null;
  const byAdmin = i.byAdmin ?? i.source === "manual_order";
  return {
    phone,
    email: typeof i.email === "string" && i.email.trim() ? i.email.trim() : null,
    source: i.source,
    consentText: byAdmin ? SMS_MANUAL_CONSENT_TEXT : SMS_ORDER_CONSENT_TEXT,
    orderId: i.orderId,
  };
}

/** A piece of the consent wording: plain words, or a link ("SMS Terms", "Privacy Policy"). */
export type ConsentPart = { text: string; href?: string; lead?: true };

/** The words that link where the consent is shown; the stored text keeps them plain. */
export const SMS_CONSENT_LINKS: readonly { words: string; href: string }[] = [
  { words: "SMS Terms", href: "/sms-terms" },
  { words: "Privacy Policy", href: "/privacy" },
];

/**
 * The consent wording split for display, word for word: the first sentence
 * marked `lead` (shown a little stronger), and each phrase in
 * SMS_CONSENT_LINKS as a link. Joining every part's text gives back the
 * exact string.
 */
export function consentTextParts(text: string): ConsentPart[] {
  const parts: ConsentPart[] = [];
  // The first sentence ends at the first ". " (or the end)
  const end = text.indexOf(". ");
  const leadEnd = end === -1 ? text.length : end + 1;
  const lead = text.slice(0, leadEnd);
  let rest = text.slice(leadEnd);
  if (lead) parts.push({ text: lead, lead: true });
  while (rest) {
    let next: { at: number; words: string; href: string } | null = null;
    for (const l of SMS_CONSENT_LINKS) {
      const at = rest.indexOf(l.words);
      if (at !== -1 && (!next || at < next.at)) next = { at, words: l.words, href: l.href };
    }
    if (!next) {
      parts.push({ text: rest });
      break;
    }
    if (next.at > 0) parts.push({ text: rest.slice(0, next.at) });
    parts.push({ text: next.words, href: next.href });
    rest = rest.slice(next.at + next.words.length);
  }
  return parts;
}
