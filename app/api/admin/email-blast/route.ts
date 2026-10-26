import { fromEmail, businessName } from "@/lib/resend";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";
import { loadBlastContacts } from "@/app/admin/email-blast/contacts";
import {
  businessPostalAddress,
  firstNameOf,
  mergeFirstName,
  newUnsubscribeTokens,
  sendBatch,
  unsubscribeHeaders,
  unsubscribeUrl,
  type BatchMessage,
} from "@/lib/email-unsubscribe";

const Schema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  // Where to pick up: the last address already handled. Contacts go out in
  // address order, a few hundred per request, and the page asks for the next
  // part until it's done (one request for everyone would outrun the function
  // time limit).
  after: z.string().max(320).optional().default(""),
});

// Resend's batch limit
const BATCH_SIZE = 100;
// Per request: two batches, well inside the function time limit
const PER_REQUEST = 200;
// No new batch after this long; the page asks for the rest
const TIME_BUDGET_MS = 15_000;
// Pause between batches, so the blast leaves room in Resend's rate limit for order emails
const BATCH_GAP_MS = 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The contact's first name wherever the text says [first name] ("there" when
 * we don't know it), and "Hi there" becomes "Hi <first name>" as before. */
function personalize(text: string, name: string) {
  const first = firstNameOf(name);
  const merged = mergeFirstName(text, first);
  return first ? merged.replace(/Hi there/g, () => `Hi ${first}`) : merged;
}

// Wrap plain text in a clean HTML email template
function blastHtml(messageBody: string, unsubscribeLink: string) {
  const site = siteUrl();
  const address = businessPostalAddress();
  return `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.6">
      ${messageBody
        .split("\n")
        .map((line) => (line.trim() === "" ? "<br>" : `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`))
        .join("")}
      <hr style="margin:28px 0;border:none;border-top:1px solid #eee" />
      <p style="font-size:12px;color:#999;margin:0">${escapeHtml(businessName)} · <a href="${site}" style="color:#999">${escapeHtml(new URL(site).host)}</a></p>
      ${address ? `<p style="font-size:12px;color:#999;margin:4px 0 0">${escapeHtml(address)}</p>` : ""}
      <p style="font-size:12px;color:#999;margin:4px 0 0">Don't want these emails? <a href="${unsubscribeLink}" style="color:#999">Unsubscribe</a></p>
    </div>
  `;
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Subject and body are required." }, { status: 400 });

  const { subject, body: messageBody, after } = parsed.data;
  const started = Date.now();

  // Unsubscribed, bounced and invalid addresses are left out. If those lists
  // can't be read, nothing is sent.
  let recipients;
  try {
    const { contacts } = await loadBlastContacts({ strict: true });
    recipients = contacts
      .filter((c) => !c.skip)
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  } catch (err) {
    console.error("Email blast: contact list failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't load the contact list, so nothing was sent. Try again in a minute." }, { status: 500 });
  }

  const thisRequest = recipients.filter((c) => c.email > after).slice(0, PER_REQUEST);
  let sent = 0;
  const failed: { email: string; reason: string }[] = [];
  let next = after;
  // Set when a whole batch was refused: the page stops and can continue from `next`
  let stopped: string | null = null;

  for (let i = 0; i < thisRequest.length; i += BATCH_SIZE) {
    if (i > 0) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      await sleep(BATCH_GAP_MS);
    }
    const chunk = thisRequest.slice(i, i + BATCH_SIZE);

    let tokens: Map<string, string>;
    try {
      tokens = await newUnsubscribeTokens(chunk.map((c) => c.email));
    } catch (err) {
      stopped = err instanceof Error ? err.message : "Couldn't save the unsubscribe links.";
      break;
    }

    const messages: BatchMessage[] = chunk.map((c) => {
      const token = tokens.get(c.email)!;
      return {
        from: fromEmail,
        to: c.email,
        subject: personalize(subject, c.name),
        html: blastHtml(personalize(messageBody, c.name), unsubscribeUrl(token)),
        headers: unsubscribeHeaders(token),
      };
    });

    const outcome = await sendBatch(messages);
    if (outcome.batchError) {
      stopped = `Resend didn't take the next batch: ${outcome.batchError}`;
      break;
    }
    sent += outcome.sent.length;
    failed.push(...outcome.failed);
    next = chunk[chunk.length - 1].email;
  }

  if (failed.length > 0) console.error(`Email blast: ${failed.length} address(es) refused by Resend`);
  const remaining = recipients.filter((c) => c.email > next).length;

  return Response.json({
    ok: true,
    sent,
    failed: failed.length,
    failedEmails: failed,
    next,
    remaining,
    total: recipients.length,
    done: !stopped && remaining === 0,
    stopped,
  });
}
