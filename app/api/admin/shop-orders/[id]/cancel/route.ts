import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { resend, fromEmail, businessName } from "@/lib/resend";
import { refundEmailHtml } from "@/lib/refund-email";
import { getAdminSession } from "@/lib/admin-auth";
import { recordRefund } from "@/lib/refund-ledger";
import { findKitPayment, type KitPaymentRef } from "@/lib/kit-payment";
import { escapeHtml } from "@/lib/card-inquiries";
import type Stripe from "stripe";

// Cancel kit order (Ship Queue): refunds what is left in full, records the
// refund in the ledger, marks the order cancelled and emails the customer.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (adminSession?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("shop_orders")
    .select("id, order_number, total_cents, refunded_cents, stripe_session_id, customer_name, customer_email, status, labels, return_label_url")
    .eq("id", id)
    .maybeSingle();

  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "cancelled") return Response.json({ error: "Order is already cancelled" }, { status: 400 });

  // Mark it cancelled first, only if nothing changed it since it was read, so a
  // double click or a second admin can't refund it twice. Put back below if the
  // refund fails.
  const previousStatus = order.status as string | null;
  const claim = admin.from("shop_orders").update({ status: "cancelled" }).eq("id", id);
  const { data: claimed, error: claimErr } = await (previousStatus === null ? claim.is("status", null) : claim.eq("status", previousStatus))
    .select("total_cents, refunded_cents")
    .maybeSingle();
  if (claimErr) return Response.json({ error: claimErr.message }, { status: 500 });
  if (!claimed) return Response.json({ error: "This order changed while you were cancelling it. Reload the page and try again." }, { status: 409 });

  const restore = async () => {
    const { error } = await admin.from("shop_orders").update({ status: previousStatus }).eq("id", id).eq("status", "cancelled");
    if (error) console.error("[cancel kit order] could not restore status:", error.message, "order:", id);
  };

  const totalCents = (claimed.total_cents as number | null) ?? 0;
  const alreadyRefunded = (claimed.refunded_cents as number | null) ?? 0;
  // What the order still shows as paid. Refunds made in the Stripe Dashboard
  // don't lower it, so Stripe is asked for whatever is left, not this amount.
  const outstanding = totalCents - alreadyRefunded;
  const orderLabel = order.order_number ? `K${order.order_number}` : id.slice(0, 8);
  const warnings: string[] = [];

  let refundId: string | null = null;
  let refundAmount = 0;
  const paidThroughStripe = /^(cs_|in_)/.test((order.stripe_session_id as string | null) ?? "");

  if (outstanding > 0 && paidThroughStripe) {
    let payment: KitPaymentRef | null = null;
    try {
      payment = await findKitPayment(order.stripe_session_id as string);
    } catch (e) {
      console.error("[cancel kit order] Stripe payment lookup failed:", e);
      await restore();
      return Response.json({ error: "Could not retrieve the Stripe payment for this order." }, { status: 502 });
    }
    if (!payment) {
      await restore();
      return Response.json({ error: "No Stripe payment was found for this order, so nothing was refunded." }, { status: 400 });
    }

    let stripeRefund: Stripe.Refund | null = null;
    try {
      // No amount: Stripe refunds everything still left on the payment
      stripeRefund = await stripe.refunds.create({
        ...payment,
        reason: "requested_by_customer",
        metadata: { shop_order_id: id, order_number: orderLabel, admin_reason: "Order cancelled by admin" },
      });
    } catch (e: unknown) {
      if ((e as { code?: string } | null)?.code !== "charge_already_refunded") {
        await restore();
        const msg = e instanceof Error ? e.message : "Stripe refund failed";
        return Response.json({ error: msg }, { status: 502 });
      }
      // Already refunded in full (in the Stripe Dashboard, or by an earlier try
      // whose answer never arrived): the money is back, so the order stays
      // cancelled. syncRefunds() adds those refunds to the ledger.
      warnings.push("Stripe shows this payment as already refunded in full, so no new refund was made.");
    }
    // The money has gone back: from here on the order stays cancelled
    if (stripeRefund) {
      refundId = stripeRefund.id;
      refundAmount = stripeRefund.amount;
      await recordRefund(admin, stripeRefund, { shopOrderId: id, kind: "kit" }, adminSession.username);
    } else {
      refundAmount = outstanding;
    }
  } else if (outstanding > 0) {
    // No Stripe payment (an order entered by hand): the money goes back another
    // way, so the ledger gets a refund paid outside Stripe
    refundAmount = outstanding;
    const { error: ledgerErr } = await admin.from("refunds").insert({
      source: "manual",
      amount_cents: outstanding,
      status: "succeeded",
      refunded_at: new Date().toISOString(),
      shop_order_id: id,
      kind: "kit",
      match_method: "admin_route",
      reason: "Order cancelled by admin",
      created_by: adminSession.username,
    });
    if (ledgerErr) {
      console.error("[cancel kit order] ledger insert failed:", ledgerErr.message, "order:", id);
      warnings.push(`The refund could not be recorded in the refunds ledger: ${ledgerErr.message}`);
    }
  }

  // Record the full refund on the order
  const { error: updateErr } = await admin
    .from("shop_orders")
    .update({ refunded_cents: totalCents })
    .eq("id", id);
  if (updateErr) {
    console.error("[cancel kit order] order update failed:", updateErr.message, "order:", id);
    warnings.push(`The refunded amount could not be saved on the order: ${updateErr.message}`);
  }

  // A label bought at checkout (or later) isn't voided here
  if ((Array.isArray(order.labels) && order.labels.length > 0) || order.return_label_url) {
    warnings.push("This order has a shipping label. Void it in Shippo to get the postage back.");
  }

  // Send cancellation email
  if (order.customer_email) {
    const amountFormatted = `$${(refundAmount / 100).toFixed(2)}`;
    const name = (order.customer_name as string | null)?.split(" ")[0] || "there";
    try {
      const { error: emailErr } = await resend.emails.send({
        from: fromEmail,
        to: order.customer_email as string,
        subject: `Your order from ${businessName} has been cancelled — Order #${orderLabel}`,
        html: refundEmailHtml({
          orderNumber: orderLabel,
          firstName: escapeHtml(name),
          amountFormatted,
          isFullRefund: true,
          customNote: "Your order has been cancelled and a full refund has been issued. Please allow 5–10 business days for the refund to appear on your statement.",
        }),
      });
      if (emailErr) throw new Error(emailErr.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cancel kit order email]", msg, "order:", id);
      warnings.push(`The email to the customer was not sent: ${msg}`);
    }
  }

  return Response.json({ ok: true, refundId, refundAmount, warnings });
}
