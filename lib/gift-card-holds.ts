import { stripe } from "@/lib/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { giftCardCents } from "@/lib/order-totals";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Gift card holds (supabase/migrations/20261027_checkout.sql). A checkout that
 * uses a gift card holds the amount it takes off, so one balance can't
 * discount several open checkouts. The Stripe webhook's deduction
 * (redeem_gift_card) stays the real spend; the hold only keeps the balance
 * from being promised twice. Holds end when the payment takes the balance,
 * when the checkout fails, when the same customer starts a newer checkout
 * with the card (their older Stripe session is expired first), or 30 minutes
 * after the Stripe session expires.
 */

const HOLDS = "gift_card_holds";

/** Stripe sessions that use a gift card stay open this long (Stripe's minimum is 30). */
export const GIFT_CARD_SESSION_MINUTES = 60;
/** A hold outlives its session by this much: a payment made in the last minute may still be on its way. */
const HOLD_GRACE_MINUTES = 30;
/** A hold whose checkout never reached Stripe (it crashed part-way) is let go after this. */
const ABANDONED_MINUTES = 5;

export type HoldKind = "restoration" | "shop";

export type GiftCardHold =
  /** No code, no gift card with that code, used up, or nothing to take off. */
  | { status: "none" }
  /** cents come off the order. holdId is null before the migration (nothing held). */
  | { status: "held"; holdId: string | null; giftCardId: string; cents: number }
  /** Other open checkouts hold the balance this order would use. */
  | { status: "in_use" }
  | { status: "error"; message: string };

/** Shown when other open checkouts hold the card's balance. */
export const GIFT_CARD_IN_USE_MESSAGE =
  "This gift card is in use in another checkout that hasn't been paid yet. Try again later, or remove the gift card to continue without it.";

/** When the Stripe session (seconds, for Stripe) and its hold (ISO) expire. Work it out once, before the hold. */
export function giftCardExpiry(now = Date.now()) {
  const stripeExpiresAt = Math.floor(now / 1000) + GIFT_CARD_SESSION_MINUTES * 60;
  return {
    stripeExpiresAt,
    holdExpiresAt: new Date((stripeExpiresAt + HOLD_GRACE_MINUTES * 60) * 1000).toISOString(),
  };
}

/** The table or function isn't there yet (migration not applied). */
function missingSchema(err: { code?: string } | null | undefined) {
  return !!err && ["PGRST202", "PGRST205", "42P01", "42883"].includes(err.code ?? "");
}

type HoldRow = { hold_id: string | null; card_id: string; held_cents: number; wanted_cents: number; balance_cents: number; available_cents: number };

/**
 * Holds the gift card with this code for one checkout. `maxCents` is the most
 * the card may cover on this order, `dueCents` the order total before it.
 */
export async function holdGiftCard(admin: Admin, opts: {
  code: string | undefined;
  maxCents: number;
  dueCents: number;
  kind: HoldKind;
  customerEmail: string;
  expiresAt: string;
}): Promise<GiftCardHold> {
  const code = (opts.code ?? "").trim().toUpperCase();
  if (!code || opts.maxCents <= 0) return { status: "none" };
  const email = opts.customerEmail.trim().toLowerCase();

  const call = () => admin.rpc("hold_gift_card", {
    p_code: code,
    p_max_cents: Math.max(0, Math.round(opts.maxCents)),
    p_due_cents: Math.max(0, Math.round(opts.dueCents)),
    p_kind: opts.kind,
    p_customer_email: email,
    p_expires_at: opts.expiresAt,
  });

  let { data, error } = await call();
  if (error) {
    if (missingSchema(error)) return withoutHolds(admin, code, opts.maxCents, opts.dueCents);
    console.error("Gift card hold failed:", error.message);
    return { status: "error", message: error.message };
  }
  let row = (Array.isArray(data) ? data[0] : data) as HoldRow | null;
  if (!row) return { status: "none" };

  // The balance is held elsewhere: if it's this customer's own earlier
  // checkout (they went back and started again), close that one and retry
  if (!row.hold_id && row.wanted_cents > 0 && row.available_cents < row.wanted_cents) {
    if ((await releaseOwnOpenHolds(admin, row.card_id, email)) > 0) {
      ({ data, error } = await call());
      if (error) {
        console.error("Gift card hold failed:", error.message);
        return { status: "error", message: error.message };
      }
      row = (Array.isArray(data) ? data[0] : data) as HoldRow | null;
      if (!row) return { status: "none" };
    }
    if (!row.hold_id && row.wanted_cents > 0 && row.available_cents < row.wanted_cents) return { status: "in_use" };
  }

  if (!row.hold_id || row.held_cents <= 0) return { status: "none" };
  return { status: "held", holdId: row.hold_id, giftCardId: row.card_id, cents: row.held_cents };
}

/** Before the migration: the balance as read, with no hold (the old behaviour). */
async function withoutHolds(admin: Admin, code: string, maxCents: number, dueCents: number): Promise<GiftCardHold> {
  const { data: gc, error } = await admin
    .from("gift_cards")
    .select("id, remaining_cents, status")
    .eq("code", code)
    .maybeSingle();
  if (error) return { status: "error", message: error.message };
  if (!gc || gc.status !== "active" || !(gc.remaining_cents > 0)) return { status: "none" };
  const cents = giftCardCents(Math.min(gc.remaining_cents, maxCents), dueCents);
  if (cents <= 0) return { status: "none" };
  return { status: "held", holdId: null, giftCardId: gc.id, cents };
}

/**
 * Ends this customer's open holds on the card: each one whose Stripe session
 * can be closed (expired) so it can never be paid, and any that never reached
 * Stripe. A restoration order whose session was closed is marked cancelled.
 * Returns how many holds were let go.
 */
async function releaseOwnOpenHolds(admin: Admin, giftCardId: string, email: string): Promise<number> {
  if (!email) return 0;
  const { data: holds, error } = await admin
    .from(HOLDS)
    .select("id, stripe_session_id, order_id, created_at")
    .eq("gift_card_id", giftCardId)
    .eq("customer_email", email)
    .is("released_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error || !holds?.length) return 0;

  let released = 0;
  for (const hold of holds as { id: string; stripe_session_id: string | null; order_id: string | null; created_at: string }[]) {
    if (!hold.stripe_session_id) {
      const ageMs = Date.now() - new Date(hold.created_at).getTime();
      if (ageMs > ABANDONED_MINUTES * 60 * 1000 && (await releaseGiftCardHold(admin, hold.id, "abandoned"))) released++;
      continue;
    }
    if (!(await closeSession(hold.stripe_session_id))) continue;
    if (!(await releaseGiftCardHold(admin, hold.id, "replaced"))) continue;
    released++;
    if (hold.order_id) {
      const { data: cancelled } = await admin
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", hold.order_id)
        .eq("payment_status", "pending")
        .eq("status", "awaiting_payment")
        .select("id");
      if (cancelled?.length) {
        await admin.from("order_events").insert({
          order_id: hold.order_id,
          event_type: "checkout_replaced",
          description: "Checkout closed unpaid: the customer started a new checkout with the same gift card.",
          is_customer_visible: false,
        });
      }
    }
  }
  return released;
}

/** Expires a Stripe session so it can't be paid. True when it is expired now. */
async function closeSession(sessionId: string): Promise<boolean> {
  try {
    const session = await stripe.checkout.sessions.expire(sessionId);
    return session.status === "expired";
  } catch {
    // Already expired is fine; complete (paid) or unknown is not
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return session.status === "expired";
    } catch {
      return false;
    }
  }
}

/** Links the hold to its order and/or Stripe session. */
export async function attachGiftCardHold(admin: Admin, holdId: string | null, link: { orderId?: string; sessionId?: string }) {
  if (!holdId) return;
  const patch: Record<string, string> = {};
  if (link.orderId) patch.order_id = link.orderId;
  if (link.sessionId) patch.stripe_session_id = link.sessionId;
  const { error } = await admin.from(HOLDS).update(patch).eq("id", holdId);
  // Not fatal: an unlinked hold still ends when it expires
  if (error) console.error(`Gift card hold ${holdId} not linked:`, error.message);
}

/** Lets a hold go (the checkout failed or was replaced). True when it was open and is now released. */
export async function releaseGiftCardHold(admin: Admin, holdId: string | null, reason: string): Promise<boolean> {
  if (!holdId) return false;
  const { data, error } = await admin
    .from(HOLDS)
    .update({ released_at: new Date().toISOString(), release_reason: reason })
    .eq("id", holdId)
    .is("released_at", null)
    .select("id");
  if (error) {
    console.error(`Gift card hold ${holdId} not released:`, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** The payment for this Stripe session took the balance: its hold has done its job. */
export async function markGiftCardHoldsPaid(admin: Admin, sessionId: string) {
  const { error } = await admin
    .from(HOLDS)
    .update({ released_at: new Date().toISOString(), release_reason: "paid" })
    .eq("stripe_session_id", sessionId)
    .is("released_at", null);
  if (error && !missingSchema(error)) console.error(`Gift card hold for ${sessionId} not closed:`, error.message);
}
