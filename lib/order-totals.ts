import { getTierById, getCardPriceCents } from "@/lib/restoration-tiers";
import { getPriceCents } from "@/lib/pricing";
import { SIGNATURE_FEE_CENTS } from "@/lib/site-config";
import { bulkDiscountPercent, isBulkEligible } from "@/lib/bulk-pricing";
import type { CardEntry, ShippingRate } from "@/lib/types";
import type { RestorationTierId } from "@/lib/restoration-tiers";

// Add-on prices. Must match what app/api/checkout/route.ts charges.
export const SLAB_CRACK_CENTS = 700;
export const PREGRADE_CENTS = 2500;
export const INSTAGRAM_FEATURE_CENTS = 25000;
export const TAX_RATE = 0.06625;

interface OrderTotalsInput {
  cards: CardEntry[];
  selectedTier?: RestorationTierId;
  shippingMethod: "buy_label" | "self_ship" | null;
  selectedRate: ShippingRate | null;
  discountPercent: number; // the higher of the affiliate and loyalty discounts
  insuranceCents: number;
  addSignatureConfirmation: boolean;
  instagramFeature: boolean;
  giftCardAmountCents: number;
}

// One calculation for the order builder's sidebar and review step, following
// the checkout route so both show what Stripe will actually charge.
export function computeOrderTotals(input: OrderTotalsInput) {
  const { cards, selectedTier } = input;

  let subtotal = 0;
  let bulkBase = 0; // the per-card prices the bulk discount applies to (not Diamond)
  for (const card of cards) {
    const tierId = card.tier ?? selectedTier;
    if (!tierId) {
      subtotal = getPriceCents(cards.length);
      bulkBase = 0;
      break;
    }
    const valueCents = card.estimated_value
      ? Math.round(parseFloat(card.estimated_value.replace(/[$,]/g, "")) * 100) || 0
      : 0;
    const price = getCardPriceCents(getTierById(tierId), valueCents);
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
  const shippingCents = input.shippingMethod === "buy_label" && input.selectedRate ? input.selectedRate.amount_cents : 0;
  const signatureCents = input.addSignatureConfirmation && input.shippingMethod === "buy_label" ? SIGNATURE_FEE_CENTS : 0;
  const slabCrackCount = cards.filter((c) => c.needs_slab_crack).length;
  const slabCrackCents = slabCrackCount * SLAB_CRACK_CENTS;
  const pregradeCount = cards.filter((c) => c.needs_pregrade).length;
  const pregradeCents = pregradeCount * PREGRADE_CENTS;
  const instagramCents = input.instagramFeature ? INSTAGRAM_FEATURE_CENTS : 0;

  // The checkout route caps a gift card at the total before the Instagram
  // feature and signature fee.
  const giftCardCap = subtotal - discountCents + taxCents + shippingCents + input.insuranceCents + slabCrackCents + pregradeCents;
  const giftCardCents = Math.min(input.giftCardAmountCents, Math.max(0, giftCardCap));

  const total = Math.max(
    0,
    giftCardCap + instagramCents + signatureCents - giftCardCents
  );

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
    giftCardCents,
    total,
  };
}
