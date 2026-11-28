/**
 * Pure helpers for the admin's text pages (/admin/texts and the order page's
 * "Text updates" card): labels, the Setup box's lines, the reply and test
 * text wording. No database, no network: tested in tests/intake/sms-admin.test.ts.
 */
import { gsm, smsSegments } from "@/lib/sms/templates";
import type { SmsMessageKind, SmsMessageStatus } from "@/lib/sms/messages";

export const SMS_KIND_LABELS: Record<SmsMessageKind, string> = {
  received: "Cards received",
  completed: "Cards finished",
  shipped: "Shipped back",
  waitlist_open: "Waitlist: we're open",
  reply: "Reply from the shop",
};

export function smsKindLabel(kind: string): string {
  return SMS_KIND_LABELS[kind as SmsMessageKind] ?? kind;
}

export const SMS_STATUS_BADGES: Record<SmsMessageStatus, { label: string; cls: string; hint: string }> = {
  queued: { label: "Waiting", cls: "bg-gray-100 text-gray-700", hint: "Goes out on the next run (every 5 minutes, 9am to 8pm the customer's time)." },
  sending: { label: "Sending", cls: "bg-blue-100 text-blue-700", hint: "Handed to Telnyx just now." },
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-700", hint: "Telnyx sent it; the carrier hasn't confirmed delivery yet." },
  delivered: { label: "Delivered", cls: "bg-green-100 text-green-700", hint: "The carrier confirmed delivery." },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700", hint: "Telnyx or the carrier refused it; it didn't go out." },
  unknown: { label: "Unknown", cls: "bg-amber-100 text-amber-800", hint: "Telnyx didn't answer clearly, so it may have gone out. It isn't sent again by itself." },
  skipped: { label: "Skipped", cls: "bg-gray-100 text-gray-600", hint: "Not sent on purpose." },
  expired: { label: "Expired", cls: "bg-gray-100 text-gray-600", hint: "Too late to send (over 24 hours old), so it was dropped." },
};

export function smsStatusBadge(status: string): { label: string; cls: string; hint: string } {
  return SMS_STATUS_BADGES[status as SmsMessageStatus] ?? { label: status, cls: "bg-gray-100 text-gray-600", hint: "" };
}

export const CONSENT_SOURCE_LABELS: Record<string, string> = {
  restoration_checkout: "restoration checkout",
  prep_checkout: "PSA prep checkout",
  show_dropoff: "show drop-off",
  manual_order: "manual order (said yes in person)",
  waitlist: "restoration waitlist",
};

export function consentSourceLabel(source: string): string {
  return CONSENT_SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}

/** "Nov 28, 3:04 PM ET" (New York time, like the rest of the admin). Empty for no time. */
export function smsWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}

export type SmsSetupStatus = {
  apiKey: boolean;
  fromNumber: string | null;
  profileId: boolean;
  publicKey: boolean;
  preview: boolean;
};

export type SetupLine = {
  /** The env var or piece being checked */
  name: string;
  ok: boolean;
  /** Needed for texts to go out (false: optional or only for one part) */
  required: boolean;
  /** Plain words: what it is, or what's missing and what to do */
  text: string;
};

const REDEPLOY = "Add it in Netlify (Site configuration, Environment variables), then redeploy.";

/**
 * The Setup box, one line per piece, never a secret's value (the from number
 * isn't secret). tablesReady: the SMS migration is applied (the tables answer).
 */
export function setupLines(s: SmsSetupStatus, tablesReady: boolean, fromNumberLabel?: string | null): SetupLine[] {
  return [
    {
      name: "TELNYX_API_KEY",
      ok: s.apiKey,
      required: true,
      text: s.apiKey ? "Set." : `Not set. Copy an API key from Telnyx (Account settings, Keys & Credentials). ${REDEPLOY}`,
    },
    {
      name: "TELNYX_FROM_NUMBER",
      ok: !!s.fromNumber,
      required: true,
      text: s.fromNumber
        ? `Set: texts come from ${fromNumberLabel || s.fromNumber}.`
        : `Not set, or not a +1 number. Use the Telnyx number on the 10DLC campaign, written like +12015551234. ${REDEPLOY}`,
    },
    {
      name: "TELNYX_MESSAGING_PROFILE_ID",
      ok: s.profileId,
      required: false,
      text: s.profileId
        ? "Set."
        : `Optional. Not set, so Telnyx uses the profile the number is assigned to. To set it, copy the Messaging Profile's ID. ${REDEPLOY}`,
    },
    {
      name: "TELNYX_PUBLIC_KEY",
      ok: s.publicKey,
      required: false,
      text: s.publicKey
        ? "Set: replies, STOP and delivery reports are checked and accepted."
        : `Not set, so replies, STOP and delivery reports from Telnyx are refused. Copy the public key from Telnyx (Account settings, Keys & Credentials, Public Key). ${REDEPLOY}`,
    },
    {
      name: "Database tables",
      ok: tablesReady,
      required: true,
      text: tablesReady
        ? "Ready."
        : "Not set up yet. Apply supabase/migrations/20261128_sms_texts.sql to the database.",
    },
    {
      name: "Preview mode",
      ok: !s.preview,
      required: true,
      text: s.preview ? "On: this is a preview copy of the site, so it never sends texts." : "Off.",
    },
  ];
}

/** Everything needed for texts to go out is in place. */
export function setupReady(lines: SetupLine[]): boolean {
  return lines.every((l) => l.ok || !l.required);
}

/** The test text from the Setup box. */
export const TEST_SMS_TEXT = "The Card Doc: Test text from the website. Texts are working. Reply STOP to opt out.";

export const REPLY_MAX_CHARS = 480;

/**
 * What a reply from the Texts page is sent as: plain characters (curly quotes
 * and dashes swapped, so it stays a cheap GSM-7 text), starting with the shop's
 * name, as carriers expect every text to say who it's from.
 */
export function replySmsText(text: string): string {
  const t = gsm(String(text ?? "")).replace(/\r\n?/g, "\n").trim();
  if (!t) return "";
  return /^the card doc\b/i.test(t) ? t : `The Card Doc: ${t}`;
}

/** Why a reply can't be sent as typed, or null. */
export function replyProblem(text: string): string | null {
  const t = String(text ?? "").trim();
  if (!t) return "Type a reply first.";
  if (replySmsText(t).length > REPLY_MAX_CHARS) return `Keep it under ${REPLY_MAX_CHARS} characters.`;
  return null;
}

/** "1 text", "2 texts": what the reply costs, as Telnyx bills it. */
export function segmentLabel(text: string): string {
  const n = smsSegments(replySmsText(text));
  return `${n} text${n === 1 ? "" : "s"}`;
}
