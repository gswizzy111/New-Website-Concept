"use client";

import { Check, Trophy } from "lucide-react";
import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { computeOrderTotals, INSTAGRAM_FEATURE_CENTS, MAX_TIP_CENTS, TIP_PRESETS_CENTS } from "@/lib/order-totals";
import type { Service, CardEntry, CustomerInfo, ShippingRate, InsuranceSelection } from "@/lib/types";
import type { RestorationTier, RestorationTierId } from "@/lib/restoration-tiers";
import { INSURANCE_ENABLED } from "@/lib/site-config";
import { InsuranceElectionBox, type InsuranceElection } from "@/components/checkout/insurance-election";
import { Req } from "@/components/checkout/required";
import type { InsuranceType } from "@/lib/types";
import { CHOICE, CHOICE_FOCUS, CHOICE_ON, FORM_PANEL, BLOCK_TITLE, NOTE_OK, STEP_TITLE, TEXT_ACTION } from "@/components/checkout/form-styles";
import { cta } from "@/components/brand";
import { cn } from "@/lib/utils";

const INSURANCE_OPTION_LABELS: Record<Exclude<InsuranceType, "none">, { label: string; sub: string }> = {
  inbound: { label: "Insure the trip to us", sub: "Covers the prepaid label's package from you to The Card Doc" },
  round_trip: { label: "Insure both ways", sub: "Covers the trip to us and the trip back to you" },
  return: { label: "Insure the trip back to you", sub: "Covers the return package from The Card Doc to you" },
};
export const insuranceTypeLabel = (t: InsuranceType) => (t === "round_trip" ? "round trip" : t === "return" ? "return" : "inbound");

interface StepReviewProps {
  services: Service[];
  selectedServiceIds: string[];
  cards: CardEntry[];
  customer: CustomerInfo;
  shippingMethod: "buy_label" | "self_ship" | null;
  selectedRate: ShippingRate | null;
  customerNotes: string;
  onNotesChange: (v: string) => void;
  affiliateCode: string;
  onAffiliateCodeChange: (v: string) => void;
  discountPercent: number;
  onDiscountChange: (pct: number) => void;
  giftCardCode: string;
  onGiftCardCodeChange: (v: string) => void;
  giftCardAmountCents: number;
  onGiftCardAmountChange: (cents: number) => void;
  instagramFeature: boolean;
  onInstagramFeatureChange: (v: boolean) => void;
  /** The optional tip (as on the old site) */
  tipCents: number;
  onTipCentsChange: (cents: number) => void;
  onEditStep: (step: number) => void;
  selectedTier?: RestorationTierId;
  /** The tiers with the admin's names and prices (lib/live-tiers.ts) */
  tiers?: RestorationTier[];
  /** The slab authorizations, permissions, e-sign consent and master signature (components/checkout/signing-section.tsx) */
  signingSlot?: React.ReactNode;
  /** The customer pressed sign with something missing: outline it in red */
  showMissing?: boolean;
  insuranceElection: InsuranceElection;
  onInsuranceElectionChange: (e: Exclude<InsuranceElection, null>) => void;
  insurance: InsuranceSelection;
  onInsuranceChange: (ins: InsuranceSelection) => void;
  addSignatureConfirmation: boolean;
  onSignatureConfirmationChange: (v: boolean) => void;
  loyaltyDiscountPercent: number;
  onLoyaltyDiscountChange: (pct: number) => void;
}

export function StepReview({
  cards,
  customer,
  shippingMethod,
  selectedRate,
  customerNotes,
  onNotesChange,
  affiliateCode,
  onAffiliateCodeChange,
  discountPercent,
  onDiscountChange,
  giftCardCode,
  onGiftCardCodeChange,
  giftCardAmountCents,
  onGiftCardAmountChange,
  instagramFeature,
  onInstagramFeatureChange,
  tipCents,
  onTipCentsChange,
  onEditStep,
  selectedTier,
  tiers,
  insurance,
  signingSlot,
  showMissing = false,
  insuranceElection,
  onInsuranceElectionChange,
  onInsuranceChange,
  addSignatureConfirmation,
  onSignatureConfirmationChange,
  loyaltyDiscountPercent,
  onLoyaltyDiscountChange,
}: StepReviewProps) {
  const [codeStatus, setCodeStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [codeName, setCodeName] = useState("");
  const [gcStatus, setGcStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [insuranceQuote, setInsuranceQuote] = useState<{ customerChargeCents: number; roundTripChargeCents: number } | null>(null);
  const [quotingInsurance, setQuotingInsurance] = useState(false);
  const [insuranceDollars, setInsuranceDollars] = useState(
    insurance.declaredValueCents > 0 ? String(insurance.declaredValueCents / 100) : ""
  );
  // What the customer typed as a custom tip (kept as typed, so "50" can be entered)
  const [customTip, setCustomTip] = useState(
    tipCents > 0 && !TIP_PRESETS_CENTS.includes(tipCents) ? String(tipCents / 100) : ""
  );

  // Auto-detect loyalty discount when review step loads
  useEffect(() => {
    if (!customer.email) return;
    // POST: the email stays out of the URL
    fetch("/api/loyalty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: customer.email }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.discountPercent > 0) onLoyaltyDiscountChange(data.discountPercent);
      })
      .catch(() => {});
  }, [customer.email]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchInsuranceQuote(declaredValueCents: number) {
    if (declaredValueCents < 100) { setInsuranceQuote(null); return; }
    setQuotingInsurance(true);
    try {
      const res = await fetch(`/api/insurance/quote?declared_value_cents=${declaredValueCents}`);
      const data = await res.json();
      if (res.ok) {
        setInsuranceQuote({ customerChargeCents: data.customerChargeCents, roundTripChargeCents: data.roundTripChargeCents });
        if (insurance.type !== "none" && insuranceOptions.includes(insurance.type)) {
          const charge = insurance.type === "round_trip" ? data.roundTripChargeCents : data.customerChargeCents;
          onInsuranceChange({ ...insurance, declaredValueCents, chargeCents: charge });
        } else {
          onInsuranceChange({ declaredValueCents, type: "none", chargeCents: 0 });
        }
      }
    } finally {
      setQuotingInsurance(false);
    }
  }

  function handleDeclaredValueBlur() {
    const raw = insuranceDollars.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(raw);
    if (!raw || isNaN(dollars) || dollars < 1) {
      setInsuranceDollars("");
      onInsuranceChange({ declaredValueCents: 0, type: "none", chargeCents: 0 });
      setInsuranceQuote(null);
      return;
    }
    const clamped = Math.min(Math.floor(dollars), 10000);
    if (clamped < 1) {
      setInsuranceDollars("");
      onInsuranceChange({ declaredValueCents: 0, type: "none", chargeCents: 0 });
      setInsuranceQuote(null);
      return;
    }
    setInsuranceDollars(String(clamped));
    fetchInsuranceQuote(clamped * 100);
  }

  function handleInsuranceTypeChange(type: InsuranceType) {
    if (type === "none") {
      onInsuranceChange({ declaredValueCents: insurance.declaredValueCents, type: "none", chargeCents: 0 });
    } else if (insuranceQuote) {
      const charge = type === "round_trip" ? insuranceQuote.roundTripChargeCents : insuranceQuote.customerChargeCents;
      onInsuranceChange({ ...insurance, type, chargeCents: charge });
    } else {
      onInsuranceChange({ ...insurance, type, chargeCents: 0 });
    }
  }

  async function validateCode() {
    const trimmed = affiliateCode.trim().toUpperCase();
    if (!trimmed) return;
    const res = await fetch(`/api/affiliates/validate?code=${encodeURIComponent(trimmed)}`);
    const data = await res.json();
    if (res.ok && data.ok) {
      setCodeStatus("valid");
      setCodeName(data.name);
      onDiscountChange(data.discount_percent ?? 0);
    } else {
      setCodeStatus("invalid");
      setCodeName("");
      onDiscountChange(0);
    }
  }

  async function validateGiftCard() {
    const trimmed = giftCardCode.trim().toUpperCase();
    if (!trimmed) return;
    const res = await fetch(`/api/gift-cards/validate?code=${encodeURIComponent(trimmed)}`);
    const data = await res.json();
    if (res.ok && data.ok) {
      setGcStatus("valid");
      onGiftCardAmountChange(data.remaining_cents);
    } else {
      setGcStatus("invalid");
      onGiftCardAmountChange(0);
    }
  }

  // We can only insure the trip to us when we buy that label
  const insuranceOptions: Exclude<InsuranceType, "none">[] = shippingMethod === "buy_label" ? ["inbound", "round_trip"] : ["return"];

  const effectiveDiscountPct = Math.max(discountPercent, loyaltyDiscountPercent);
  const totals = computeOrderTotals({
    cards,
    selectedTier,
    tiers,
    shippingMethod,
    selectedRate,
    discountPercent: effectiveDiscountPct,
    insuranceCents: INSURANCE_ENABLED ? insurance.chargeCents : 0,
    addSignatureConfirmation,
    instagramFeature,
    giftCardAmountCents,
    tipCents,
  });
  // The totals themselves (with any tip) are in the order summary beside this step
  const { discountKind, discountPercentApplied, bulkPercent } = totals;
  const gcApplied = totals.giftCardCents;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className={STEP_TITLE}>Review your order.</h2>
      </div>

      {/* Bulk discount banner (it replaces a smaller code or loyalty discount) */}
      {discountKind === "bulk" && (
        <div className={`${NOTE_OK} flex items-center gap-3.5 p-4`}>
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-white"><Trophy className="size-5" strokeWidth={1.75} /></span>
          <div>
            <p className="text-[15px] font-bold text-ink">{discountPercentApplied}% bulk discount applied!</p>
            <p className="mt-0.5 text-xs text-ink-soft">
              {cards.length} cards: {discountPercentApplied}% off the per-card price{cards.some((c) => (c.tier ?? selectedTier) === "elite") ? " (Diamond cards excluded)" : ""}.
            </p>
          </div>
        </div>
      )}

      {/* Shipping */}
      <div className={`${FORM_PANEL} flex flex-col gap-2`}>
        <div className="flex items-center justify-between">
          <h3 className={`${BLOCK_TITLE} text-[1.375rem] md:text-[1.5rem]`}>Shipping</h3>
          <button
            type="button"
            onClick={() => onEditStep(4)}
            className={TEXT_ACTION}
          >
            Edit
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {shippingMethod === "buy_label"
            ? selectedRate
              ? `Prepaid label — ${selectedRate.carrier} ${selectedRate.service_level} — ${formatCurrency(selectedRate.amount_cents)}`
              : "Prepaid label"
            : `Self-ship — you'll receive our address after checkout${selectedRate ? `. Return shipping: ${selectedRate.carrier} ${selectedRate.service_level}, ${formatCurrency(selectedRate.amount_cents)}` : ""}`}
        </p>
      </div>

      {/* Signature confirmation add-on */}
      {shippingMethod === "buy_label" && (
        <div className={cn("p-4 sm:p-5", CHOICE, CHOICE_FOCUS, addSignatureConfirmation && CHOICE_ON)}>
          <label className="flex cursor-pointer items-start gap-3.5 select-none">
            <input
              type="checkbox"
              checked={addSignatureConfirmation}
              onChange={(e) => onSignatureConfirmationChange(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <div>
              <p className="text-[15px] font-semibold text-ink">
                Add signature confirmation on delivery{" "}
                <span className="font-bold text-cobalt-deep">+$5.00</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Requires someone to sign for the package when delivered to you. Adds an extra layer of security for high-value cards.
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Shipping insurance: a required choice, buy or decline (Terms 15.2, 15.4) */}
      {INSURANCE_ENABLED && (
        <div className={FORM_PANEL}>
        <InsuranceElectionBox
          election={insuranceElection}
          onElection={onInsuranceElectionChange}
          showMissing={showMissing}
          purchaseMissing={!(insurance.declaredValueCents > 0 && insurance.type !== "none")}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-ink" htmlFor="insurance-amount">Amount to insure<Req /></label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                id="insurance-amount"
                type="number"
                min={1}
                max={10000}
                step={1}
                value={insuranceDollars}
                onChange={(e) => setInsuranceDollars(e.target.value)}
                onBlur={handleDeclaredValueBlur}
                placeholder="e.g. 500"
                className="h-11 w-40 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
              />
              {quotingInsurance && <span className="text-xs text-muted-foreground">Getting rate...</span>}
            </div>
            <p className="text-xs text-muted-foreground">The value of the cards in the package ($1 to $10,000)</p>
          </div>

          {insuranceQuote && insurance.declaredValueCents > 0 && (
            <div className="flex flex-col gap-2">
              {insuranceOptions.map((type) => {
                const { label, sub } = INSURANCE_OPTION_LABELS[type];
                const price = type === "round_trip" ? insuranceQuote.roundTripChargeCents : insuranceQuote.customerChargeCents;
                return (
                  <label key={type} className={cn("flex cursor-pointer items-start gap-3 p-3.5", CHOICE, CHOICE_FOCUS, insurance.type === type && CHOICE_ON)}>
                    <input
                      type="radio"
                      name="insurance-type"
                      checked={insurance.type === type}
                      onChange={() => handleInsuranceTypeChange(type)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-bold text-ink">{label}</span>
                      <span className="ml-2 text-sm font-bold text-cobalt-deep">{formatCurrency(price)}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {!insuranceQuote && insurance.declaredValueCents === 0 && (
            <p className="text-xs text-muted-foreground italic">Enter the amount to insure to see the price.</p>
          )}
        </InsuranceElectionBox>
        </div>
      )}

      {/* Instagram Feature Add-on */}
      <div className={cn("p-5 sm:p-6", CHOICE, CHOICE_FOCUS, instagramFeature && CHOICE_ON)}>
        <label className="flex cursor-pointer items-start gap-4 select-none">
          <input
            type="checkbox"
            checked={instagramFeature}
            onChange={(e) => onInstagramFeatureChange(e.target.checked)}
            className="mt-1 shrink-0"
          />
          <div>
            <p className="font-heading text-[1.5rem] leading-[1.05] font-extrabold text-ink">
              Feature my card in an Instagram video{" "}
              <span className="text-cobalt-deep">+{formatCurrency(INSTAGRAM_FEATURE_CENTS)}</span>
            </p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              We&apos;ll film your card being restored and post it to{" "}
              <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className="font-semibold text-cobalt underline-offset-2 hover:underline">@the_card_doc</a>.
              Perfect for rare or high-value cards.
            </p>
          </div>
        </label>
      </div>

      {/* Tip */}
      <div className={FORM_PANEL}>
        <p className="mb-1.5 font-heading text-[1.5rem] leading-none font-extrabold text-ink">Add a tip <span className="font-sans text-sm font-semibold normal-case tracking-normal text-ink-soft">(optional)</span></p>
        <p className="text-sm text-muted-foreground mb-3">100% goes to the technician working on your cards. Thank you!</p>
        <div className="mb-4 flex flex-wrap gap-2.5">
          {[0, ...TIP_PRESETS_CENTS].map((cents) => (
            <button
              key={cents}
              type="button"
              aria-pressed={tipCents === cents}
              onClick={() => {
                setCustomTip("");
                onTipCentsChange(cents);
              }}
              className={cn(
                "min-h-11 rounded-full px-4 text-[15px] font-bold tabular-nums transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt",
                tipCents === cents
                  ? "bg-ink text-white"
                  : "bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--ink-soft)]"
              )}
            >
              {cents === 0 ? "No tip" : formatCurrency(cents)}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs">
          <span className="absolute left-3.5 top-1/2 z-[1] -translate-y-1/2 text-sm font-semibold text-ink-soft">$</span>
          <input
            type="number"
            min={0}
            max={MAX_TIP_CENTS / 100}
            step={1}
            inputMode="decimal"
            placeholder="Custom amount"
            aria-label="Custom tip amount"
            value={customTip}
            onChange={(e) => {
              const v = Math.round((parseFloat(e.target.value) || 0) * 100);
              // Up to $500, as on the old site
              setCustomTip(v > MAX_TIP_CENTS ? String(MAX_TIP_CENTS / 100) : e.target.value);
              onTipCentsChange(Math.min(Math.max(v, 0), MAX_TIP_CENTS));
            }}
            className="h-11 w-full rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px] pl-7"
          />
        </div>
      </div>

      <div className={`${FORM_PANEL} flex flex-col gap-7`}>
      {/* Notes */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-notes">Anything else we should know? (optional)</Label>
        <Textarea
          id="customer-notes"
          value={customerNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="Special instructions, packaging preferences, etc."
        />
      </div>

      {/* Affiliate / creator code */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="affiliate-code">Creator or coupon code <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <div className="flex gap-3">
          <input
            id="affiliate-code"
            type="text"
            value={affiliateCode}
            onChange={(e) => {
              onAffiliateCodeChange(e.target.value.toUpperCase());
              setCodeStatus("idle");
              setCodeName("");
              onDiscountChange(0);
            }}
            placeholder="CREATOR123"
            className="h-11 min-w-0 flex-1 font-mono uppercase rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
          />
          <button
            type="button"
            onClick={validateCode}
            disabled={!affiliateCode.trim()}
            className={cta({ tone: "outline", size: "sm", className: "shrink-0 px-5" })}
          >
            Apply
          </button>
        </div>
        {codeStatus === "valid" && discountPercent > 0 && discountKind !== "bulk" && (
          <p className="text-sm font-semibold text-success"><Check className="inline h-3.5 w-3.5 mr-1 -mt-0.5" strokeWidth={2.5} />{discountPercent}% discount applied — {codeName}</p>
        )}
        {codeStatus === "valid" && discountPercent > 0 && discountKind === "bulk" && (
          <p className="text-sm text-muted-foreground">Your {bulkPercent}% bulk discount is bigger, so it applies instead of this code (discounts don&apos;t combine).</p>
        )}
        {codeStatus === "valid" && discountPercent === 0 && (
          <p className="text-sm font-semibold text-success"><Check className="inline h-3.5 w-3.5 mr-1 -mt-0.5" strokeWidth={2.5} />Code applied — {codeName}</p>
        )}
        {codeStatus === "invalid" && <p className="text-sm text-destructive">Invalid code.</p>}
      </div>

      {/* Gift card */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="gift-card-code">Gift card code <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <div className="flex gap-3">
          <input
            id="gift-card-code"
            type="text"
            value={giftCardCode}
            onChange={(e) => {
              onGiftCardCodeChange(e.target.value.toUpperCase());
              setGcStatus("idle");
              onGiftCardAmountChange(0);
            }}
            placeholder="GIFT-XXXX-XXXX"
            className="h-11 min-w-0 flex-1 font-mono uppercase rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
          />
          <button
            type="button"
            onClick={validateGiftCard}
            disabled={!giftCardCode.trim()}
            className={cta({ tone: "outline", size: "sm", className: "shrink-0 px-5" })}
          >
            Apply
          </button>
        </div>
        {gcStatus === "valid" && gcApplied > 0 && (
          <p className="text-sm font-semibold text-success"><Check className="inline h-3.5 w-3.5 mr-1 -mt-0.5" strokeWidth={2.5} />Gift card applied — {formatCurrency(gcApplied)} off</p>
        )}
        {gcStatus === "invalid" && <p className="text-sm text-destructive">Invalid or already used gift card.</p>}
      </div>

      </div>

      {signingSlot}
    </div>
  );
}
