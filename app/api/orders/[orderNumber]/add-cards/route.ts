import { z } from "zod";
import { CardFieldsSchema, SigningSchema, cardDetails, checkoutConsents, signingChoices, masterSignatureInput, signingError, type AuthorizedOrder } from "@/lib/checkout-signing";
import { recordConsents, recordSignatures, signingContext } from "@/lib/signatures";
import { ensureTermsVersion } from "@/lib/terms-versions";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { RESTORATION_TIERS, applyDbOverride, getCardPriceCents } from "@/lib/restoration-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { addedCardsBulkPercent } from "@/lib/bulk-pricing";
import { MAX_CARD_PHOTOS } from "@/lib/site-config";
import { siteUrl } from "@/lib/site-url";
import { getSlotsOpenedAt } from "@/lib/store-config";
import { tierMaxSlots, tierSlotUsage } from "@/lib/tier-slots";

const TAX_RATE = 0.06625;

const CardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Required: every card needs its own declared value (Terms Section 4)
  declaredValueCents: z.number().int().positive(),
  photoUrls: z.array(z.string()).max(MAX_CARD_PHOTOS).optional().default([]),
}).extend(CardFieldsSchema.shape);

const Body = z.object({
  email: z.string().email(),
  cards: z.array(CardSchema).min(1).max(20),
}).extend(SigningSchema.shape);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { email, cards } = parsed.data;

  // The added cards are signed for like a new order: the Terms of Service v1.0
  // and e-sign consent.
  const signingProblem = signingError(parsed.data);
  if (signingProblem) return Response.json(signingProblem, { status: 400 });
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, order_number, customer_email, status, restoration_tier, subtotal_cents, total_cents")
    .eq("order_number", orderNumber)
    .single();

  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if ((order.customer_email ?? "").toLowerCase() !== email.toLowerCase())
    return Response.json({ error: "Email does not match this order" }, { status: 403 });
  if (order.status !== "awaiting_cards")
    return Response.json({ error: "Cards can only be added before they are received" }, { status: 409 });

  // Added cards take the order's tier (an order with cards on several tiers:
  // Bronze). Orders that aren't restorations (prep) can't add cards here.
  const tierId = (order.restoration_tier ?? "regular") as RestorationTierId;
  if (!RESTORATION_TIERS[tierId]) {
    return Response.json({ error: "Cards can't be added to this order online." }, { status: 409 });
  }

  // Priced as the admin set the tier (restoration_settings), like checkout
  const { data: tierSetting, error: tierSettingError } = await admin
    .from("restoration_settings")
    .select("tier, max_slots, display_name, price_cents, pricing_rate, min_card_value_cents")
    .eq("tier", tierId)
    .maybeSingle();
  if (tierSettingError) {
    console.error("Tier settings unavailable:", tierSettingError.message);
    return Response.json({ error: "We couldn't load our prices. Please try again in a moment." }, { status: 503 });
  }
  const tier = applyDbOverride(RESTORATION_TIERS[tierId], tierSetting);

  // A tier's card-value cap is an eligibility condition (Terms 9.2)
  const overCap = tier.max_card_value_cents === null ? undefined : cards.find((c) => c.declaredValueCents > tier.max_card_value_cents!);
  if (overCap) {
    return Response.json({
      error: `${overCap.name} is declared above the ${tier.name} tier's $${(tier.max_card_value_cents! / 100).toLocaleString()} cap, so it can't be added to this order. Please place a new order for it with a higher tier.`,
      code: "TIER_CAP",
    }, { status: 400 });
  }

  const cardPrices = cards.map((c) => getCardPriceCents(tier, c.declaredValueCents));
  const listSubtotalCents = cardPrices.reduce((a, b) => a + b, 0);
  if (listSubtotalCents <= 0) return Response.json({ error: "Could not compute price" }, { status: 400 });

  // Bulk pricing: the order's new size (cards on it + these) sets the percent
  const { count: cardsOnOrder } = await admin
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);

  // Slots are counted in cards: the added cards take slots in the order's tier
  const maxSlots = tierMaxSlots(tier.id, tierSetting?.max_slots);
  if (maxSlots !== null) {
    let usage: Record<string, number>;
    try {
      usage = await tierSlotUsage(admin, await getSlotsOpenedAt());
    } catch (err) {
      console.error("Tier slot count failed:", err);
      return Response.json({ error: "We couldn't check how many spots are left. Please try again in a moment." }, { status: 503 });
    }
    if ((usage[tier.id] ?? 0) + cards.length > maxSlots) {
      return Response.json({ error: `Sorry, the ${tier.name} tier is sold out, so cards can't be added right now.`, code: "TIER_SOLD_OUT" }, { status: 409 });
    }
  }

  const bulkPercent = addedCardsBulkPercent(tier.id, cardsOnOrder ?? 0, cards.length);
  const bulkDiscountCents = Math.round(listSubtotalCents * bulkPercent / 100);
  const subtotalCents = listSubtotalCents - bulkDiscountCents;

  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const totalCents = subtotalCents + taxCents;

  let terms;
  try {
    terms = await ensureTermsVersion(admin);
  } catch (err) {
    console.error("Terms version unavailable:", err);
    return Response.json({ error: "We couldn't load the Terms of Service. Please try again in a moment.", code: "TERMS_UNAVAILABLE" }, { status: 500 });
  }
  // Exactly what the customer is authorizing, recorded with the signature
  const authorized: AuthorizedOrder = {
    order_number: order.order_number,
    cards: cards.map((c, i) => ({
      ...cardDetails({ ...c, card_name: c.name }, c.declaredValueCents),
      services: [{ name: `${tier.name} - Full Restoration & PSA Prep (added card)`, cents: cardPrices[i] }],
    })),
    order_lines: [
      ...(bulkDiscountCents > 0 ? [{ name: `Bulk discount (${bulkPercent}%)`, cents: -bulkDiscountCents }] : []),
      { name: "Sales tax", cents: taxCents },
    ],
    total_cents: totalCents,
    choices: signingChoices(parsed.data),
  };
  const ctx = await signingContext(request, email);
  const signed = await recordSignatures(admin, [masterSignatureInput(order.id, terms, parsed.data.terms!.signer_name, authorized)], ctx);
  const consentError = "error" in signed ? null : await recordConsents(admin, checkoutConsents(order.id, parsed.data), ctx);
  if ("error" in signed || consentError) {
    return Response.json({ error: "We couldn't save your signature. Please try again." }, { status: 500 });
  }

  // The added cards' full details wait here until payment (Stripe metadata is too small for them)
  const { data: pending } = await admin.from("order_events").insert({
    order_id: order.id,
    event_type: "add_cards_pending",
    description: `Terms of Service v${terms.version} signed by ${parsed.data.terms!.signer_name.trim()} to add ${cards.length} card${cards.length !== 1 ? "s" : ""} (awaiting payment)`,
    is_customer_visible: false,
    // prices: what each card is charged (the admin's tier price), for the webhook
    metadata: { cards, terms_version_id: terms.id, prices: cardPrices },
  }).select("id").single();

  const appUrl = siteUrl();

  // Encode each card as a separate metadata key (max 500 chars, stays well under for typical cards)
  const cardMetadata: Record<string, string> = {};
  cards.forEach((c, i) => {
    cardMetadata[`card_${i}`] = JSON.stringify({
      n: c.name,
      s: c.card_set || undefined,
      y: c.card_year || undefined,
      v: c.declaredValueCents || undefined,
      p: c.photoUrls.length ? c.photoUrls : undefined,
    });
  });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.customer_email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Add ${cards.length} Card${cards.length !== 1 ? "s" : ""} — ${tier.name} Restoration${bulkPercent > 0 ? ` (${bulkPercent}% bulk discount)` : ""}`,
            },
            unit_amount: subtotalCents,
          },
          quantity: 1,
        },
        ...(taxCents > 0
          ? [
              {
                price_data: {
                  currency: "usd",
                  product_data: { name: "Sales Tax (6.625%)" },
                  unit_amount: taxCents,
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      // The payment itself names its order, so admin refunds can find it
      payment_intent_data: { metadata: { order_id: order.id, type: "add_cards" } },
      success_url: `${appUrl}/orders/${orderNumber}?email=${encodeURIComponent(email)}&added=1`,
      cancel_url: `${appUrl}/orders/${orderNumber}?email=${encodeURIComponent(email)}`,
      metadata: {
        type: "add_cards",
        order_id: order.id,
        order_number: String(orderNumber),
        tier: tier.id,
        card_count: String(cards.length),
        ...(pending ? { pending_event_id: pending.id } : {}),
        subtotal_cents: String(subtotalCents),
        ...(bulkPercent > 0 ? { bulk_discount_percent: String(bulkPercent), bulk_discount_cents: String(bulkDiscountCents) } : {}),
        ...cardMetadata,
      },
    });
  } catch (err) {
    console.error("Add-cards session creation failed:", err);
    return Response.json({ error: "Payment setup failed. Please try again." }, { status: 500 });
  }

  return Response.json({ url: session.url });
}
