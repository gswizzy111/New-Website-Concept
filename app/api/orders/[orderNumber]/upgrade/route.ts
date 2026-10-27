import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { applyDbOverride, getTierById, UPGRADE_LADDER } from "@/lib/restoration-tiers";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { siteUrl } from "@/lib/site-url";
import { getSlotsOpenedAt } from "@/lib/store-config";
import { tierMaxSlots, tierSlotUsage } from "@/lib/tier-slots";
import { upgradeFee } from "@/lib/upgrade-pricing";
import { hasUnappliedUpgrade } from "@/lib/pending-upgrade";

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

  // An upgrade already paid but not on the order yet: another would charge twice
  // (unknown when Stripe can't be asked in time: the webhook still catches a repeat)
  if ((await hasUnappliedUpgrade(order)) === true)
    return Response.json({ error: "Your last upgrade payment is still being processed. Please try again in a few minutes." }, { status: 409 });

  // The order's cards and what each was charged (refunded cards pay nothing)
  const { data: orderCards, error: cardsError } = await admin
    .from("cards")
    .select("tier, status, service_price_cents")
    .eq("order_id", order.id);
  if (cardsError) {
    console.error("Order cards unavailable:", cardsError.message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

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

  // For each card, the new tier's price (the admin's, today) minus what the
  // card was charged, with the order's bulk percent off (lib/upgrade-pricing.ts)
  const fee = upgradeFee(orderCards ?? [], currentTierId, currentTier.price_cents, newTier.price_cents);
  if (fee.chargeCents <= 0)
    return Response.json({ error: "You can only upgrade to a higher service level" }, { status: 400 });
  const numCards = fee.cardCount;

  if (newTierSetting && newTierSetting.is_open === false)
    return Response.json({ error: "That service level is currently closed" }, { status: 409 });

  // One slot is one order: the order takes a slot in the new tier (it counts
  // in its own tier, never yet in a higher one). Checked against paid orders
  // only, as upgrades always were, placed since the slots opened (lib/tier-slots.ts).
  const maxSlots = tierMaxSlots(new_tier, newTierSetting?.max_slots);
  if (maxSlots !== null) {
    let usage: Record<string, number>;
    try {
      usage = await tierSlotUsage(admin, await getSlotsOpenedAt(), { paidOnly: true });
    } catch (err) {
      console.error("Tier slot count failed:", err);
      return Response.json({ error: "We couldn't check how many spots are left. Please try again in a moment." }, { status: 503 });
    }
    if ((usage[new_tier] ?? 0) + 1 > maxSlots)
      return Response.json({ error: "No slots available for that service level" }, { status: 409 });
  }

  const { bulkPercent, chargeCents, taxCents, totalCents: totalUpgradeCents } = fee;

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
      // The order page opens with the order's email (as add-cards does)
      success_url: `${appUrl}/orders/${orderNumber}?email=${encodeURIComponent(email)}&upgraded=1`,
      cancel_url: `${appUrl}/orders/${orderNumber}?email=${encodeURIComponent(email)}`,
      metadata: {
        type: "tier_upgrade",
        order_id: order.id,
        order_number: orderNumber,
        new_tier,
        // The tier it was priced from, so the webhook can tell if the order moved since
        from_tier: currentTierId,
        upgrade_amount_cents: String(totalUpgradeCents),
        upgrade_subtotal_cents: String(chargeCents),
        // Both tiers' per-card prices (the admin's), for the order's service
        // line and for splitting the upgrade over the cards (lib/upgrade-pricing.ts)
        new_price_cents: String(newTier.price_cents),
        current_price_cents: String(currentTier.price_cents),
        ...(bulkPercent > 0 ? { bulk_discount_percent: String(bulkPercent) } : {}),
      },
    });
  } catch (err) {
    console.error("Upgrade session creation failed:", err);
    return Response.json({ error: "Payment setup failed. Please try again." }, { status: 500 });
  }

  return Response.json({ url: session.url });
}
