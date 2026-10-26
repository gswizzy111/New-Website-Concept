import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail } from "@/lib/resend";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";

const BUCKET = "app-config";
const FILE = "checkout-errors.json";
const MAX_ENTRIES = 200;

export interface CheckoutErrorEntry {
  ref: string;
  timestamp: string;
  code: string;
  actual_error: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  tier?: string;
  card_count?: number;
  shipping_method?: string;
  user_agent?: string;
}

async function readLog(admin: ReturnType<typeof createAdminClient>): Promise<CheckoutErrorEntry[]> {
  const { data, error } = await admin.storage.from(BUCKET).download(FILE);
  if (error || !data) return [];
  try {
    return JSON.parse(await data.text()) as CheckoutErrorEntry[];
  } catch {
    return [];
  }
}

async function writeLog(admin: ReturnType<typeof createAdminClient>, entries: CheckoutErrorEntry[]) {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const { error } = await admin.storage.from(BUCKET).upload(FILE, blob, { upsert: true, contentType: "application/json" });
  if (error) console.error("Failed to write checkout error log:", error.message);
}

export async function logCheckoutError(entry: CheckoutErrorEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {});
    const existing = await readLog(admin);
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    await writeLog(admin, updated);
  } catch (e) {
    console.error("Failed to write checkout error log:", e);
  }

  // Email admin — fire and forget
  try {
    // Never the sending address (orders@… has no mailbox): the admin inbox the
    // other alerts use, else the owner's address
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFY_EMAIL || process.env.BUSINESS_SHIPPING_EMAIL || "gavinfraiman33@gmail.com";
    // Everything in the entry can come from the customer (or from an error that quotes them)
    const esc = (value: string | number | undefined) => escapeHtml(String(value ?? ""));
    const firstName = entry.customer_name?.split(" ")[0] ?? "there";
    const customerMailto = entry.customer_email
      ? `mailto:${entry.customer_email}?subject=${encodeURIComponent("Your Card Doc Order — We Can Help")}&body=${encodeURIComponent(`Hi ${firstName},\n\nWe noticed you had trouble checking out and wanted to reach out to help complete your order.\n\n— The Card Doc`)}`
      : "";
    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `⚠️ Checkout Failed — ${entry.code} — ${entry.customer_name ?? "Unknown customer"}`,
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#111">
          <div style="background:#dc2626;border-radius:8px 8px 0 0;padding:16px 20px">
            <h2 style="font-family:Georgia,'Times New Roman',serif;margin:0;color:#fff;font-size:20px">Checkout Failure Alert</h2>
          </div>
          <div style="border:1px solid #e6e4e2;border-top:0;border-radius:0 0 8px 8px;padding:20px;background:#fff">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#74716e;width:140px">Error Code</td><td style="font-weight:700;color:#dc2626">${esc(entry.code)}</td></tr>
              <tr><td style="padding:6px 0;color:#74716e">Ref</td><td style="font-family:monospace;font-size:12px">${esc(entry.ref)}</td></tr>
              <tr><td style="padding:6px 0;color:#74716e">Time</td><td>${new Date(entry.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</td></tr>
              ${entry.customer_name ? `<tr><td style="padding:6px 0;color:#74716e">Customer</td><td><strong>${esc(entry.customer_name)}</strong></td></tr>` : ""}
              ${entry.customer_email ? `<tr><td style="padding:6px 0;color:#74716e">Email</td><td><a href="mailto:${esc(entry.customer_email)}">${esc(entry.customer_email)}</a></td></tr>` : ""}
              ${entry.customer_phone ? `<tr><td style="padding:6px 0;color:#74716e">Phone</td><td>${esc(entry.customer_phone)}</td></tr>` : ""}
              ${entry.tier ? `<tr><td style="padding:6px 0;color:#74716e">Tier</td><td>${esc(entry.tier)}</td></tr>` : ""}
              ${entry.card_count ? `<tr><td style="padding:6px 0;color:#74716e">Cards</td><td>${esc(entry.card_count)}</td></tr>` : ""}
              ${entry.shipping_method ? `<tr><td style="padding:6px 0;color:#74716e">Shipping</td><td>${esc(entry.shipping_method)}</td></tr>` : ""}
            </table>
            <div style="margin-top:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px">
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.05em">Actual Error</p>
              <p style="margin:0;font-family:monospace;font-size:12px;color:#7f1d1d;word-break:break-all">${esc(entry.actual_error)}</p>
            </div>
            ${entry.customer_email ? `
            <div style="margin-top:16px;text-align:center">
              <a href="${esc(customerMailto)}"
                style="display:inline-block;background:#a23200;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">
                Email Customer →
              </a>
            </div>` : ""}
            <p style="margin-top:16px;font-size:12px;color:#74716e;text-align:center">
              View all errors at <a href="${siteUrl()}/admin/checkout-errors" style="color:#a23200">Admin → Checkout Errors</a>
            </p>
          </div>
        </div>
      `,
    });
    // Resend reports failures here instead of throwing
    if (sendError) console.error("Failed to send checkout error email:", sendError.message);
  } catch (e) {
    console.error("Failed to send checkout error email:", e);
  }
}

export async function getCheckoutErrors(): Promise<CheckoutErrorEntry[]> {
  const admin = createAdminClient();
  await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {});
  return readLog(admin);
}

export async function clearCheckoutErrors(): Promise<void> {
  const admin = createAdminClient();
  await writeLog(admin, []);
}
