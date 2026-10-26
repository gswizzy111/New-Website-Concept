import Stripe from "stripe";
import { addressFromSession } from "@/lib/shipping-address";
import { stripe, invoiceSubscriptionId } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, fromEmail, replyToAddress, businessName } from "@/lib/resend";
import { randomInt, randomUUID } from "node:crypto";
import { itemAmounts } from "@/lib/item-pricing";
import { signedPdfAttachments } from "@/lib/signed-pdfs";
import { escapeHtml } from "@/lib/card-inquiries";
import { siteUrl } from "@/lib/site-url";
import { logCheckoutError } from "@/lib/checkout-error-log";

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

/** The table or function isn't there yet (migration not applied). */
function missingSchema(err: { code?: string } | null | undefined) {
  return !!err && ["PGRST202", "PGRST205", "42P01", "42883"].includes(err.code ?? "");
}

/**
 * Claims the session for this run. null: go ahead (claimed, or the claims table
 * isn't there yet, so only the data checks guard). A Response: answer Stripe
 * with it and do nothing else.
 */
async function claimSession(admin: Admin, session: Stripe.Checkout.Session, kind: Kind, orderId?: string | null): Promise<Response | null> {
  const { data, error } = await admin
    .from(CLAIMS)
    .upsert({ stripe_session_id: session.id, kind, order_id: orderId ?? null }, { onConflict: "stripe_session_id", ignoreDuplicates: true })
    .select("stripe_session_id");
  if (error) {
    if (missingSchema(error)) {
      console.warn(`${CLAIMS} is missing (apply 20261027_webhook.sql); handling ${session.id} with data checks only`);
      return null;
    }
    // Nothing has happened yet, so Stripe can safely send it again
    console.error(`Could not claim checkout session ${session.id}:`, error.message);
    return Response.json({ error: "Could not claim the session" }, { status: 500 });
  }
  if (data?.length) return null;
  return repeatedSession(admin, session, kind);
}

/** Stripe sent a session that was already claimed. */
async function repeatedSession(admin: Admin, session: Stripe.Checkout.Session, kind: Kind): Promise<Response> {
  const { data: claim, error } = await admin
    .from(CLAIMS)
    .select("claimed_at, completed_at, alerted_at")
    .eq("stripe_session_id", session.id)
    .maybeSingle();
  // The claim was released in between, or can't be read: Stripe tries again later
  if (error || !claim) return Response.json({ error: "Session claim changed, retry" }, { status: 409 });
  if (claim.completed_at || claim.alerted_at) return Response.json({ received: true, duplicate: true });
  if (Date.now() - new Date(claim.claimed_at).getTime() < STALE_CLAIM_MS) {
    // Another delivery is handling it right now. A non-2xx answer makes Stripe
    // ask again later, when that run has finished (or is known to have died).
    return Response.json({ received: true, in_progress: true }, { status: 409 });
  }
  // The first run stopped part-way (most likely a timeout): tell the admin, once
  const { data: marked } = await admin
    .from(CLAIMS)
    .update({ alerted_at: new Date().toISOString() })
    .eq("stripe_session_id", session.id)
    .is("completed_at", null)
    .is("alerted_at", null)
    .select("stripe_session_id");
  if (marked?.length) {
    await alertAdmin(
      session,
      "WEBHOOK_UNFINISHED",
      `Stripe sent paid checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}) again. The first run started ${claim.claimed_at} and never finished, most likely a timeout. Check it by hand: payment status, prepaid or kit label, gift card balance, cards and totals, and the emails.`,
    );
  }
  return Response.json({ received: true, duplicate: true });
}

/** The run ended (note: what it found already done, or why it stopped). */
async function finishClaim(admin: Admin, sessionId: string, note?: string) {
  const { error } = await admin
    .from(CLAIMS)
    .update({ completed_at: new Date().toISOString(), ...(note ? { note: note.slice(0, 500) } : {}) })
    .eq("stripe_session_id", sessionId);
  if (error && !missingSchema(error)) console.error(`Could not mark checkout session ${sessionId} done:`, error.message);
}

/** Nothing was done after all: let Stripe's next delivery start over. */
async function releaseClaim(admin: Admin, sessionId: string) {
  const { error } = await admin.from(CLAIMS).delete().eq("stripe_session_id", sessionId).is("completed_at", null);
  if (error && !missingSchema(error)) console.error(`Could not release checkout session ${sessionId}:`, error.message);
}

/**
 * Whether this session's payment is already in the order's history (the
 * cards_added / tier_upgraded event carries the session id). A data check that
 * also works before the claims table exists. null: couldn't tell.
 */
async function alreadyRecorded(admin: Admin, orderId: string, eventType: string, sessionId: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from("order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event_type", eventType)
    .eq("metadata->>stripe_session_id", sessionId)
    .limit(1);
  if (error) {
    console.error(`Could not check order history for session ${sessionId}:`, error.message);
    return null;
  }
  return (data?.length ?? 0) > 0;
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
 * Something threw after the session was claimed. The steps before `stage` are
 * done (a label may be bought), so a retry must not start over: the admin is
 * told what to finish by hand, and Stripe gets a 200.
 */
async function failedAfterClaim(admin: Admin, session: Stripe.Checkout.Session, kind: Kind, stage: string, err: unknown): Promise<Response> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Stripe webhook (${kind}) stopped at "${stage}" for ${session.id}:`, err);
  await alertAdmin(
    session,
    "WEBHOOK_FAILED",
    `Paid checkout session ${session.id} (${kind}${session.metadata?.order_id ? `, order id ${session.metadata.order_id}` : ""}) stopped at "${stage}": ${message}. The steps before it are done; finish the rest by hand.`,
  );
  await finishClaim(admin, session.id, `stopped at ${stage}: ${message}`);
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
 * Anything short of the full amount is reported to the admin.
 */
async function redeemGiftCard(admin: Admin, session: Stripe.Checkout.Session, giftCardId: string, cents: number, what: string) {
  let applied = 0;
  let remaining: number | null = null;
  let failure = "";
  const { data, error } = await admin.rpc("redeem_gift_card", { p_gift_card_id: giftCardId, p_cents: cents, p_reference: session.id });
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as { applied: number | null; remaining: number | null; repeated: boolean } | null;
    if (row?.repeated) return; // this session already took its share
    applied = row?.applied ?? 0;
    remaining = row?.remaining ?? null;
  } else if (missingSchema(error)) {
    const result = await deductWithoutRpc(admin, giftCardId, cents);
    if ("error" in result) failure = result.error;
    else ({ applied, remaining } = result);
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
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
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

      const claimed = await claimSession(admin, session, "gift_card");
      if (claimed) return claimed;

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
          console.error("Gift card insert failed:", insertError.message);
          await releaseClaim(admin, session.id);
          return Response.json({ error: "Could not save the gift card" }, { status: 500 });
        }
        // Already saved for this session (an earlier delivery, or the other site's webhook)
        const { data: existing } = await admin.from("gift_cards").select("id").eq("stripe_session_id", session.id).maybeSingle();
        if (existing) {
          await finishClaim(admin, session.id, "gift card already saved for this session");
          return Response.json({ received: true, duplicate: true });
        }
      }
      if (!code) {
        await releaseClaim(admin, session.id);
        return Response.json({ error: "Could not draw a unique gift card code" }, { status: 500 });
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

        await finishClaim(admin, session.id);
        return Response.json({ received: true });
      } catch (err) {
        return failedAfterClaim(admin, session, "gift_card", stage, err);
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

      const claimed = await claimSession(admin, session, "shop");
      if (claimed) return claimed;

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
        await finishClaim(admin, session.id, "kit order already saved for this session");
        return Response.json({ received: true, duplicate: true });
      }
      if (kitInsertError || !savedKitOrder) {
        // Nothing was saved, bought or sent: Stripe sends it again
        console.error(`Kit order insert failed (session ${session.id}):`, kitInsertError?.message);
        await releaseClaim(admin, session.id);
        return Response.json({ error: "Could not save the kit order" }, { status: 500 });
      }

      let stage = "kit label";
      try {
        // The shipping speed the customer picked is bought as the label now, so
        // the kit is ready to pack the moment the order lands
        let kitLabel: KitLabel | null = null;
        let kitLabelError = "";
        const kitRateId = session.metadata.kit_rate_object_id;
        if (kitRateId && savedKitOrder) {
          const bought = await buyKitLabel(kitRateId, isInternationalShop);
          if ("label" in bought) {
            kitLabel = bought.label;
            const { error: labelSaveError } = await admin.from("shop_orders").update({
              labels: [{
                labelUrl: kitLabel.labelUrl,
                trackingNumber: kitLabel.trackingNumber,
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

        // Consume gift card balance if one was applied
        stage = "gift card";
        const shopGcId = session.metadata?.gift_card_id;
        const shopGcDiscount = parseInt(session.metadata?.gift_card_discount_cents ?? "0", 10);
        if (shopGcId && shopGcDiscount > 0) {
          await redeemGiftCard(admin, session, shopGcId, shopGcDiscount, `Kit order K${savedKitOrder.order_number ?? savedKitOrder.id}`);
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

        await finishClaim(admin, session.id);
        return Response.json({ received: true });
      } catch (err) {
        return failedAfterClaim(admin, session, "shop", stage, err);
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

      const claimed = await claimSession(admin2, session, "subscription");
      if (claimed) return claimed;

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
        await finishClaim(admin2, session.id, "subscription already recorded");
        return Response.json({ received: true, duplicate: true });
      }
      if (subInsertError) {
        console.error(`Subscription insert failed (session ${session.id}):`, subInsertError.message);
        await releaseClaim(admin2, session.id);
        return Response.json({ error: "Could not save the subscription" }, { status: 500 });
      }

      let stage = "first kit order";
      try {
        // Create the first kit order immediately — don't rely on invoice.paid which can race
        const subFirstPriceCents = session.amount_total ?? 6299;
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

        await finishClaim(admin2, session.id);
        return Response.json({ received: true });
      } catch (err) {
        return failedAfterClaim(admin2, session, "subscription", stage, err);
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
        const claimed = await claimSession(admin, session, "add_cards", addOrderId);
        if (claimed) return claimed;
        const addRecorded = await alreadyRecorded(admin, addOrderId, "cards_added", session.id);
        if (addRecorded !== false) {
          if (addRecorded === null) {
            await releaseClaim(admin, session.id);
            return Response.json({ error: "Could not check the order history" }, { status: 500 });
          }
          await finishClaim(admin, session.id, "cards already added for this session");
          return Response.json({ received: true, duplicate: true });
        }

        let stage = "read the added cards";
        let cardsSaved = false;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let newCardRows: Record<string, any>[] = [];
          // The full card details saved when the customer signed (add-cards route)
          const pendingId = session.metadata.pending_event_id;
          const { data: pending } = pendingId
            ? await admin.from("order_events").select("metadata").eq("id", pendingId).maybeSingle()
            : { data: null };
          const pendingCards = (pending?.metadata as { cards?: AddedCard[] } | null)?.cards;
          if (pendingCards?.length) {
            const addTier = RESTORATION_TIERS[tierName as RestorationTierId] ?? RESTORATION_TIERS.regular;
            const prices = pendingCards.map((c) => getCardPriceCents(addTier, c.declaredValueCents));
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

          // Steps after the cards are in keep going if one fails; the admin gets the list
          const problems: string[] = [];
          if (newCardRows.length > 0) {
            stage = "add the cards";
            const { error: cardsError } = await admin.from("cards").insert(newCardRows);
            if (cardsError) {
              // One insert: no card was added and nothing else has happened, so Stripe sends it again
              console.error(`Add-cards insert failed (session ${session.id}):`, cardsError.message);
              await releaseClaim(admin, session.id);
              return Response.json({ error: "Could not add the cards" }, { status: 500 });
            }
            cardsSaved = true;

            // Service lines for the added cards, priced the way the add-cards route charged them
            stage = "add the service lines";
            const addTier = RESTORATION_TIERS[tierName as RestorationTierId] ?? RESTORATION_TIERS.regular;
            const priceCounts = new Map<number, number>();
            for (const row of newCardRows) {
              const price = getCardPriceCents(addTier, row.estimated_value_cents);
              priceCounts.set(price, (priceCounts.get(price) ?? 0) + 1);
            }
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
            await alertAdmin(session, "ADD_CARDS_INCOMPLETE", `Order id ${addOrderId}: ${newCardRows.length} added card${newCardRows.length !== 1 ? "s were" : " was"} paid for (session ${session.id}), but ${problems.join("; ")}. Fix this by hand.`);
          }
          await finishClaim(admin, session.id, problems.join("; ") || undefined);
        } catch (err) {
          return failedAfterClaim(admin, session, "add_cards", cardsSaved ? `${stage} (the cards were added)` : stage, err);
        }
      }
      return Response.json({ received: true });
    }

    // ── Tier upgrade ──────────────────────────────────────────────────────
    if (session.metadata?.type === "tier_upgrade") {
      const upgradeOrderId = session.metadata.order_id;
      const newTier = session.metadata.new_tier;
      if (upgradeOrderId && newTier) {
        const claimed = await claimSession(admin, session, "tier_upgrade", upgradeOrderId);
        if (claimed) return claimed;
        const upgradeRecorded = await alreadyRecorded(admin, upgradeOrderId, "tier_upgraded", session.id);
        if (upgradeRecorded !== false) {
          if (upgradeRecorded === null) {
            await releaseClaim(admin, session.id);
            return Response.json({ error: "Could not check the order history" }, { status: 500 });
          }
          await finishClaim(admin, session.id, "upgrade already recorded for this session");
          return Response.json({ received: true, duplicate: true });
        }

        // Fetch order to compute new totals
        const { data: upgradeOrder, error: upgradeReadError } = await admin
          .from("orders")
          .select("subtotal_cents, total_cents, restoration_tier")
          .eq("id", upgradeOrderId)
          .single();
        if (upgradeReadError) {
          console.error(`Upgrade order read failed (session ${session.id}):`, upgradeReadError.message);
          await releaseClaim(admin, session.id);
          return Response.json({ error: "Could not read the order" }, { status: 500 });
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
          console.error(`Upgrade order update failed (session ${session.id}):`, upgradeError.message);
          await releaseClaim(admin, session.id);
          return Response.json({ error: "Could not upgrade the order" }, { status: 500 });
        }

        let stage = "move the service line";
        try {
          const problems: string[] = [];
          // Move the order's service line to the new tier
          const oldTier = upgradeOrder?.restoration_tier as RestorationTierId | null | undefined;
          if (oldTier && oldTier !== newTier) {
            const tier = getTierById(newTier as RestorationTierId);
            const { error: serviceError } = await admin
              .from("order_services")
              .update({
                service_id: newTier,
                service_name: `${tier.name} - Full Restoration & PSA Prep`,
                price_cents: tier.price_cents,
              })
              .eq("order_id", upgradeOrderId)
              .eq("service_id", oldTier);
            if (serviceError) problems.push(`the service line was not moved to the new tier (${serviceError.message})`);
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
          await finishClaim(admin, session.id, problems.join("; ") || undefined);
        } catch (err) {
          return failedAfterClaim(admin, session, "tier_upgrade", `${stage} (the tier and totals were updated)`, err);
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

    const claimed = await claimSession(admin, session, kind, orderId);
    if (claimed) return claimed;

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
      console.error("Supabase update error:", JSON.stringify(error));
      await releaseClaim(admin, session.id);
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!updated || updated.length === 0) {
      const { data: existingOrder, error: lookupError } = await admin.from("orders").select("payment_status").eq("id", orderId).maybeSingle();
      if (lookupError || !existingOrder) {
        await releaseClaim(admin, session.id);
        if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
        console.error("No order found with id:", orderId);
        return Response.json({ error: `Order not found: ${orderId}` }, { status: 404 });
      }
      await finishClaim(admin, session.id, `order already ${existingOrder.payment_status}`);
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
    let stage = "prepaid label";
    try {
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

      // Consume gift card balance if one was applied
      stage = "gift card";
      if (gcId && gcDiscount > 0) {
        await redeemGiftCard(admin, session, gcId, gcDiscount, `Order #${updated[0].order_number}`);
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
      if (paidEventError) console.error(`payment_received event not saved (order ${orderId}):`, paidEventError.message);
      if (labelError) {
        const { error: labelEventError } = await admin.from("order_events").insert({
          order_id: orderId,
          event_type: "label_failed",
          description: `Prepaid label could not be created: ${labelError.slice(0, 300)}. Use Regenerate label on this order.`,
          is_customer_visible: false,
        });
        if (labelEventError) console.error(`label_failed event not saved (order ${orderId}):`, labelEventError.message);
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
        await admin.from("order_events").insert({
          order_id: orderId,
          event_type: "email_failed",
          description: `Order confirmation email could not be sent: ${confirmationError.slice(0, 300)}`,
          is_customer_visible: false,
        });
      }

      await finishClaim(admin, session.id);
      return Response.json({ received: true });
    } catch (err) {
      return failedAfterClaim(admin, session, kind, stage, err);
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
      const { data: subRecord } = await adminInv
        .from("subscriptions")
        .select("*")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();

      if (subRecord) {
        const invPriceCents = typeof invoice.amount_paid === "number" ? invoice.amount_paid : 6299;
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
    await adminCan
      .from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("stripe_subscription_id", subscription.id)
      .or("status.is.null,status.neq.cancelled");
  }

  return Response.json({ received: true });
}
