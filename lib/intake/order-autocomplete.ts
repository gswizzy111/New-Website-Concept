import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_STATUSES } from "@/lib/constants";
import { fetchAll } from "@/lib/fetch-all";
import { setOrderStatus } from "@/lib/order-status";
import { DONE_STATUSES, type NotesEmailResult } from "@/lib/completion-notes-email";

/**
 * The owner's rule (Nov 25 2026, "Do it automatically"): the moment the last
 * card of an order is marked done, the order becomes Completed and the
 * customer gets the usual completed email. Server only; callers check admin
 * access. Called once per order by every request that marks cards done
 * (advanceCards, the tracking Done / Done place, the order page's Done
 * toggle) and only when that request marked at least one card done.
 *
 * The change goes through setOrderStatus() exactly as the admin status
 * button: the 'Status updated to: Completed' event, the customer email and
 * the held completion-notes email. Then one staff-only line records who
 * ("Order completed automatically: last card done by gavin.").
 *
 * Only from an in-shop status (AUTO_COMPLETE_FROM: Cards Received, In
 * Progress) on a paid order; never for Awaiting Payment / Awaiting Cards,
 * cancelled or refunded orders, and never again once the order is Completed,
 * Shipped Back or Delivered. Race-safe: the status changes only while it is
 * still the one read (setOrderStatus's `onlyIfCurrent`, a conditional
 * update), so two requests finishing the last two cards at once send ONE
 * email. Un-doing a card later never un-completes the order (nothing here
 * moves a status backwards). Never throws.
 */

/** The statuses an order is auto-completed from (the in-shop ones before Completed). */
export const AUTO_COMPLETE_FROM = ["received", "in_progress"] as const;
/** payment_status values that count as paid (a partial refund keeps 'paid'). */
const PAID = ["paid", "partially_refunded"];

export type AutoCompleteReason =
  /** Some non-refunded card isn't done yet (or still on its way). */
  | "not_all_done"
  /** Every card of the order is refunded, or it has none. */
  | "no_cards"
  /** Completed, Shipped Back or Delivered already. */
  | "already_done"
  /** Not in an in-shop status (Awaiting Payment, Awaiting Cards, Cancelled). */
  | "wrong_status"
  /** Payment pending, failed or refunded. */
  | "not_paid"
  /** Someone changed the status at the same moment (that request did the work). */
  | "taken"
  /** A read or the status change failed (`error`). */
  | "failed";

export type OrderAutoComplete = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  /** This request changed the order to Completed. */
  completed: boolean;
  /** The customer's completed email went out (false: no address, or Resend refused it). */
  emailed: boolean;
  /** Why the order was left as it was (only when `completed` is false). */
  reason?: AutoCompleteReason;
  /** The order's status after this call (null when it couldn't be read). */
  status: string | null;
  /** The completion-notes email's outcome (setOrderStatus), when the order was completed. */
  notesEmailed?: NotesEmailResult;
  /** One plain line for staff, when there is something to say ("Order completed. Pat Collector emailed."). */
  message?: string;
  /** The failure behind `reason: "failed"`. */
  error?: string;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const statusLabel = (s: string) => ORDER_STATUSES[s as keyof typeof ORDER_STATUSES]?.label ?? s;

/** The staff line for a result (also set as `message` by completeOrderIfAllDone). */
export function autoCompleteMessage(r: Omit<OrderAutoComplete, "message">, hasEmail: boolean): string | undefined {
  const name = r.customerName?.trim() || "The customer";
  if (r.completed) {
    if (r.emailed) return `Order completed. ${name} emailed.`;
    return hasEmail
      ? `Order completed, but the email to ${name} didn't send.`
      : "Order completed. No email sent: the order has no email address.";
  }
  switch (r.reason) {
    case "not_paid":
      return "Every card is done, but the order isn't paid, so it wasn't marked Completed. Change its status on the order page.";
    case "wrong_status":
      return `Every card is done. The order is ${statusLabel(r.status ?? "")}, so its status wasn't changed.`;
    case "failed":
      return `Every card is done, but the order couldn't be marked Completed (${r.error ?? "unknown error"}). Change its status on the order page.`;
    default:
      return undefined;
  }
}

/**
 * Mark the order Completed when every non-refunded card is done (see the
 * file comment). `by`: who marked the last card done (the admin's username).
 */
export async function completeOrderIfAllDone(admin: SupabaseClient, orderId: string, by: string | null): Promise<OrderAutoComplete> {
  const base = { orderId, orderNumber: null as string | null, customerName: null as string | null, completed: false, emailed: false };
  const done = (r: Omit<OrderAutoComplete, "message">, hasEmail = false): OrderAutoComplete => {
    const message = autoCompleteMessage(r, hasEmail);
    return message ? { ...r, message } : r;
  };

  let order: { status: string | null; payment_status: string | null; order_number: string | null; customer_name: string | null; customer_email: string | null } | null;
  let cards: { id: string; completed: boolean | null; status: string | null }[];
  try {
    const [o, c] = await Promise.all([
      admin.from("orders").select("status, payment_status, order_number, customer_name, customer_email").eq("id", orderId).maybeSingle(),
      // Paged: the API returns at most 1,000 rows per request
      fetchAll((from, to) => admin.from("cards").select("id, completed, status").eq("order_id", orderId).order("id").range(from, to)),
    ]);
    if (o.error) throw new Error(o.error.message);
    order = o.data as typeof order;
    cards = c as typeof cards;
  } catch (e) {
    console.error("[intake] order auto-complete: couldn't read the order:", orderId, errText(e));
    return { ...base, status: null, reason: "failed", error: errText(e),
      message: `Couldn't check whether every card of the order is done (${errText(e)}). Check the order's status.` };
  }
  if (!order) return { ...base, status: null, reason: "failed", error: "Order not found" };

  const status = order.status ?? null;
  const info = { ...base, orderNumber: order.order_number ?? null, customerName: order.customer_name ?? null, status };
  const live = cards.filter((c) => c.status !== "refunded");
  if (!live.length) return { ...info, reason: "no_cards" };
  if (live.some((c) => c.completed !== true)) return { ...info, reason: "not_all_done" };
  if (status && DONE_STATUSES.includes(status)) return { ...info, reason: "already_done" };
  if (!(AUTO_COMPLETE_FROM as readonly string[]).includes(status ?? "")) return done({ ...info, reason: "wrong_status" });
  if (!PAID.includes(order.payment_status ?? "")) return done({ ...info, reason: "not_paid" });

  // Exactly the status button, but only while the order still has the status
  // read above: a second request finishing the last cards at the same moment
  // (or someone changing the status meanwhile) finds it changed and writes and
  // sends nothing
  const hasEmail = !!order.customer_email?.trim();
  const r = await setOrderStatus({ orderId, status: "completed", onlyIfCurrent: status! }, admin);
  if (!r.ok) {
    console.error("[intake] order auto-complete failed:", orderId, r.error);
    return done({ ...info, reason: "failed", error: r.error });
  }
  if (r.skipped) {
    const { data: now } = await admin.from("orders").select("status").eq("id", orderId).maybeSingle();
    return { ...info, status: (now?.status as string | undefined) ?? status, reason: "taken" };
  }

  const who = by?.trim() || "admin";
  const { error: eventErr } = await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "order_auto_completed",
    description: `Order completed automatically: last card done by ${who}.`,
    metadata: { auto: true, by: who, cards: live.length },
    is_customer_visible: false,
  });
  if (eventErr) console.error("[intake] order auto-complete: who wasn't recorded:", orderId, eventErr.message);

  return done({
    ...info,
    status: "completed",
    completed: true,
    emailed: hasEmail && !r.emailFailed,
    ...(r.notesEmailed ? { notesEmailed: r.notesEmailed } : {}),
  }, hasEmail);
}

/**
 * completeOrderIfAllDone for every order in `orderIds` (each once, one after
 * the other: a request marking cards of several orders done, e.g. the Scan
 * page). Never throws.
 */
export async function completeOrdersIfAllDone(admin: SupabaseClient, orderIds: readonly string[], by: string | null): Promise<OrderAutoComplete[]> {
  const out: OrderAutoComplete[] = [];
  for (const id of [...new Set(orderIds.filter(Boolean))]) out.push(await completeOrderIfAllDone(admin, id, by));
  return out;
}
