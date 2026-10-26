import { createClient as createSupabase, type User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";

/**
 * Account emails with one-time links: confirm the email address, or reset the
 * password. The token is minted with the service role (generateLink, which
 * sends nothing itself) and the link points at our own page, which verifies
 * it (verifyOtp with the token hash). Supabase's redirect allowlist and email
 * templates (shared with the old site) are never involved. Each email has a
 * plain-text version, the link printed under the button, and where to get help.
 */
type LinkKind = "confirm" | "reset";

const COPY: Record<LinkKind, { subject: string; heading: string; body: string; button: string; path: string }> = {
  confirm: {
    subject: `Confirm your email — ${businessName}`,
    heading: "Confirm your email",
    body: "Tap the button to confirm your email and open your account. Your orders placed with this email will show up there.",
    button: "Confirm my email",
    path: "/account/confirm",
  },
  reset: {
    subject: `Reset your password — ${businessName}`,
    heading: "Reset your password",
    body: "Someone (hopefully you) asked to reset the password for your account. Tap the button to choose a new one. If it wasn't you, you can ignore this email.",
    button: "Choose a new password",
    path: "/account/reset-password",
  },
};

export const CONFIRM_SUBJECT = COPY.confirm.subject;

const INSTAGRAM_HANDLE = "@the_card_doc";
const INSTAGRAM_URL = "https://www.instagram.com/the_card_doc";

/**
 * The first word of a name, only when it looks like a name. Anyone can sign
 * up any address with any name, so free text (links, sentences) never makes it
 * into an email that comes from us.
 */
function safeFirstName(name?: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}\p{M}'’-]{1,30}$/u.test(first) ? first : "";
}

function appUrl() {
  return siteUrl();
}

/**
 * A fresh one-time token for the account with this email (minting one cancels
 * the link in any earlier email of that kind). Null when there is no account.
 */
export async function mintAccountToken(kind: LinkKind, email: string): Promise<{ tokenHash: string; user: User } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: kind === "reset" ? "recovery" : "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash || !data.user) {
    if (error) console.error(`generateLink (${kind}) failed:`, error.message);
    return null;
  }
  return { tokenHash, user: data.user };
}

/**
 * Whether `password` is this unconfirmed account's password, checked on a
 * throwaway client so no session is kept: Supabase answers "Email not
 * confirmed" only when the password is right. "error" when Supabase couldn't
 * say (rate limit, outage): callers must not treat that as either answer.
 */
export async function checkPassword(email: string, password: string): Promise<"match" | "mismatch" | "error"> {
  const check = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await check.auth.signInWithPassword({ email, password });
  if (!error) {
    if (data.session) await check.auth.signOut({ scope: "local" });
    return "match";
  }
  if (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message)) return "match";
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) return "mismatch";
  console.error("Password check failed:", error.message);
  return "error";
}

/**
 * Emails the link for a token from mintAccountToken. False when the send failed.
 * `checkUserId`: the account was signed up more than once with different
 * passwords, so the link carries its id and check=1, and the confirm page asks
 * for its password (or a new one) before confirming. (The id, not the email,
 * so no address ends up in the link.)
 */
export async function emailAccountLink(kind: LinkKind, email: string, tokenHash: string, name?: string | null, checkUserId?: string): Promise<boolean> {
  const copy = COPY[kind];
  const params = new URLSearchParams({ token_hash: tokenHash });
  if (checkUserId) {
    params.set("uid", checkUserId);
    params.set("check", "1");
  }
  const link = `${appUrl()}${copy.path}?${params.toString()}`;
  const first = safeFirstName(name);
  const lead = first ? `Hi ${first}, ${copy.body.charAt(0).toLowerCase()}${copy.body.slice(1)}` : copy.body;
  const expiry = "This link works once and expires in 1 hour. Didn't ask for this? Ignore this email.";
  const text = [copy.heading, "", lead, "", `${copy.button}: ${link}`, "", expiry, `Questions? DM us on Instagram at ${INSTAGRAM_HANDLE}.`].join("\n");
  try {
    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: copy.subject,
      text,
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:900;margin:0 0 12px">${copy.heading}</h1>
          <p style="font-size:15px;line-height:1.6;color:#333">${escapeHtml(lead)}</p>
          <a href="${link}" style="display:inline-block;background:#a23200;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:12px 0">${copy.button}</a>
          <p style="font-size:13px;color:#555;line-height:1.5;margin:8px 0 0">Button not working? Copy this link into your browser:<br><a href="${link}" style="color:#a23200;word-break:break-all">${link}</a></p>
          <p style="font-size:12px;color:#888;line-height:1.5;margin:16px 0 0">${expiry}</p>
          <p style="font-size:12px;color:#888;line-height:1.5;margin:8px 0 0">Questions? DM us on Instagram at <a href="${INSTAGRAM_URL}" style="color:#888">${INSTAGRAM_HANDLE}</a>.</p>
        </div>
      `,
    });
    if (sendError) {
      console.error(`Account ${kind} email failed:`, sendError.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Account ${kind} email failed:`, err);
    return false;
  }
}

/**
 * Mints a new confirm or reset link and emails it to `email`. Returns false
 * when there is no such account or the email couldn't be sent; callers that
 * must not reveal whether an account exists ignore the result.
 */
export async function sendAccountLink(kind: LinkKind, email: string, name?: string | null): Promise<boolean> {
  const minted = await mintAccountToken(kind, email);
  if (!minted) return false;
  const checkUserId = kind === "confirm" && minted.user.app_metadata?.signup_conflict ? minted.user.id : undefined;
  return emailAccountLink(kind, email, minted.tokenHash, name ?? (minted.user.user_metadata?.name as string | undefined), checkUserId);
}
