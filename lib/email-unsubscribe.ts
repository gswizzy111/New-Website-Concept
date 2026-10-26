import type { CreateBatchEmailOptions } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { newToken, sha256, TOKEN_PATTERN } from "@/lib/admin-session";
import { bareAddress } from "@/lib/email-problem-labels";
import { siteUrl } from "@/lib/site-url";
import { escapeHtml } from "@/lib/card-inquiries";

/**
 * Marketing email (the admin Email Blast and the restoration waitlist notice)
 * and the bulk-send helpers they share.
 *
 * Unsubscribing: every send gives each address a fresh random token, links
 * /email/unsubscribe?token=… in the footer and sends List-Unsubscribe headers
 * that POST to /api/email/unsubscribe?token=… (one-click in Gmail and Yahoo).
 * Only the token's SHA-256 is stored (email_unsubscribe_tokens); using it adds
 * the address to email_unsubscribes, and every later marketing email skips it.
 * Order, shipping and account emails are not marketing and still go out.
 * Schema: supabase/migrations/20261027_email.sql.
 */

/** Lowercased and trimmed: the form every list here is keyed on. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

// A plain user@domain.tld. Anything else is left out of a batch up front, so
// Resend never refuses a batch over it.
const ADDRESS = /^(?!.*\.\.)[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

export function isSendableAddress(email: string): boolean {
  return email.length <= 254 && ADDRESS.test(email);
}

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Puts the first name wherever the text says [first name] (any case), or
 * "there" when we don't know it, so "Hi [first name]," reads "Hi there,". */
export function mergeFirstName(text: string, firstName: string): string {
  // A function, so a "$" in someone's name isn't read as a replacement pattern
  return text.replace(/\[first name\]/gi, () => firstName || "there");
}

/** The business's postal address for marketing footers (US anti-spam law asks
 * for one), from the BUSINESS_SHIPPING_* settings the shipping labels use.
 * null when any part is missing; marketing email then doesn't go out
 * (marketingSendProblem()). */
export function businessPostalAddress(): string | null {
  const street = [process.env.BUSINESS_SHIPPING_STREET1, process.env.BUSINESS_SHIPPING_STREET2]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
  const city = process.env.BUSINESS_SHIPPING_CITY?.trim() ?? "";
  const state = process.env.BUSINESS_SHIPPING_STATE?.trim() ?? "";
  const zip = process.env.BUSINESS_SHIPPING_ZIP?.trim() ?? "";
  if (!process.env.BUSINESS_SHIPPING_STREET1?.trim() || !city || !state || !zip) return null;
  return `${street}, ${city}, ${state} ${zip}`;
}

/** A host without "www." or a trailing dot, lowercased, for comparing. */
function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** The hosts a request came in on (the Host header, a proxy's forwarded
 * host, the URL's host), for marketingSendProblem(). */
export function requestHosts(headers: { get(name: string): string | null }, url?: string): string[] {
  const hosts = [headers.get("x-forwarded-host")?.split(",")[0], headers.get("host")];
  if (url) {
    try { hosts.push(new URL(url).host); } catch { /* no URL host */ }
  }
  return hosts.filter((h): h is string => !!h && h.trim().length > 0);
}

/**
 * Why marketing email (Email Blast, the restoration waitlist notice) can't go
 * out from here, or null when it can. US anti-spam law asks for a postal
 * address and a working unsubscribe link: the address comes from the
 * BUSINESS_SHIPPING_* settings, and the links are built on siteUrl(), which
 * must be this site (the old site has no unsubscribe page). `hosts`: the
 * hosts this request came in on (requestHosts()); none known skips that check.
 */
export function marketingSendProblem(hosts: string[]): string | null {
  if (!businessPostalAddress()) {
    return "The business postal address isn't set (BUSINESS_SHIPPING_STREET1, CITY, STATE and ZIP in Netlify), and marketing emails must show it.";
  }
  const linkHost = bareHost(new URL(siteUrl()).host);
  const here = hosts.map(bareHost);
  if (here.length > 0 && !here.includes(linkHost)) {
    return `Unsubscribe links would go to ${linkHost}, but this page is on ${here[0]}. Send from ${linkHost} if that is this site; otherwise set NEXT_PUBLIC_APP_URL to this site's address and redeploy.`;
  }
  return null;
}

/** The footer every marketing email ends with: the site, the postal address
 * and the unsubscribe link. */
export function marketingFooterHtml(businessName: string, unsubscribeLink: string): string {
  const site = siteUrl();
  const address = businessPostalAddress();
  return `
      <hr style="margin:28px 0;border:none;border-top:1px solid #eee" />
      <p style="font-size:12px;color:#999;margin:0">${escapeHtml(businessName)} · <a href="${site}" style="color:#999">${escapeHtml(new URL(site).host)}</a></p>
      ${address ? `<p style="font-size:12px;color:#999;margin:4px 0 0">${escapeHtml(address)}</p>` : ""}
      <p style="font-size:12px;color:#999;margin:4px 0 0">Don't want these emails? <a href="${unsubscribeLink}" style="color:#999">Unsubscribe</a></p>`;
}

/** The unsubscribe page for a token. */
export function unsubscribeUrl(token: string): string {
  return `${siteUrl()}/email/unsubscribe?token=${token}`;
}

/** One-click unsubscribe headers (RFC 8058): the mail app POSTs
 * "List-Unsubscribe=One-Click" to this address, with no page in between. */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${siteUrl()}/api/email/unsubscribe?token=${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** A fresh unsubscribe token for each address (lowercased), stored before the
 * email goes out. Throws if they can't be stored: a blast never goes out with
 * an unsubscribe link that doesn't work. */
export async function newUnsubscribeTokens(emails: string[]): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  const rows: { token_hash: string; email: string }[] = [];
  for (const email of emails) {
    const token = newToken();
    tokens.set(email, token);
    rows.push({ token_hash: await sha256(token), email });
  }
  if (rows.length === 0) return tokens;
  const { error } = await createAdminClient().from("email_unsubscribe_tokens").insert(rows);
  if (error) throw new Error(`Couldn't save the unsubscribe links: ${error.message}`);
  return tokens;
}

/** Every address that has unsubscribed. Throws if the list can't be read. */
export async function unsubscribedEmails(): Promise<Set<string>> {
  const admin = createAdminClient();
  const rows = await fetchAll<{ email: string }>((from, to) =>
    admin.from("email_unsubscribes").select("email").order("email").range(from, to)
  );
  return new Set(rows.map((r) => normalizeEmail(r.email)));
}

/** Addresses with an open bounce or Resend suppression, and every address
 * that ever marked our email as spam, even after the admin marked that fixed
 * (lib/email-problems.ts): a complaint counts as unsubscribing for good.
 * Mailing them again hurts the sending domain, which also carries every order
 * email. Throws if the list can't be read. */
export async function undeliverableEmails(): Promise<Set<string>> {
  const admin = createAdminClient();
  const rows = await fetchAll<{ email: string; type: string; resolved_at: string | null }>((from, to) =>
    admin.from("email_problems").select("email, type, resolved_at")
      .in("type", ["bounced", "complained", "suppressed"])
      .order("id").range(from, to)
  );
  return new Set(rows.filter((r) => r.type === "complained" || !r.resolved_at).map((r) => bareAddress(r.email)));
}

/** The address a token belongs to and whether it has unsubscribed already;
 * null for a malformed or unknown token. Throws on a database error. */
export async function lookupUnsubscribeToken(token: string): Promise<{ email: string; unsubscribed: boolean } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_unsubscribe_tokens")
    .select("email")
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: row, error: readError } = await admin
    .from("email_unsubscribes")
    .select("email")
    .eq("email", data.email)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  return { email: data.email as string, unsubscribed: !!row };
}

/** Unsubscribes the token's address (doing it twice is fine). Returns the
 * address, or null for a malformed or unknown token. Throws on a database error. */
export async function unsubscribeByToken(token: string): Promise<string | null> {
  const found = await lookupUnsubscribeToken(token);
  if (!found) return null;
  if (found.unsubscribed) return found.email;
  const { error } = await createAdminClient()
    .from("email_unsubscribes")
    .upsert({ email: found.email }, { onConflict: "email", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return found.email;
}

export type BatchMessage = CreateBatchEmailOptions & { to: string };

export type BatchOutcome = {
  /** Addresses Resend accepted */
  sent: string[];
  /** Addresses Resend refused one at a time, with its reason */
  failed: { email: string; reason: string }[];
  /** Set when Resend didn't take the batch (even after waiting out a rate
   * limit). Treat it as not sent; only a dropped connection leaves that in doubt. */
  batchError: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits before retrying a rate-limited batch (Resend allows a few requests a second)
const RATE_LIMIT_WAITS_MS = [1200, 2500];

/**
 * Sends up to 100 emails as one Resend batch and says exactly which went out.
 * Resend's send never throws on a refusal; it returns { error }, so that is
 * checked here. Permissive validation means one refused address fails alone
 * instead of sinking the batch. Only a rate limit (429) is retried: anything
 * else may have been sent already, so retrying could email people twice.
 */
export async function sendBatch(messages: BatchMessage[]): Promise<BatchOutcome> {
  if (messages.length === 0) return { sent: [], failed: [], batchError: null };
  let batchError = "Resend refused the batch";
  for (let attempt = 0; ; attempt++) {
    let result: Awaited<ReturnType<typeof sendOnce>>;
    try {
      result = await sendOnce(messages);
    } catch (err) {
      return { sent: [], failed: [], batchError: err instanceof Error ? err.message : String(err) };
    }
    const { data, error } = result;
    if (!error) {
      const refused = new Map((data.errors ?? []).map((e) => [e.index, e.message]));
      return {
        sent: messages.filter((_, i) => !refused.has(i)).map((m) => m.to),
        failed: messages.flatMap((m, i) => (refused.has(i) ? [{ email: m.to, reason: refused.get(i) ?? "Refused" }] : [])),
        batchError: null,
      };
    }
    batchError = error.message || error.name || batchError;
    if (error.statusCode !== 429 || attempt >= RATE_LIMIT_WAITS_MS.length) break;
    await sleep(RATE_LIMIT_WAITS_MS[attempt]);
  }
  console.error("Email batch refused:", batchError);
  return { sent: [], failed: [], batchError };
}

async function sendOnce(messages: BatchMessage[]) {
  // Loaded here, not at the top: the public unsubscribe page uses this file
  // and must render even where no Resend key is set
  const { resend } = await import("@/lib/resend");
  return resend.batch.send(messages, { batchValidation: "permissive" });
}
