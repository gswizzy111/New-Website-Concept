import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";

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
  return /^[\p{L}\p{M}'’.-]{1,30}$/u.test(first) ? first : "";
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://theonethatsaveditall.com";
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

/** Emails the link for a token from mintAccountToken. False when the send failed. */
export async function emailAccountLink(kind: LinkKind, email: string, tokenHash: string, name?: string | null): Promise<boolean> {
  const copy = COPY[kind];
  const link = `${appUrl()}${copy.path}?token_hash=${encodeURIComponent(tokenHash)}`;
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
  return emailAccountLink(kind, email, minted.tokenHash, name ?? (minted.user.user_metadata?.name as string | undefined));
}
