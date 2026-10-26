import { resend } from "@/lib/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailProblemType } from "@/lib/email-problem-labels";

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
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Resend webhook received but RESEND_WEBHOOK_SECRET is not set");
    return Response.json({ error: "Not configured" }, { status: 503 });
  }

  const payload = await request.text();
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  let event: ReturnType<typeof resend.webhooks.verify>;
  try {
    event = resend.webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret: secret });
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
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
  const recipients = [...new Set((data.to ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) return Response.json({ ok: true });
  const { error } = await createAdminClient()
    .from("email_problems")
    .upsert(
      recipients.map((email) => ({
        event_id: id,
        email,
        type,
        subject: data.subject?.slice(0, 300) ?? null,
        detail: detail.slice(0, 1000) || null,
        resend_email_id: data.email_id ?? null,
        sent_at: data.created_at ?? null,
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
