import { createAdminClient } from "@/lib/supabase/admin";
import { fromEmail, businessName } from "@/lib/resend";
import { isAdmin } from "@/lib/admin-auth";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";
import { firstNameOf, isSendableAddress, mergeFirstName, normalizeEmail, sendBatch, type BatchMessage } from "@/lib/email-unsubscribe";

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

function personalize(template: string, firstName: string): string {
  return mergeFirstName(template, firstName);
}

function bodyToHtml(body: string): string {
  const site = siteUrl();
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
      <hr style="margin:28px 0;border:none;border-top:1px solid #eee" />
      <p style="font-size:12px;color:#999;margin:0">${escapeHtml(businessName)} · <a href="${site}" style="color:#999">${escapeHtml(new URL(site).host)}</a></p>
    </div>
  `;
}

/** The text, with the booking link added unless it already has one. */
function smsText(template: string, firstName: string): string {
  const text = personalize(template, firstName);
  return /\/tier-selection\b/i.test(text) ? text : `${text} ${bookingUrl}`;
}

async function sendText(phone: string, message: string, key: string): Promise<boolean> {
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
    console.error("Textbelt error for", normalized, data.error);
  } catch (e) {
    console.error("Failed to text", normalized, e instanceof Error ? e.message : e);
  }
  return false;
}

/**
 * Tells restoration-waitlist signups that restorations are open: an email to
 * each, and a text to those who gave a phone number (when TEXTBELT_API_KEY is
 * set). Each person is marked notified as soon as their email or text goes
 * out, so a second send doesn't contact them again.
 *
 * Body: ids (at most 25; the page sends a longer list in parts), the message
 * texts, and since: when this send began, so a part that's sent again (after
 * a dropped connection) skips the people this send already reached. Without
 * ids, the next 25 people not yet notified are sent.
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

  try {
    const body = await request.json();
    if (Array.isArray(body.ids)) ids = body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    if (typeof body.emailSubject === "string" && body.emailSubject.trim()) emailSubject = body.emailSubject;
    if (typeof body.emailBody === "string" && body.emailBody.trim()) emailBody = body.emailBody;
    if (typeof body.smsMessage === "string" && body.smsMessage.trim()) smsMessage = body.smsMessage;
    if (typeof body.since === "string" && !Number.isNaN(Date.parse(body.since))) since = new Date(body.since).toISOString();
  } catch {
    // no body — use defaults, send to the next people not yet notified
  }

  if (ids && ids.length === 0) return Response.json({ ok: true, sent: 0, texts: 0, notified: [], failed: [] });
  if (ids && ids.length > MAX_PER_REQUEST) {
    return Response.json({ error: `Send to at most ${MAX_PER_REQUEST} people per request.` }, { status: 400 });
  }

  const admin = createAdminClient();

  let query = admin.from("restoration_waitlist").select("id, name, email, phone, notified_at");
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
      .from("restoration_waitlist")
      .update({ notified_at: new Date().toISOString() })
      .in("id", personIds);
    if (markError) return markError.message;
    for (const id of personIds) notified.add(id);
    return null;
  }

  // Emails: one batch (at most 25). A malformed address is left out and
  // reported, instead of sinking the batch.
  const byEmail = new Map<string, string[]>();
  const messages: BatchMessage[] = [];
  for (const person of waitlist) {
    const email = normalizeEmail(person.email);
    if (!isSendableAddress(email)) {
      failed.push({ email: person.email || "(no email)", reason: "Not a valid email address" });
      continue;
    }
    // The same address twice in the list gets one email
    if (byEmail.has(email)) {
      byEmail.get(email)!.push(person.id);
      continue;
    }
    byEmail.set(email, [person.id]);
    messages.push({
      from: fromEmail,
      to: email,
      subject: emailSubject,
      html: bodyToHtml(personalize(emailBody, firstNameOf(person.name))),
    });
  }

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
    }, { status: 500 });
  }

  // Send SMS a few at a time (Textbelt has no batch API)
  const toText = textbeltKey ? waitlist.filter((p) => p.phone) : [];
  const textedOnly: string[] = [];
  for (let i = 0; i < toText.length; i += TEXT_CONCURRENCY) {
    const group = toText.slice(i, i + TEXT_CONCURRENCY);
    const results = await Promise.all(
      group.map((person) => sendText(person.phone as string, smsText(smsMessage, firstNameOf(person.name)), textbeltKey!))
    );
    results.forEach((ok, j) => {
      if (!ok) return;
      textsSent++;
      if (!notified.has(group[j].id)) textedOnly.push(group[j].id);
    });
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
    ...(textMarkError ? { error: `Texts went out, but some couldn't be marked as notified: ${textMarkError}` } : {}),
  }, { status: textMarkError ? 500 : 200 });
}
