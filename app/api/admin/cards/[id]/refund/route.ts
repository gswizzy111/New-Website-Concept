import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/admin-auth";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { refundEmailHtml } from "@/lib/refund-email";
import { escapeHtml } from "@/lib/card-inquiries";
import { cardGate, gateFacts, nonRefundableText, type GateCard } from "@/lib/work-gates";
import { recordRefund } from "@/lib/refund-ledger";
import {
  catchUpRefunds, orderPayments, planRefund, refundAcrossPayments, refundableCents, refundHistory, unloggedRefunds,
  type OrderPayment, type RefundHistory,
} from "@/lib/order-payments";

const Body = z.object({
  sendEmail: z.boolean().optional(),
  // One per click of Refund, so a retried request can't refund twice
  requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Refund one card's service fee (with its share of discount and tax, and the
 * slab fee if its holder wasn't opened) through Stripe, while work on it
 * hasn't started. After cleaning starts it's refused (Terms Section 11).
 * The money comes back from the order's payments, the original checkout
 * first, then any add-cards or upgrade payments (lib/order-payments.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (session?.role !== "admin") return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { id } = await params;
  const admin = createAdminClient();
  const { data: card } = await admin.from("cards").select("*").eq("id", id).single();
  if (!card) return Response.json({ error: "Card not found" }, { status: 404 });
  const { data: order } = await admin.from("orders")
    .select("id, order_number, total_cents, refunded_cents, payment_status, restoration_tier, stripe_session_id, stripe_payment_intent_id, customer_name, customer_email, created_at")
    .eq("id", card.order_id).single();
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

  const facts = await gateFacts(admin, card.order_id);
  const firstGate = cardGate(card as GateCard, facts);
  if (firstGate.nonRefundableNote && firstGate.refundableCents === 0) return Response.json({ error: nonRefundableText() }, { status: 409 });
  if (firstGate.refundableCents <= 0) return Response.json({ error: "Nothing left to refund for this card." }, { status: 409 });
  if (order.payment_status !== "paid" && order.payment_status !== "partially_refunded") {
    return Response.json({ error: "This order hasn't been paid." }, { status: 400 });
  }
  if (!order.stripe_payment_intent_id && !order.stripe_session_id) return Response.json({ error: "No Stripe payment on this order." }, { status: 400 });

  // The original checkout and any add-cards or upgrade payments (separate Stripe payments)
  let payments: OrderPayment[];
  try {
    payments = await orderPayments(order, admin);
  } catch (e) {
    console.error("[card refund] Stripe payment lookup failed:", e instanceof Error ? e.message : e, "card:", id);
    return Response.json({ error: "Could not read the order's Stripe payments. Nothing was refunded." }, { status: 502 });
  }
  if (payments.length === 0) return Response.json({ error: "No payment found on the Stripe session." }, { status: 400 });

  const kind = order.restoration_tier === "prep" || order.restoration_tier === "prep_standard" ? "prep" : "restoration";

  // What was refunded before, and what this same request already refunded on an earlier try
  const requestId = parsed.data.requestId ?? null;
  let history: RefundHistory;
  try {
    history = await refundHistory(admin, {
      orderId: order.id,
      orderRecordedCents: order.refunded_cents,
      cardId: card.id,
      cardRecordedCents: card.refunded_cents,
    }, payments, requestId);
  } catch (e) {
    console.error("[card refund] refund history lookup failed:", e instanceof Error ? e.message : e, "card:", id);
    return Response.json({ error: "Could not check the refunds already made. Nothing was refunded. Try again." }, { status: 502 });
  }
  // Refunds the records missed (a request that timed out before saving, the Stripe Dashboard): catch up, then stop
  if (history.unrecorded.length || history.ledgerAhead) {
    const total = await catchUpRefunds(admin, { orderId: order.id, orderRecordedCents: order.refunded_cents, kind }, history.unrecorded);
    return Response.json({
      error: `This order has ${dollars(total)} refunded in all, more than was recorded here. It's recorded now. Reload the page and check the balance before refunding again.`,
    }, { status: 409 });
  }

  const gate = cardGate({ ...(card as GateCard), refunded_cents: history.cardRefundedBefore }, facts);
  const remaining = (order.total_cents ?? 0) - history.orderRefundedBefore;
  const amount = Math.min(gate.refundableCents, remaining);
  if (amount <= 0) return Response.json({ error: "The order is already fully refunded." }, { status: 409 });

  // A retried request refunds only what its earlier try didn't
  const toRefund = Math.max(0, amount - history.priorCents);
  const plan = toRefund > 0 ? planRefund(payments, toRefund) : [];
  if (!plan) {
    return Response.json({
      error: `Stripe can refund only ${dollars(refundableCents(payments))} more through the payments found for this order. Refund this card from the Stripe Dashboard.`,
    }, { status: 400 });
  }
  const { refunds: made, error: stripeError } = plan.length
    ? await refundAcrossPayments(plan, {
      metadata: { order_id: order.id, order_number: String(order.order_number), card_id: card.id },
      requestKey: requestId,
    })
    : { refunds: [], error: null };
  const refunds = [...history.prior, ...made];
  if (refunds.length === 0) return Response.json({ error: stripeError ?? "Stripe refund failed" }, { status: 502 });

  for (const r of refunds) {
    await recordRefund(admin, r, { orderId: order.id, cardId: card.id, kind }, session.username);
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
      description: `Refund of $${(refundedNow / 100).toFixed(2)} for ${card.card_name} (cancelled before work started) by ${session.username}. Stripe refund ID${fresh.length > 1 ? "s" : ""}: ${fresh.map((r) => r.id).join(", ")}`,
      is_customer_visible: false,
    });
    if (eventErr) console.error("[card refund] event insert failed:", eventErr.message, "order:", order.id);
  }

  // The card is marked refunded once all of it went back; a part refund only counts on it
  const { error: cardErr } = await admin.from("cards").update({
    refunded_cents: history.cardRefundedBefore + refundedThisRequest,
    ...(complete ? { status: "refunded", refunded_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  if (cardErr) console.error("[card refund] card update failed:", cardErr.message, "card:", id);

  let emailFailed = false;
  if (parsed.data.sendEmail && order.customer_email && refundedNow > 0) {
    try {
      const { error: emailErr } = await resend.emails.send({
        from: fromEmail,
        to: order.customer_email,
        subject: `Your refund from ${businessName} — Order #${order.order_number}`,
        html: refundEmailHtml({
          orderNumber: String(order.order_number),
          firstName: escapeHtml((order.customer_name ?? "").split(" ")[0] || "there"),
          amountFormatted: dollars(refundedNow),
          isFullRefund: full,
          customNote: escapeHtml(`This refunds the service fee for ${card.card_name}, cancelled before work began.`),
        }),
      });
      if (emailErr) {
        emailFailed = true;
        console.error("[card refund email]", emailErr.message);
      }
    } catch (e) {
      emailFailed = true;
      console.error("[card refund email]", e);
    }
  }

  if (stripeError) {
    return Response.json({
      error: `Refunded ${dollars(refundedThisRequest)} of ${dollars(amount)}. The rest failed: ${stripeError}. Reload to see the new balance before trying again.`,
      partial: true,
      amountCents: refundedThisRequest,
    }, { status: 502 });
  }
  return Response.json({ ok: true, amountCents: refundedThisRequest, ...(emailFailed ? { emailFailed: true } : {}) });
}
