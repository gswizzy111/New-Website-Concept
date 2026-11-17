"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Copy, Gem } from "lucide-react";
import { useAccountPrefill } from "@/lib/use-account-prefill";
import { useState, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProgressIndicator } from "./progress-indicator";
import { OrderSummary } from "./order-summary";
import { StepCards } from "./step-cards";
import { StepCustomer } from "./step-customer";
import { StepShipping } from "./step-shipping";
import { YourInformation } from "./your-information";
import { StepReview } from "./step-review";
import { SigningSection, emptySigning, signingReady, slabSigned, submittedSigning, type SigningState, type SlabCard } from "@/components/checkout/signing-section";
import { SlabAuthorizationDialog } from "@/components/checkout/slab-authorization-dialog";
import { MissingNote, Need, revealMissing } from "@/components/checkout/required";
import { emptyIdentity, identityPayload } from "@/components/checkout/card-identity-fields";
import type { InsuranceElection } from "@/components/checkout/insurance-election";
import { SIGN_BUTTON_LABEL } from "@/lib/legal/current-terms";
import { cardProblems } from "./step-cards";
import type { Service, CardEntry, CustomerInfo, ShippingRate, InsuranceSelection } from "@/lib/types";
import type { RestorationTier, RestorationTierId } from "@/lib/restoration-tiers";
import { fbq } from "@/lib/pixel";
import { INSET, NOTE_SUN } from "@/components/checkout/form-styles";

function defaultCard(serviceId: string, tier?: RestorationTierId): CardEntry {
  return {
    id: crypto.randomUUID(),
    card_name: "",
    ...emptyIdentity(),
    estimated_value: "",
    notes: "",
    photo_urls: [],
    service_ids: [serviceId],
    tier,
  };
}

function emptyCustomer(): CustomerInfo {
  return { name: "", email: "", phone: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US" };
}

const noSubscription = () => () => {};

function InAppBrowserBanner() {
  // Read in the browser only (the server render shows nothing)
  const show = useSyncExternalStore(
    noSubscription,
    () => /Instagram|FBAN|FBAV|FB_IAB|Twitter|TikTok/i.test(navigator.userAgent),
    () => false,
  );
  if (!show) return null;
  return (
    <div className="mb-8 rounded-[18px] bg-white p-5 text-sm text-ink shadow-[inset_6px_0_0_var(--danger),0_0_0_1px_var(--line),var(--panel-shadow)]">
      <p className="mb-2 flex items-center gap-2 font-heading text-[1.5rem] leading-tight font-extrabold text-destructive"><AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={2.25} />You must open this in Safari or Chrome</p>
      <p className="mb-3 leading-relaxed text-ink">
        Instagram&apos;s built-in browser <strong>blocks photo uploads and payments</strong>. You won&apos;t be able to complete your order here.
      </p>
      <p className="font-bold text-ink">
        Tap the <strong>···</strong> menu (top right) → <strong>&quot;Open in browser&quot;</strong>
      </p>
    </div>
  );
}

// Steps: 1=Cards, 2=Customer, 3=Shipping, 4=Review
// `tiers` carry the admin's names and prices (lib/live-tiers.ts, loaded by builder.tsx)
export function OrderBuilderClient({ services, selectedTier, tiers }: { services: Service[]; selectedTier?: RestorationTierId; tiers: RestorationTier[] }) {
  const service = services[0];
  const serviceId = service?.id ?? "";

  const [step, setStep] = useState(1);
  const [cards, setCards] = useState<CardEntry[]>([defaultCard(serviceId, selectedTier)]);
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer());
  // Signed in: fill the customer step from the account (only empty fields)
  useAccountPrefill((p) => setCustomer((c) => ({
    ...c,
    name: c.name || p.name,
    email: c.email || p.email,
    phone: c.phone || p.phone,
    ...(!c.street1 && p.address ? { street1: p.address.street1, street2: p.address.street2, city: p.address.city, state: p.address.state, zip: p.address.zip } : {}),
  })));
  const [shippingMethod, setShippingMethod] = useState<"buy_label" | "self_ship" | null>(null);
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null);
  const [customerNotes, setCustomerNotes] = useState("");
  const [affiliateCode, setAffiliateCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [loyaltyDiscountPercent, setLoyaltyDiscountPercent] = useState(0);
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardAmountCents, setGiftCardAmountCents] = useState(0);
  const [instagramFeature, setInstagramFeature] = useState(false);
  // The optional tip on the review step (as on the old site)
  const [tipCents, setTipCents] = useState(0);
  // The signatures and consents for the Terms of Service v1.0 (components/checkout/signing-section.tsx)
  const [signing, setSigning] = useState<SigningState>(emptySigning());
  // The card whose slab authorization pop-up is open
  const [slabDialogId, setSlabDialogId] = useState<string | null>(null);
  // Pressed Continue / sign with something missing: outline it in red
  const [showMissing, setShowMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [insuranceElection, setInsuranceElection] = useState<InsuranceElection>(null);
  const [insurance, setInsurance] = useState<InsuranceSelection>({ declaredValueCents: 0, type: "none", chargeCents: 0 });
  const [addSignatureConfirmation, setAddSignatureConfirmation] = useState(false);
  const [checkoutError, setCheckoutError] = useState<{ message: string; ref: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const DIAMOND_MIN_CENTS = 500_000; // $5,000

  function totalEstimatedValueCents(): number {
    return cards.reduce((sum, c) => {
      const v = c.estimated_value ? Math.round(parseFloat(c.estimated_value.replace(/[$,]/g, "")) * 100) : 0;
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }

  const cardValueCents = (c: CardEntry) => {
    const v = c.estimated_value ? Math.round(parseFloat(c.estimated_value.replace(/[$,]/g, "")) * 100) : 0;
    return isNaN(v) ? 0 : v;
  };
  const slabCardOf = (c: CardEntry, i: number): SlabCard => ({
    index: i,
    id: c.id,
    details: { card_name: c.card_name.trim(), ...identityPayload(c), declared_value_cents: cardValueCents(c) },
  });
  const slabCards: SlabCard[] = cards.flatMap((c, i) => (c.needs_slab_crack ? [slabCardOf(c, i)] : []));
  const slabDialogIndex = cards.findIndex((c) => c.id === slabDialogId);
  const slabDialogCard = slabDialogIndex >= 0 ? slabCardOf(cards[slabDialogIndex], slabDialogIndex) : null;
  const insuranceOk = insuranceElection === "declined"
    || (insuranceElection === "purchased" && insurance.declaredValueCents > 0 && insurance.type !== "none");
  const readyToSign = signingReady(signing, slabCards) && insuranceOk;

  // The paid Instagram feature needs the photo permission, and goes when it's unchecked
  function changeInstagramFeature(v: boolean) {
    setInstagramFeature(v);
    if (v) setSigning((s) => ({ ...s, media: true }));
  }
  function changeSigning(next: SigningState) {
    setSigning(next);
    if (!next.media && instagramFeature) setInstagramFeature(false);
  }
  // Picking slab cracking opens its authorization; closing it unsigned takes the slab off
  function closeSlabDialog(signed: boolean) {
    if (!signed && slabDialogId) setCards((cs) => cs.map((c) => (c.id === slabDialogId ? { ...c, needs_slab_crack: false } : c)));
    setSlabDialogId(null);
  }
  // A ticked slab whose card changed after signing pops its authorization up again
  function openUnsignedSlab(): boolean {
    const unsigned = slabCards.find((c) => !slabSigned(signing, c));
    if (!unsigned) return false;
    setSlabDialogId(cards[unsigned.index]?.id ?? null);
    return true;
  }
  function changeInsuranceElection(e: Exclude<InsuranceElection, null>) {
    setInsuranceElection(e);
    if (e === "declined") setInsurance((ins) => ({ ...ins, type: "none", chargeCents: 0 }));
  }

  const isDiamondOrder = selectedTier === "elite" || cards.some((c) => c.tier === "elite");
  const diamondValueOk = !isDiamondOrder || totalEstimatedValueCents() >= DIAMOND_MIN_CENTS;

  function canAdvance(): boolean {
    if (step === 1) {
      return cards.every((c) => cardProblems(c, selectedTier, tiers).length === 0) && diamondValueOk;
    }
    if (step === 2) {
      const c = customer;
      const isUS = !c.country || c.country === "US";
      if (isUS) return !!(c.name && c.email && c.phone && c.street1 && c.city && c.state && c.zip);
      return !!(c.name && c.email && c.phone && c.street1 && c.city && c.country);
    }
    if (step === 3) {
      // Both ways need a rate: the prepaid label's, or the trip back for self-ship
      return !!shippingMethod && !!selectedRate;
    }
    return true;
  }

  function goToStep(n: number) {
    setShowMissing(false);
    setStep(n);
  }
  function tryContinue() {
    if (step === 1 && openUnsignedSlab()) return;
    if (canAdvance()) return goToStep(step + 1);
    setShowMissing(true);
    revealMissing();
  }
  function trySign() {
    if (openUnsignedSlab()) return;
    if (readyToSign) {
      setShowMissing(false);
      return handleSubmit();
    }
    setShowMissing(true);
    revealMissing();
  }

  async function handleSubmit() {
    fbq("track", "InitiateCheckout", { num_items: cards.length, currency: "USD" });
    setSubmitting(true);
    setCheckoutError(null);
    try {
      // Determine if all cards share one tier or have mixed tiers
      const tiers = cards.map((c) => c.tier ?? selectedTier);
      const uniqueTiers = [...new Set(tiers.filter(Boolean))];
      const singleTier = uniqueTiers.length === 1 ? uniqueTiers[0] : undefined;

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(singleTier
            ? { restoration_tier: singleTier }
            : { services: [{ id: serviceId, quantity: cards.length }] }),
          cards: cards.map((c) => ({
            card_name: c.card_name,
            ...identityPayload(c),
            estimated_value_cents: cardValueCents(c),
            notes: c.notes || undefined,
            photo_urls: c.photo_urls,
            service_ids: [serviceId],
            tier: c.tier ?? selectedTier,
            needs_slab_crack: c.needs_slab_crack || undefined,
            needs_pregrade: !!c.needs_pregrade,
          })),
          customer: {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            address: {
              street1: customer.street1,
              street2: customer.street2 || undefined,
              city: customer.city,
              state: customer.state || undefined,
              zip: customer.zip || undefined,
              country: customer.country || "US",
            },
          },
          shipping_method: shippingMethod,
          shipping_rate: selectedRate
            ? {
                object_id: selectedRate.object_id,
                amount_cents: selectedRate.amount_cents,
                carrier: selectedRate.carrier,
                service_level: selectedRate.service_level,
              }
            : undefined,
          customer_notes: customerNotes || undefined,
          affiliate_code: affiliateCode.trim().toUpperCase() || undefined,
          discount_percent: discountPercent > 0 ? discountPercent : undefined,
          gift_card_code: giftCardCode.trim().toUpperCase() || undefined,
          instagram_feature: instagramFeature || undefined,
          tip_cents: tipCents > 0 ? tipCents : undefined,
          insurance_election: insuranceElection,
          insurance_declared_value_cents: insuranceElection === "purchased" && insurance.declaredValueCents > 0 ? insurance.declaredValueCents : undefined,
          insurance_type: insuranceElection === "purchased" && insurance.declaredValueCents > 0 && insurance.type !== "none" ? insurance.type : undefined,
          add_signature_confirmation: addSignatureConfirmation || undefined,
          slab_crack_count: cards.filter((c) => c.needs_slab_crack).length || undefined,
          pregrade_count: cards.filter((c) => c.needs_pregrade).length || undefined,
          ...submittedSigning(signing, slabCards),
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        const msg = typeof data.error === "string" ? data.error : "Something went wrong. Please try again.";
        const code = typeof data.code === "string" ? data.code : "CHECKOUT_ERROR";
        // Use server-generated ref if available; fall back to client-generated
        const ref = typeof data.ref === "string" ? data.ref : `${code}-${Date.now().toString(36).toUpperCase()}`;
        setCheckoutError({ message: msg, ref });
        setSubmitting(false);
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
      }
    } catch (err) {
      console.error("Checkout fetch error:", err);
      const ref = `NETWORK_ERROR-${Date.now().toString(36).toUpperCase()}`;
      setCheckoutError({
        message: "Could not reach our server. Please check your internet connection and try again.",
        ref,
      });
      setSubmitting(false);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    }
  }

  return (
    <div className="wrap py-8 md:py-12">
      <InAppBrowserBanner />
      <SlabAuthorizationDialog card={slabDialogCard} state={signing} onChange={changeSigning} onClose={closeSlabDialog} />
      <div className="mb-10 rounded-[22px] bg-white px-2 pt-5 pb-4 shadow-[0_0_0_1px_var(--line)] sm:px-8 md:mb-14">
        <ProgressIndicator currentStep={step} />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 xl:gap-14">
        <div className="min-w-0">
          {step === 1 && (
            <StepCards
              cards={cards}
              services={services}
              selectedServiceIds={[serviceId]}
              onChange={setCards}
              defaultTier={selectedTier}
              tiers={tiers}
              onOpenSlab={setSlabDialogId}
              showMissing={showMissing}
            />
          )}
          {step === 2 && <StepCustomer customer={customer} onChange={setCustomer} showMissing={showMissing} />}
          {step === 3 && (
            <StepShipping
              customer={customer}
              shippingMethod={shippingMethod}
              selectedRate={selectedRate}
              onMethodChange={(m) => {
                setShippingMethod(m);
                // What can be insured depends on who buys the label (step-review.tsx)
                setInsurance((ins) => ({ ...ins, type: "none", chargeCents: 0 }));
                // Signature confirmation comes with the prepaid label only
                if (m !== "buy_label") setAddSignatureConfirmation(false);
              }}
              onRateChange={setSelectedRate}
              showMissing={showMissing}
            />
          )}
          {step === 4 && (
            <StepReview
              services={services}
              selectedServiceIds={[serviceId]}
              cards={cards}
              customer={customer}
              shippingMethod={shippingMethod}
              selectedRate={selectedRate}
              customerNotes={customerNotes}
              onNotesChange={setCustomerNotes}
              affiliateCode={affiliateCode}
              onAffiliateCodeChange={setAffiliateCode}
              discountPercent={discountPercent}
              onDiscountChange={setDiscountPercent}
              signingSlot={
                <SigningSection
                  state={signing}
                  onChange={changeSigning}
                  mediaRequiredNote={instagramFeature ? "The Instagram feature you added needs the first permission; unchecking it removes the feature." : undefined}
                  showMissing={showMissing}
                />
              }
              insuranceElection={insuranceElection}
              onInsuranceElectionChange={changeInsuranceElection}
              insurance={insurance}
              onInsuranceChange={setInsurance}
              addSignatureConfirmation={addSignatureConfirmation}
              onSignatureConfirmationChange={setAddSignatureConfirmation}
              giftCardCode={giftCardCode}
              onGiftCardCodeChange={setGiftCardCode}
              giftCardAmountCents={giftCardAmountCents}
              onGiftCardAmountChange={setGiftCardAmountCents}
              instagramFeature={instagramFeature}
              onInstagramFeatureChange={changeInstagramFeature}
              tipCents={tipCents}
              onTipCentsChange={setTipCents}
              loyaltyDiscountPercent={loyaltyDiscountPercent}
              onLoyaltyDiscountChange={setLoyaltyDiscountPercent}
              onEditStep={(s) => {
                // remap review edit targets to new step numbers
                if (s === 2) goToStep(1); // cards
                else if (s === 3) goToStep(2); // customer
                else if (s === 4) goToStep(3); // shipping
              }}
              selectedTier={selectedTier}
              tiers={tiers}
              showMissing={showMissing}
            />
          )}

          {step === 4 && checkoutError && (
            <div ref={errorRef} className="mt-8 rounded-[22px] bg-white p-5 text-ink shadow-[inset_6px_0_0_var(--danger),0_0_0_1px_var(--line),var(--panel-shadow)] sm:p-6">
              <div className="flex gap-3">
                <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" strokeWidth={2} />
                <div className="flex-1 min-w-0">
                  <p className="mb-1 font-heading text-[1.75rem] leading-none font-black text-destructive">Checkout failed</p>
                  <p className="mb-4 text-sm leading-relaxed text-ink">{checkoutError.message}</p>

                  <div className={`${INSET} mb-4 px-4 py-3`}>
                    <p className="label-caps mb-1.5 text-[15px] text-ink-soft">Error Reference</p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="select-all break-all font-mono text-sm font-bold text-ink">{checkoutError.ref}</span>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm shrink-0 gap-1.5 px-4"
                        onClick={() => {
                          navigator.clipboard.writeText(`Error ref: ${checkoutError.ref}\n${checkoutError.message}`);
                          toast.success("Copied!");
                        }}
                      >
                        <Copy aria-hidden className="size-4" strokeWidth={2} />
                        Copy
                      </button>
                    </div>
                  </div>

                  <div className={NOTE_SUN}>
                    <p className="mb-1 text-sm font-semibold text-ink">What to do:</p>
                    <p className="text-sm leading-relaxed text-ink">
                      Screenshot this screen and DM <strong>@the_card_doc</strong>{" "}on Instagram — include the error reference above and we&apos;ll complete your order manually right away.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Diamond minimum value warning */}
          {step === 1 && isDiamondOrder && !diamondValueOk && (
            <Need missing={showMissing} note={null} className="mt-6">
            <div className={`${NOTE_SUN} flex items-start gap-3 px-5 py-4`}>
              <Gem className="h-6 w-6 shrink-0 text-ink" strokeWidth={1.75} />
              <div>
                <p className="text-sm font-bold text-ink">Diamond tier requires $5,000+ in total card value</p>
                <p className="mt-0.5 text-sm text-ink">
                  Your current total is <strong>${(totalEstimatedValueCents() / 100).toLocaleString()}</strong>. Please enter estimated values for your cards totaling at least $5,000, or choose a different tier.
                </p>
              </div>
            </div>
            </Need>
          )}

          <div className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-6">
            <Button
              variant="outline"
              size="lg"
              onClick={() => goToStep(step - 1)}
              disabled={step === 1}
              className="gap-1.5"
            >
              <ArrowLeft aria-hidden className="size-4" strokeWidth={2.25} />
              Back
            </Button>
            {step < 4 ? (
              <Button size="lg" onClick={tryContinue} className="gap-2 px-8">
                Continue
                <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
              </Button>
            ) : (
              <Button size="lg" onClick={trySign} disabled={submitting} className="h-auto min-h-14 px-6 py-3 leading-tight whitespace-normal sm:px-8">
                {submitting ? "Redirecting..." : SIGN_BUTTON_LABEL}
              </Button>
            )}
          </div>
          <MissingNote show={showMissing && (step === 4 ? !readyToSign : !canAdvance())} />
        </div>

        <div>
          <div className="lg:sticky lg:top-[calc(var(--header-h)+24px)]">
            <OrderSummary
              cards={cards}
              shippingMethod={shippingMethod}
              selectedRate={selectedRate}
              discountPercent={Math.max(discountPercent, loyaltyDiscountPercent)}
              loyaltyPercent={loyaltyDiscountPercent}
              isInternational={!!(customer.country && customer.country !== "US")}
              selectedTier={selectedTier}
              insurance={insurance}
              addSignatureConfirmation={addSignatureConfirmation}
              instagramFeature={instagramFeature}
              giftCardAmountCents={giftCardAmountCents}
              tipCents={tipCents}
              tiers={tiers}
            />
            {step === 4 && (
              <div className="mt-4">
                <YourInformation customer={customer} onEdit={() => goToStep(2)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
