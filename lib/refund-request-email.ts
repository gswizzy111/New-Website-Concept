import type { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { escapeHtml, orderLabel } from "@/lib/card-inquiries";
import { sendAdminEmail } from "@/lib/admin-password";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The email side of refund requests (lib/refund-requests.ts). Kept apart
 * because sending pulls in the Resend SDK, and lib/refund-requests.ts is
 * loaded by the admin layout on every admin page: only the route that files
 * a request (app/api/admin/support/refund-requests) needs this.
 */

/** Tells every active admin with an email on their Profile that a request is waiting. */
export async function emailAdminsAboutRequest(admin: Admin, req: { orderNumber: number; requestedBy: string; reason: string }) {
  const { data: admins } = await admin.from("admin_users").select("email").eq("active", true).not("email", "is", null);
  const appUrl = siteUrl();
  await Promise.all(
    (admins ?? []).map((a) =>
      sendAdminEmail(
        a.email as string,
        `Refund request for order ${orderLabel(req.orderNumber)}`,
        "A refund is waiting for your approval",
        `<strong>${escapeHtml(req.requestedBy)}</strong> asked for a refund on order <strong>${escapeHtml(orderLabel(req.orderNumber))}</strong>:<br><br>${escapeHtml(req.reason).replace(/\n/g, "<br>")}`,
        { label: "Review refund requests", href: `${appUrl}/admin?tab=refunds`, note: "Nothing is refunded until you approve it." },
      )
    )
  );
}
