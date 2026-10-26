import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

/**
 * The Stripe payments behind a restoration order: the original checkout, plus
 * any later "add cards" and tier upgrade checkouts. Those are separate Stripe
 * payments (their sessions carry metadata type add_cards / tier_upgrade and
 * order_id) whose amounts the webhook adds to the order's total_cents, so a
 * refund of the order's total can need more than one payment.
 */

export type OrderPaymentKind = "order" | "add_cards" | "tier_upgrade";

export type OrderPayment = {
  paymentIntentId: string;
  kind: OrderPaymentKind;
  /** When Stripe took it (unix seconds). */
  created: number;
  amountCents: number;
  /** Already refunded on Stripe (including refunds still pending). */
  refundedCents: number;
};

export type OrderPaymentRef = {
  id: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id?: string | null;
  customer_email: string | null;
  created_at?: string | null;
};

const ADD_ON_TYPES = new Set(["add_cards", "tier_upgrade"]);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

async function payment(paymentIntentId: string, kind: OrderPaymentKind): Promise<OrderPayment | null> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  if (pi.status !== "succeeded") return null;
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? (pi.latest_charge as Stripe.Charge) : null;
  return {
    paymentIntentId: pi.id,
    kind,
    created: pi.created,
    amountCents: charge?.amount_captured ?? pi.amount_received ?? 0,
    refundedCents: charge?.amount_refunded ?? 0,
  };
}

/** Add-on checkouts for this order: found by the customer's email, and by payment metadata when a checkout sets it. */
async function addOnPaymentIntents(order: OrderPaymentRef): Promise<Map<string, OrderPaymentKind>> {
  const found = new Map<string, OrderPaymentKind>();
  const since = order.created_at ? Math.floor(new Date(order.created_at).getTime() / 1000) - 86_400 : null;
  const emails = [...new Set([order.customer_email?.trim(), order.customer_email?.trim().toLowerCase()].filter((e): e is string => !!e))];
  for (const email of emails) {
    let seen = 0;
    for await (const s of stripe.checkout.sessions.list({
      customer_details: { email },
      status: "complete",
      limit: 100,
      ...(since && Number.isFinite(since) ? { created: { gte: since } } : {}),
    })) {
      const pi = idOf(s.payment_intent);
      if (pi && s.payment_status === "paid" && s.metadata?.order_id === order.id && ADD_ON_TYPES.has(s.metadata?.type ?? "")) {
        found.set(pi, s.metadata!.type as OrderPaymentKind);
      }
      if (++seen >= 1000) break;
    }
  }
  // Checkouts that copy order_id onto the payment itself are found even after the order's email changed
  try {
    const res = await stripe.paymentIntents.search({ query: `metadata['order_id']:'${order.id.replace(/'/g, "")}'`, limit: 100 });
    for (const pi of res.data) {
      const type = pi.metadata?.type ?? "";
      if (ADD_ON_TYPES.has(type)) found.set(pi.id, type as OrderPaymentKind);
    }
  } catch (e) {
    console.error("[order payments] payment search failed:", e instanceof Error ? e.message : e);
  }
  return found;
}

/** Every successful Stripe payment for the order, the original first, then add-ons oldest first. */
export async function orderPayments(order: OrderPaymentRef): Promise<OrderPayment[]> {
  let originalPi = order.stripe_payment_intent_id ?? null;
  if (!originalPi && order.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    originalPi = idOf(session.payment_intent);
  }
  const addOns = await addOnPaymentIntents(order);
  const list: OrderPayment[] = [];
  if (originalPi) {
    const p = await payment(originalPi, "order");
    if (p) list.push(p);
    addOns.delete(originalPi);
  }
  const extras = await Promise.all([...addOns].map(([pi, kind]) => payment(pi, kind)));
  list.push(...extras.filter((p): p is OrderPayment => !!p).sort((a, b) => a.created - b.created));
  return list;
}

/** How much Stripe can still give back across these payments. */
export function refundableCents(payments: OrderPayment[]): number {
  return payments.reduce((s, p) => s + Math.max(0, p.amountCents - p.refundedCents), 0);
}

/** Split an amount across the payments, the original first; null when they can't cover it. */
export function planRefund(payments: OrderPayment[], amountCents: number): { paymentIntentId: string; amountCents: number }[] | null {
  const plan: { paymentIntentId: string; amountCents: number }[] = [];
  let left = amountCents;
  for (const p of payments) {
    if (left <= 0) break;
    const room = p.amountCents - p.refundedCents;
    if (room <= 0) continue;
    const take = Math.min(room, left);
    plan.push({ paymentIntentId: p.paymentIntentId, amountCents: take });
    left -= take;
  }
  return left > 0 ? null : plan;
}

/**
 * Refund an amount across an order's payments. Stops at the first Stripe
 * error and returns the refunds already made with it, so the caller records
 * them. `requestKey` (one per admin click) makes a retried request reuse the
 * same Stripe refunds instead of making new ones.
 */
export async function refundAcrossPayments(
  plan: { paymentIntentId: string; amountCents: number }[],
  { metadata, requestKey }: { metadata: Record<string, string>; requestKey?: string | null },
): Promise<{ refunds: Stripe.Refund[]; error: string | null }> {
  const refunds: Stripe.Refund[] = [];
  for (const step of plan) {
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: step.paymentIntentId, amount: step.amountCents, reason: "requested_by_customer", metadata },
        requestKey ? { idempotencyKey: `admin-refund:${requestKey}:${step.paymentIntentId}:${step.amountCents}` } : undefined,
      );
      refunds.push(refund);
    } catch (e) {
      return { refunds, error: e instanceof Error ? e.message : "Stripe refund failed" };
    }
  }
  return { refunds, error: null };
}

/** Refund IDs already in the ledger (a retried request gets the same refund back from Stripe). */
export async function knownRefundIds(admin: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await admin.from("refunds").select("stripe_refund_id").in("stripe_refund_id", ids);
  return new Set((data ?? []).map((r) => r.stripe_refund_id as string));
}
