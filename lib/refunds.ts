import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { refundEmailHtml } from "@/lib/refund-email";
import { escapeHtml } from "@/lib/card-inquiries";
import { cardGate, gateFacts, nonRefundableText, type GateCard } from "@/lib/work-gates";
import { recordRefund } from "@/lib/refund-ledger";
import {
  catchUpRefunds, orderPayments, planRefund, refundAcrossPayments, refundableCents, refundHistory, unloggedRefunds,
  type OrderPayment, type RefundHistory,
} from "@/lib/order-payments";

/**
 * Restoration and prep refunds through Stripe: the order Refund button
 * (/api/admin/orders/[id]/refund), a card's refund (/api/admin/cards/[id]/refund)
 * and an approved support refund request (/api/admin/refund-requests/[id]) all
 * run these, so every refund is recorded the same way: the refund ledger, the
 * order's refunded_cents and status, an activity entry and, if asked, the
 * customer email. `by` is the admin who issued it.
 *
 * The money comes back from the order's payments, the original checkout
 * first, then any add-cards or upgrade payments (lib/order-payments.ts).
 * `requestId` (one per admin click, or one per refund request and card) is the
 * Stripe idempotency key and is stamped on each refund, so a retry of the same
 * request finds what its earlier try refunded and refunds only the rest, and
 * logs and emails only what wasn't logged. Refunds Stripe holds that the
 * records lack are recorded first and the refund stops with 409.
 */
type Admin = ReturnType<typeof createAdminClient>;

export type RefundResult =
  | {
    ok: true;
    /** The Stripe refund IDs, comma separated (one per payment refunded). */
    refundId: string;
    refundIds: string[];
    amountCents: number;
    newRefundedCents: number;
    isFullRefund: boolean;
    /** The customer email was asked for and Resend refused it. */
    emailFailed: boolean;
  }
  | {
    ok: false;
    error: string;
    status: number;
    /** Some of the money went back before Stripe failed: it is recorded, and this is what went. */
    partial?: { amountCents: number; refundIds: string[] };
  };

const fail = (error: string, status: number): RefundResult => ({ ok: false, error, status });

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function kindOf(tier: string | null) {
  return tier === "prep" || tier === "prep_standard" ? "prep" : "restoration";
}

const caughtUpError = (total: number) =>
  `This order has ${dollars(total)} refunded in all, more than was recorded here. It's recorded now. Reload the page and check the balance before refunding again.`;

/** Sends the refund email; true when it failed. */
async function sendRefundEmail(to: string, orderNumber: unknown, html: string, tag: string): Promise<boolean> {
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to,
      subject: `Your refund from ${businessName} — Order #${orderNumber}`,
      html,
    });
    if (error) {
      console.error(tag, error.message);
      return true;
    }
    return false;
  } catch (e) {
    console.error(tag, e);
    return true;
  }
}

/** A refund of `amountCents` (or everything left) on an order. */
export async function refundOrder(
  admin: Admin,
  orderId: string,
  opts: { amountCents?: number; reason?: string; sendEmail?: boolean; customerMessage?: string; requestId?: string | null },
  by: string,
): Promise<RefundResult> {
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, order_number, total_cents, stripe_session_id, stripe_payment_intent_id, payment_status, refunded_cents, restoration_tier, customer_name, customer_email, created_at")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    console.error("[refund] order lookup failed:", orderErr?.message, "id:", orderId);
    return fail(`Order not found (${orderErr?.message ?? "no data"})`, 404);
  }
  if (order.payment_status !== "paid" && order.payment_status !== "partially_refunded") {
    return fail("Order has not been paid", 400);
  }
  if (!order.stripe_session_id) return fail("No Stripe session on this order", 400);

  // The original checkout and any add-cards or upgrade payments (separate Stripe payments)
  let payments: OrderPayment[];
  try {
    payments = await orderPayments(order, admin);
  } catch (e) {
    console.error("Stripe payment lookup failed:", e);
    return fail("Could not retrieve Stripe payment. Check the session ID.", 502);
  }
  if (payments.length === 0) {
    return fail("No payment intent found on this Stripe session (subscription orders use a different flow)", 400);
  }

  const kind = kindOf(order.restoration_tier as string | null);

  // What was refunded before, and what this same request already refunded on an earlier try
  const requestId = opts.requestId ?? null;
  let history: RefundHistory;
  try {
    history = await refundHistory(admin, { orderId, orderRecordedCents: order.refunded_cents as number | null }, payments, requestId);
  } catch (e) {
    console.error("[refund] refund history lookup failed:", e instanceof Error ? e.message : e, "order:", orderId);
    return fail("Could not check the refunds already made. Nothing was refunded. Try again.", 502);
  }
  // Refunds the records missed (a request that timed out before saving, the Stripe Dashboard): catch up, then stop
  if (history.unrecorded.length || history.ledgerAhead) {
    const total = await catchUpRefunds(admin, { orderId, orderRecordedCents: order.refunded_cents as number | null, kind }, history.unrecorded);
    return fail(caughtUpError(total), 409);
  }

  // Partial refunds made before the ledger existed may be missing from refunded_cents
  const alreadyRefunded = history.orderRefundedBefore;
  const maxRefundable = (order.total_cents as number) - alreadyRefunded;
  if (maxRefundable <= 0) return fail("Order is already fully refunded", 400);

  const refundAmount = opts.amountCents ?? maxRefundable;
  if (refundAmount > maxRefundable) {
    return fail(`Cannot refund more than ${maxRefundable / 100} (remaining balance)`, 400);
  }

  // A retried request refunds only what its earlier try didn't
  const toRefund = Math.max(0, refundAmount - history.priorCents);
  const plan = toRefund > 0 ? planRefund(payments, toRefund) : [];
  if (!plan) {
    return fail(
      `Stripe can refund only ${dollars(refundableCents(payments))} more through the payments found for this order. Refund up to that here, and anything else from the Stripe Dashboard.`,
      400,
    );
  }

  const { refunds: made, error: stripeError } = plan.length
    ? await refundAcrossPayments(plan, {
      metadata: {
        order_id: orderId,
        order_number: String(order.order_number),
        admin_reason: opts.reason ?? "",
      },
      requestKey: requestId,
    })
    : { refunds: [] as Stripe.Refund[], error: null };
  const refunds = [...history.prior, ...made];
  if (refunds.length === 0) return fail(stripeError ?? "Stripe refund failed", 502);

  // Saving is idempotent (one ledger row per Stripe refund), so a retry saves anything its earlier try didn't
  for (const r of refunds) {
    await recordRefund(admin, r, { orderId, kind }, by);
  }

  const totalThisRequest = refunds.reduce((s, r) => s + r.amount, 0);
  const newRefundedCents = alreadyRefunded + totalThisRequest;
  const isFullRefund = newRefundedCents >= (order.total_cents as number);

  // A partial refund leaves the order paid (payment_status allows only pending/paid/refunded/failed)
  const { error: updateErr } = await admin
    .from("orders")
    .update({
      refunded_cents: newRefundedCents,
      ...(isFullRefund ? { status: "cancelled", payment_status: "refunded" } : {}),
    })
    .eq("id", orderId);
  if (updateErr) console.error("[refund] order update failed:", updateErr.message, "order:", orderId);

  // Logged and emailed once: a retry adds only refunds its earlier try didn't log
  const fresh = await unloggedRefunds(admin, orderId, history.prior, made);
  const refundedNow = fresh.reduce((s, r) => s + r.amount, 0);
  if (fresh.length) {
    const { error: eventErr } = await admin.from("order_events").insert({
      order_id: orderId,
      event_type: "refund_issued",
      description: `Refund of $${(refundedNow / 100).toFixed(2)} issued${opts.reason ? ` — ${opts.reason}` : ""}. Stripe refund ID${fresh.length > 1 ? "s" : ""}: ${fresh.map((r) => r.id).join(", ")}`,
      is_customer_visible: false,
    });
    if (eventErr) console.error("[refund] event insert failed:", eventErr.message, "order:", orderId);
  }

  // Send customer email if requested (once: not again for a retried request)
  let emailFailed = false;
  if (opts.sendEmail && order.customer_email && refundedNow > 0) {
    const name = (order.customer_name as string | null)?.split(" ")[0] || "there";
    const customNote = opts.customerMessage?.trim();
    const html = refundEmailHtml({
      orderNumber: String(order.order_number),
      firstName: escapeHtml(name),
      amountFormatted: dollars(refundedNow),
      isFullRefund,
      customNote: customNote ? escapeHtml(customNote) : undefined,
    });
    emailFailed = await sendRefundEmail(order.customer_email as string, order.order_number, html, "[refund email]");
  }

  const refundIds = refunds.map((r) => r.id);
  if (stripeError) {
    return {
      ok: false,
      error: `Refunded ${dollars(totalThisRequest)} of ${dollars(refundAmount)}. The rest failed: ${stripeError}. Reload to see the new balance before trying again.`,
      status: 502,
      partial: { amountCents: totalThisRequest, refundIds },
    };
  }

  return { ok: true, refundId: refundIds.join(", "), refundIds, amountCents: totalThisRequest, newRefundedCents, isFullRefund, emailFailed };
}

/**
 * Refund one card's service fee (with its share of discount and tax, and the
 * slab fee if its holder wasn't opened) while work on it hasn't started.
 * After cleaning starts it's refused (Terms Section 11).
 */
export async function refundCard(
  admin: Admin,
  cardId: string,
  opts: { sendEmail?: boolean; requestId?: string | null },
  by: string,
): Promise<RefundResult> {
  const { data: card } = await admin.from("cards").select("*").eq("id", cardId).single();
  if (!card) return fail("Card not found", 404);
  const { data: order } = await admin.from("orders")
    .select("id, order_number, total_cents, refunded_cents, payment_status, restoration_tier, stripe_session_id, stripe_payment_intent_id, customer_name, customer_email, created_at")
    .eq("id", card.order_id).single();
  if (!order) return fail("Order not found", 404);

  const facts = await gateFacts(admin, card.order_id);
  // A request with an id may be a retry whose earlier try already refunded the card
  // (and marked it, and maybe the order, refunded): the request's refund history
  // below decides what is left, so the early checks only apply without one.
  const requestId = opts.requestId ?? null;
  if (!requestId) {
    const firstGate = cardGate(card as GateCard, facts);
    if (firstGate.nonRefundableNote && firstGate.refundableCents === 0) return fail(nonRefundableText(), 409);
    if (firstGate.refundableCents <= 0) return fail("Nothing left to refund for this card.", 409);
  }
  const paid = order.payment_status === "paid" || order.payment_status === "partially_refunded"
    || (!!requestId && order.payment_status === "refunded");
  if (!paid) {
    return fail("This order hasn't been paid.", 400);
  }
  if (!order.stripe_payment_intent_id && !order.stripe_session_id) return fail("No Stripe payment on this order.", 400);

  // The original checkout and any add-cards or upgrade payments (separate Stripe payments)
  let payments: OrderPayment[];
  try {
    payments = await orderPayments(order, admin);
  } catch (e) {
    console.error("[card refund] Stripe payment lookup failed:", e instanceof Error ? e.message : e, "card:", cardId);
    return fail("Could not read the order's Stripe payments. Nothing was refunded.", 502);
  }
  if (payments.length === 0) return fail("No payment found on the Stripe session.", 400);

  const kind = kindOf(order.restoration_tier);

  // What was refunded before, and what this same request already refunded on an earlier try
  let history: RefundHistory;
  try {
    history = await refundHistory(admin, {
      orderId: order.id,
      orderRecordedCents: order.refunded_cents,
      cardId: card.id,
      cardRecordedCents: card.refunded_cents,
    }, payments, requestId);
  } catch (e) {
    console.error("[card refund] refund history lookup failed:", e instanceof Error ? e.message : e, "card:", cardId);
    return fail("Could not check the refunds already made. Nothing was refunded. Try again.", 502);
  }
  // Refunds the records missed (a request that timed out before saving, the Stripe Dashboard): catch up, then stop
  if (history.unrecorded.length || history.ledgerAhead) {
    const total = await catchUpRefunds(admin, { orderId: order.id, orderRecordedCents: order.refunded_cents, kind }, history.unrecorded);
    return fail(caughtUpError(total), 409);
  }

  // An earlier try of this request may have marked the card refunded: judge it as before that try
  const retried = history.prior.length > 0;
  const gate = cardGate({
    ...(card as GateCard),
    refunded_cents: history.cardRefundedBefore,
    ...(retried && card.status === "refunded" ? { status: null } : {}),
  }, facts);
  if (!retried) {
    if (gate.nonRefundableNote && gate.refundableCents === 0) return fail(nonRefundableText(), 409);
    if (gate.refundableCents <= 0) return fail("Nothing left to refund for this card.", 409);
  }
  const remaining = (order.total_cents ?? 0) - history.orderRefundedBefore;
  const amount = Math.min(gate.refundableCents, remaining);
  if (amount <= 0) return fail("The order is already fully refunded.", 409);

  // A retried request refunds only what its earlier try didn't
  const toRefund = Math.max(0, amount - history.priorCents);
  const plan = toRefund > 0 ? planRefund(payments, toRefund) : [];
  if (!plan) {
    return fail(
      `Stripe can refund only ${dollars(refundableCents(payments))} more through the payments found for this order. Refund this card from the Stripe Dashboard.`,
      400,
    );
  }
  const { refunds: made, error: stripeError } = plan.length
    ? await refundAcrossPayments(plan, {
      metadata: { order_id: order.id, order_number: String(order.order_number), card_id: card.id },
      requestKey: requestId,
    })
    : { refunds: [] as Stripe.Refund[], error: null };
  const refunds = [...history.prior, ...made];
  if (refunds.length === 0) return fail(stripeError ?? "Stripe refund failed", 502);

  for (const r of refunds) {
    await recordRefund(admin, r, { orderId: order.id, cardId: card.id, kind }, by);
  }

  const refundedThisRequest = refunds.reduce((s, r) => s + r.amount, 0);
  const complete = !stripeError && refundedThisRequest >= amount;
  const newRefunded = history.orderRefundedBefore + refundedThisRequest;
  const full = newRefunded >= (order.total_cents ?? 0);
  // A partial refund leaves the order paid (payment_status allows only pending/paid/refunded/failed)
  const { error: orderErr } = await admin.from("orders").update({
    refunded_cents: newRefunded,
    ...(full ? { status: "cancelled", payment_status: "refunded" } : {}),
  }).eq("id", order.id);
  if (orderErr) console.error("[card refund] order update failed:", orderErr.message, "order:", order.id);

  // Logged and emailed once: a retry adds only refunds its earlier try didn't log
  const fresh = await unloggedRefunds(admin, order.id, history.prior, made);
  const refundedNow = fresh.reduce((s, r) => s + r.amount, 0);
  if (fresh.length) {
    const { error: eventErr } = await admin.from("order_events").insert({
      order_id: order.id,
      event_type: "refund_issued",
      description: `Refund of $${(refundedNow / 100).toFixed(2)} for ${card.card_name} (cancelled before work started) by ${by}. Stripe refund ID${fresh.length > 1 ? "s" : ""}: ${fresh.map((r) => r.id).join(", ")}`,
      is_customer_visible: false,
    });
    if (eventErr) console.error("[card refund] event insert failed:", eventErr.message, "order:", order.id);
  }

  // The card is marked refunded once all of it went back; a part refund only counts on it
  const { error: cardErr } = await admin.from("cards").update({
    refunded_cents: history.cardRefundedBefore + refundedThisRequest,
    ...(complete ? { status: "refunded", refunded_at: new Date().toISOString() } : {}),
  }).eq("id", cardId);
  if (cardErr) console.error("[card refund] card update failed:", cardErr.message, "card:", cardId);

  let emailFailed = false;
  if (opts.sendEmail && order.customer_email && refundedNow > 0) {
    emailFailed = await sendRefundEmail(order.customer_email, order.order_number, refundEmailHtml({
      orderNumber: String(order.order_number),
      firstName: escapeHtml((order.customer_name ?? "").split(" ")[0] || "there"),
      amountFormatted: dollars(refundedNow),
      isFullRefund: full,
      customNote: escapeHtml(`This refunds the service fee for ${card.card_name}, cancelled before work began.`),
    }), "[card refund email]");
  }

  const refundIds = refunds.map((r) => r.id);
  if (stripeError) {
    return {
      ok: false,
      error: `Refunded ${dollars(refundedThisRequest)} of ${dollars(amount)}. The rest failed: ${stripeError}. Reload to see the new balance before trying again.`,
      status: 502,
      partial: { amountCents: refundedThisRequest, refundIds },
    };
  }
  return { ok: true, refundId: refundIds.join(", "), refundIds, amountCents: refundedThisRequest, newRefundedCents: newRefunded, isFullRefund: full, emailFailed };
}
