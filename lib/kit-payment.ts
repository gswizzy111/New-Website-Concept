import { stripe } from "@/lib/stripe";

export type KitPaymentRef = { payment_intent: string } | { charge: string };

/**
 * The Stripe payment behind a kit order, for refunds. Kit orders are paid
 * three ways: a shop Checkout session (cs_), the first month of Kit Club (a
 * subscription Checkout session, paid through its invoice), or a Kit Club
 * renewal (stripe_session_id holds the invoice id, in_). Orders entered by
 * hand (manual_sub_…) have none: returns null.
 */
export async function findKitPayment(stripeSessionId: string): Promise<KitPaymentRef | null> {
  let invoiceId: string | null = null;
  if (stripeSessionId.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (pi) return { payment_intent: pi };
    invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null;
  } else if (stripeSessionId.startsWith("in_")) {
    invoiceId = stripeSessionId;
  }
  if (!invoiceId) return null;

  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 1 });
  const payment = payments.data[0]?.payment;
  const pi = typeof payment?.payment_intent === "string" ? payment.payment_intent : payment?.payment_intent?.id;
  if (pi) return { payment_intent: pi };
  const charge = typeof payment?.charge === "string" ? payment.charge : payment?.charge?.id;
  return charge ? { charge } : null;
}
