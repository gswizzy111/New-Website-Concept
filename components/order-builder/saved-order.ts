"use client";

import { useEffect } from "react";
import type { CardEntry, CustomerInfo, InsuranceSelection, ShippingRate } from "@/lib/types";
import type { InsuranceElection } from "@/components/checkout/insurance-election";
import type { RestorationTierId } from "@/lib/restoration-tiers";

/**
 * The restoration order builder's answers, kept in this tab (sessionStorage)
 * so "Return to Order Builder" on /checkout/cancel brings them back. Never the
 * signatures, consents or signing checkboxes: those are given again each time.
 * Cleared once an order is placed (/checkout/success).
 */
export interface SavedOrder {
  v: 1;
  /** The builder's ?tier= when this was saved; restored only on the same one */
  selectedTier: RestorationTierId | null;
  step: number;
  cards: CardEntry[];
  customer: CustomerInfo;
  shippingMethod: "buy_label" | "self_ship" | null;
  selectedRate: ShippingRate | null;
  customerNotes: string;
  affiliateCode: string;
  discountPercent: number;
  giftCardCode: string;
  giftCardAmountCents: number;
  tipCents: number;
  insuranceElection: InsuranceElection;
  insurance: InsuranceSelection;
  addSignatureConfirmation: boolean;
}

const KEY = "carddoc:order-builder:v1";

/** The saved builder answers, or null (none, unreadable, or storage blocked). */
export function loadSavedOrder(): SavedOrder | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedOrder;
    if (saved?.v !== 1 || !Array.isArray(saved.cards) || saved.cards.length === 0 || !saved.customer) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveOrder(saved: SavedOrder): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the builder still works, it just isn't kept
  }
}

export function clearSavedOrder(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear
  }
}

/** Where "Return to Order Builder" goes: the builder on the saved tier. */
export function savedOrderHref(): string {
  const tier = loadSavedOrder()?.selectedTier;
  return tier ? `/order?tier=${encodeURIComponent(tier)}` : "/order";
}

/** Rendered on the checkout success page: the order is placed, forget the answers. */
export function ClearSavedOrder(): null {
  useEffect(() => clearSavedOrder(), []);
  return null;
}
