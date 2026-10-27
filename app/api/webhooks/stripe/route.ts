import Stripe from "stripe";
import { addressFromSession } from "@/lib/shipping-address";
import { stripe, invoiceSubscriptionId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, replyToAddress, businessName } from "@/lib/resend";
import { randomInt, randomUUID } from "node:crypto";
import { itemAmounts } from "@/lib/item-pricing";
import { bulkPriceCents } from "@/lib/bulk-pricing";
import { upgradeBaseCents } from "@/lib/upgrade-pricing";
import { signedPdfAttachments } from "@/lib/signed-pdfs";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";
import { logCheckoutError, getCheckoutErrors } from "@/lib/checkout-error-log";
import { markGiftCardHoldsPaid } from "@/lib/gift-card-holds";
import { getSubscriptionPriceCents } from "@/lib/store-config";

/** A card added to a paid order, as the add-cards route saved it. */
type AddedCard = {
  name: string;
  declaredValueCents: number;
  photoUrls?: string[];
  card_set?: string; card_year?: string; card_number?: string; variation?: string;
  grading_company?: string; grade?: string; cert_number?: string; known_defects?: string;
};
import { buyKitLabel, type KitLabel } from "@/lib/kit-shipping";
import { RESTORATION_TIERS, getCardPriceCents, getTierById } from "@/lib/restoration-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";

type Admin = ReturnType<typeof createAdminClient>;
type Kind = "restoration" | "prep" | "gift_card" | "shop" | "subscription" | "add_cards" | "tier_upgrade";

/** Customer-typed (or outside) text placed in email HTML. */
const esc = (value: unknown) => escapeHtml(String(value ?? ""));
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ── Handling each checkout session once ─────────────────────────────────────
// Stripe sends an event again after a timeout or an error. Each session is
// claimed in stripe_webhook_claims (insert ... on conflict do nothing) before
// anything is bought, charged, added or emailed, so a repeat stops at the claim.
// The branches also check the data itself (an order already paid, a gift card
// or kit order already saved for the session), which also catches sessions the
// old site's webhook handled. Migration: supabase/migrations/20261027_webhook.sql.

const CLAIMS = "stripe_webhook_claims";
/** Far longer than one run can last (the function times out well before). */
const STALE_CLAIM_MS = 2 * 60 * 1000;
/** A save that keeps failing this many deliveries in, or this long after the payment, is reported (once). */
const RETRY_ALERT_ATTEMPTS = 3;
const RETRY_ALERT_AFTER_MS = 60 * 60 * 1000;

/** The table or function isn't there yet (migration not applied). */
function missingSchema(err: { code?: string } | null | undefined) {
  return !!err && ["PGRST202", "PGRST205", "42P01", "42883"].includes(err.code ?? "");
}

/** This delivery's hold on one checkout session. */
type Claim = {
  admin: Admin;
  session: Stripe.Checkout.Session;
  kind: Kind;
  /** When Stripe created the event (Unix seconds). */
  eventCreated: number;
  /** Written with the claim, so a run only ever lets go of its own. null: no claims table yet (data checks only). */
  token: string | null;
};

type ClaimRow = {
  claimed_at: string;
  completed_at: string | null;
  alerted_at: string | null;
  released_at?: string | null;
  claim_token?: string | null;
  attempts?: number | null;
  retry_alerted_at?: string | null;
};

/**
 * Claims the session for this run. A Claim: go ahead. A Response: answer
 * Stripe with it and do nothing else.
 */
async function claimSession(admin: Admin, session: Stripe.Checkout.Session, kind: Kind, eventCreated: number, orderId?: string | null): Promise<Claim | Response> {
  const claim: Claim = { admin, session, kind, eventCreated, token: randomUUID() };
  const { data, error } = await admin
    .from(CLAIMS)
    .upsert({ stripe_session_id: session.id, kind, order_id: orderId ?? null, claim_token: claim.token }, { onConflict: "stripe_session_id", ignoreDuplicates: true })
    .select("stripe_session_id");
  if (error) {
    if (missingSchema(error)) {
      console.warn(`${CLAIMS} is missing (apply 20261027_webhook.sql); handling ${session.id} with data checks only`);
      return { ...claim, token: null };
    }
    // Nothing has happened yet, so Stripe can safely send it again. The row may
    // have been written even though the answer was lost: it is let go (it
    // carries this run's token), so the next delivery doesn't take it for a run
    // that died part-way.
    return retryLater(claim, `could not claim the session (${error.message})`);
  }
  if (data?.length) return claim;
  return repeatedSession(claim);
}

/** Stripe sent a session that was already claimed. */
async function repeatedSession(claim: Claim): Promise<Claim | Response> {
  const { admin, session, kind } = claim;
  const { data, error } = await admin.from(CLAIMS).select("*").eq("stripe_session_id", session.id).maybeSingle();
  const row = data as ClaimRow | null;
  // The claim changed in between, or can't be read: Stripe tries again later
  if (error || !row) return Response.json({ error: "Session claim changed, retry" }, { status: 409 });
  if (row.completed_at || row.alerted_at) return Response.json({ received: true, duplicate: true });

  if (row.released_at) {
    // An earlier delivery stopped before doing anything and let the claim go:
    // take it over (only if no other delivery took it over first)
    let retake = admin
      .from(CLAIMS)
      .update({ claim_token: claim.token, claimed_at: new Date().toISOString(), released_at: null, attempts: (row.attempts ?? 1) + 1 })
      .eq("stripe_session_id", session.id)
      .is("completed_at", null)
      .not("released_at", "is", null);
    retake = row.claim_token ? retake.eq("claim_token", row.claim_token) : retake.is("claim_token", null);
    const { data: retaken, error: retakeError } = await retake.select("stripe_session_id");
    if (retakeError) {
      console.error(`Could not take over checkout session ${session.id}:`, retakeError.message);
      return Response.json({ error: "Could not claim the session" }, { status: 500 });
    }
    return retaken?.length ? claim : Response.json({ received: true, in_progress: true }, { status: 409 });
  }

  if (Date.now() - new Date(row.claimed_at).getTime() < STALE_CLAIM_MS) {
    // Another delivery is handling it right now. A non-2xx answer makes Stripe
    // ask again later, when that run has finished (or is known to have died).
    return Response.json({ received: true, in_progress: true }, { status: 409 });
  }
  // The first run stopped part-way (most likely a timeout): tell the admin, once
  const { data: marked, error: markError } = await admin
    .from(CLAIMS)
    .update({ alerted_at: new Date().toISOString() })
    .eq("stripe_session_id", session.id)
    .is("completed_at", null)
    .is("alerted_at", null)
    .select("stripe_session_id");
  if (markError) {
    // Not reported yet: a non-2xx answer makes Stripe send it again, and that try reports it
    console.error(`Could not mark checkout session ${session.id} as reported:`, markError.message);
    return Response.json({ error: "Could not record the unfinished session" }, { status: 500 });
  }
  if (marked?.length) {
    await alertAdmin(
      session,
      "WEBHOOK_UNFINISHED",
      `Stripe sent paid checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}) again. The first run started ${row.claimed_at} and never finished, most likely a timeout. Check it by hand: payment status, prepaid or kit label, gift card balance, cards and totals, and the emails.`,
    );
  }
  return Response.json({ received: true, duplicate: true });
}

/** The run ended (note: what it found already done, or why it stopped). */
async function finishClaim(claim: Claim, note?: string) {
  if (!claim.token) return;
  const { error } = await claim.admin
    .from(CLAIMS)
    .update({ completed_at: new Date().toISOString(), ...(note ? { note: note.slice(0, 500) } : {}) })
    .eq("stripe_session_id", claim.session.id);
  if (error) console.error(`Could not mark checkout session ${claim.session.id} done:`, error.message);
}

/**
 * Nothing was done for the session (a read or save failed before any label,
 * charge, card, total or email): the claim is let go and Stripe gets a non-2xx
 * answer, so its next delivery starts over. Stripe keeps trying for up to 3
 * days; a failure that lasts (3 deliveries, or an hour after the payment) is
 * reported to the admin once, and the claim row keeps the last error.
 */
async function retryLater(claim: Claim, reason: string, status = 500): Promise<Response> {
  const { admin, session, kind } = claim;
  console.error(`Stripe webhook (${kind}) could not handle ${session.id}, Stripe will send it again: ${reason}`);
  if (claim.token) {
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from(CLAIMS)
      .update({ released_at: now, last_error: reason.slice(0, 500) })
      .eq("stripe_session_id", session.id)
      .eq("claim_token", claim.token)
      .is("completed_at", null)
      .select("attempts, retry_alerted_at");
    if (error) console.error(`Could not release checkout session ${session.id}:`, error.message);
    const row = (data?.[0] ?? null) as Pick<ClaimRow, "attempts" | "retry_alerted_at"> | null;
    const attempts = row?.attempts ?? 1;
    const lasting = attempts >= RETRY_ALERT_ATTEMPTS || Date.now() - claim.eventCreated * 1000 >= RETRY_ALERT_AFTER_MS;
    if (row && lasting && !row.retry_alerted_at) {
      const { data: marked } = await admin
        .from(CLAIMS)
        .update({ retry_alerted_at: now })
        .eq("stripe_session_id", session.id)
        .is("retry_alerted_at", null)
        .select("stripe_session_id");
      if (marked?.length) {
        await alertAdmin(
          session,
          "WEBHOOK_RETRYING",
          `Paid checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}) could not be recorded: ${reason}. Nothing was done for it yet (no label, gift card charge, cards, totals or emails). Stripe has sent it ${attempts} time${attempts !== 1 ? "s" : ""} and keeps trying for up to 3 days after the payment. Fix the cause so a later try goes through.`,
        );
      }
    }
  }
  return Response.json({ error: reason }, { status });
}

/**
 * Whether this session's payment is already in the order's history, a data
 * check that also works before the claims table exists:
 *   "yes": the new webhook's cards_added / tier_upgraded event carries the session id;
 *   "old_site": the old site's webhook writes the same event without metadata,
 *     and one for the same amount was saved after this session started (a
 *     Stripe retry that crosses the domain switch must not add it twice);
 *   "no"; "unknown": the history couldn't be read.
 */
async function alreadyRecorded(admin: Admin, orderId: string, eventType: string, session: Stripe.Checkout.Session): Promise<"yes" | "old_site" | "no" | "unknown"> {
  const { data, error } = await admin
    .from("order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event_type", eventType)
    .eq("metadata->>stripe_session_id", session.id)
    .limit(1);
  if (error) {
    console.error(`Could not check order history for session ${session.id}:`, error.message);
    return "unknown";
  }
  if (data?.length) return "yes";

  const { data: oldSite, error: oldSiteError } = await admin
    .from("order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event_type", eventType)
    .is("metadata", null)
    .gte("created_at", new Date(session.created * 1000).toISOString())
    .like("description", `%additional payment of ${usd(session.amount_total ?? 0)} received`)
    .limit(1);
  if (oldSiteError) {
    console.error(`Could not check order history for session ${session.id}:`, oldSiteError.message);
    return "unknown";
  }
  return oldSite?.length ? "old_site" : "no";
}

/**
 * The payment was already recorded (an earlier delivery, or the old site's
 * webhook): nothing more to do. A match on the old site's entry is only by
 * amount and time, so the admin is told, in case the customer really paid
 * twice for the same amount.
 */
async function alreadyDone(claim: Claim, found: "yes" | "old_site", orderId: string, what: string): Promise<Response> {
  if (found === "old_site") {
    await alertAdmin(
      claim.session,
      "OLD_SITE_HANDLED",
      `Order id ${orderId}: paid checkout session ${claim.session.id} (${claim.kind}, ${usd(claim.session.amount_total ?? 0)}) was skipped, because the order's history already has a payment of the same amount from the old site's webhook, saved after this checkout started. If the customer paid twice for the same amount, add the second one by hand.`,
    );
  }
  await finishClaim(claim, found === "old_site" ? `${what} by the old site's webhook` : `${what} for this session`);
  return Response.json({ received: true, duplicate: true });
}

/**
 * A paid tier upgrade, on each card it covered, split the way the upgrade
 * route priced it (lib/upgrade-pricing.ts): every card not refunded that has
 * its own price gains the new tier's price minus what it was charged, with the
 * upgrade's bulk percent as discount and the tax on the rest. Its
 * service_price_cents becomes its full price at the new tier, so a later
 * upgrade charges from it. Returns what went wrong, or null.
 */
async function addUpgradeToCards(
  admin: Admin,
  orderId: string,
  p: { oldTier: string; currentPriceCents: number; newPriceCents: number; bulkPercent: number },
): Promise<string | null> {
  const { data, error } = await admin
    .from("cards")
    .select("id, tier, status, service_price_cents, discount_cents, tax_cents")
    .eq("order_id", orderId);
  if (error) return error.message;
  const cards = (data ?? []).filter((c) => c.status !== "refunded" && c.service_price_cents != null);
  const bases = cards.map((c) => upgradeBaseCents(c, p.oldTier, p.currentPriceCents));
  const diffs = bases.map((base) => Math.max(0, p.newPriceCents - base));
  const listCents = diffs.reduce((sum, d) => sum + d, 0);
  if (listCents <= 0) return null;
  const shares = itemAmounts(diffs, listCents - bulkPriceCents(listCents, p.bulkPercent));
  const results = await Promise.all(cards.map((c, i) => diffs[i] > 0
    ? admin.from("cards").update({
        service_price_cents: bases[i] + shares[i].service_price_cents,
        discount_cents: (c.discount_cents ?? 0) + shares[i].discount_cents,
        tax_cents: (c.tax_cents ?? 0) + shares[i].tax_cents,
      }).eq("id", c.id)
    : Promise.resolve({ error: null })));
  const failed = results.filter((r) => r.error);
  return failed.length ? `${failed.length} of ${cards.length} card${cards.length !== 1 ? "s" : ""} not updated: ${failed[0].error?.message}` : null;
}

/** Raises a problem with a paid session in the checkout error log (stored + emailed to the admin). */
async function alertAdmin(session: Stripe.Checkout.Session, code: string, detail: string) {
  await logCheckoutError({
    ref: `${code}-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    code,
    actual_error: detail,
    customer_name: session.metadata?.customer_name || session.metadata?.purchaser_name || session.customer_details?.name || undefined,
    customer_email: session.customer_email || session.customer_details?.email || undefined,
    customer_phone: session.metadata?.customer_phone || undefined,
  });
}

/**
 * What this site started the session for, or null (a Stripe Payment Link sale
 * or anything else with no order behind it).
 */
function sessionKind(session: Stripe.Checkout.Session): Kind | null {
  const type = session.metadata?.type;
  if (type === "gift_card" || type === "shop" || type === "subscription" || type === "add_cards" || type === "tier_upgrade") return type;
  if (session.metadata?.order_id) return session.metadata.service_type === "prep" ? "prep" : "restoration";
  return null;
}

/**
 * A payment by a delayed method (a bank debit, for example) that hasn't
 * arrived, or that failed: nothing is done for the session, and the admin is
 * told once (Stripe may send the same event again).
 */
async function alertPaymentOnce(session: Stripe.Checkout.Session, code: string, detail: string) {
  try {
    const logged = await getCheckoutErrors();
    if (logged.some((entry) => entry.code === code && entry.actual_error.includes(session.id))) return;
  } catch (err) {
    console.error(`Could not read the checkout error log for ${session.id}:`, err);
  }
  await alertAdmin(session, code, detail);
}

/**
 * Something threw after the session was claimed. The steps before `stage` are
 * done (a label may be bought), so a retry must not start over: the admin is
 * told what to finish by hand, and Stripe gets a 200.
 */
async function failedAfterClaim(claim: Claim, stage: string, err: unknown): Promise<Response> {
  const { session, kind } = claim;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Stripe webhook (${kind}) stopped at "${stage}" for ${session.id}:`, err);
  await alertAdmin(
    session,
    "WEBHOOK_FAILED",
    `Paid checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}) stopped at "${stage}": ${message}. The steps before it are done; finish the rest by hand.`,
  );
  await finishClaim(claim, `stopped at ${stage}: ${message}`);
  return Response.json({ received: true, error: "logged" });
}

/** Sends one email. Resend reports failures in { error } instead of throwing; returns that message, or null. */
async function sendEmail(what: string, payload: Parameters<typeof resend.emails.send>[0]): Promise<string | null> {
  try {
    const { error } = await resend.emails.send(payload);
    if (!error) return null;
    console.error(`${what} failed:`, error.message);
    return error.message || "unknown error";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${what} failed:`, message);
    return message;
  }
}

/**
 * Takes a gift card's balance for one paid session: a single atomic database
 * step that never goes below zero and runs once per session (redeem_gift_card).
 * Anything short of the full amount is reported to the admin. Once the balance
 * is taken, the checkout's hold on it (lib/gift-card-holds.ts) has done its
 * job and is closed; if it couldn't be taken, the hold stays until it expires.
 */
async function redeemGiftCard(admin: Admin, session: Stripe.Checkout.Session, giftCardId: string, cents: number, what: string) {
  let applied = 0;
  let remaining: number | null = null;
  let failure = "";
  const { data, error } = await admin.rpc("redeem_gift_card", { p_gift_card_id: giftCardId, p_cents: cents, p_reference: session.id });
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as { applied: number | null; remaining: number | null; repeated: boolean } | null;
    await markGiftCardHoldsPaid(admin, session.id);
    if (row?.repeated) return; // this session already took its share
    applied = row?.applied ?? 0;
    remaining = row?.remaining ?? null;
  } else if (missingSchema(error)) {
    const result = await deductWithoutRpc(admin, giftCardId, cents);
    if ("error" in result) failure = result.error;
    else {
      ({ applied, remaining } = result);
      await markGiftCardHoldsPaid(admin, session.id);
    }
  } else {
    failure = error.message;
  }

  if (failure) {
    await alertAdmin(session, "GIFT_CARD_NOT_CHARGED", `${what}: the gift card (id ${giftCardId}) could not be charged ${usd(cents)}: ${failure}. Take it off the card's balance by hand.`);
  } else if (remaining === null) {
    await alertAdmin(session, "GIFT_CARD_NOT_CHARGED", `${what}: the gift card (id ${giftCardId}) used for ${usd(cents)} no longer exists, so nothing was taken off it.`);
  } else if (applied < cents) {
    await alertAdmin(session, "GIFT_CARD_SHORT", `${what}: the gift card (id ${giftCardId}) was applied for ${usd(cents)} but only had ${usd(applied)} left when payment arrived. It is now at $0.00; ${usd(cents - applied)} of the discount was not covered by its balance.`);
  }
}

/**
 * Before the migration adds redeem_gift_card: a compare-and-set update (only
 * writes if the balance is still what was read), so two payments can't both
 * spend the same balance.
 */
async function deductWithoutRpc(admin: Admin, giftCardId: string, cents: number): Promise<{ applied: number; remaining: number | null } | { error: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: gc, error } = await admin.from("gift_cards").select("remaining_cents, status").eq("id", giftCardId).maybeSingle();
    if (error) return { error: error.message };
    if (!gc) return { applied: 0, remaining: null };
    const applied = Math.min(cents, Math.max(0, gc.remaining_cents));
    const left = Math.max(0, gc.remaining_cents - applied);
    const { data: done, error: updateError } = await admin
      .from("gift_cards")
      .update({ remaining_cents: left, status: left === 0 ? "depleted" : gc.status })
      .eq("id", giftCardId)
      .eq("remaining_cents", gc.remaining_cents)
      .select("id");
    if (updateError) return { error: updateError.message };
    if (done?.length) return { applied, remaining: left };
  }
  return { error: "the balance kept changing while it was being updated" };
}

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    return await handleEvent(event);
  } catch (err) {
    // Thrown before a session was claimed (claimed work catches its own errors): retrying is safe
    console.error(`Stripe webhook ${event.type} ${event.id} failed:`, err);
    return Response.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<Response> {
  // ── Delayed payment methods ─────────────────────────────────────────────
  // With a bank debit (for example) Checkout completes before the money
  // arrives: checkout.session.completed comes with payment_status "unpaid",
  // then async_payment_succeeded (handled like a paid completion below, under
  // the same claim) or async_payment_failed. The Stripe endpoint must be
  // subscribed to both async events for them to arrive.
  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const kind = sessionKind(session);
    if (kind) {
      await alertPaymentOnce(
        session,
        "PAYMENT_FAILED",
        `The delayed payment for checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}, ${usd(session.amount_total ?? 0)}) failed. Nothing was done for it (no order change, label, gift card or email). Ask the customer to pay again.`,
      );
    }
    return Response.json({ received: true, ignored: "payment failed" });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === "unpaid") {
      // Not paid yet: no claim, so the async_payment_succeeded event can claim it.
      // The admin is told, unless that event already got here first.
      const kind = sessionKind(session);
      const { data: claimed } = kind
        ? await createAdminClient().from(CLAIMS).select("stripe_session_id").eq("stripe_session_id", session.id).maybeSingle()
        : { data: null };
      if (kind && !claimed) {
        await alertPaymentOnce(
          session,
          "PAYMENT_PENDING",
          `Checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}, ${usd(session.amount_total ?? 0)}) was completed with a payment that hasn't arrived yet (a delayed method such as a bank debit). Nothing was done for it yet (no order change, label, gift card or email). It is handled when Stripe reports the payment succeeded, if the webhook endpoint is subscribed to checkout.session.async_payment_succeeded; otherwise handle it by hand once the payment arrives.`,
        );
      }
      return Response.json({ received: true, ignored: "awaiting payment" });
    }
    const admin = createAdminClient();

    // ── Gift card purchase ────────────────────────────────────────────────
    if (session.metadata?.type === "gift_card") {
      const amountCents = parseInt(session.metadata.amount_cents ?? "0", 10);
      const purchaserName = session.metadata.purchaser_name ?? "";
      const purchaserEmail = session.metadata.purchaser_email ?? session.customer_email ?? "";
      const recipientName = session.metadata.recipient_name ?? purchaserName;
      const recipientEmail = session.metadata.recipient_email ?? purchaserEmail;
      const personalMessage = session.metadata.personal_message ?? "";
      const isSelfPurchase = recipientEmail.toLowerCase() === purchaserEmail.toLowerCase();

      const claim = await claimSession(admin, session, "gift_card", event.created);
      if (claim instanceof Response) return claim;

      // Generate unique code: GIFT-XXXX-XXXX (A-Z 0-9, no ambiguous chars)
      const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      function randomSegment(len: number) {
        return Array.from({ length: len }, () => CHARS[randomInt(CHARS.length)]).join("");
      }

      // The card is saved once per session (stripe_session_id is unique); a new
      // code is drawn if one ever collides with an existing card's code
      let code = "";
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = `GIFT-${randomSegment(4)}-${randomSegment(4)}`;
        const { error: insertError } = await admin.from("gift_cards").insert({
          code: candidate,
          value_cents: amountCents,
          remaining_cents: amountCents,
          purchaser_email: purchaserEmail,
          purchaser_name: purchaserName,
          recipient_email: recipientEmail,
          recipient_name: recipientName,
          personal_message: personalMessage || null,
          stripe_session_id: session.id,
          status: "active",
        });
        if (!insertError) {
          code = candidate;
          break;
        }
        if (insertError.code !== "23505") {
          return retryLater(claim, `could not save the gift card (${insertError.message})`);
        }
        // Already saved for this session (an earlier delivery, or the other site's webhook)
        const { data: existing } = await admin.from("gift_cards").select("id").eq("stripe_session_id", session.id).maybeSingle();
        if (existing) {
          await finishClaim(claim, "gift card already saved for this session");
          return Response.json({ received: true, duplicate: true });
        }
      }
      if (!code) {
        return retryLater(claim, "could not draw a unique gift card code");
      }

      let stage = "gift card email";
      try {
        const amountStr = `$${(amountCents / 100).toFixed(2)}`;
        const appUrl = siteUrl();

        // Email to recipient (or purchaser if same)
        const recipientFirstName = recipientName.split(" ")[0] || "there";
        const recipientEmailError = await sendEmail("Gift card email to recipient", {
          from: fromEmail,
          to: recipientEmail,
          subject: `You received a ${amountStr} Gift Card — ${businessName}`,
          html: `
            <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:900;margin-bottom:4px">You got a gift card! 🎁</h1>
              <p>Hi ${esc(recipientFirstName)},${isSelfPurchase ? " your gift card is ready to use." : ` ${esc(purchaserName)} sent you a gift card for ${businessName}.`}</p>
              ${personalMessage ? `<div style="background:#f8f9fa;border-left:4px solid #c34104;padding:12px 16px;margin:16px 0;border-radius:4px;font-style:italic;color:#444">"${esc(personalMessage)}"</div>` : ""}
              <div style="background:#fff5f0;border:2px solid #c34104;border-radius:16px;padding:24px;margin:24px 0;text-align:center">
                <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#c34104">Your Gift Card Code</p>
                <p style="margin:0 0 8px;font-family:monospace;font-size:32px;font-weight:900;color:#7c2704;letter-spacing:0.1em">${code}</p>
                <p style="margin:0;font-size:20px;font-weight:700;color:#c34104">${amountStr} Value</p>
              </div>
              <p style="font-size:14px;color:#444">To redeem, enter this code in the <strong>"Gift Card"</strong> field at checkout when placing a restoration order.</p>
              <a href="${appUrl}/restoration" style="display:inline-block;background:#c34104;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin:8px 0 24px">Start a Restoration Order →</a>
              <p style="font-size:12px;color:#999">Gift cards never expire and can be used on any restoration order. ${businessName}</p>
            </div>
          `,
        });

        // Separate receipt email to purchaser if they're different from recipient
        stage = "gift card receipt";
        const purchaserEmailError = isSelfPurchase ? null : await sendEmail("Gift card receipt to purchaser", {
          from: fromEmail,
          to: purchaserEmail,
          subject: `Gift Card Sent — ${businessName}`,
          html: `
              <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
                <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:900;margin-bottom:4px">Gift Card Sent!</h1>
                <p>Hi ${esc(purchaserName.split(" ")[0] || "there")}, your ${amountStr} gift card has been sent to <strong>${esc(recipientEmail)}</strong>.</p>
                <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:16px;margin:16px 0">
                  <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.05em">Gift Card Code</p>
                  <p style="margin:0;font-family:monospace;font-size:20px;font-weight:700;color:#15803d">${code}</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#166534">Value: ${amountStr}</p>
                </div>
                <p style="font-size:13px;color:#666">${businessName}</p>
              </div>
            `,
        });

        // The code only reaches the customer by email: if that failed, the admin sends it
        if (recipientEmailError || purchaserEmailError) {
          await alertAdmin(
            session,
            "GIFT_CARD_EMAIL_FAILED",
            `Gift card ${code} (${amountStr}) was paid and saved, but ${[
              recipientEmailError ? `the email to the recipient (${recipientEmail}) failed: ${recipientEmailError}` : "",
              purchaserEmailError ? `the receipt to the purchaser (${purchaserEmail}) failed: ${purchaserEmailError}` : "",
            ].filter(Boolean).join("; ")}. Send the code by hand.`,
          );
        }

        await finishClaim(claim);
        return Response.json({ received: true });
      } catch (err) {
        return failedAfterClaim(claim, stage, err);
      }
    }

    // ── Shop / kit order ──────────────────────────────────────────────────
    if (session.metadata?.type === "shop") {
      const items: { id: string; qty: number }[] = JSON.parse(session.metadata.items ?? "[]");

      // Fetch product names from DB
      const productIds = items.map((i) => i.id);
      const { data: products } = await admin
        .from("products")
        .select("id, name, price_cents, inventory_count")
        .in("id", productIds);

      const productMap = Object.fromEntries((products ?? []).map((p) => [p.id, p]));

      // Build items array for storage
      const itemsForDb = items.map((i) => ({
        product_id: i.id,
        product_name: productMap[i.id]?.name ?? "Unknown product",
        quantity: i.qty,
        price_cents: productMap[i.id]?.price_cents ?? 0,
      }));

      // The address checked in the cart (older orders: the one Stripe collected)
      const shippingAddress = addressFromSession(session);
      const isInternationalShop = session.metadata.is_international === "true";

      const customerName = session.metadata.customer_name ?? session.customer_details?.name ?? "";
      const customerEmail = session.customer_email ?? "";
      const customerPhone = session.metadata.customer_phone ?? "";
      const totalCents = session.amount_total ?? 0;
      // Live-rate checkouts record what shipping cost; older ones were $5.99
      // in the US (abroad: what the total holds beyond the items)
      const kitShippingCents = parseInt(session.metadata.kit_shipping_cents ?? "", 10);
      const shippingCents = Number.isFinite(kitShippingCents)
        ? kitShippingCents
        : isInternationalShop
          ? totalCents - (session.amount_subtotal ?? totalCents - 599)
          : 599;
      const shippingService = session.metadata.kit_shipping_service ?? "";

      const claim = await claimSession(admin, session, "shop", event.created);
      if (claim instanceof Response) return claim;

      // Save shop order to DB
      const { data: savedKitOrder, error: kitInsertError } = await admin.from("shop_orders").insert({
        stripe_session_id: session.id,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        shipping_address: shippingAddress,
        items: itemsForDb,
        subtotal_cents: Math.max(0, totalCents - shippingCents),
        shipping_cents: shippingCents,
        total_cents: totalCents,
        status: "paid",
        affiliate_code: session.metadata.affiliate_code || null,
      }).select("id, order_number").single();

      // Stripe retried an event we already handled (the session ID is unique):
      // don't take stock, gift card balance or a label twice
      if (kitInsertError?.code === "23505") {
        await finishClaim(claim, "kit order already saved for this session");
        return Response.json({ received: true, duplicate: true });
      }
      if (kitInsertError || !savedKitOrder) {
        // Nothing was saved, bought or sent: Stripe sends it again
        return retryLater(claim, `could not save the kit order (${kitInsertError?.message ?? "no row returned"})`);
      }

      let stage = "gift card";
      try {
        // Consume gift card balance if one was applied. Taken first (one quick
        // step), so it is spent even if the run dies later, e.g. buying the label.
        const shopGcId = session.metadata?.gift_card_id;
        const shopGcDiscount = parseInt(session.metadata?.gift_card_discount_cents ?? "0", 10);
        if (shopGcId && shopGcDiscount > 0) {
          await redeemGiftCard(admin, session, shopGcId, shopGcDiscount, `Kit order K${savedKitOrder.order_number ?? savedKitOrder.id}`);
        }

        stage = "kit label";
        // The shipping speed the customer picked is bought as the label now, so
        // the kit is ready to pack the moment the order lands
        let kitLabel: KitLabel | null = null;
        let kitLabelError = "";
        const kitRateId = session.metadata.kit_rate_object_id;
        if (kitRateId && savedKitOrder) {
          // The rate's carrier: sent by the kit checkout (older sessions: the
          // first word of the service name, e.g. "UPS Ground")
          const kitCarrier = session.metadata.kit_carrier || shippingService.split(" ")[0] || null;
          const bought = await buyKitLabel(kitRateId, isInternationalShop, kitCarrier);
          if ("label" in bought) {
            kitLabel = bought.label;
            const { error: labelSaveError } = await admin.from("shop_orders").update({
              labels: [{
                labelUrl: kitLabel.labelUrl,
                trackingNumber: kitLabel.trackingNumber,
                // Read by the order page's tracking link (lib/tracking-carrier.ts)
                ...(kitLabel.trackingUrl ? { trackingUrl: kitLabel.trackingUrl } : {}),
                ...(kitLabel.carrier ? { carrier: kitLabel.carrier } : {}),
                createdAt: new Date().toISOString(),
                ...(kitLabel.customsUrl ? { customsUrl: kitLabel.customsUrl } : {}),
              }],
              return_label_url: kitLabel.labelUrl,
              tracking_number: kitLabel.trackingNumber,
              status: "processing",
            }).eq("id", savedKitOrder.id);
            if (labelSaveError) {
              console.error(`Kit label bought but not saved (session ${session.id}):`, labelSaveError.message, kitLabel.labelUrl);
              await alertAdmin(session, "KIT_LABEL_NOT_SAVED", `The kit label was bought but could not be saved on the kit order (${labelSaveError.message}). Label: ${kitLabel.labelUrl}${kitLabel.trackingNumber ? `, tracking ${kitLabel.trackingNumber}` : ""}${kitLabel.customsUrl ? `, customs invoice ${kitLabel.customsUrl}` : ""}. Add it to the order by hand; don't buy another.`);
            }
          } else {
            kitLabelError = bought.error;
            console.error(`Kit label purchase failed (session ${session.id}):`, bought.error);
          }
        }

        // Decrement inventory for each product
        stage = "inventory";
        for (const item of items) {
          const current = productMap[item.id]?.inventory_count ?? 0;
          const { error: stockError } = await admin
            .from("products")
            .update({ inventory_count: Math.max(0, current - item.qty) })
            .eq("id", item.id);
          if (stockError) console.error(`Inventory update failed for product ${item.id} (session ${session.id}):`, stockError.message);
        }

        const addrLine = shippingAddress
          ? `${shippingAddress.street1}${shippingAddress.street2 ? `, ${shippingAddress.street2}` : ""}, ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}`
          : "";

        // Send confirmation email to customer
        stage = "kit confirmation email";
        if (customerEmail) {
          const itemsHtml = itemsForDb
            .map((i) => `<tr><td style="padding:4px 0">${esc(i.product_name)} x${i.quantity}</td><td style="padding:4px 0;text-align:right">$${((i.price_cents * i.quantity) / 100).toFixed(2)}</td></tr>`)
            .join("");

          await sendEmail("Shop order confirmation email", {
            from: fromEmail,
            to: customerEmail,
            subject: `Order Confirmed — ${businessName}`,
            html: `
              <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
                <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:900">Order Confirmed</h1>
                <p>Hi ${esc(customerName.split(" ")[0] || "there")}, your order has been placed and will ship within 1-2 business days.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
                  ${itemsHtml}
                  <tr style="border-top:1px solid #eee"><td style="padding:8px 0;font-weight:700">Shipping${shippingService ? ` <span style="font-weight:400;color:#666">(${esc(shippingService)})</span>` : ""}</td><td style="padding:8px 0;text-align:right">$${(shippingCents / 100).toFixed(2)}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:700">Total</td><td style="padding:4px 0;text-align:right;font-weight:700">$${(totalCents / 100).toFixed(2)}</td></tr>
                </table>
                ${addrLine ? `<p style="font-size:13px;color:#666">Shipping to: ${esc(addrLine)}</p>` : ""}
                ${kitLabel?.trackingNumber ? `<p style="font-size:13px;color:#666">Tracking number: ${kitLabel.trackingUrl ? `<a href="${esc(kitLabel.trackingUrl)}" style="color:#111">${esc(kitLabel.trackingNumber)}</a>` : esc(kitLabel.trackingNumber)}. It starts updating once your kit is handed to the carrier.</p>` : ""}
                <p style="font-size:13px;color:#666">Questions? DM us on Instagram <strong>@thecarddoc</strong></p>
                <p style="font-size:13px;color:#999">${businessName}</p>
              </div>
            `,
          });
        }

        // Notify admin
        stage = "admin kit order email";
        const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? process.env.BUSINESS_SHIPPING_EMAIL ?? "";
        const appUrl = siteUrl();
        await sendEmail("Admin kit order email", {
          from: fromEmail,
          to: adminEmail,
          subject: `New Kit Order — ${customerName}`,
          html: `
            <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:900">New kit order!</h1>
              <p><strong>${esc(customerName)}</strong> just purchased a kit.</p>
              <p style="color:#666;font-size:14px">${esc(customerEmail)} · ${esc(customerPhone)}</p>
              ${addrLine ? `<p style="font-size:14px"><strong>Ship to:</strong> ${esc(addrLine)}</p>` : ""}
              <p style="font-size:14px"><strong>Total:</strong> $${(totalCents / 100).toFixed(2)}</p>
              ${kitRateId && savedKitOrder
                ? kitLabel
                  ? `<p style="font-size:14px"><strong>Label bought:</strong> ${esc(shippingService || "shipping label")}${kitLabel.trackingNumber ? ` · ${esc(kitLabel.trackingNumber)}` : ""} · <a href="${esc(kitLabel.labelUrl)}">Print label</a>${kitLabel.customsUrl ? ` · <a href="${esc(kitLabel.customsUrl)}">Customs invoice</a>` : ""}</p>`
                  : `<p style="font-size:14px;color:#b91c1c"><strong>The label couldn't be bought:</strong> ${esc(kitLabelError)}. Buy it from Kit Orders.</p>`
                : ""}
              <a href="${appUrl}/admin/shop-orders" style="display:inline-block;background:#a23200;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">View Kit Orders</a>
            </div>
          `,
        });

        await finishClaim(claim);
        return Response.json({ received: true });
      } catch (err) {
        return failedAfterClaim(claim, stage, err);
      }
    }

    // ── Subscription checkout ─────────────────────────────────────────────
    if (session.metadata?.type === "subscription") {
      const admin2 = createAdminClient();

      let shippingAddress: Record<string, unknown> | null = null;
      try {
        shippingAddress = JSON.parse(session.metadata.shipping_address_json ?? "null");
      } catch {
        console.error("Failed to parse subscription shipping_address_json");
      }

      const claim = await claimSession(admin2, session, "subscription", event.created);
      if (claim instanceof Response) return claim;

      const { error: subInsertError } = await admin2.from("subscriptions").insert({
        stripe_subscription_id: String(session.subscription ?? ""),
        stripe_customer_id: String(session.customer ?? ""),
        customer_name: session.metadata.customer_name ?? "",
        customer_email: session.customer_email ?? "",
        customer_phone: session.metadata.customer_phone ?? "",
        shipping_address: shippingAddress,
        status: "active",
      });
      // Already recorded (an earlier delivery, or the other site's webhook)
      if (subInsertError?.code === "23505") {
        await finishClaim(claim, "subscription already recorded");
        return Response.json({ received: true, duplicate: true });
      }
      if (subInsertError) {
        return retryLater(claim, `could not save the subscription (${subInsertError.message})`);
      }

      let stage = "first kit order";
      try {
        // Create the first kit order immediately — don't rely on invoice.paid which can race
        const subFirstPriceCents = session.amount_total ?? (await getSubscriptionPriceCents());
        const { error: firstKitError } = await admin2.from("shop_orders").insert({
          stripe_session_id: session.id,
          customer_name: session.metadata.customer_name ?? "",
          customer_email: session.customer_email ?? "",
          customer_phone: session.metadata.customer_phone ?? "",
          shipping_address: shippingAddress,
          items: [{ product_id: "subscription", product_name: "Monthly Kit Club", quantity: 1, price_cents: subFirstPriceCents }],
          subtotal_cents: subFirstPriceCents,
          shipping_cents: 0,
          total_cents: subFirstPriceCents,
          status: "paid",
        });
        if (firstKitError && firstKitError.code !== "23505") {
          console.error(`First Kit Club kit order insert failed (session ${session.id}):`, firstKitError.message);
          await alertAdmin(session, "KIT_CLUB_ORDER_NOT_SAVED", `The Kit Club subscription was recorded, but its first kit order could not be saved (${firstKitError.message}). Add the first kit to Kit Orders by hand.`);
        }

        stage = "Kit Club welcome email";
        const subCustomerEmail = session.customer_email;
        const subCustomerName = session.metadata.customer_name ?? "";
        if (subCustomerEmail) {
          await sendEmail("Subscription welcome email", {
            from: fromEmail,
            to: subCustomerEmail,
            subject: `Welcome to Monthly Kit Club — ${businessName}`,
            html: `
              <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
                <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:900">Welcome to Monthly Kit Club!</h1>
                <p>Hi ${esc(subCustomerName.split(" ")[0] || "there")}, you&rsquo;re officially subscribed.</p>
                <p>Your first kit will ship within 1-2 business days. After that, you&rsquo;ll be billed $${(subFirstPriceCents / 100).toFixed(2)} on the same day each month and a new kit will be on its way.</p>
                <p>You can cancel anytime by emailing us at <a href="mailto:${esc(replyToAddress)}">${esc(replyToAddress)}</a>.</p>
                <p style="font-size:13px;color:#666">Questions? DM us on Instagram <strong>@thecarddoc</strong></p>
                <p style="font-size:13px;color:#999">${businessName}</p>
              </div>
            `,
          });
        }

        await finishClaim(claim);
        return Response.json({ received: true });
      } catch (err) {
        return failedAfterClaim(claim, stage, err);
      }
    }

    // ── Add cards ─────────────────────────────────────────────────────────
    if (session.metadata?.type === "add_cards") {
      const addOrderId = session.metadata.order_id;
      const cardCount = parseInt(session.metadata.card_count ?? "0", 10);
      const subtotalPaidCents = parseInt(session.metadata.subtotal_cents ?? "0", 10);
      const tierName = session.metadata.tier ?? "regular";
      const paidCents = session.amount_total ?? 0;
      const paidIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

      if (addOrderId && cardCount > 0) {
        const claim = await claimSession(admin, session, "add_cards", event.created, addOrderId);
        if (claim instanceof Response) return claim;
        const addRecorded = await alreadyRecorded(admin, addOrderId, "cards_added", session);
        if (addRecorded === "unknown") return retryLater(claim, "could not check the order history");
        if (addRecorded !== "no") return alreadyDone(claim, addRecorded, addOrderId, "cards already added");

        let stage = "read the added cards";
        let cardsSaved = false;
        try {
          // What went wrong along the way (steps after the cards are in keep
          // going if one fails); the admin gets the list
          const problems: string[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let newCardRows: Record<string, any>[] = [];
          // The full card details saved when the customer signed (add-cards route)
          const pendingId = session.metadata.pending_event_id;
          const { data: pending, error: pendingError } = pendingId
            ? await admin.from("order_events").select("metadata").eq("id", pendingId).maybeSingle()
            : { data: null, error: null };
          // Nothing has been added yet: Stripe sends it again, rather than adding thin cards
          if (pendingError) return retryLater(claim, `could not read the card details saved at signing (${pendingError.message})`);
          const pendingMeta = pending?.metadata as { cards?: AddedCard[]; prices?: unknown } | null;
          const pendingCards = pendingMeta?.cards;
          if (pendingId && !pendingCards?.length) {
            problems.push(`the card details saved when the customer signed (order event ${pendingId}) were not found, so the cards were added from the checkout's short details: no tier, per-card prices, number, variation, grade, cert number or known defects`);
          }
          const addTier = RESTORATION_TIERS[tierName as RestorationTierId] ?? RESTORATION_TIERS.regular;
          // What each card was charged: the admin's tier price the add-cards
          // route saved with the cards (older sessions: the default price)
          const savedPrices = Array.isArray(pendingMeta?.prices) && pendingMeta.prices.length === pendingCards?.length
            && pendingMeta.prices.every((p) => Number.isInteger(p) && (p as number) >= 0)
            ? (pendingMeta.prices as number[])
            : null;
          const priceOf = (i: number, declaredValueCents: number | null | undefined) =>
            savedPrices?.[i] ?? getCardPriceCents(addTier, declaredValueCents ?? 0);
          if (pendingCards?.length) {
            const prices = pendingCards.map((c, i) => priceOf(i, c.declaredValueCents));
            const amounts = itemAmounts(prices, parseInt(session.metadata.bulk_discount_cents ?? "0", 10) || 0);
            newCardRows = pendingCards.map((c, i) => ({
              id: randomUUID(),
              order_id: addOrderId,
              card_name: c.name,
              photo_urls: c.photoUrls ?? [],
              card_set: c.card_set ?? null,
              card_year: c.card_year ?? null,
              card_number: c.card_number ?? null,
              variation: c.variation ?? null,
              grading_company: c.grading_company ?? null,
              grade: c.grade ?? null,
              cert_number: c.cert_number ?? null,
              known_defects: c.known_defects ?? null,
              estimated_value_cents: c.declaredValueCents,
              tier: addTier.id,
              status: "active",
              ...amounts[i],
            }));
          }
          for (let i = 0; i < cardCount && !pendingCards?.length; i++) {
            const raw = session.metadata[`card_${i}`];
            if (!raw) continue;
            try {
              const c = JSON.parse(raw);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const row: Record<string, any> = {
                order_id: addOrderId,
                card_name: c.n ?? "",
                photo_urls: c.p ?? [],
              };
              if (c.s) row.card_set = c.s;
              if (c.y) row.card_year = c.y;
              if (c.v) row.estimated_value_cents = c.v;
              newCardRows.push(row);
            } catch { /* skip malformed card */ }
          }
          if (newCardRows.length !== cardCount) {
            problems.push(`${cardCount} card${cardCount !== 1 ? "s were" : " was"} paid for but ${newCardRows.length} could be read from the checkout, so ${newCardRows.length < cardCount ? "the missing ones must be added by hand" : "check the cards on the order"}`);
          }

          if (newCardRows.length > 0) {
            stage = "add the cards";
            const { error: cardsError } = await admin.from("cards").insert(newCardRows);
            if (cardsError) {
              // One insert: no card was added and nothing else has happened, so Stripe sends it again
              return retryLater(claim, `could not add the cards (${cardsError.message})`);
            }
            cardsSaved = true;

            // Service lines for the added cards, priced the way the add-cards route charged them
            stage = "add the service lines";
            const priceCounts = new Map<number, number>();
            newCardRows.forEach((row, i) => {
              const price = priceOf(i, row.estimated_value_cents);
              priceCounts.set(price, (priceCounts.get(price) ?? 0) + 1);
            });
            const { error: servicesError } = await admin.from("order_services").insert(
              [...priceCounts].map(([price, count]) => ({
                order_id: addOrderId,
                service_id: addTier.id,
                service_name: `${addTier.name} - Full Restoration & PSA Prep`,
                price_cents: price,
                quantity: count,
              }))
            );
            if (servicesError) problems.push(`the service lines for the added cards were not saved (${servicesError.message})`);
          }

          stage = "add the payment to the order totals";
          const { data: existingOrder, error: totalsReadError } = await admin
            .from("orders")
            .select("subtotal_cents, total_cents")
            .eq("id", addOrderId)
            .single();
          const { error: totalsError } = totalsReadError
            ? { error: totalsReadError }
            : await admin
              .from("orders")
              .update({
                subtotal_cents: (existingOrder?.subtotal_cents ?? 0) + subtotalPaidCents,
                total_cents: (existingOrder?.total_cents ?? 0) + paidCents,
              })
              .eq("id", addOrderId);
          if (totalsError) problems.push(`the payment (${usd(paidCents)}, ${usd(subtotalPaidCents)} before tax) was not added to the order totals (${totalsError.message})`);

          stage = "order history";
          const { error: eventError } = await admin.from("order_events").insert({
            order_id: addOrderId,
            event_type: "cards_added",
            description: `Customer added ${newCardRows.length} card${newCardRows.length !== 1 ? "s" : ""} — additional payment of $${(paidCents / 100).toFixed(2)} received`,
            is_customer_visible: true,
            // The payment behind it, for refunds and for spotting a repeat
            metadata: { stripe_session_id: session.id, stripe_payment_intent_id: paidIntent ?? null, amount_cents: paidCents },
          });
          if (eventError) problems.push(`the "cards added" entry was not saved in the order history, which the dashboard counts the payment from (${eventError.message})`);

          // The signature given for these cards, emailed as a PDF
          stage = "signed copy email";
          const { data: addSig } = await admin.from("signatures").select("id").eq("order_id", addOrderId).eq("type", "master_terms").order("signed_at", { ascending: false }).limit(1);
          const docs = addSig?.length ? await signedPdfAttachments(admin, addOrderId, [addSig[0].id]).catch(() => []) : [];
          const { data: addOrder } = await admin.from("orders").select("order_number, customer_email").eq("id", addOrderId).single();
          if (docs.length && addOrder) {
            await sendEmail("Add-cards documents email", {
              from: fromEmail,
              to: addOrder.customer_email,
              subject: `Cards added — ${businessName} #${addOrder.order_number}`,
              html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;color:#333;font-size:15px;line-height:1.6"><p>Thanks! We added ${newCardRows.length} card${newCardRows.length !== 1 ? "s" : ""} to order #${esc(addOrder.order_number)}. Your signed copy of the Terms of Service for them is attached as a PDF.</p></div>`,
              attachments: docs,
            });
          }

          if (problems.length) {
            await alertAdmin(session, "ADD_CARDS_INCOMPLETE", `Order id ${addOrderId}: ${cardCount} added card${cardCount !== 1 ? "s were" : " was"} paid for (session ${session.id}), but ${problems.join("; ")}. Fix this by hand.`);
          }
          await finishClaim(claim, problems.join("; ") || undefined);
        } catch (err) {
          return failedAfterClaim(claim, cardsSaved ? `${stage} (the cards were added)` : stage, err);
        }
      }
      return Response.json({ received: true });
    }

    // ── Tier upgrade ──────────────────────────────────────────────────────
    if (session.metadata?.type === "tier_upgrade") {
      const upgradeOrderId = session.metadata.order_id;
      const newTier = session.metadata.new_tier;
      if (upgradeOrderId && newTier) {
        const claim = await claimSession(admin, session, "tier_upgrade", event.created, upgradeOrderId);
        if (claim instanceof Response) return claim;
        const upgradeRecorded = await alreadyRecorded(admin, upgradeOrderId, "tier_upgraded", session);
        if (upgradeRecorded === "unknown") return retryLater(claim, "could not check the order history");
        if (upgradeRecorded !== "no") return alreadyDone(claim, upgradeRecorded, upgradeOrderId, "upgrade already recorded");

        // Fetch order to compute new totals
        const { data: upgradeOrder, error: upgradeReadError } = await admin
          .from("orders")
          .select("subtotal_cents, total_cents, restoration_tier")
          .eq("id", upgradeOrderId)
          .single();
        if (upgradeReadError) {
          return retryLater(claim, `could not read the order (${upgradeReadError.message})`);
        }

        const upgradePaidCents = session.amount_total ?? 0;
        // Pre-tax part of the upgrade; older sessions only carry the taxed amount.
        const upgradeSubtotalCents = session.metadata.upgrade_subtotal_cents
          ? parseInt(session.metadata.upgrade_subtotal_cents, 10)
          : Math.round(upgradePaidCents / 1.06625);

        const { error: upgradeError } = await admin
          .from("orders")
          .update({
            restoration_tier: newTier,
            subtotal_cents: (upgradeOrder?.subtotal_cents ?? 0) + upgradeSubtotalCents,
            total_cents: (upgradeOrder?.total_cents ?? 0) + upgradePaidCents,
          })
          .eq("id", upgradeOrderId);
        if (upgradeError) {
          // One update: nothing changed, so Stripe sends it again
          return retryLater(claim, `could not upgrade the order (${upgradeError.message})`);
        }

        let stage = "move the service line";
        try {
          const problems: string[] = [];
          // Move the order's service line to the new tier, at the per-card
          // price the upgrade route charged from (older sessions: the default)
          const oldTier = upgradeOrder?.restoration_tier as RestorationTierId | null | undefined;
          if (oldTier && oldTier !== newTier) {
            const tier = getTierById(newTier as RestorationTierId);
            const chargedPrice = parseInt(session.metadata.new_price_cents ?? "", 10);
            const newPrice = Number.isFinite(chargedPrice) && chargedPrice > 0 ? chargedPrice : tier.price_cents;
            const { error: serviceError } = await admin
              .from("order_services")
              .update({
                service_id: newTier,
                service_name: `${tier.name} - Full Restoration & PSA Prep`,
                price_cents: newPrice,
              })
              .eq("order_id", upgradeOrderId)
              .eq("service_id", oldTier);
            if (serviceError) problems.push(`the service line was not moved to the new tier (${serviceError.message})`);

            // Each card's price, discount and tax take its share of the upgrade,
            // as the upgrade route charged it (lib/upgrade-pricing.ts), so a
            // per-card refund (lib/work-gates.ts) returns what was paid for it.
            // Before the cards move: their tier tells which prices are current.
            stage = "price the cards";
            const currentPrice = parseInt(session.metadata.current_price_cents ?? "", 10);
            const cardsPriceProblem = await addUpgradeToCards(admin, upgradeOrderId, {
              oldTier,
              currentPriceCents: Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : getTierById(oldTier).price_cents,
              newPriceCents: newPrice,
              bulkPercent: parseInt(session.metadata.bulk_discount_percent ?? "0", 10) || 0,
            });
            if (cardsPriceProblem) problems.push(`the cards' prices were not updated for the upgrade, so a per-card refund would return only the old tier's price (${cardsPriceProblem})`);

            // All the order's cards move to the new tier (an order that can
            // upgrade is on one tier)
            stage = "move the cards";
            const { error: cardsTierError } = await admin
              .from("cards")
              .update({ tier: newTier })
              .eq("order_id", upgradeOrderId);
            if (cardsTierError) problems.push(`the cards were not moved to the new tier (${cardsTierError.message})`);
          }

          stage = "order history";
          const { error: eventError } = await admin.from("order_events").insert({
            order_id: upgradeOrderId,
            event_type: "tier_upgraded",
            description: `Upgraded to ${newTier} tier — additional payment of $${(upgradePaidCents / 100).toFixed(2)} received`,
            is_customer_visible: true,
            // The payment behind it, for refunds and for spotting a repeat
            metadata: {
              stripe_session_id: session.id,
              stripe_payment_intent_id: (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) ?? null,
              amount_cents: upgradePaidCents,
            },
          });
          if (eventError) problems.push(`the "upgraded" entry was not saved in the order history, which the dashboard counts the payment from (${eventError.message})`);

          if (problems.length) {
            await alertAdmin(session, "TIER_UPGRADE_INCOMPLETE", `Order id ${upgradeOrderId}: the upgrade to ${newTier} was paid (session ${session.id}) and the tier and totals were updated, but ${problems.join("; ")}. Fix this by hand.`);
          }
          await finishClaim(claim, problems.join("; ") || undefined);
        } catch (err) {
          return failedAfterClaim(claim, `${stage} (the tier and totals were updated)`, err);
        }
      }
      return Response.json({ received: true });
    }

    // ── Restoration order ─────────────────────────────────────────────────
    const orderId = session.metadata?.order_id;
    // Stripe Payment Link sales (and anything else this site didn't start) carry
    // no order: nothing to do, and a 200 stops Stripe retrying them for days
    if (!orderId) return Response.json({ received: true, ignored: "no order_id in metadata" });

    const isPrep = session.metadata?.service_type === "prep";
    const kind: Kind = isPrep ? "prep" : "restoration";
    const rateObjectId = session.metadata?.shipping_rate_object_id;
    const isInternational = session.metadata?.is_international === "true";

    const gcId = session.metadata?.gift_card_id;
    const gcDiscount = parseInt(session.metadata?.gift_card_discount_cents ?? "0", 10);
    const amountCharged = session.amount_total ?? 0;
    const autoPaymentMethod = gcId && gcDiscount > 0 && amountCharged === 0 ? "gift_card" : "card";

    const updatePayload: Record<string, unknown> = { status: "awaiting_cards", payment_status: "paid", payment_method: autoPaymentMethod };
    // The payment to refund against (per-card refunds, lib/work-gates.ts)
    const paidIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (paidIntent) updatePayload.stripe_payment_intent_id = paidIntent;

    // Save insurance, signature, slab crack, and instagram so the admin breakdown can display them
    const metaInsuranceCents = parseInt(session.metadata?.insurance_declared_value_cents ?? "0", 10);
    const metaInsuranceType = session.metadata?.insurance_type ?? "";
    if (metaInsuranceCents > 0) updatePayload.insurance_declared_value_cents = metaInsuranceCents;
    if (metaInsuranceType && metaInsuranceType !== "none") updatePayload.insurance_type = metaInsuranceType;
    if (session.metadata?.add_signature_confirmation === "true") updatePayload.add_signature_confirmation = true;
    const metaSlabCount = parseInt(session.metadata?.slab_crack_count ?? "0", 10);
    if (metaSlabCount > 0) updatePayload.slab_crack_count = metaSlabCount;
    if (session.metadata?.instagram_feature === "true") updatePayload.instagram_feature = true;
    const metaGcDiscount = parseInt(session.metadata?.gift_card_discount_cents ?? "0", 10);
    if (metaGcDiscount > 0) {
      updatePayload.gift_card_discount_cents = metaGcDiscount;
      const metaGcId = session.metadata?.gift_card_id ?? "";
      if (metaGcId) {
        const { data: gc } = await admin.from("gift_cards").select("code").eq("id", metaGcId).single();
        if (gc?.code) updatePayload.gift_card_code = gc.code;
      }
    }

    const claim = await claimSession(admin, session, kind, event.created, orderId);
    if (claim instanceof Response) return claim;

    // Only an unpaid order turns paid, so a repeated delivery (or the other
    // site's webhook getting there first) finds nothing to update and stops
    // before a label is bought or a gift card is charged
    const { data: updated, error } = await admin
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .or("payment_status.is.null,payment_status.in.(pending,failed)")
      .select();

    if (error) {
      return retryLater(claim, `could not mark the order paid (${error.message})`);
    }

    if (!updated || updated.length === 0) {
      const { data: existingOrder, error: lookupError } = await admin.from("orders").select("payment_status").eq("id", orderId).maybeSingle();
      if (lookupError) return retryLater(claim, `could not read the order (${lookupError.message})`);
      if (!existingOrder) return retryLater(claim, `no order with id ${orderId}`, 404);
      await finishClaim(claim, `order already ${existingOrder.payment_status}`);
      return Response.json({ received: true, duplicate: true });
    }

    // Purchase prepaid inbound label for buy_label orders (both domestic and international)
    let shippingLabelUrl: string | null = null;
    let inboundCustomsFormUrl: string | null = null;
    let inboundTrackingNumber: string | null = null;
    let inboundTrackingUrl: string | null = null;
    const inboundEta: string | null = null; // no ETA source yet
    // Why the prepaid label could not be bought, for the admin (order timeline + email)
    let labelError: string | null = null;
    // Saves that failed after the order turned paid; the admin gets the list
    const problems: string[] = [];
    let stage = "gift card";
    try {
      // Consume gift card balance if one was applied. Taken first (one quick
      // step), so it is spent even if the run dies later, e.g. buying the label.
      if (gcId && gcDiscount > 0) {
        await redeemGiftCard(admin, session, gcId, gcDiscount, `Order #${updated[0].order_number}`);
      }

      stage = "prepaid label";
      if (rateObjectId) {
        // Read insurance and signature from Stripe metadata (passed at checkout time,
        // avoids depending on DB columns that may not be migrated yet)
        const insuranceCents = parseInt(session.metadata?.insurance_declared_value_cents ?? "0", 10);
        const insuranceType = session.metadata?.insurance_type ?? "";
        // "return" insures only the trip back, applied when the return label is bought
        const hasInboundInsurance = insuranceCents > 0 && insuranceType !== "" && insuranceType !== "none" && insuranceType !== "return";
        const wantsSignature = session.metadata?.add_signature_confirmation === "true";
        try {
          // The Shippo SDK's TransactionCreateRequest has no `extra` field — it strips it silently.
          // Call the REST API directly so insurance and signature actually reach Shippo.
          const txBody: Record<string, unknown> = {
            rate: rateObjectId,
            label_file_type: "PDF_4x6",
            async: false,
          };
          if (wantsSignature || hasInboundInsurance) {
            txBody.extra = {
              ...(wantsSignature ? { signature_confirmation: "STANDARD" } : {}),
              ...(hasInboundInsurance ? {
                insurance: {
                  amount: (insuranceCents / 100).toFixed(2),
                  currency: "USD",
                  provider: "SHIPPO",
                  content: "Trading cards",
                },
              } : {}),
            };
          }
          const txRes = await fetch("https://api.goshippo.com/transactions/", {
            method: "POST",
            headers: {
              "Authorization": `ShippoToken ${process.env.SHIPPO_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(txBody),
          });
          const transaction = await txRes.json() as Record<string, unknown>;
          if (transaction.status === "SUCCESS" && transaction.label_url) {
            shippingLabelUrl = transaction.label_url as string;
            inboundTrackingNumber = (transaction.tracking_number as string) ?? null;
            inboundTrackingUrl = (transaction.tracking_url_provider as string) ?? null;
            // For international shipments, extract customs form URL
            if (isInternational) {
              if (transaction.commercial_invoice_url) {
                inboundCustomsFormUrl = transaction.commercial_invoice_url as string;
              } else if (Array.isArray(transaction.documents) && transaction.documents.length > 0) {
                const docs = transaction.documents as Array<{ type?: string; url?: string }>;
                const customsDoc = docs.find((d) => d.type && /customs|invoice|declaration/i.test(d.type));
                inboundCustomsFormUrl = (customsDoc ?? docs[0])?.url ?? null;
              }
            }
          } else {
            console.error("Shippo label purchase failed:", transaction.messages ?? transaction);
            const messages = Array.isArray(transaction.messages) ? (transaction.messages as Array<{ text?: string }>) : [];
            labelError = messages.map((m) => m.text).filter(Boolean).join("; ")
              || (typeof transaction.detail === "string" ? transaction.detail : "")
              || `Shippo status ${String(transaction.status ?? "unknown")}`;
          }
        } catch (err) {
          console.error("Shippo transaction error:", err);
          labelError = err instanceof Error ? err.message : String(err);
        }
      }

      if (shippingLabelUrl) {
        stage = "save the prepaid label";
        const labelPatch: Record<string, unknown> = { shipping_label_url: shippingLabelUrl };
        if (inboundTrackingNumber) labelPatch.inbound_tracking_number = inboundTrackingNumber;
        if (inboundCustomsFormUrl) labelPatch.inbound_customs_form_url = inboundCustomsFormUrl;
        const { error: labelSaveError } = await admin.from("orders").update(labelPatch).eq("id", orderId);
        if (labelSaveError) {
          console.error(`Prepaid label bought but not saved (order ${orderId}):`, labelSaveError.message, shippingLabelUrl);
          await alertAdmin(session, "LABEL_NOT_SAVED", `Order #${updated[0].order_number}: the prepaid label was bought but could not be saved on the order (${labelSaveError.message}). Label: ${shippingLabelUrl}${inboundTrackingNumber ? `, tracking ${inboundTrackingNumber}` : ""}${inboundCustomsFormUrl ? `, customs form ${inboundCustomsFormUrl}` : ""}. Add it to the order by hand; don't buy another. The customer's email still has the label.`);
        }
      }

      stage = "order history";
      const { error: paidEventError } = await admin.from("order_events").insert({
        order_id: orderId,
        event_type: "payment_received",
        description: shippingLabelUrl
          ? "Payment confirmed — prepaid shipping label generated"
          : "Payment confirmed via Stripe",
        is_customer_visible: true,
        metadata: { stripe_session_id: session.id, stripe_payment_intent_id: paidIntent ?? null },
      });
      if (paidEventError) {
        console.error(`payment_received event not saved (order ${orderId}):`, paidEventError.message);
        problems.push(`its "payment received" entry was not saved in the order history, which the dashboard and sales reports date the payment from (${paidEventError.message})`);
      }
      if (labelError) {
        const { error: labelEventError } = await admin.from("order_events").insert({
          order_id: orderId,
          event_type: "label_failed",
          description: `Prepaid label could not be created: ${labelError.slice(0, 300)}. Use Regenerate label on this order.`,
          is_customer_visible: false,
        });
        if (labelEventError) {
          console.error(`label_failed event not saved (order ${orderId}):`, labelEventError.message);
          problems.push(`the prepaid label could not be bought (${labelError.slice(0, 300)}) and that note was not saved on the order (${labelEventError.message}); use Regenerate label`);
        }
      }

      // Notify admin of new restoration order
      stage = "admin new order email";
      const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? process.env.BUSINESS_SHIPPING_EMAIL ?? "";
      const appUrl2 = siteUrl();
      const o = updated[0];
      const shipFromAddr = o.ship_from_address as Record<string, string> | null;
      const addressLine = shipFromAddr
        ? `${shipFromAddr.street1}${shipFromAddr.street2 ? `, ${shipFromAddr.street2}` : ""}, ${shipFromAddr.city}, ${shipFromAddr.state} ${shipFromAddr.zip}`
        : "—";

      const inboundShippingBlock = inboundTrackingNumber
        ? `
        <div style="background:#fbfaf9;border:1px solid #e6e4e2;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#2d2b29">Inbound Tracking</p>
          <p style="margin:0 0 8px;font-family:monospace;font-size:18px;font-weight:900;color:#1e1d1a">${esc(inboundTrackingNumber)}</p>
          ${inboundEta ? `<p style="margin:0 0 4px;font-size:13px;color:#2d2b29">Estimated arrival: <strong>${new Date(inboundEta).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</strong></p>` : ""}
          ${inboundTrackingUrl ? `<a href="${esc(inboundTrackingUrl)}" style="font-size:13px;color:#2d2b29">Track on carrier website →</a>` : ""}
        </div>`
        : labelError
        ? `<p style="font-size:14px;color:#b91c1c;"><strong>Prepaid label failed:</strong> ${esc(labelError.slice(0, 300))}. Open the order and use Regenerate label.</p>`
        : `<p style="font-size:14px;color:#666;">Customer is self-shipping — no prepaid label.</p>`;

      await sendEmail("Admin new order email", {
        from: fromEmail,
        to: adminEmail,
        subject: isPrep
          ? `🔬 New Prep Order #${o.order_number} — ${o.customer_name}`
          : `📦 New Restoration Order #${o.order_number} — ${o.customer_name}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
            <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:900">${isPrep ? "New prep order!" : "New restoration order!"}</h1>
            <p><strong>${esc(o.customer_name)}</strong> just placed order <strong>#${esc(o.order_number)}</strong>.</p>
            <table style="font-size:14px;width:100%;border-collapse:collapse;margin:12px 0">
              <tr><td style="padding:4px 0;color:#666;width:120px">Email</td><td style="font-weight:600">${esc(o.customer_email)}</td></tr>
              <tr><td style="padding:4px 0;color:#666">Phone</td><td style="font-weight:600">${esc(o.customer_phone ?? "—")}</td></tr>
              <tr><td style="padding:4px 0;color:#666">Address</td><td style="font-weight:600">${esc(addressLine)}</td></tr>
              <tr><td style="padding:4px 0;color:#666">Shipping</td><td style="font-weight:600">${esc(o.inbound_carrier ? `${o.inbound_carrier} — ${o.inbound_service_level}` : o.return_carrier ? `Self-ship; return paid: ${o.return_carrier} — ${o.return_service_level}` : "Self-ship")}</td></tr>
            </table>
            ${inboundShippingBlock}
            <a href="${appUrl2}/admin/orders/${esc(orderId)}" style="display:inline-block;background:#c34104;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">View Order</a>
          </div>
        `,
      });

      // Send confirmation email to restoration customer
      stage = "confirmation email";
      const order = updated[0];
      const appUrl = siteUrl();
      const trackingUrl = `${appUrl}/orders/${order.order_number}`;

      const firstName = order.customer_name?.split(" ")[0] ?? "there";
      // The signed Terms and slab authorizations, stored and attached (lib/signed-pdfs.ts)
      const signedDocs = await signedPdfAttachments(admin, orderId!).catch((err) => {
        console.error("Signed PDFs failed:", err);
        return [];
      });
      const shippingSection = shippingLabelUrl
        ? `<div style="background:#fff5f0;border:2px solid #feb993;border-radius:12px;padding:24px;margin:24px 0">
          <p style="margin:0 0 6px;font-size:18px;font-weight:900;color:#5c1f08">📦 Your Prepaid Shipping Label Is Ready</p>
          ${isInternational ? `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:12px;margin-bottom:14px"><p style="margin:0;font-size:13px;font-weight:700;color:#92400e">⚠️ International shipment — you MUST bring this to a carrier counter or post office in person. Do not drop in a mailbox. You may also need to present the customs form to the agent.</p></div>` : ""}
          <p style="margin:0 0 16px;color:#7c2704;font-size:14px;line-height:1.6">We've generated a prepaid label for you. Just:</p>
          <ol style="margin:0 0 16px;padding-left:20px;color:#7c2704;font-size:14px;line-height:2">
            <li>Package your cards securely in a bubble mailer or small box</li>
            <li>Print the label${isInternational && inboundCustomsFormUrl ? " and customs form" : ""} and tape the label to the outside</li>
            <li>${isInternational ? "Bring the package to your nearest post office or carrier counter — do not use a mailbox" : "Drop the package off at your nearest carrier location"}</li>
          </ol>
          <a href="${esc(shippingLabelUrl)}" style="display:inline-block;background:#a23200;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">⬇ Download Shipping Label (PDF)</a>
          ${isInternational && inboundCustomsFormUrl ? `<br><br><a href="${esc(inboundCustomsFormUrl)}" style="display:inline-block;background:#1e1d1a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">⬇ Download Customs Form (PDF)</a>` : ""}
        </div>`
        : `<div style="background:#fefce8;border:2px solid #fbbf24;border-radius:12px;padding:24px;margin:24px 0">
          <p style="margin:0 0 6px;font-size:18px;font-weight:900;color:#78350f">📬 Ship Your Cards To Us</p>
          <p style="margin:0 0 12px;color:#92400e;font-size:14px;line-height:1.6">Please send your cards using a tracked, insured shipping method (USPS Priority, UPS, or FedEx recommended).</p>
          <ol style="margin:0 0 16px;padding-left:20px;color:#92400e;font-size:14px;line-height:2">
            <li>Package your cards securely in a bubble mailer or small box</li>
            <li>Write your order number <strong>#${esc(order.order_number)}</strong> on the inside</li>
            <li>Ship to the address below and save your tracking number</li>
          </ol>
          <div style="background:#fff8e1;border:1px solid #fde68a;border-radius:8px;padding:14px">
            <p style="margin:0;color:#78350f;font-weight:700;font-size:15px;line-height:1.8">
              ${process.env.BUSINESS_SHIPPING_NAME ?? "The Card Doc"}<br>
              ${process.env.BUSINESS_SHIPPING_STREET1 ?? ""}${process.env.BUSINESS_SHIPPING_STREET2 ? `<br>${process.env.BUSINESS_SHIPPING_STREET2}` : ""}<br>
              ${process.env.BUSINESS_SHIPPING_CITY ?? ""}, ${process.env.BUSINESS_SHIPPING_STATE ?? ""} ${process.env.BUSINESS_SHIPPING_ZIP ?? ""}<br>
              United States
            </p>
          </div>
        </div>`;

      const confirmationError = await sendEmail("Confirmation email", {
        from: fromEmail,
        to: order.customer_email,
        subject: isPrep
          ? `Prep Order Confirmed — ${businessName} #${order.order_number}`
          : `Restoration Order Confirmed — ${businessName} #${order.order_number}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;color:#111">
            <div style="background:#a23200;border-radius:12px 12px 0 0;padding:24px;text-align:center">
              <p style="margin:0;color:#fed8c4;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">${businessName}</p>
              <h1 style="font-family:Georgia,'Times New Roman',serif;margin:6px 0 0;color:#fff;font-size:28px;font-weight:900">${isPrep ? "Prep Order Confirmed ✓" : "Restoration Order Confirmed ✓"}</h1>
            </div>
            <div style="background:#fff;border:1px solid #e6e4e2;border-top:0;border-radius:0 0 12px 12px;padding:28px">
              <p style="color:#666;margin:0 0 4px;font-size:13px">Order number</p>
              <p style="margin:0 0 20px;font-size:22px;font-weight:900;color:#111">#${esc(order.order_number)}</p>
              <p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.6">Hi ${esc(firstName)}! 👋 Thank you for your ${isPrep ? "prep" : "restoration"} order. Here's what to do next to get your cards to us.</p>
              ${shippingSection}
              ${signedDocs.length ? `<p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.6">Your signed copy of the Terms of Service${signedDocs.length > 1 ? " and slab removal authorizations are" : " is"} attached as PDF${signedDocs.length > 1 ? "s" : ""}. Please keep ${signedDocs.length > 1 ? "them" : "it"} for your records.</p>` : ""}
              <div style="text-align:center;margin:24px 0">
                <a href="${esc(trackingUrl)}" style="display:inline-block;background:#111;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">View Your Order Status →</a>
              </div>
              <hr style="border:none;border-top:1px solid #e6e4e2;margin:24px 0">
              <p style="font-size:13px;color:#666;margin:0 0 6px">Questions? We're always happy to help:</p>
              <p style="font-size:13px;color:#333;margin:0">Instagram: <a href="https://instagram.com/the_card_doc" style="color:#a23200;font-weight:600">@the_card_doc</a></p>
            </div>
          </div>
        `,
        ...(signedDocs.length ? { attachments: signedDocs } : {}),
      });
      if (confirmationError) {
        // Shown on the order's timeline, so the admin can send the details (and label) by hand
        const { error: emailEventError } = await admin.from("order_events").insert({
          order_id: orderId,
          event_type: "email_failed",
          description: `Order confirmation email could not be sent: ${confirmationError.slice(0, 300)}`,
          is_customer_visible: false,
        });
        if (emailEventError) {
          console.error(`email_failed event not saved (order ${orderId}):`, emailEventError.message);
          problems.push(`the confirmation email could not be sent (${confirmationError.slice(0, 300)}) and that note was not saved on the order (${emailEventError.message}); use Resend Confirmation`);
        }
      }

      if (problems.length) {
        await alertAdmin(session, "ORDER_INCOMPLETE", `Order #${order.order_number} is paid (session ${session.id}), but ${problems.join("; ")}. Fix this by hand.`);
      }
      await finishClaim(claim, problems.join("; ") || undefined);
      return Response.json({ received: true });
    } catch (err) {
      return failedAfterClaim(claim, stage, err);
    }
  }

  // ── Invoice paid (recurring subscription billing) ─────────────────────
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    // Skip the first invoice — it's handled by checkout.session.completed above to avoid race conditions
    if ((invoice as { billing_reason?: string | null }).billing_reason === "subscription_create") {
      return Response.json({ received: true });
    }
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (subscriptionId) {
      const adminInv = createAdminClient();
      const { data: subRecord, error: subLookupError } = await adminInv
        .from("subscriptions")
        .select("*")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      if (subLookupError) {
        // Not "no subscription": Stripe sends it again
        console.error(`invoice.paid: could not read the subscription for ${invoice.id}:`, subLookupError.message);
        return Response.json({ error: "Could not read the subscription" }, { status: 500 });
      }

      if (subRecord) {
        const invPriceCents = typeof invoice.amount_paid === "number" ? invoice.amount_paid : await getSubscriptionPriceCents();
        // One kit order per invoice: a repeat (or the daily safety-net job getting
        // there first) leaves the saved order alone, so a shipped kit stays shipped
        const { error: invoiceOrderError } = await adminInv.from("shop_orders").upsert(
          {
            stripe_session_id: invoice.id,
            customer_name: subRecord.customer_name,
            customer_email: subRecord.customer_email,
            customer_phone: subRecord.customer_phone ?? "",
            shipping_address: subRecord.shipping_address,
            items: [
              {
                product_id: "subscription",
                product_name: "Monthly Kit Club",
                quantity: 1,
                price_cents: invPriceCents,
              },
            ],
            subtotal_cents: invPriceCents,
            shipping_cents: 0,
            total_cents: invPriceCents,
            status: "paid",
          },
          { onConflict: "stripe_session_id", ignoreDuplicates: true }
        );
        if (invoiceOrderError) {
          console.error(`invoice.paid: kit order not saved for ${invoice.id}:`, invoiceOrderError.message);
          return Response.json({ error: "Could not save the kit order" }, { status: 500 });
        }
      } else {
        console.warn("invoice.paid: no subscription record found for", subscriptionId);
      }
    }
  }

  // ── Subscription cancelled ────────────────────────────────────────────
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const adminCan = createAdminClient();
    // Already cancelled (a repeat, or cancelled here first): keep the first date
    const { error: cancelError } = await adminCan
      .from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("stripe_subscription_id", subscription.id)
      .or("status.is.null,status.neq.cancelled");
    if (cancelError) {
      // Stripe sends it again
      console.error(`customer.subscription.deleted: could not mark ${subscription.id} cancelled:`, cancelError.message);
      return Response.json({ error: "Could not record the cancellation" }, { status: 500 });
    }
  }

  return Response.json({ received: true });
}
