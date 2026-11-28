import { z } from "zod";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { smsConfigured, smsSetupStatus } from "@/lib/sms/config";
import { isOptedOut } from "@/lib/sms/opt-outs";
import { sendOneOffSms } from "@/lib/sms/outbox";
import { formatPhone, toE164 } from "@/lib/sms/phone";
import { setupLines, TEST_SMS_TEXT } from "@/app/admin/texts/_components/text-helpers";

const Body = z.object({ phone: z.string().max(40) });

/**
 * The Setup box's "Send a test text": one fixed text to the number the admin
 * types (usually their own phone), so they can see Telnyx working. No consent
 * record is needed (the admin is texting themselves), but a number that
 * replied STOP is still refused. Telnyx's own error comes back word for word
 * (a 10DLC campaign not approved yet, a number not on the messaging profile).
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const to = toE164(parsed.data.phone);
  if (!to) return Response.json({ error: "Enter a US or Canadian mobile number, like (201) 555-1234." }, { status: 400 });

  if (!smsConfigured()) {
    const missing = setupLines(smsSetupStatus(), true).filter((l) => l.required && !l.ok).map((l) => l.name);
    return Response.json({ error: `Texts aren't set up yet${missing.length ? ` (${missing.join(", ")})` : ""}, so nothing was sent.` }, { status: 409 });
  }
  if (await isOptedOut(to)) {
    return Response.json({ error: `${formatPhone(to)} replied STOP, so it can't be texted. Text START from that phone to turn texts back on.` }, { status: 409 });
  }

  const session = await getAdminSession();
  const result = await sendOneOffSms({
    to,
    text: TEST_SMS_TEXT,
    kind: "reply",
    createdBy: session?.username ?? null,
    allowWithoutConsent: true,
  });
  if (!result.ok) {
    return Response.json({ error: result.error ? `Telnyx said: ${result.error}` : "Not sent, and Telnyx gave no reason." }, { status: 502 });
  }
  return Response.json({ ok: true, to: formatPhone(to) });
}
