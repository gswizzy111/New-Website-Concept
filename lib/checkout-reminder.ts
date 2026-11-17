import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { resend, fromEmail, fromAddress, replyToAddress } from "@/lib/resend";
import { isSendableAddress, undeliverableEmails } from "@/lib/email-unsubscribe";
import { bareAddress } from "@/lib/email-problem-labels";
import { likeExact } from "@/lib/like-exact";
import { checkoutReminderEmail } from "@/lib/checkout-reminder-email";

/**
 * Unpaid order reminders. A restoration or prep customer who reaches Stripe
 * but doesn't pay gets one email, with a button back to the same Stripe
 * payment page (lib/checkout-reminder-email.ts). Run every 5 minutes by
 * app/api/cron/checkout-reminders (netlify/functions/cron-checkout-reminders.mjs).
 *
 * When: 10 to 25 minutes after the order was created. Almost everyone who
 * pays does so within 5 minutes, and a pending checkout holds its tier slot
 * for 30 (lib/tier-slots.ts), so the email lands while the slot is still held
 * and the Stripe page is still open.
 *
 * Who: orders still pending in Stripe (payment_status 'pending', status
 * 'awaiting_payment') with a Stripe session and no reminder yet. Skipped:
 * - staff-entered orders (the admin's manual orders are saved as paid with no
 *   Stripe session; the manual_order_created event is checked as well);
 * - test orders: a Stripe test-mode session while the key is live, or an
 *   order placed with one of the business's own addresses;
 * - addresses with an open bounce or Resend suppression, or that ever marked
 *   our email as spam (the email_problems rows lib/email-problems.ts shows,
 *   read with the same rule as undeliverableEmails()). Marketing unsubscribes
 *   don't apply: this is a transactional message about an order the customer
 *   signed, not marketing;
 * - an order whose customer already came back: the same address has a paid
 *   order, or a newer checkout, created after it (only the newest unpaid
 *   checkout gets a reminder, so a customer never gets a link to an older
 *   copy of an order they placed again);
 * - an address that already got a reminder in the last 24 hours.
 *
 * Exactly once: the order is claimed (payment_reminder_sent_at set while
 * still null, supabase/migrations/20261118_checkout_reminders.sql) before
 * Stripe is asked or anything is sent, so overlapping runs never double-send.
 * The claim is kept whatever happens next: if the Stripe page has closed or
 * been paid, or Resend refuses the email, nothing is retried.
 *
 * The reminder never changes the order's status, totals, tier slot or gift
 * card hold: it only sets payment_reminder_sent_at and adds an admin-only
 * line to the order's activity.
 */

export const REMIND_AFTER_MINUTES = 10;
export const REMIND_BEFORE_MINUTES = 25;
/** One reminder per address in this long, whatever the order */
const ONE_PER_ADDRESS_HOURS = 24;
// A run handles at most this many orders and stops starting new ones after
// the time budget. Anything left stays unclaimed for the next run (every 5
// minutes, so still inside the window).
const MAX_PER_RUN = 25;
const TIME_BUDGET_MS = 20_000;

export type CheckoutReminderCounts = {
  /** Unpaid orders in the 10 to 25 minute window */
  checked: number;
  sent: number;
  /** Why the others got no email, by reason */
  skipped: Record<string, number>;
};

type Candidate = {
  id: string;
  order_number: string | null;
  customer_email: string | null;
  customer_name: string | null;
  total_cents: number | null;
  created_at: string;
  stripe_session_id: string;
  restoration_tier: string | null;
  cards: { id: string }[] | null;
};

const CANDIDATE_COLUMNS =
  "id, order_number, customer_email, customer_name, total_cents, created_at, stripe_session_id, restoration_tier, cards(id)";

const iso = (ms: number) => new Date(ms).toISOString();

export async function sendCheckoutReminders(): Promise<CheckoutReminderCounts> {
  const admin = createAdminClient();
  const started = Date.now();
  const counts: CheckoutReminderCounts = { checked: 0, sent: 0, skipped: {} };
  const skip = (order: Candidate, reason: string, detail?: string) => {
    counts.skipped[reason] = (counts.skipped[reason] ?? 0) + 1;
    console.log(`[checkout-reminders] #${order.order_number ?? order.id} not reminded: ${reason}${detail ? ` (${detail})` : ""}`);
  };

  const { data, error } = await admin
    .from("orders")
    .select(CANDIDATE_COLUMNS)
    .eq("payment_status", "pending")
    .eq("status", "awaiting_payment")
    .is("payment_reminder_sent_at", null)
    .not("stripe_session_id", "is", null)
    .gte("created_at", iso(started - REMIND_BEFORE_MINUTES * 60_000))
    .lte("created_at", iso(started - REMIND_AFTER_MINUTES * 60_000))
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(`Couldn't read unpaid orders: ${error.message}`);
  const orders = (data ?? []) as unknown as Candidate[];
  counts.checked = orders.length;
  if (orders.length === 0) return counts;

  // Read before anything is claimed: if either fails, the run stops with
  // nothing claimed or sent, and the next run tries again
  const { data: manual, error: manualError } = await admin
    .from("order_events")
    .select("order_id")
    .in("order_id", orders.map((o) => o.id))
    .eq("event_type", "manual_order_created");
  if (manualError) throw new Error(`Couldn't check for staff-entered orders: ${manualError.message}`);
  const staffEntered = new Set((manual ?? []).map((r) => r.order_id as string));
  const undeliverable = await undeliverableEmails();
  const ownAddresses = businessAddresses();
  const liveKey = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? "");

  for (const order of orders) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      skip(order, "next_run");
      continue;
    }
    const address = bareAddress(order.customer_email ?? "");
    if (staffEntered.has(order.id)) { skip(order, "staff_entered"); continue; }
    if ((liveKey && order.stripe_session_id.startsWith("cs_test_")) || ownAddresses.has(address)) {
      skip(order, "test_order");
      continue;
    }
    if (!isSendableAddress(address)) { skip(order, "invalid_address"); continue; }
    if (undeliverable.has(address)) { skip(order, "email_problem"); continue; }

    let cameBack: string | null;
    try {
      cameBack = await customerCameBack(admin, order, started);
    } catch (err) {
      skip(order, "lookup_failed", err instanceof Error ? err.message : String(err));
      continue;
    }
    if (cameBack) { skip(order, cameBack); continue; }

    // Claim it: only one run can set the column from null, and only while the
    // order is still unpaid. From here on it is never considered again.
    const { data: claimed, error: claimError } = await admin
      .from("orders")
      .update({ payment_reminder_sent_at: new Date().toISOString() })
      .eq("id", order.id)
      .is("payment_reminder_sent_at", null)
      .eq("payment_status", "pending")
      .eq("status", "awaiting_payment")
      .select("id");
    if (claimError) { skip(order, "claim_failed", claimError.message); continue; }
    if (!claimed?.length) { skip(order, "claimed_or_paid"); continue; }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    } catch (err) {
      skip(order, "stripe_unreadable", err instanceof Error ? err.message : String(err));
      continue;
    }
    if (session.metadata?.order_id && session.metadata.order_id !== order.id) {
      skip(order, "session_mismatch", session.id);
      continue;
    }
    if (session.payment_status === "paid") { skip(order, "session_paid"); continue; }
    if (session.status !== "open") { skip(order, `session_${session.status ?? "unknown"}`); continue; }
    if (!session.url) { skip(order, "session_no_url"); continue; }

    const lifetimeMinutes = session.expires_at && session.created
      ? (session.expires_at - session.created) / 60
      : 24 * 60;
    const message = checkoutReminderEmail({
      orderNumber: order.order_number ?? "",
      customerName: order.customer_name,
      isPrep: order.restoration_tier === "prep",
      cardCount: order.cards?.length ?? 0,
      totalCents: order.total_cents ?? 0,
      paymentUrl: session.url,
      sessionLifetimeMinutes: lifetimeMinutes,
    });

    // Resend's send() returns { error } rather than throwing; the catch is for
    // a dropped connection. Never retried: the claim stays either way. The
    // idempotency key makes Resend drop a second copy for the same order.
    let sendError: string | null = null;
    try {
      const { error: resendError } = await resend.emails.send(
        { from: fromEmail, to: order.customer_email as string, subject: message.subject, html: message.html, text: message.text },
        { idempotencyKey: `checkout-reminder/${order.id}` },
      );
      if (resendError) sendError = resendError.message || resendError.name || "unknown error";
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
    }
    if (sendError) {
      console.error(`Payment reminder email failed for #${order.order_number}:`, sendError);
      skip(order, "send_failed");
      await noteOnOrder(admin, order.id, `Payment reminder email couldn't be sent: ${sendError.slice(0, 200)}`);
      continue;
    }
    counts.sent++;
    console.log(`[checkout-reminders] #${order.order_number} reminded`);
    await noteOnOrder(admin, order.id, "Payment reminder emailed to the customer, with a link back to their open Stripe checkout");
  }

  return counts;
}

/**
 * Why this order's customer needs no reminder, or null if they do: the same
 * address (any case) has a paid order created after it, a newer checkout
 * still open, or a reminder in the last 24 hours. Throws on a database error.
 */
async function customerCameBack(admin: SupabaseClient, order: Candidate, now: number): Promise<string | null> {
  const recentSince = now - ONE_PER_ADDRESS_HOURS * 3_600_000;
  // Covers both: later orders (this one is under 25 minutes old) and orders
  // reminded in the last 24 hours (reminded within 25 minutes of creation)
  const { data, error } = await admin
    .from("orders")
    .select("id, payment_status, status, created_at, payment_reminder_sent_at")
    .ilike("customer_email", likeExact((order.customer_email ?? "").trim()))
    .neq("id", order.id)
    .gte("created_at", iso(recentSince - 3_600_000));
  if (error) throw new Error(error.message);
  const created = new Date(order.created_at).getTime();
  const rows = (data ?? []) as { payment_status: string | null; status: string | null; created_at: string; payment_reminder_sent_at: string | null }[];
  const later = rows.filter((r) => new Date(r.created_at).getTime() > created);
  if (later.some((r) => r.payment_status === "paid" || r.payment_status === "refunded")) return "paid_later";
  if (later.some((r) => r.status !== "cancelled")) return "newer_checkout";
  if (rows.some((r) => r.payment_reminder_sent_at && new Date(r.payment_reminder_sent_at).getTime() >= recentSince)) {
    return "reminded_recently";
  }
  return null;
}

/** The business's own addresses (lowercased). An order placed with one of
 * them is staff trying the checkout, not a customer. */
function businessAddresses(): Set<string> {
  const values = [
    fromAddress,
    replyToAddress,
    process.env.CONTACT_EMAIL,
    process.env.BUSINESS_SHIPPING_EMAIL,
    process.env.ADMIN_NOTIFICATION_EMAIL,
    process.env.ADMIN_NOTIFY_EMAIL,
  ];
  return new Set(
    values
      .flatMap((v) => (v ?? "").split(","))
      .map((v) => bareAddress(v))
      .filter(Boolean),
  );
}

/** An admin-only line in the order's Activity. Never throws: the email has
 * already been decided by then. */
async function noteOnOrder(admin: SupabaseClient, orderId: string, description: string) {
  const { error } = await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "payment_reminder",
    description,
    is_customer_visible: false,
  });
  if (error) console.error("[checkout-reminders] couldn't note it on the order:", error.message);
}
