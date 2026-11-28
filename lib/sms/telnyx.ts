import { smsApiKey, smsFromNumber, smsProfileId } from "@/lib/sms/config";

export type SendSmsResult = { id: string | null; error: string | null; code: string | null; definite: boolean };

export async function sendSms(to: string, text: string): Promise<SendSmsResult> {
  const key = smsApiKey();
  const from = smsFromNumber();
  if (!key || !from) return { id: null, error: "Texts aren't set up (TELNYX_API_KEY / TELNYX_FROM_NUMBER).", code: "not_configured", definite: true };
  try {
    const profile = smsProfileId();
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ from, to, text, ...(profile ? { messaging_profile_id: profile } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { data?: { id?: string }; errors?: { code?: string; title?: string; detail?: string }[] } | null;
    if (res.ok && json?.data?.id) return { id: json.data.id, error: null, code: null, definite: false };
    const e = json?.errors?.[0];
    return { id: null, error: e?.detail || e?.title || `HTTP ${res.status}`, code: e?.code ?? String(res.status), definite: res.status >= 400 && res.status < 500 && res.status !== 429 };
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err), code: "network", definite: false };
  }
}
