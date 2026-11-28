import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSmsConsent } from "@/lib/sms/consents";
import { SMS_WAITLIST_CONSENT_TEXT } from "@/lib/sms/consent-text";
import { waitlistSmsProblem } from "@/lib/sms-public";
import { z } from "zod";

const Schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  // The "text me when spots open" box; anything but true is a no (never fails the parse)
  smsOptIn: z.unknown().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Please fill in all required fields." }, { status: 400 });

  const { name, email, phone } = parsed.data;
  const smsOptIn = parsed.data.smsOptIn === true;
  // Box ticked: the phone is required and must be textable (the form checks this first)
  const smsProblem = waitlistSmsProblem(phone, smsOptIn);
  if (smsProblem) return Response.json({ error: smsProblem }, { status: 400 });

  const admin = createAdminClient();

  const { data, error } = await admin.from("restoration_waitlist").upsert(
    { name, email: email.toLowerCase().trim(), phone: phone?.trim() ?? null },
    { onConflict: "email" }
  ).select("id");

  if (error) return Response.json({ error: "Failed to save. Please try again." }, { status: 500 });

  // The text consent is recorded after the answer goes out, so the sign-up
  // never waits on it or fails because of it (recordSmsConsent logs its own
  // errors, e.g. before the SMS migration is applied)
  if (smsOptIn && phone) {
    const waitlistId = (data?.[0] as { id?: string } | undefined)?.id ?? null;
    after(async () => {
      try {
        await recordSmsConsent({
          phone,
          email,
          source: "waitlist",
          consentText: SMS_WAITLIST_CONSENT_TEXT,
          waitlistId,
        });
      } catch (err) {
        console.error("[sms] waitlist consent not saved:", err instanceof Error ? err.message : err);
      }
    });
  }

  return Response.json({ ok: true });
}
