import { fromEmail, businessName } from "@/lib/resend";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin-auth";
import { escapeHtml } from "@/lib/card-inquiries";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBlastContacts } from "@/app/admin/email-blast/contacts";
import { BLAST_COLUMNS, failuresOf, type BlastFailure, type BlastRow } from "@/app/admin/email-blast/blasts";
import {
  firstNameOf,
  marketingFooterHtml,
  marketingSendProblem,
  mergeFirstName,
  newUnsubscribeTokens,
  requestHosts,
  sendBatch,
  unsubscribeHeaders,
  unsubscribeUrl,
  type BatchMessage,
} from "@/lib/email-unsubscribe";

const Schema = z.union([
  // Sets an unfinished send aside ("Write a new email instead")
  z.object({ blastId: z.uuid(), discard: z.literal(true) }),
  // The next part of a blast. Contacts go out in address order, a few hundred
  // per request, and the page asks for the next part until it's done (one
  // request for everyone would outrun the function time limit). The page makes
  // blastId when the admin presses Send and keeps it for every part; how far
  // the blast got is kept in email_blasts, never taken from the page, so a
  // lost reply, a closed tab or a second tab can't send a part twice. Once the
  // blast exists, its saved subject and body are the ones sent.
  z.object({ blastId: z.uuid(), subject: z.string().min(1), body: z.string().min(1) }),
]);

// Resend's batch limit
const BATCH_SIZE = 100;
// Per request: two batches, well inside the function time limit
const PER_REQUEST = 200;
// No new batch after this long; the page asks for the rest
const TIME_BUDGET_MS = 15_000;
// Pause between batches, so the blast leaves room in Resend's rate limit for order emails
const BATCH_GAP_MS = 600;
// How long a request holds the blast while it sends (longer than any request can run)
const LEASE_MS = 60_000;
const FREE = new Date(0).toISOString();

const BUSY = "This email is being sent from another tab or window. Wait a minute, then press Continue sending.";

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
  return `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.6">
      ${messageBody
        .split("\n")
        .map((line) => (line.trim() === "" ? "<br>" : `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`))
        .join("")}
      ${marketingFooterHtml(businessName, unsubscribeLink)}
    </div>
  `;
}

/**
 * This blast's record, held by this request until it lets go (or LEASE_MS
 * passes). Made on the blast's first part. A finished blast comes back as it
 * is, not held: there's nothing left to send.
 */
async function holdBlast(
  id: string,
  subject: string,
  body: string,
  createdBy: string,
  leaseUntil: string,
): Promise<{ blast: BlastRow } | { error: string; status: number }> {
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin.from("email_blasts").select(BLAST_COLUMNS).eq("id", id).maybeSingle();
  if (readError) return { error: `Couldn't read how far this send got, so nothing was sent: ${readError.message}`, status: 500 };

  if (!existing) {
    const { data: created, error: createError } = await admin
      .from("email_blasts")
      .upsert({ id, subject, body, created_by: createdBy, locked_until: leaseUntil }, { onConflict: "id", ignoreDuplicates: true })
      .select(BLAST_COLUMNS);
    if (createError) return { error: `Couldn't start the send, so nothing was sent: ${createError.message}`, status: 500 };
    // Made by another request a moment ago
    if (!created || created.length === 0) return { error: BUSY, status: 409 };
    return { blast: created[0] as BlastRow };
  }

  if (existing.discarded_at) return { error: "This send was set aside. Write a new email to send again.", status: 409 };
  if (existing.finished_at) return { blast: existing as BlastRow };

  const { data: held, error: holdError } = await admin
    .from("email_blasts")
    .update({ locked_until: leaseUntil })
    .eq("id", id)
    .is("finished_at", null)
    .is("discarded_at", null)
    .lt("locked_until", new Date().toISOString())
    .select(BLAST_COLUMNS)
    .maybeSingle();
  if (holdError) return { error: `Couldn't read how far this send got, so nothing was sent: ${holdError.message}`, status: 500 };
  if (!held) return { error: BUSY, status: 409 };
  return { blast: held as BlastRow };
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (session?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Subject and body are required." }, { status: 400 });
  const admin = createAdminClient();

  if ("discard" in parsed.data) {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("email_blasts")
      .update({ discarded_at: now, updated_at: now })
      .eq("id", parsed.data.blastId)
      .is("finished_at", null)
      .is("discarded_at", null);
    if (error) {
      console.error("Email blast: set aside failed:", error.message);
      return Response.json({ error: "Couldn't set this send aside. Try again." }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  const { blastId } = parsed.data;
  const started = Date.now();

  // US anti-spam law asks for a postal address and an unsubscribe link that works
  const problem = marketingSendProblem(requestHosts(request.headers));
  if (problem) return Response.json({ error: problem }, { status: 409 });

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

  const leaseUntil = new Date(started + LEASE_MS).toISOString();
  const held = await holdBlast(blastId, parsed.data.subject, parsed.data.body, session.username, leaseUntil);
  if ("error" in held) return Response.json({ error: held.error }, { status: held.status });
  const { blast } = held;

  let last = blast.last_email ?? "";
  let sent = blast.sent ?? 0;
  const failed: BlastFailure[] = [...failuresOf(blast.failed_emails)];
  // Set when a batch wasn't sent or its progress wasn't saved: the page stops
  // and can continue from what's saved
  let stopped: string | null = null;

  const thisRequest = blast.finished_at ? [] : recipients.filter((c) => c.email > last).slice(0, PER_REQUEST);

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
        subject: personalize(blast.subject, c.name),
        html: blastHtml(personalize(blast.body, c.name), unsubscribeUrl(token)),
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
    last = chunk[chunk.length - 1].email;

    // Saved before anything else happens, so this batch is never sent again
    let saveError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(500);
      const { error } = await admin
        .from("email_blasts")
        .update({ last_email: last, sent, failed_emails: failed, updated_at: new Date().toISOString() })
        .eq("id", blast.id);
      saveError = error?.message ?? null;
      if (!saveError) break;
    }
    if (saveError) {
      console.error("Email blast: progress not saved after a sent batch:", saveError);
      stopped = `The last ${chunk.length} emails went out, but how far the send got couldn't be saved, so sending stopped. Continuing may send them again: ${saveError}`;
      break;
    }
  }

  if (failed.length > 0) console.error(`Email blast: ${failed.length} address(es) refused by Resend so far`);
  const remaining = recipients.filter((c) => c.email > last).length;
  const done = !!blast.finished_at || (!stopped && remaining === 0);

  if (!blast.finished_at) {
    const now = new Date().toISOString();
    const { error: releaseError } = await admin
      .from("email_blasts")
      .update({ locked_until: FREE, updated_at: now, ...(done ? { finished_at: now } : {}) })
      .eq("id", blast.id)
      .eq("locked_until", leaseUntil);
    // Not fatal: the hold runs out by itself
    if (releaseError) console.error("Email blast: couldn't let go of the send:", releaseError.message);
  }

  return Response.json({
    ok: true,
    blastId: blast.id,
    // Totals for the whole blast so far
    sent,
    failed: failed.length,
    failedEmails: failed,
    next: last,
    remaining: blast.finished_at ? 0 : remaining,
    total: recipients.length,
    done,
    stopped,
  });
}
