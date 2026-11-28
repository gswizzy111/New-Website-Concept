import { createAdminClient } from "@/lib/supabase/admin";
import { PREVIEW_MODE } from "@/lib/preview";
import { toE164 } from "@/lib/sms/phone";
import { SMS_CONSENT_VERSION, type SmsConsentSource } from "@/lib/sms/consent-text";

export async function recordSmsConsent(i: {
  phone: string;
  email?: string | null;
  source: SmsConsentSource;
  consentText: string;
  orderId?: string | null;
  waitlistId?: string | null;
}): Promise<{ error: string | null }> {
  try {
    if (PREVIEW_MODE) return { error: null };
    const phone = toE164(i.phone);
    if (!phone) return { error: null };
    const { error } = await createAdminClient().from("sms_consents").insert({
      phone_e164: phone,
      phone_raw: i.phone.slice(0, 40),
      email: i.email?.trim().toLowerCase() || null,
      order_id: i.orderId ?? null,
      waitlist_id: i.waitlistId ?? null,
      source: i.source,
      consent_text: i.consentText,
      consent_version: SMS_CONSENT_VERSION,
    });
    if (error) {
      console.error("[sms] consent not saved:", error.message);
      return { error: error.message };
    }
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sms] consent not saved:", message);
    return { error: message };
  }
}
