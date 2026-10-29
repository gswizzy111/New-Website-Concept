import { getTierById, getCardPriceCents } from "@/lib/restoration-tiers";
import { SIGNATURE_FEE_CENTS } from "@/lib/site-config";
import { bulkDiscountPercent, isBulkEligible } from "@/lib/bulk-pricing";
import type { CardEntry, ShippingRate } from "@/lib/types";
import type { RestorationTier, RestorationTierId } from "@/lib/restoration-tiers";

// Add-on prices. Must match what app/api/checkout/route.ts charges.
export const SLAB_CRACK_CENTS = 700;
export const PREGRADE_CENTS = 2500;
export const INSTAGRAM_FEATURE_CENTS = 25000;
export const TAX_RATE = 0.06625;

/** The optional tip at checkout: preset amounts and the most it can be (as on the old site). */
export const TIP_PRESETS_CENTS = [500, 1000, 2000, 5000];
export const MAX_TIP_CENTS = 50000;

/** Stripe can't charge less than this. */
export const STRIPE_MIN_CHARGE_CENTS = 50;

/**
 * What a gift card takes off an order: `wantedCents` (its balance, capped at
 * what it may cover), except that Stripe can't charge 1-49 cents, so when the
 * card would leave that little to pay it takes less and leaves 50 cents (the
 * rest stays on the card). An order it covers in full costs $0. `dueCents` is
 * the order total before the gift card. The checkout routes and the database
 * (hold_gift_card, supabase/migrations/20261027_checkout.sql) use the same rule.
 */
export function giftCardCents(wantedCents: number, dueCents: number): number {
  const wanted = Math.max(0, wantedCents);
  const left = dueCents - wanted;
  if (left > 0 && left < STRIPE_MIN_CHARGE_CENTS) return Math.max(0, dueCents - STRIPE_MIN_CHARGE_CENTS);
  return wanted;
}

interface OrderTotalsInput {
  cards: CardEntry[];
  selectedTier?: RestorationTierId;
  /** The tiers with the admin's prices (lib/live-tiers.ts); missing: the defaults */
  tiers?: RestorationTier[];
  shippingMethod: "buy_label" | "self_ship" | null;
  selectedRate: ShippingRate | null;
  discountPercent: number; // the higher of the affiliate and loyalty discounts
  insuranceCents: number;
  addSignatureConfirmation: boolean;
  instagramFeature: boolean;
  giftCardAmountCents: number;
  tipCents?: number;
}

/** A tier with the admin's prices when they're known, else its defaults. */
export function tierFor(id: RestorationTierId, tiers?: RestorationTier[]): RestorationTier | undefined {
  return tiers?.find((t) => t.id === id) ?? getTierById(id);
}

// One calculation for the order builder's sidebar and review step, following
// the checkout route so both show what Stripe will actually charge.
export function computeOrderTotals(input: OrderTotalsInput) {
  const { cards, selectedTier } = input;

  // Every card needs a tier (the checkout refuses a card without one)
  let subtotal = 0;
  let bulkBase = 0; // the per-card prices the bulk discount applies to (not Diamond)
  for (const card of cards) {
    const tierId = card.tier ?? selectedTier;
    const tier = tierId ? tierFor(tierId, input.tiers) : undefined;
    if (!tierId || !tier) continue;
    const valueCents = card.estimated_value
      ? Math.round(parseFloat(card.estimated_value.replace(/[$,]/g, "")) * 100) || 0
      : 0;
    const price = getCardPriceCents(tier, valueCents);
    subtotal += price;
    if (isBulkEligible(tierId)) bulkBase += price;
  }

  // Codes and bulk pricing don't stack: the biggest discount applies (as at checkout)
  const codeDiscountCents = input.discountPercent > 0 ? Math.round(subtotal * input.discountPercent / 100) : 0;
  const bulkPercent = bulkDiscountPercent(cards.length);
  const bulkDiscountCents = bulkPercent > 0 ? Math.round(bulkBase * bulkPercent / 100) : 0;
  const bulkWins = bulkDiscountCents > codeDiscountCents;
  const discountCents = bulkWins ? bulkDiscountCents : codeDiscountCents;
  const discountKind: "bulk" | "code" | null = discountCents === 0 ? null : bulkWins ? "bulk" : "code";
  const discountPercentApplied = bulkWins ? bulkPercent : input.discountPercent;
  const taxCents = Math.round((subtotal - discountCents) * TAX_RATE);
  // The prepaid label (to us and back), or the trip back for self-ship
  const shippingCents = input.shippingMethod && input.selectedRate ? input.selectedRate.amount_cents : 0;
  const signatureCents = input.addSignatureConfirmation && input.shippingMethod === "buy_label" ? SIGNATURE_FEE_CENTS : 0;
  const slabCrackCount = cards.filter((c) => c.needs_slab_crack).length;
  const slabCrackCents = slabCrackCount * SLAB_CRACK_CENTS;
  const pregradeCount = cards.filter((c) => c.needs_pregrade).length;
  const pregradeCents = pregradeCount * PREGRADE_CENTS;
  const instagramCents = input.instagramFeature ? INSTAGRAM_FEATURE_CENTS : 0;
  const tipCents = Math.min(Math.max(0, Math.round(input.tipCents ?? 0)), MAX_TIP_CENTS);

  // The checkout route caps a gift card at the total before the Instagram
  // feature, the signature fee and the tip, and leaves Stripe at least 50 cents.
  const giftCardCap = subtotal - discountCents + taxCents + shippingCents + input.insuranceCents + slabCrackCents + pregradeCents;
  const beforeGiftCard = giftCardCap + instagramCents + signatureCents + tipCents;
  const giftCardCents = giftCardCentsFor(input.giftCardAmountCents, giftCardCap, beforeGiftCard);

  const total = Math.max(0, beforeGiftCard - giftCardCents);

  return {
    subtotal,
    discountCents,
    discountKind,
    discountPercentApplied,
    bulkPercent,
    taxCents,
    shippingCents,
    signatureCents,
    insuranceCents: input.insuranceCents,
    slabCrackCount,
    slabCrackCents,
    pregradeCount,
    pregradeCents,
    instagramCents,
    tipCents,
    giftCardCents,
    total,
  };
}

function giftCardCentsFor(balanceCents: number, capCents: number, dueCents: number): number {
  if (balanceCents <= 0) return 0;
  return giftCardCents(Math.min(balanceCents, Math.max(0, capCents)), dueCents);
}
