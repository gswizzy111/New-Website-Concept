import { createAdminClient } from "@/lib/supabase/admin";
import { fromEmail, businessName } from "@/lib/resend";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { smsConfigured } from "@/lib/sms/config";
import { isMissingTable } from "@/lib/sms/db";
import { sendOneOffSms } from "@/lib/sms/outbox";
import { toE164 } from "@/lib/sms/phone";
import { optedOutPhones, planWaitlistTexts, waitlistSmsText, type OptEventRow, type WaitlistConsentRow } from "./telnyx-plan";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";
import {
  firstNameOf,
  isSendableAddress,
  marketingFooterHtml,
  marketingSendProblem,
  mergeFirstName,
  newUnsubscribeTokens,
  normalizeEmail,
  requestHosts,
  sendBatch,
  undeliverableEmails,
  unsubscribedEmails,
  unsubscribeHeaders,
  unsubscribeUrl,
  type BatchMessage,
} from "@/lib/email-unsubscribe";

export const maxDuration = 60;

const DEFAULT_SUBJECT = `We're accepting restorations again — ${businessName}`;
const DEFAULT_EMAIL_BODY = `Hi [first name], great news — ${businessName} is now accepting restoration orders again.

You signed up to be notified, so we wanted to reach out right away.

Spots fill up fast — book soon to secure your place in the queue.`;
const DEFAULT_SMS = `Hi [first name]! ${businessName} is now accepting restoration orders. Book your spot:`;

const bookingUrl = `${siteUrl()}/tier-selection`;

// People per request. The page sends a big list in parts of this size, so each
// request (one email batch, then the texts a few at a time) ends well inside
// the function time limit.
const MAX_PER_REQUEST = 25;
// Texts sent at once, and how long one may take
const TEXT_CONCURRENCY = 10;
const TEXT_TIMEOUT_MS = 6_000;
// Telnyx texts sent at once (10DLC numbers have a per-second limit)
const TELNYX_CONCURRENCY = 5;

function personalize(template: string, firstName: string): string {
  return mergeFirstName(template, firstName);
}

// The notice is marketing: it carries the unsubscribe link and postal address
function bodyToHtml(body: string, unsubscribeLink: string): string {
  return `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.6">
      ${body
        .split("\n")
        .map((line) =>
          line.trim() === ""
            ? "<br>"
            : `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`
        )
        .join("")}
      <p style="margin:24px 0">
        <a href="${bookingUrl}" style="background:#c34104;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px">
          Book Your Restoration
        </a>
      </p>
      ${marketingFooterHtml(businessName, unsubscribeLink)}
    </div>
  `;
}

/** The text, with the booking link added unless it already has one. */
function smsText(template: string, firstName: string): string {
  const text = personalize(template, firstName);
  return /\/tier-selection\b/i.test(text) ? text : `${text} ${bookingUrl}`;
}

// Logs name the waitlist row, never the phone number
async function sendText(personId: string, phone: string, message: string, key: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  try {
    const res = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized, message, key }),
      signal: AbortSignal.timeout(TEXT_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) return true;
    console.error("Textbelt error for waitlist row", personId, data.error);
  } catch (e) {
    console.error("Failed to text waitlist row", personId, e instanceof Error ? e.message : e);
  }
  return false;
}

/**
 * Tells restoration-waitlist signups that restorations are open: an email to
 * each, and a text to those who gave a phone number (when TEXTBELT_API_KEY is
 * set). Each person is marked notified as soon as their email or text goes
 * out, so a second send doesn't contact them again. The email is marketing
 * (lib/email-unsubscribe.ts): it has an unsubscribe link and the postal
 * address, and isn't sent to addresses that unsubscribed, bounced or marked
 * our email as spam (their text still goes).
 *
 * Once Telnyx is set up (lib/sms, smsConfigured()), the texts go through it
 * instead, and only to people who ticked the text box when they signed up (an
 * sms_consents row from the waitlist, matched by their row, else by phone) and
 * haven't replied STOP, each ending with "Reply STOP to opt out."; phones with
 * no text opt-in are counted (textsNoOptIn), not texted. Until then, Textbelt
 * as before.
 *
 * Body: ids (at most 25; the page sends a longer list in parts), the message
 * texts, and since: when the page loaded its list, by the server's clock, kept
 * by the page until a send finishes. Anyone notified at or after it is skipped
 * (counted in alreadyNotified), so a part that's sent again after a lost reply
 * never reaches the same people twice. Without ids, the next 25 people not
 * yet notified are sent.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse optional body — supports custom messages and specific recipient IDs
  let ids: string[] | undefined;
  let emailSubject = DEFAULT_SUBJECT;
  let emailBody = DEFAULT_EMAIL_BODY;
  let smsMessage = DEFAULT_SMS;
  let since: string | null = null; // ISO time
  // Which list: the original restoration waitlist, or the sold-out pop-up's own list
  let table: "restoration_waitlist" | "sold_out_waitlist" = "restoration_waitlist";

  try {
    const body = await request.json();
    if (Array.isArray(body.ids)) ids = body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    if (typeof body.emailSubject === "string" && body.emailSubject.trim()) emailSubject = body.emailSubject;
    if (typeof body.emailBody === "string" && body.emailBody.trim()) emailBody = body.emailBody;
    if (typeof body.smsMessage === "string" && body.smsMessage.trim()) smsMessage = body.smsMessage;
    if (body.list === "sold_out") table = "sold_out_waitlist";
    if (typeof body.since === "string" && !Number.isNaN(Date.parse(body.since))) since = new Date(body.since).toISOString();
  } catch {
    // no body — use defaults, send to the next people not yet notified
  }

  if (ids && ids.length === 0) return Response.json({ ok: true, sent: 0, texts: 0, notified: [], failed: [], alreadyNotified: 0 });
  if (ids && ids.length > MAX_PER_REQUEST) {
    return Response.json({ error: `Send to at most ${MAX_PER_REQUEST} people per request.` }, { status: 400 });
  }

  // US anti-spam law asks for a postal address and an unsubscribe link that works
  const problem = marketingSendProblem(requestHosts(request.headers));
  if (problem) return Response.json({ error: `Nothing was sent. ${problem}` }, { status: 409 });

  let unsubscribed: Set<string>;
  let undeliverable: Set<string>;
  try {
    [unsubscribed, undeliverable] = await Promise.all([unsubscribedEmails(), undeliverableEmails()]);
  } catch (err) {
    console.error("Waitlist: unsubscribe/bounce lists unreadable:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't read the unsubscribe and bounce lists, so nothing was sent. Try again in a minute." }, { status: 500 });
  }

  const admin = createAdminClient();

  let query = admin.from(table).select("id, name, email, phone, notified_at");
  if (ids) {
    query = query.in("id", ids);
  } else {
    query = query.is("notified_at", null).order("created_at", { ascending: true }).order("id").limit(MAX_PER_REQUEST);
  }

  const { data: rows, error } = await query;
  if (error) return Response.json({ error: "Failed to load waitlist." }, { status: 500 });

  // Reached earlier in this same send: don't contact them twice
  const sinceMs = since ? Date.parse(since) : NaN;
  const alreadyDone = (rows ?? []).filter((p) => p.notified_at && Date.parse(p.notified_at) >= sinceMs);
  const waitlist = (rows ?? []).filter((p) => !alreadyDone.includes(p));

  const notified = new Set<string>(alreadyDone.map((p) => p.id as string));
  const failed: { email: string; reason: string }[] = [];
  let textsSent = 0;
  const textbeltKey = process.env.TEXTBELT_API_KEY;

  async function markNotified(personIds: string[]): Promise<string | null> {
    if (personIds.length === 0) return null;
    const { error: markError } = await admin
      .from(table)
      .update({ notified_at: new Date().toISOString() })
      .in("id", personIds);
    if (markError) return markError.message;
    for (const id of personIds) notified.add(id);
    return null;
  }

  // Emails: one batch (at most 25). A malformed, unsubscribed or bouncing
  // address is left out and reported, instead of sinking the batch.
  const byEmail = new Map<string, string[]>();
  const firstNames = new Map<string, string>();
  for (const person of waitlist) {
    const email = normalizeEmail(person.email);
    if (!isSendableAddress(email)) {
      failed.push({ email: person.email || "(no email)", reason: "Not a valid email address" });
      continue;
    }
    if (unsubscribed.has(email)) {
      failed.push({ email, reason: "Unsubscribed from marketing emails" });
      continue;
    }
    if (undeliverable.has(email)) {
      failed.push({ email, reason: "Bounced, blocked or marked as spam before" });
      continue;
    }
    // The same address twice in the list gets one email
    if (byEmail.has(email)) {
      byEmail.get(email)!.push(person.id);
      continue;
    }
    byEmail.set(email, [person.id]);
    firstNames.set(email, firstNameOf(person.name));
  }

  let tokens: Map<string, string>;
  try {
    tokens = await newUnsubscribeTokens(Array.from(byEmail.keys()));
  } catch (err) {
    console.error("Waitlist:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't save the unsubscribe links, so nothing was sent. Try again in a minute." }, { status: 500 });
  }
  const messages: BatchMessage[] = Array.from(byEmail.keys()).map((email) => {
    const token = tokens.get(email)!;
    return {
      from: fromEmail,
      to: email,
      subject: emailSubject,
      html: bodyToHtml(personalize(emailBody, firstNames.get(email) ?? ""), unsubscribeUrl(token)),
      headers: unsubscribeHeaders(token),
    };
  });

  const outcome = await sendBatch(messages);
  if (outcome.batchError) {
    // Resend took none of them (a rate limit that didn't clear, the daily
    // quota, an outage): stop here, before any texts, so everyone in this part
    // can be sent again together later
    return Response.json({
      error: `Resend didn't take the emails, so sending stopped: ${outcome.batchError}`,
      sent: 0,
      texts: 0,
      notified: Array.from(notified),
      failed,
      alreadyNotified: alreadyDone.length,
    }, { status: 502 });
  }
  failed.push(...outcome.failed);
  const emailsSent = outcome.sent.length;

  // Marked as soon as the email is out, before the texts
  const emailedIds = outcome.sent.flatMap((email) => byEmail.get(email) ?? []);
  const markError = await markNotified(emailedIds);
  if (markError) {
    console.error("Waitlist: emails sent but notified_at not saved:", markError);
    return Response.json({
      error: `${emailsSent} email${emailsSent !== 1 ? "s" : ""} went out, but they couldn't be marked as notified, so sending stopped: ${markError}`,
      sent: emailsSent,
      texts: 0,
      // Reached, even though the mark didn't save: the page takes them off the selection
      notified: [...Array.from(notified), ...emailedIds],
      failed,
      alreadyNotified: alreadyDone.length,
    }, { status: 500 });
  }

  const textedOnly: string[] = [];
  let textsNoOptIn = 0;
  let textsOptedOut = 0;
  let textError: string | null = null;
  const viaTelnyx = smsConfigured();
  if (viaTelnyx) {
    // Telnyx: only people who agreed to texts, never a number that replied STOP
    const telnyx = await sendTelnyxTexts({
      admin,
      people: waitlist,
      matchWaitlistId: table === "restoration_waitlist",
      text: (name) => waitlistSmsText(smsText(smsMessage, firstNameOf(name))),
      createdBy: (await getAdminSession())?.username ?? null,
    });
    textsSent = telnyx.sent;
    textsNoOptIn = telnyx.noOptIn;
    textsOptedOut = telnyx.optedOut;
    textError = telnyx.error;
    for (const id of telnyx.textedIds) if (!notified.has(id)) textedOnly.push(id);
  } else {
    // Send SMS a few at a time (Textbelt has no batch API)
    const toText = textbeltKey ? waitlist.filter((p) => p.phone) : [];
    for (let i = 0; i < toText.length; i += TEXT_CONCURRENCY) {
      const group = toText.slice(i, i + TEXT_CONCURRENCY);
      const results = await Promise.all(
        group.map((person) => sendText(person.id, person.phone as string, smsText(smsMessage, firstNameOf(person.name)), textbeltKey!))
      );
      results.forEach((ok, j) => {
        if (!ok) return;
        textsSent++;
        if (!notified.has(group[j].id)) textedOnly.push(group[j].id);
      });
    }
  }

  // Reached by text only (their email didn't go out)
  const textMarkError = await markNotified(textedOnly);
  if (textMarkError) console.error("Waitlist: texts sent but notified_at not saved:", textMarkError);

  return Response.json({
    ok: !textMarkError,
    sent: emailsSent,
    texts: textsSent,
    notified: Array.from(notified),
    failed,
    alreadyNotified: alreadyDone.length,
    textsVia: viaTelnyx ? "telnyx" : textbeltKey ? "textbelt" : null,
    ...(viaTelnyx ? { textsNoOptIn, textsOptedOut } : {}),
    ...(textError ? { textError } : {}),
    ...(textMarkError ? { error: `Texts went out, but some couldn't be marked as notified: ${textMarkError}` } : {}),
  }, { status: textMarkError ? 500 : 200 });
}

type WaitlistRow = { id: string; name: string | null; phone: string | null };

/**
 * The texts of one part through Telnyx (lib/sms/outbox.ts logs each in
 * sms_messages and checks the opt-out again as it sends). Reads the part's
 * waitlist consents and opt-outs in two queries. A table that isn't there yet
 * (the SMS migration) or a read that fails sends no texts and says why in
 * `error`; the emails already went out, so the part still succeeds.
 */
async function sendTelnyxTexts({ admin, people, matchWaitlistId, text, createdBy }: {
  admin: ReturnType<typeof createAdminClient>;
  people: WaitlistRow[];
  matchWaitlistId: boolean;
  text: (name: string | null) => string;
  createdBy: string | null;
}): Promise<{ sent: number; textedIds: string[]; noOptIn: number; optedOut: number; error: string | null }> {
  const none = { sent: 0, textedIds: [] as string[], noOptIn: 0, optedOut: 0 };
  const withPhone = people.filter((p) => (p.phone ?? "").trim());
  const ids = people.map((p) => p.id);
  const phones = [...new Set(withPhone.map((p) => toE164(p.phone)).filter((p): p is string => !!p))];
  if (ids.length === 0) return { ...none, error: null };

  const consentQuery = () => admin.from("sms_consents").select("phone_e164, waitlist_id").eq("source", "waitlist");
  const [byRow, byPhone] = await Promise.all([
    matchWaitlistId ? consentQuery().in("waitlist_id", ids) : Promise.resolve({ data: [], error: null }),
    phones.length ? consentQuery().in("phone_e164", phones) : Promise.resolve({ data: [], error: null }),
  ]);
  const consentError = byRow.error ?? byPhone.error;
  if (consentError) {
    if (isMissingTable(consentError)) {
      return { ...none, noOptIn: planWaitlistTexts(people, [], new Set(), { matchWaitlistId }).noOptIn, error: "No texts went out: the text tables aren't set up yet (see Texts in the menu)." };
    }
    console.error("Waitlist: text opt-ins unreadable:", consentError.message);
    return { ...none, error: "No texts went out: couldn't read who agreed to texts. The emails went out." };
  }
  const consents = [...(byRow.data ?? []), ...(byPhone.data ?? [])] as WaitlistConsentRow[];

  const candidates = [...new Set(planWaitlistTexts(people, consents, new Set(), { matchWaitlistId }).texts.map((t) => t.phone))];
  let stopped = new Set<string>();
  if (candidates.length) {
    const { data: events, error: optError } = await admin
      .from("sms_opt_events")
      .select("phone_e164, event, created_at")
      .in("phone_e164", candidates)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (optError && !isMissingTable(optError)) {
      // Can't tell who replied STOP: text nobody
      console.error("Waitlist: text opt-outs unreadable:", optError.message);
      return { ...none, error: "No texts went out: couldn't read who replied STOP. The emails went out." };
    }
    stopped = optedOutPhones((events ?? []) as OptEventRow[]);
  }

  const plan = planWaitlistTexts(people, consents, stopped, { matchWaitlistId });
  let sent = 0;
  const textedIds: string[] = [];
  let lastError: string | null = null;
  for (let i = 0; i < plan.texts.length; i += TELNYX_CONCURRENCY) {
    const group = plan.texts.slice(i, i + TELNYX_CONCURRENCY);
    const results = await Promise.all(
      group.map((t) => sendOneOffSms({ to: t.phone, text: text(t.person.name), kind: "waitlist_open", createdBy })),
    );
    results.forEach((r, j) => {
      if (r.ok) {
        sent++;
        textedIds.push(...group[j].ids);
        return;
      }
      // Logs name the waitlist row, never the phone number
      console.error("Telnyx text not sent for waitlist row", group[j].person.id, r.error);
      lastError = r.error;
    });
  }
  const failedCount = plan.texts.length - sent;
  return {
    sent,
    textedIds,
    noOptIn: plan.noOptIn,
    optedOut: plan.optedOut,
    error: failedCount > 0 ? `${failedCount} text${failedCount !== 1 ? "s" : ""} didn't go out${lastError ? `: ${lastError}` : ""}.` : null,
  };
}
