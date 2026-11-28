import { createAdminClient } from "@/lib/supabase/admin";
import { PREVIEW_MODE } from "@/lib/preview";
import { isMissingTable } from "@/lib/sms/db";

/** Carrier-standard keywords (CTIA): the whole message, any case. */
const OPT_OUT_WORDS = new Set(["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "OPT OUT", "OPT-OUT", "REVOKE"]);
const OPT_IN_WORDS = new Set(["START", "UNSTOP", "YES", "SUBSCRIBE", "OPTIN", "OPT IN", "OPT-IN"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

/** The whole message as one keyword, or null for anything else. Pure. */
export function parseKeyword(text: string): "opt_out" | "opt_in" | "help" | null {
  const word = String(text ?? "")
    .trim()
    .replace(/[.!?,;:"'‘’“”]+$/g, "")
    .replace(/^["'‘’“”]+/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (!word) return null;
  if (OPT_OUT_WORDS.has(word)) return "opt_out";
  if (OPT_IN_WORDS.has(word)) return "opt_in";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

/** Latest event wins: true when the phone's last event is an opt-out. */
export async function isOptedOut(phoneE164: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("sms_opt_events")
    .select("event")
    .eq("phone_e164", phoneE164)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return false;
    // Can't tell: treat as opted out so nobody is texted by mistake
    console.error("[sms] opt-out check failed:", error.message);
    return true;
  }
  return data?.[0]?.event === "opt_out";
}

export async function recordOptEvent(
  phoneE164: string,
  event: "opt_out" | "opt_in",
  keyword: string | null,
  source: "keyword" | "carrier" | "admin",
): Promise<{ error: string | null }> {
  if (PREVIEW_MODE) return { error: null };
  try {
    const { error } = await createAdminClient().from("sms_opt_events").insert({
      phone_e164: phoneE164,
      event,
      keyword: keyword ? keyword.slice(0, 40) : null,
      source,
    });
    if (error) {
      console.error("[sms] opt event not saved:", error.message);
      return { error: error.message };
    }
    return { error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sms] opt event not saved:", message);
    return { error: message };
  }
}
