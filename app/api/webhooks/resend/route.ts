import { resend } from "@/lib/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { bareAddress, type EmailProblemType } from "@/lib/email-problem-labels";

/**
 * Resend's webhook: records emails that didn't reach the customer (bounced,
 * marked as spam, suppressed, failed) in email_problems, for the admin Email
 * Problems page (lib/email-problems.ts). One endpoint serves both sites: they
 * send through the same Resend account.
 *
 * Set up in the Resend dashboard (Webhooks): endpoint
 * https://theonethatsaveditall.com/api/webhooks/resend with the events
 * email.bounced, email.complained, email.suppressed and email.failed; its
 * signing secret goes in RESEND_WEBHOOK_SECRET. Every request is checked
 * against that secret (Svix signature and timestamp).
 *
 * Only a failure to save answers 5xx (Resend then retries). A signed event
 * this route can't use answers 200, since retrying would never help.
 */
export async function POST(request: Request) {
  // Pasted secrets sometimes carry spaces, a newline or quotes
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim().replace(/^["']|["']$/g, "");
  if (!secret) {
    console.error("Resend webhook received but RESEND_WEBHOOK_SECRET is not set");
    return Response.json({ error: "Not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) return Response.json({ error: "Missing signature" }, { status: 400 });
  const payload = await request.text();

  let event: ReturnType<typeof resend.webhooks.verify>;
  try {
    event = resend.webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret: secret });
  } catch (err) {
    // The body is parsed only after the signature matched: a parse error is a
    // genuine event we can't read
    if (err instanceof SyntaxError) return Response.json({ ok: true, ignored: "unparseable" });
    // Logged so a wrong RESEND_WEBHOOK_SECRET shows up in the function log
    console.error("Resend webhook signature check failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  if (!event || typeof event !== "object" || !event.data || typeof event.data !== "object") {
    return Response.json({ ok: true, ignored: "malformed" });
  }

  let type: EmailProblemType;
  let detail: string;
  switch (event.type) {
    case "email.bounced": {
      const b = event.data.bounce;
      type = "bounced";
      detail = [b?.type && `${b.type}${b.subType ? ` (${b.subType})` : ""}`, b?.message].filter(Boolean).join(": ");
      break;
    }
    case "email.complained":
      type = "complained";
      detail = "The recipient marked this email as spam.";
      break;
    case "email.suppressed":
      type = "suppressed";
      detail = [event.data.suppressed?.type, event.data.suppressed?.message].filter(Boolean).join(": ");
      break;
    case "email.failed":
      type = "failed";
      detail = event.data.failed?.reason ?? "";
      break;
    default:
      // Other events (delivered, opened, ...) aren't recorded
      return Response.json({ ok: true, ignored: event.type });
  }

  const data = event.data;
  const to: unknown[] = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  const recipients = [...new Set(to.filter((t): t is string => typeof t === "string").map(bareAddress).filter(Boolean))];
  if (recipients.length === 0) return Response.json({ ok: true, ignored: "no recipients" });
  const sentAt = typeof data.created_at === "string" && !Number.isNaN(Date.parse(data.created_at))
    ? new Date(data.created_at).toISOString()
    : null;

  const { error } = await createAdminClient()
    .from("email_problems")
    .upsert(
      recipients.map((email) => ({
        event_id: id,
        email,
        type,
        subject: typeof data.subject === "string" ? data.subject.slice(0, 300) : null,
        detail: String(detail ?? "").slice(0, 1000) || null,
        resend_email_id: typeof data.email_id === "string" ? data.email_id : null,
        sent_at: sentAt,
      })),
      { onConflict: "event_id,email", ignoreDuplicates: true },
    );
  if (error) {
    // A non-2xx reply makes Resend retry later
    console.error("Saving an email problem failed:", error.message);
    return Response.json({ error: "Could not save" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
