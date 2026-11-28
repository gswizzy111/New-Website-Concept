/**
 * The exact texts. Pure, GSM-7 characters only (no curly quotes, no emoji,
 * no em dashes): one GSM-7 segment is 160 characters, anything else drops
 * a segment to 70. Every marketing-adjacent text ends with the opt-out line.
 */

export type OrderSmsKind = "received" | "completed" | "shipped";

/** Where questions go (the same fallback as lib/resend.ts's reply-to). */
export function smsContactEmail(): string {
  return (process.env.CONTACT_EMAIL ?? "").trim() || "thecarddoc1@gmail.com";
}

export function orderSmsText(
  kind: OrderSmsKind,
  v: { orderNumber: string; trackingUrl?: string | null },
): string {
  const order = gsm(String(v.orderNumber ?? "").trim());
  switch (kind) {
    case "received":
      return `The Card Doc: We received your cards for order ${order}. We'll text you when they're done. Reply STOP to opt out.`;
    case "completed":
      return `The Card Doc: Your cards for order ${order} are done! We'll text you tracking when they ship. Reply STOP to opt out.`;
    case "shipped": {
      const url = (v.trackingUrl ?? "").trim();
      return url && /^https?:\/\/\S+$/.test(url)
        ? `The Card Doc: Order ${order} is on its way back to you. Track it: ${url} Reply STOP to opt out.`
        : `The Card Doc: Order ${order} is on its way back to you. Reply STOP to opt out.`;
    }
  }
}

export const SMS_HELP_TEXT = `The Card Doc: order updates by text. Questions? Email ${smsContactEmail()}. Msg & data rates may apply. Reply STOP to opt out.`;

export const SMS_STOP_TEXT = "The Card Doc: You're unsubscribed and won't get more texts. Reply START to opt back in.";

/** Confirmation after START (Telnyx's opt-in auto-reply usually covers it). */
export const SMS_START_TEXT = "The Card Doc: You're subscribed to order updates again. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

/** Adds " Reply STOP to opt out." unless the text already mentions STOP. */
export function withStopLine(text: string): string {
  const t = text.trim();
  if (/\bstop\b/i.test(t)) return t;
  return `${t}${/[.!?]$/.test(t) ? "" : "."} Reply STOP to opt out.`;
}

const GSM_REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "―": "-", "−": "-",
  "…": "...", " ": " ", "•": "-",
};

/** Swaps the usual typographic characters for plain ones. */
export function gsm(text: string): string {
  return text.replace(/[‘’‚‛“”„–—―−… •]/g, (c) => GSM_REPLACEMENTS[c] ?? c);
}

// GSM 03.38 basic set plus the extension table (which costs 2 characters)
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€\f";

/** True when every character is in the GSM-7 alphabet. */
export function isGsm7(text: string): boolean {
  for (const c of text) if (!GSM_BASIC.includes(c) && !GSM_EXT.includes(c)) return false;
  return true;
}

/** How many SMS segments the text costs (GSM-7: 160 / 153 per part; UCS-2: 70 / 67). */
export function smsSegments(text: string): number {
  if (!text) return 0;
  if (isGsm7(text)) {
    let len = 0;
    for (const c of text) len += GSM_EXT.includes(c) ? 2 : 1;
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  const len = [...text].reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
