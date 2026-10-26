import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { recordRefund, upsertStripeRefund, type RefundKind } from "@/lib/refund-ledger";

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

/** Add-on payments the webhook noted in the order's history ("cards_added" / "tier_upgraded" events). */
async function addOnsFromHistory(admin: SupabaseClient, orderId: string): Promise<Map<string, OrderPaymentKind>> {
  const found = new Map<string, OrderPaymentKind>();
  const { data, error } = await admin.from("order_events").select("event_type, metadata")
    .eq("order_id", orderId).in("event_type", ["cards_added", "tier_upgraded"]);
  if (error) console.error("[order payments] could not read the order history:", error.message);
  for (const e of data ?? []) {
    const pi = (e.metadata as { stripe_payment_intent_id?: unknown } | null)?.stripe_payment_intent_id;
    if (typeof pi === "string" && pi.startsWith("pi_")) found.set(pi, e.event_type === "cards_added" ? "add_cards" : "tier_upgrade");
  }
  return found;
}

/** Every successful Stripe payment for the order, the original first, then add-ons oldest first. */
export async function orderPayments(order: OrderPaymentRef, admin?: SupabaseClient): Promise<OrderPayment[]> {
  let originalPi = order.stripe_payment_intent_id ?? null;
  if (!originalPi && order.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    originalPi = idOf(session.payment_intent);
  }
  // A failed add-on lookup leaves the original payment refundable, as before
  const addOns = await addOnPaymentIntents(order).catch((e) => {
    console.error("[order payments] add-on lookup failed:", e instanceof Error ? e.message : e);
    return new Map<string, OrderPaymentKind>();
  });
  // The order's own history names add-on payments even after its email changed
  if (admin) for (const [pi, kind] of await addOnsFromHistory(admin, order.id)) addOns.set(pi, kind);
  const list: OrderPayment[] = [];
  if (originalPi) {
    const p = await payment(originalPi, "order");
    if (p) list.push(p);
    addOns.delete(originalPi);
  }
  const extras = await Promise.all([...addOns].map(([pi, kind]) => payment(pi, kind).catch((e) => {
    console.error("[order payments] could not read add-on payment", pi, e instanceof Error ? e.message : e);
    return null;
  })));
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
 * them. `requestKey` (one per admin click) goes on each refund as its
 * request_id, so a retry finds them (refundHistory), and makes the Stripe
 * idempotency key, so two sends of the same request make one refund.
 */
export async function refundAcrossPayments(
  plan: { paymentIntentId: string; amountCents: number }[],
  { metadata, requestKey }: { metadata: Record<string, string>; requestKey?: string | null },
): Promise<{ refunds: Stripe.Refund[]; error: string | null }> {
  const refunds: Stripe.Refund[] = [];
  const meta = requestKey ? { ...metadata, request_id: requestKey } : metadata;
  for (const step of plan) {
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: step.paymentIntentId, amount: step.amountCents, reason: "requested_by_customer", metadata: meta },
        requestKey ? { idempotencyKey: `admin-refund:${requestKey}:${step.paymentIntentId}:${step.amountCents}` } : undefined,
      );
      refunds.push(refund);
    } catch (e) {
      return { refunds, error: e instanceof Error ? e.message : "Stripe refund failed" };
    }
  }
  return { refunds, error: null };
}

const LIVE = ["succeeded", "pending", "requires_action"];
/** A refund that is (or may still be) money back: not failed or canceled. */
const live = (r: Stripe.Refund) => LIVE.includes(r.status ?? "pending");
const sum = (refunds: Stripe.Refund[]) => refunds.reduce((s, r) => s + r.amount, 0);

export type RefundHistory = {
  /** Refunds this same request made on an earlier try (found by request_id), counted once. */
  prior: Stripe.Refund[];
  priorCents: number;
  /** Refunded on the order before this request. */
  orderRefundedBefore: number;
  /** Refunded on the card before this request (card refunds). */
  cardRefundedBefore: number;
  /** Refunds Stripe holds on these payments that the ledger doesn't link to any order. */
  unrecorded: Stripe.Refund[];
  /** The ledger holds more for the order than its refunded_cents (what the admin page shows). */
  ledgerAhead: boolean;
};

/** What the ledger holds for an order or a card (live refunds), checked for errors. */
async function ledgerCents(admin: SupabaseClient, column: "order_id" | "card_id", value: string): Promise<number> {
  const { data, error } = await admin.from("refunds").select("amount_cents").eq(column, value).in("status", LIVE);
  if (error) throw new Error(`refund ledger: ${error.message}`);
  return (data ?? []).reduce((s, r) => s + ((r.amount_cents as number | null) ?? 0), 0);
}

/**
 * Before refunding: what was refunded before this request, and which refunds
 * this request already made. A retry after a timeout or a dropped connection
 * (same requestId) finds its earlier refunds on Stripe by request_id, so it
 * finishes the same refund rather than making a second one, even when they
 * never reached the ledger. `unrecorded` lists refunds on Stripe the site
 * never saved (another request that timed out before saving, or one made in
 * the Stripe Dashboard), and `ledgerAhead` says the order's own refunded
 * figure, which the admin page shows, is behind the ledger. Either way, bring
 * the records up to date with catchUpRefunds and stop, so the admin sees the
 * real balance before refunding more.
 */
export async function refundHistory(
  admin: SupabaseClient,
  { orderId, orderRecordedCents, cardId, cardRecordedCents }: { orderId: string; orderRecordedCents: number | null; cardId?: string; cardRecordedCents?: number | null },
  payments: OrderPayment[],
  requestId: string | null | undefined,
): Promise<RefundHistory> {
  // Only payments with something refunded can hold earlier refunds
  const onStripe = (await Promise.all(payments.filter((p) => p.refundedCents > 0).map(async (p) => {
    const list: Stripe.Refund[] = [];
    for await (const r of stripe.refunds.list({ payment_intent: p.paymentIntentId, limit: 100 })) list.push(r);
    return list;
  }))).flat();

  const ledger = new Map<string, { order_id: string | null; shop_order_id: string | null; card_id: string | null }>();
  if (onStripe.length) {
    const { data, error } = await admin.from("refunds").select("stripe_refund_id, order_id, shop_order_id, card_id")
      .in("stripe_refund_id", onStripe.map((r) => r.id));
    if (error) throw new Error(`refund ledger: ${error.message}`);
    for (const row of data ?? []) ledger.set(row.stripe_refund_id as string, { order_id: row.order_id, shop_order_id: row.shop_order_id, card_id: row.card_id });
  }

  const prior = requestId ? onStripe.filter((r) => r.metadata?.request_id === requestId && live(r)) : [];
  const priorIds = new Set(prior.map((r) => r.id));
  const linked = (id: string) => !!(ledger.get(id)?.order_id || ledger.get(id)?.shop_order_id);
  const unrecorded = onStripe.filter((r) => live(r) && !linked(r.id) && !priorIds.has(r.id));

  // The earlier try's refunds may already be in the totals: take them out, they're counted with this request
  const orderLedger = await ledgerCents(admin, "order_id", orderId);
  const orderBefore = Math.max(orderRecordedCents ?? 0, orderLedger);
  const priorInOrder = sum(prior.filter((r) => ledger.get(r.id)?.order_id === orderId));
  let cardRefundedBefore = 0;
  if (cardId) {
    const cardBefore = Math.max(cardRecordedCents ?? 0, await ledgerCents(admin, "card_id", cardId));
    cardRefundedBefore = Math.max(0, cardBefore - sum(prior.filter((r) => ledger.get(r.id)?.card_id === cardId)));
  }
  return {
    prior,
    priorCents: sum(prior),
    orderRefundedBefore: Math.max(0, orderBefore - priorInOrder),
    cardRefundedBefore,
    unrecorded,
    ledgerAhead: orderLedger - priorInOrder > (orderRecordedCents ?? 0),
  };
}

/**
 * Save refunds Stripe made that the site never recorded, bring the order's
 * refunded figure up to the ledger, and note it in the order's history.
 * Returns what the order has had refunded in all.
 */
export async function catchUpRefunds(
  admin: SupabaseClient,
  { orderId, orderRecordedCents, kind }: { orderId: string; orderRecordedCents: number | null; kind: RefundKind },
  refunds: Stripe.Refund[],
): Promise<number> {
  for (const r of refunds) {
    try {
      await upsertStripeRefund(admin, r);
    } catch (e) {
      console.error("[order payments] could not match", r.id, e instanceof Error ? e.message : e);
    }
    // They were taken from this order's payments: save or link any the matcher couldn't
    const { data: row, error: readErr } = await admin.from("refunds").select("order_id, shop_order_id").eq("stripe_refund_id", r.id).maybeSingle();
    if (readErr) console.error("[order payments] could not read", r.id, readErr.message);
    else if (!row) await recordRefund(admin, r, { orderId, kind });
    else if (!row.order_id && !row.shop_order_id) {
      const { error } = await admin.from("refunds").update({ order_id: orderId, kind, match_method: "payment_intent" }).eq("stripe_refund_id", r.id);
      if (error) console.error("[order payments] could not link", r.id, error.message);
    }
  }
  const recorded = orderRecordedCents ?? 0;
  const total = Math.max(recorded, await ledgerCents(admin, "order_id", orderId).catch(() => 0));
  if (total > recorded) {
    const { error } = await admin.from("orders").update({ refunded_cents: total }).eq("id", orderId);
    if (error) console.error("[order payments] order refunded figure not updated:", error.message, "order:", orderId);
  }
  const { error: eventErr } = await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "refund_recorded",
    description: refunds.length
      ? `Refund of $${(sum(refunds) / 100).toFixed(2)} found on Stripe and recorded (it wasn't saved here before). Stripe refund ID${refunds.length > 1 ? "s" : ""}: ${refunds.map((r) => r.id).join(", ")}`
      : `Refunded total brought up to $${(total / 100).toFixed(2)} from the refund records (it showed $${(recorded / 100).toFixed(2)}).`,
    is_customer_visible: false,
  });
  if (eventErr) console.error("[order payments] event insert failed:", eventErr.message, "order:", orderId);
  return total;
}

/** Refunds not yet named in a "refund_issued" entry of the order's history (a retry logs and emails only those). */
export async function unloggedRefunds(admin: SupabaseClient, orderId: string, prior: Stripe.Refund[], made: Stripe.Refund[]): Promise<Stripe.Refund[]> {
  if (!prior.length) return made;
  const { data, error } = await admin.from("order_events").select("description").eq("order_id", orderId).eq("event_type", "refund_issued");
  // Can't tell: treat the earlier try's refunds as logged rather than email the customer twice
  if (error) return made;
  const logged = (data ?? []).map((e) => (e.description as string | null) ?? "").join("\n");
  return [...prior.filter((r) => !logged.includes(r.id)), ...made];
}
