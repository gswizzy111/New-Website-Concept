import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { refundEmailHtml } from "@/lib/refund-email";
import { escapeHtml } from "@/lib/card-inquiries";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin-auth";
import { recordRefund } from "@/lib/refund-ledger";
import {
  catchUpRefunds, orderPayments, planRefund, refundAcrossPayments, refundableCents, refundHistory, unloggedRefunds,
  type OrderPayment, type RefundHistory,
} from "@/lib/order-payments";

const Body = z.object({
  amountCents: z.number().int().min(1).optional(),
  reason: z.string().max(500).optional(),
  sendEmail: z.boolean().optional(),
  customerMessage: z.string().max(1000).optional(),
  // One per click of Confirm Refund, so a retried request can't refund twice
  requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (adminSession?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const admin = createAdminClient();

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, order_number, total_cents, stripe_session_id, stripe_payment_intent_id, payment_status, refunded_cents, restoration_tier, customer_name, customer_email, created_at")
    .eq("id", id)
    .single();

  if (orderErr || !order) {
    console.error("[refund] order lookup failed:", orderErr?.message, "id:", id);
    return Response.json({ error: `Order not found (${orderErr?.message ?? "no data"})` }, { status: 404 });
  }
  if (order.payment_status !== "paid" && order.payment_status !== "partially_refunded") {
    return Response.json({ error: "Order has not been paid" }, { status: 400 });
  }
  if (!order.stripe_session_id) return Response.json({ error: "No Stripe session on this order" }, { status: 400 });

  // The original checkout and any add-cards or upgrade payments (separate Stripe payments)
  let payments: OrderPayment[];
  try {
    payments = await orderPayments(order, admin);
  } catch (e) {
    console.error("Stripe payment lookup failed:", e);
    return Response.json({ error: "Could not retrieve Stripe payment. Check the session ID." }, { status: 502 });
  }
  if (payments.length === 0) {
    return Response.json({ error: "No payment intent found on this Stripe session (subscription orders use a different flow)" }, { status: 400 });
  }

  const kind = order.restoration_tier === "prep" || order.restoration_tier === "prep_standard" ? "prep" : "restoration";

  // What was refunded before, and what this same request already refunded on an earlier try
  const requestId = parsed.data.requestId ?? null;
  let history: RefundHistory;
  try {
    history = await refundHistory(admin, { orderId: id, orderRecordedCents: order.refunded_cents as number | null }, payments, requestId);
  } catch (e) {
    console.error("[refund] refund history lookup failed:", e instanceof Error ? e.message : e, "order:", id);
    return Response.json({ error: "Could not check the refunds already made. Nothing was refunded. Try again." }, { status: 502 });
  }
  // Refunds the records missed (a request that timed out before saving, the Stripe Dashboard): catch up, then stop
  if (history.unrecorded.length || history.ledgerAhead) {
    const total = await catchUpRefunds(admin, { orderId: id, orderRecordedCents: order.refunded_cents as number | null, kind }, history.unrecorded);
    return Response.json({
      error: `This order has ${dollars(total)} refunded in all, more than was recorded here. It's recorded now. Reload the page and check the balance before refunding again.`,
    }, { status: 409 });
  }

  // Partial refunds made before the ledger existed may be missing from refunded_cents
  const alreadyRefunded = history.orderRefundedBefore;
  const maxRefundable = (order.total_cents as number) - alreadyRefunded;
  if (maxRefundable <= 0) return Response.json({ error: "Order is already fully refunded" }, { status: 400 });

  const refundAmount = parsed.data.amountCents ?? maxRefundable;
  if (refundAmount > maxRefundable) {
    return Response.json({ error: `Cannot refund more than ${maxRefundable / 100} (remaining balance)` }, { status: 400 });
  }

  // A retried request refunds only what its earlier try didn't
  const toRefund = Math.max(0, refundAmount - history.priorCents);
  const plan = toRefund > 0 ? planRefund(payments, toRefund) : [];
  if (!plan) {
    return Response.json({
      error: `Stripe can refund only ${dollars(refundableCents(payments))} more through the payments found for this order. Refund up to that here, and anything else from the Stripe Dashboard.`,
    }, { status: 400 });
  }

  const { refunds: made, error: stripeError } = plan.length
    ? await refundAcrossPayments(plan, {
      metadata: {
        order_id: id,
        order_number: String(order.order_number),
        admin_reason: parsed.data.reason ?? "",
      },
      requestKey: requestId,
    })
    : { refunds: [], error: null };
  const refunds = [...history.prior, ...made];
  if (refunds.length === 0) {
    return Response.json({ error: stripeError ?? "Stripe refund failed" }, { status: 502 });
  }

  // Saving is idempotent (one ledger row per Stripe refund), so a retry saves anything its earlier try didn't
  for (const r of refunds) {
    await recordRefund(admin, r, { orderId: id, kind }, adminSession.username);
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
    .eq("id", id);
  if (updateErr) console.error("[refund] order update failed:", updateErr.message, "order:", id);

  // Logged and emailed once: a retry adds only refunds its earlier try didn't log
  const fresh = await unloggedRefunds(admin, id, history.prior, made);
  const refundedNow = fresh.reduce((s, r) => s + r.amount, 0);
  if (fresh.length) {
    const { error: eventErr } = await admin.from("order_events").insert({
      order_id: id,
      event_type: "refund_issued",
      description: `Refund of $${(refundedNow / 100).toFixed(2)} issued${parsed.data.reason ? ` — ${parsed.data.reason}` : ""}. Stripe refund ID${fresh.length > 1 ? "s" : ""}: ${fresh.map((r) => r.id).join(", ")}`,
      is_customer_visible: false,
    });
    if (eventErr) console.error("[refund] event insert failed:", eventErr.message, "order:", id);
  }

  // Send customer email if requested (once: not again for a retried request)
  let emailFailed = false;
  if (parsed.data.sendEmail && order.customer_email && refundedNow > 0) {
    const amountFormatted = `$${(refundedNow / 100).toFixed(2)}`;
    const orderNum = order.order_number;
    const name = (order.customer_name as string | null)?.split(" ")[0] || "there";
    const customNote = parsed.data.customerMessage?.trim();

    const html = refundEmailHtml({ orderNumber: String(orderNum), firstName: escapeHtml(name), amountFormatted, isFullRefund, customNote: customNote ? escapeHtml(customNote) : undefined });

    try {
      const { error: emailErr } = await resend.emails.send({
        from: fromEmail,
        to: order.customer_email as string,
        subject: `Your refund from ${businessName} — Order #${orderNum}`,
        html,
      });
      if (emailErr) {
        emailFailed = true;
        console.error("[refund email]", emailErr.message);
      }
    } catch (e) {
      emailFailed = true;
      console.error("[refund email]", e);
    }
  }

  if (stripeError) {
    return Response.json({
      error: `Refunded ${dollars(totalThisRequest)} of ${dollars(refundAmount)}. The rest failed: ${stripeError}. Reload to see the new balance before trying again.`,
      partial: true,
      amountCents: totalThisRequest,
    }, { status: 502 });
  }

  return Response.json({
    ok: true,
    refundId: refunds.map((r) => r.id).join(", "),
    amountCents: totalThisRequest,
    newRefundedCents,
    isFullRefund,
    ...(emailFailed ? { emailFailed: true } : {}),
  });
}
