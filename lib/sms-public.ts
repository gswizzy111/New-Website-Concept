/**
 * Public-side helpers for text-message opt-ins (pure: no network, no
 * database). The waitlist form and its API route share them, so the browser
 * and the server agree on when a phone is good enough for texts.
 */
import { toE164 } from "@/lib/sms/phone";

/** Where the linked words in the consent wording go (the stored text keeps the plain words). */
export const SMS_CONSENT_LINKS: Record<string, string> = {
  "SMS Terms": "/sms-terms",
  "Privacy Policy": "/privacy",
};

export type ConsentPart = { text: string; href?: string };

/**
 * Splits consent wording into plain runs and linked words, in order:
 * "...See our SMS Terms and Privacy Policy." -> [..., {text:"SMS Terms",
 * href:"/sms-terms"}, {text:" and "}, {text:"Privacy Policy", href:"/privacy"},
 * {text:"."}]. Joining every part's text gives back the wording exactly.
 */
export function consentParts(text: string): ConsentPart[] {
  const words = Object.keys(SMS_CONSENT_LINKS).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${words.join("|")})`, "g");
  return text
    .split(re)
    .filter((t) => t !== "")
    .map((t) => (SMS_CONSENT_LINKS[t] ? { text: t, href: SMS_CONSENT_LINKS[t] } : { text: t }));
}

/**
 * Restoration waitlist: the phone stays optional, but once the text box is
 * ticked it must be a number we can text (US or Canada, +1). Returns what to
 * fix, or null when the sign-up can go ahead.
 */
export function waitlistSmsProblem(phone: string | null | undefined, smsOptIn: boolean): string | null {
  if (!smsOptIn) return null;
  if (!(phone ?? "").trim()) return "Enter your mobile number to get a text, or untick the text box.";
  if (!toE164(phone)) return "Enter a 10-digit US or Canadian mobile number to get a text, or untick the text box.";
  return null;
}
