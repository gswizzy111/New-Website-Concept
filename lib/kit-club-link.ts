import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { newToken, sha256, TOKEN_PATTERN } from "@/lib/admin-session";
import { resend, fromEmail, replyToAddress } from "@/lib/resend";
import { siteUrl } from "@/lib/site-url";
import { likeExact } from "@/lib/like-exact";
import { stripe } from "@/lib/stripe";
import { sendCancellationEmail } from "@/lib/subscription-emails";

/**
 * Managing a Monthly Kit Club subscription (/subscribe/manage) takes proof of
 * the inbox: the page emails a one-time link (/subscribe/manage?token=...), or
 * the customer is signed in to a confirmed account with the same email. The
 * link holds a random token; the database keeps only its SHA-256
 * (kit_club_manage_links). It works for an hour and stops working once it has
 * cancelled a subscription. Nobody can look up or cancel a subscription from
 * an email address alone.
 */
const LINK_MINUTES = 60;

/** Link emails per address (lib/attempt-limit.ts, kind "kit-club-link-email") */
export const KIT_CLUB_LINK_RULE = { max: 3, windowMinutes: 60 };

export type KitClubSubscription = {
  id: string;
  stripe_subscription_id: string;
  status: string | null;
  customer_email: string;
  customer_name: string | null;
  created_at: string | null;
  cancelled_at: string | null;
};

/** What the manage page may show (to the verified owner only). */
export function publicView(sub: KitClubSubscription) {
  return { found: true, id: sub.id, status: sub.status, created_at: sub.created_at, cancelled_at: sub.cancelled_at };
}

/**
 * The subscription this email manages: the newest one still running, else the
 * newest one. Undefined when the database couldn't be read.
 */
export async function subscriptionForEmail(email: string): Promise<KitClubSubscription | null | undefined> {
  const { data, error } = await createAdminClient()
    .from("subscriptions")
    .select("id, stripe_subscription_id, status, customer_email, customer_name, created_at, cancelled_at")
    .ilike("customer_email", likeExact(email.trim()))
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("Kit Club subscription lookup failed:", error.message);
    return undefined;
  }
  const subs = (data ?? []) as KitClubSubscription[];
  return subs.find((s) => s.status !== "cancelled") ?? subs[0] ?? null;
}

/** The signed-in customer's email, when the account's email is confirmed. */
export async function signedInEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email && user.email_confirmed_at ? user.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Emails a manage link to `email` (the caller has already checked there is a
 * subscription for it). False when the link couldn't be stored or sent.
 */
export async function sendKitClubLink(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const token = newToken();
  const admin = createAdminClient();
  // Expired links are no use to anyone: clear them out while we're here
  await admin.from("kit_club_manage_links").delete().lt("expires_at", new Date().toISOString());
  const { error: insertError } = await admin.from("kit_club_manage_links").insert({
    token_hash: await sha256(token),
    email: address,
    expires_at: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString(),
  });
  if (insertError) {
    console.error("Storing a Kit Club manage link failed:", insertError.message);
    return false;
  }

  const link = `${siteUrl()}/subscribe/manage?token=${token}`;
  const heading = "Manage your subscription";
  const body = "Tap the button to see your Monthly Kit Club subscription. You can cancel it there.";
  const expiry = "This link expires in 1 hour. Didn't ask for this? Ignore this email.";
  const help = `Questions? Reply to this email or write to ${replyToAddress}.`;
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: address,
      subject: "Manage your Monthly Kit Club subscription",
      text: [heading, "", body, "", `Manage my subscription: ${link}`, "", expiry, help].join("\n"),
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:900;margin:0 0 12px">${heading}</h1>
          <p style="font-size:15px;line-height:1.6;color:#333">${body}</p>
          <a href="${link}" style="display:inline-block;background:#a23200;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:12px 0">Manage my subscription</a>
          <p style="font-size:13px;color:#555;line-height:1.5;margin:8px 0 0">Button not working? Copy this link into your browser:<br><a href="${link}" style="color:#a23200;word-break:break-all">${link}</a></p>
          <p style="font-size:12px;color:#888;line-height:1.5;margin:16px 0 0">${expiry}</p>
          <p style="font-size:12px;color:#888;line-height:1.5;margin:8px 0 0">${help}</p>
        </div>
      `,
    });
    if (error) {
      console.error("Kit Club manage link email failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Kit Club manage link email failed:", err);
    return false;
  }
}

/** The email a manage link is for, while the link is unused and unexpired. */
export async function emailForKitClubToken(token: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await createAdminClient()
    .from("kit_club_manage_links")
    .select("email, expires_at, used_at")
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (error) console.error("Reading a Kit Club manage link failed:", error.message);
  if (!data || data.used_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data.email as string;
}

/**
 * Uses up a manage link (for a cancellation). Only one request can claim it,
 * so a double click can't cancel twice. Returns the link's email, or null
 * when it was already used or has expired.
 */
export async function claimKitClubToken(token: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await createAdminClient()
    .from("kit_club_manage_links")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", await sha256(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("email");
  if (error) console.error("Claiming a Kit Club manage link failed:", error.message);
  return (data?.[0]?.email as string | undefined) ?? null;
}

/** Gives a claimed link back when the cancellation didn't happen. */
export async function releaseKitClubToken(token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) return;
  const { error } = await createAdminClient()
    .from("kit_club_manage_links")
    .update({ used_at: null })
    .eq("token_hash", await sha256(token));
  if (error) console.error("Releasing a Kit Club manage link failed:", error.message);
}

/**
 * Cancels the subscription in Stripe and records it. The cancellation email
 * goes out only from the request whose Stripe cancel went through, so a
 * second click (or a subscription already cancelled in Stripe) never sends a
 * second one.
 */
export async function cancelKitClubSubscription(sub: KitClubSubscription): Promise<{ ok: true } | { error: string }> {
  let cancelledNow = true;
  try {
    await stripe.subscriptions.cancel(sub.stripe_subscription_id);
  } catch (e: unknown) {
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id).catch(() => null);
    if (current?.status !== "canceled") return { error: e instanceof Error ? e.message : "Stripe error" };
    cancelledNow = false;
  }

  const cancelledAt = new Date();
  const { error } = await createAdminClient()
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: cancelledAt.toISOString() })
    .eq("id", sub.id)
    .or("status.is.null,status.neq.cancelled");
  // Stripe has stopped billing either way; its webhook records it too
  if (error) console.error("Recording a Kit Club cancellation failed:", error.message);
  if (cancelledNow) await sendCancellationEmail(sub.customer_email, sub.customer_name, cancelledAt);
  return { ok: true };
}
