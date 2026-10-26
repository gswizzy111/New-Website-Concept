import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { applyDbOverride, getTierById, UPGRADE_LADDER } from "@/lib/restoration-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { bulkDiscountPercent, bulkPriceCents } from "@/lib/bulk-pricing";
import { siteUrl } from "@/lib/site-url";
import { getSlotsOpenedAt } from "@/lib/store-config";
import { tierMaxSlots, tierSlotUsage } from "@/lib/tier-slots";

const TAX_RATE = 0.06625;

const Body = z.object({
  email: z.string().email(),
  new_tier: z.enum(["regular", "expedited", "premium", "ultra_premium"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { email, new_tier } = parsed.data;
  const admin = createAdminClient();

  // Fetch order — verify email and upgradeable status
  const { data: order } = await admin
    .from("orders")
    .select("id, order_number, customer_email, status, subtotal_cents, restoration_tier, total_cents")
    .eq("order_number", orderNumber)
    .single();

  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  if ((order.customer_email ?? "").toLowerCase() !== email.toLowerCase())
    return Response.json({ error: "Email does not match this order" }, { status: 403 });
  if (order.status !== "awaiting_cards")
    return Response.json({ error: "This order can no longer be upgraded" }, { status: 409 });

  // Only an order on one tier of the ladder can move up it (not Diamond, Fast
  // Pass, prep, or an order with cards on different tiers)
  const currentTierId = order.restoration_tier as RestorationTierId | null;
  if (!currentTierId || !UPGRADE_LADDER.includes(currentTierId) || UPGRADE_LADDER.indexOf(new_tier) <= UPGRADE_LADDER.indexOf(currentTierId))
    return Response.json({ error: "You can only upgrade to a higher service level" }, { status: 400 });

  // Count cards
  const { count: cardCount } = await admin
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);
  const numCards = cardCount ?? 1;

  // The admin's prices and slots for both tiers (restoration_settings)
  const { data: settings, error: settingsError } = await admin
    .from("restoration_settings")
    .select("tier, is_open, max_slots, display_name, price_cents, pricing_rate, min_card_value_cents")
    .in("tier", [currentTierId, new_tier]);
  if (settingsError) {
    console.error("Tier settings unavailable:", settingsError.message);
    return Response.json({ error: "We couldn't load our prices. Please try again in a moment." }, { status: 503 });
  }
  const settingFor = (tier: string) => (settings ?? []).find((s) => s.tier === tier) ?? null;
  const currentTier = applyDbOverride(getTierById(currentTierId), settingFor(currentTierId));
  const newTier = applyDbOverride(getTierById(new_tier), settingFor(new_tier));
  const newTierSetting = settingFor(new_tier);

  // The per-card difference at today's prices, for every card on the order
  const diffCents = (newTier.price_cents - currentTier.price_cents) * numCards;
  if (diffCents <= 0)
    return Response.json({ error: "You can only upgrade to a higher service level" }, { status: 400 });

  if (newTierSetting && newTierSetting.is_open === false)
    return Response.json({ error: "That service level is currently closed" }, { status: 409 });

  // Slots are counted in cards: the order's cards move into the new tier
  const maxSlots = tierMaxSlots(new_tier, newTierSetting?.max_slots);
  if (maxSlots !== null) {
    let usage: Record<string, number>;
    try {
      usage = await tierSlotUsage(admin, await getSlotsOpenedAt());
    } catch (err) {
      console.error("Tier slot count failed:", err);
      return Response.json({ error: "We couldn't check how many spots are left. Please try again in a moment." }, { status: 503 });
    }
    if ((usage[new_tier] ?? 0) + numCards > maxSlots)
      return Response.json({ error: "No slots available for that service level" }, { status: 409 });
  }

  // Bulk pricing: an order of 10+ cards pays the difference with its bulk percent off
  const bulkPercent = bulkDiscountPercent(numCards);
  const chargeCents = bulkPriceCents(diffCents, bulkPercent);
  const taxCents = Math.round(chargeCents * TAX_RATE);
  const totalUpgradeCents = chargeCents + taxCents;

  const appUrl = siteUrl();

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.customer_email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Upgrade to ${newTier.name} — ${numCards} card${numCards !== 1 ? "s" : ""}${bulkPercent > 0 ? ` (${bulkPercent}% bulk discount)` : ""}` },
            unit_amount: chargeCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Sales Tax (6.625%)" },
            unit_amount: taxCents,
          },
          quantity: 1,
        },
      ],
      // The payment itself names its order, so admin refunds can find it
      payment_intent_data: { metadata: { order_id: order.id, type: "tier_upgrade" } },
      success_url: `${appUrl}/orders/${orderNumber}?upgraded=1`,
      cancel_url: `${appUrl}/orders/${orderNumber}`,
      metadata: {
        type: "tier_upgrade",
        order_id: order.id,
        order_number: orderNumber,
        new_tier,
        upgrade_amount_cents: String(totalUpgradeCents),
        upgrade_subtotal_cents: String(chargeCents),
        // The new tier's per-card price (the admin's), for the order's service line
        new_price_cents: String(newTier.price_cents),
        ...(bulkPercent > 0 ? { bulk_discount_percent: String(bulkPercent) } : {}),
      },
    });
  } catch (err) {
    console.error("Upgrade session creation failed:", err);
    return Response.json({ error: "Payment setup failed. Please try again." }, { status: 500 });
  }

  return Response.json({ url: session.url });
}
