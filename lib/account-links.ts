import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";

/**
 * Account emails with one-time links: confirm the email address, or reset the
 * password. The token is minted with the service role (generateLink, which
 * sends nothing itself) and the link points at our own page, which verifies
 * it (verifyOtp with the token hash). Supabase's redirect allowlist and email
 * templates (shared with the old site) are never involved.
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

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://theonethatsaveditall.com";
}

/**
 * Emails a confirm or reset link to `email`. Returns false when there is no
 * such account (reset) or the email couldn't be sent; callers that must not
 * reveal whether an account exists ignore the result.
 */
export async function sendAccountLink(kind: LinkKind, email: string, name?: string | null): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: kind === "reset" ? "recovery" : "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    if (error) console.error(`generateLink (${kind}) failed:`, error.message);
    return false;
  }

  const copy = COPY[kind];
  const link = `${appUrl()}${copy.path}?token_hash=${encodeURIComponent(tokenHash)}`;
  const first = (name ?? (data.user?.user_metadata?.name as string | undefined) ?? "").split(" ")[0];
  try {
    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: copy.subject,
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:900;margin:0 0 12px">${copy.heading}</h1>
          <p style="font-size:15px;line-height:1.6;color:#333">${first ? `Hi ${escapeHtml(first)}, ` : ""}${copy.body}</p>
          <a href="${link}" style="display:inline-block;background:#a23200;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:12px 0">${copy.button}</a>
          <p style="font-size:12px;color:#888;line-height:1.5">This link works once and expires in 1 hour. Didn't ask for this? Ignore this email.</p>
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
