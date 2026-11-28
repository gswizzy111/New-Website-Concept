import { z } from "zod";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { smsConfigured } from "@/lib/sms/config";
import { isMissingTable } from "@/lib/sms/db";
import { parseKeyword } from "@/lib/sms/opt-outs";
import { sendOneOffSms } from "@/lib/sms/outbox";
import { replyProblem, replySmsText } from "@/app/admin/texts/_components/text-helpers";

const Body = z.object({
  inboundId: z.string().uuid(),
  text: z.string().max(2000),
});

/**
 * The Texts page's reply box: answers a customer's text from the shop's
 * number. Only to a number that texted us and agreed to texts (an
 * sms_consents row for that phone); lib/sms/outbox.ts refuses a number that
 * replied STOP and logs the text in sms_messages. The reply marks the
 * customer's text handled.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const problem = replyProblem(parsed.data.text);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (!smsConfigured()) return Response.json({ error: "Texts aren't set up yet, so nothing was sent. See the Setup box." }, { status: 409 });

  const admin = createAdminClient();
  const { data: inbound, error } = await admin
    .from("sms_inbound")
    .select("id, from_phone, body, order_id")
    .eq("id", parsed.data.inboundId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return Response.json({ error: "The text tables aren't set up yet, so nothing was sent." }, { status: 409 });
    console.error("[sms] reply: inbound text unreadable:", error.message);
    return Response.json({ error: "Couldn't load that text. Try again in a minute." }, { status: 500 });
  }
  if (!inbound) return Response.json({ error: "That text wasn't found." }, { status: 404 });
  if (parseKeyword(inbound.body ?? "") === "opt_out") {
    return Response.json({ error: "They replied STOP, so they can't be texted. Email them instead." }, { status: 409 });
  }

  // Never text a number that never agreed to texts
  const { data: consent, error: consentError } = await admin
    .from("sms_consents")
    .select("id")
    .eq("phone_e164", inbound.from_phone)
    .limit(1)
    .maybeSingle();
  if (consentError) {
    console.error("[sms] reply: consent check failed:", consentError.message);
    return Response.json({ error: "Couldn't check that this number agreed to texts, so nothing was sent. Try again in a minute." }, { status: 500 });
  }
  if (!consent) {
    return Response.json({ error: "This number never agreed to texts, so it can't be texted. Email them instead." }, { status: 409 });
  }

  const session = await getAdminSession();
  const result = await sendOneOffSms({
    to: inbound.from_phone,
    text: replySmsText(parsed.data.text),
    kind: "reply",
    orderId: inbound.order_id ?? null,
    createdBy: session?.username ?? null,
  });
  if (!result.ok) {
    return Response.json({ error: result.error ? `Not sent: ${result.error}` : "Not sent. Try again in a minute." }, { status: 502 });
  }

  const { error: markError } = await admin
    .from("sms_inbound")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", inbound.id)
    .is("handled_at", null);
  if (markError) console.error("[sms] reply sent but the text wasn't marked handled:", markError.message);

  return Response.json({ ok: true });
}
