"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Copy, Gem } from "lucide-react";
import { useAccountPrefill } from "@/lib/use-account-prefill";
import { useEffect, useState, useRef } from "react";
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
import { InAppBrowserNotice } from "@/components/checkout/in-app-browser-notice";
import { MissingNote, Need, revealMissing } from "@/components/checkout/required";
import { emptyIdentity, identityPayload } from "@/components/checkout/card-identity-fields";
import type { InsuranceElection } from "@/components/checkout/insurance-election";
import { SIGN_BUTTON_LABEL } from "@/lib/legal/current-terms";
import { cardProblems } from "./step-cards";
import type { Service, CardEntry, CustomerInfo, ShippingRate, InsuranceSelection } from "@/lib/types";
import { diamondMinCents, type RestorationTier, type RestorationTierId } from "@/lib/restoration-tiers";
import { fbq } from "@/lib/pixel";
import { trackCheckout, type CheckoutEvent, type CheckoutEventData } from "@/lib/checkout-funnel";
import { loadSavedOrder, resumeLinkHash, saveOrder } from "./saved-order";
import { isInAppBrowser } from "@/lib/in-app-browser";
import { INSET, NOTE_SUN } from "@/components/checkout/form-styles";
import { contactOk } from "@/lib/checkout-validation";
import { TierAvailabilityNotice, tierAvailabilityProblems, useTierAvailability } from "./tier-availability";

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

  // The answers are kept in this tab, so returning from a cancelled checkout
  // (/checkout/cancel) brings them back (./saved-order.ts). Read once in the
  // browser after the first render; saved from then on. Signatures, consents
  // and the Instagram feature (it needs the photo permission) start fresh.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = loadSavedOrder();
    if (saved && saved.selectedTier === (selectedTier ?? null)) {
      setCards(saved.cards);
      setCustomer(saved.customer);
      setShippingMethod(saved.shippingMethod);
      setSelectedRate(saved.selectedRate);
      setCustomerNotes(saved.customerNotes);
      setAffiliateCode(saved.affiliateCode);
      setDiscountPercent(saved.discountPercent);
      setGiftCardCode(saved.giftCardCode);
      setGiftCardAmountCents(saved.giftCardAmountCents);
      setTipCents(saved.tipCents);
      setInsuranceElection(saved.insuranceElection);
      setInsurance(saved.insurance);
      setAddSignatureConfirmation(saved.addSignatureConfirmation);
      // Back on the shipping step at most: its rates are fetched again there
      setStep(Math.min(Math.max(saved.step, 1), 3));
    }
    setRestored(true);
  }, [selectedTier]);
  useEffect(() => {
    if (!restored) return;
    saveOrder({
      v: 1,
      selectedTier: selectedTier ?? null,
      step,
      cards,
      customer,
      shippingMethod,
      selectedRate,
      customerNotes,
      affiliateCode,
      discountPercent,
      giftCardCode,
      giftCardAmountCents,
      tipCents,
      insuranceElection,
      insurance,
      addSignatureConfirmation,
    });
  }, [restored, selectedTier, step, cards, customer, shippingMethod, selectedRate, customerNotes, affiliateCode, discountPercent, giftCardCode, giftCardAmountCents, tipCents, insuranceElection, insurance, addSignatureConfirmation]);

  // Inside Instagram / Facebook / TikTok the address itself carries the cards
  // (#resume=, ./saved-order.ts), so the app's own "Open in browser" and copy
  // link bring them along too. Cards only, never contact details. Analytics
  // stop for that tab once the address holds it (lib/tracking-guard.ts).
  useEffect(() => {
    if (!restored || !isInAppBrowser()) return;
    const t = window.setTimeout(() => {
      try {
        const url = new URL(window.location.href);
        const want = resumeLinkHash() ?? "";
        if (url.hash === want) return;
        url.hash = want;
        window.history.replaceState(window.history.state, "", url.href);
      } catch {
        // The address keeps what it had; Copy link still carries the cards
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [restored, selectedTier, cards]);

  // Checkout funnel (lib/checkout-funnel.ts): each step as it comes into view, once the saved order is restored
  const track = (event: CheckoutEvent, data: CheckoutEventData = {}) => trackCheckout("restoration", event, { step, tier: selectedTier, cards: cards.length, ...data });
  useEffect(() => {
    if (restored) track("step_view");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step, not on every edit
  }, [restored, step]);

  // Each Diamond card must itself be declared at the Diamond minimum or more
  // (the admin's setting, else $5,000); other tiers in the order are unaffected
  const diamondMin = diamondMinCents("elite", tiers.find((t) => t.id === "elite")) ?? 500_000;

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
    track("blocked", { code: "slab_unsigned" });
    return true;
  }
  function changeInsuranceElection(e: Exclude<InsuranceElection, null>) {
    setInsuranceElection(e);
    if (e === "declined") setInsurance((ins) => ({ ...ins, type: "none", chargeCents: 0 }));
  }

  const diamondCards = cards.filter((c) => (c.tier ?? selectedTier) === "elite");
  const isDiamondOrder = diamondCards.length > 0;
  const diamondValueOk = diamondCards.every((c) => cardValueCents(c) >= diamondMin);

  function canAdvance(): boolean {
    if (step === 1) {
      return cards.every((c) => cardProblems(c, selectedTier, tiers).length === 0) && diamondValueOk;
    }
    if (step === 2) {
      // Filled in, and as /api/checkout will check it (email format, phone length)
      return contactOk(customer);
    }
    if (step === 3) {
      // Both ways need a rate: the prepaid label's, or the trip back for self-ship
      return !!shippingMethod && !!selectedRate;
    }
    return true;
  }

  // A new step starts at the top of the page, not where the last step's
  // buttons were (Continue sits at the bottom of a long step)
  const scrollTopOnStep = useRef(false);
  useEffect(() => {
    if (!scrollTopOnStep.current) return;
    scrollTopOnStep.current = false;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);
  function goToStep(n: number) {
    setShowMissing(false);
    scrollTopOnStep.current = true;
    setStep(n);
  }
  // The cards and contact steps must still pass when a later step is reached
  // some other way (a restored order, or rules changed since it was saved).
  const cardsStepOk = cards.every((c) => cardProblems(c, selectedTier, tiers).length === 0) && diamondValueOk;
  const contactStepOk = contactOk(customer);
  /** Sends the customer back to the first earlier step that no longer passes. */
  function backToFailingStep(): boolean {
    const target = step > 1 && !cardsStepOk ? 1 : step > 2 && !contactStepOk ? 2 : null;
    if (target === null) return false;
    setStep(target);
    setShowMissing(true);
    revealMissing();
    return true;
  }
  function tryContinue() {
    if (backToFailingStep()) return;
    if (step === 1 && openUnsignedSlab()) return;
    if (canAdvance()) return goToStep(step + 1);
    setShowMissing(true);
    track("blocked", { code: "missing_fields" });
    revealMissing();
  }
  // A tier on the order that closed or sold out since step 1: caught before
  // signing (./tier-availability.tsx; the server still checks at checkout)
  const tierAvailability = useTierAvailability(step === 4);
  const tierProblems = tierAvailabilityProblems(
    cards.map((c) => ({ tier: c.tier ?? selectedTier, name: c.card_name })),
    tierAvailability.availability,
    tiers,
  );
  /** Back to the cards step, at the first card whose tier can't take the order, with focus on its tier choices. */
  function chooseAnotherTier() {
    const unavailable = new Set(tierProblems.flatMap((p) => (p.kind === "shop_closed" ? [] : [p.tierId])));
    // By position: card ids are made in the browser, so the server's differ
    const target = cards.findIndex((c) => {
      const t = c.tier ?? selectedTier;
      return !!t && unavailable.has(t);
    });
    goToStep(1);
    if (target < 0) return;
    window.setTimeout(() => {
      const picker = document.querySelector<HTMLElement>(`[data-tier-picker="${target}"]`);
      if (!picker) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      picker.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      picker.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
    }, 60);
  }
  function trySign() {
    if (backToFailingStep()) return;
    if (openUnsignedSlab()) return;
    if (readyToSign && tierProblems.length === 0) {
      setShowMissing(false);
      return handleSubmit();
    }
    setShowMissing(true);
    track("blocked", { code: readyToSign ? "tier_unavailable" : "missing_fields" });
    revealMissing();
    // Only the tier notice stopped it: check the tiers again and focus the notice
    if (readyToSign) tierAvailability.recheck();
  }

  async function handleSubmit() {
    fbq("track", "InitiateCheckout", { num_items: cards.length, currency: "USD" });
    track("submit");
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
        track("redirect");
        window.location.href = data.url;
      } else {
        const msg = typeof data.error === "string" ? data.error : "Something went wrong. Please try again.";
        const code = typeof data.code === "string" ? data.code : "CHECKOUT_ERROR";
        track("rejected", { code: typeof data.code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.code) ? data.code : `HTTP_${res.status}` });
        // A tier that sold out or closed between the last check and Sign: read the
        // tiers again so the notice with "Choose another tier" shows too
        if (code === "TIER_SOLD_OUT" || code === "TIER_CLOSED" || code === "TIER_FULL") tierAvailability.recheck();
        // Use server-generated ref if available; fall back to client-generated
        const ref = typeof data.ref === "string" ? data.ref : `${code}-${Date.now().toString(36).toUpperCase()}`;
        setCheckoutError({ message: msg, ref });
        setSubmitting(false);
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
      }
    } catch (err) {
      console.error("Checkout fetch error:", err);
      const ref = `NETWORK_ERROR-${Date.now().toString(36).toUpperCase()}`;
      track("rejected", { code: "NETWORK_ERROR" });
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
      {/* The steps start at h2; this gives the page its heading. */}
      <h1 className="sr-only">Restoration order</h1>
      <InAppBrowserNotice flow="restoration" carryProgress className="mb-8" />
      <SlabAuthorizationDialog
        card={slabDialogCard}
        state={signing}
        onChange={changeSigning}
        onClose={closeSlabDialog}
        cardName={slabDialogIndex >= 0 ? cards[slabDialogIndex].card_name : ""}
        onCardName={(n) => setCards((cs) => cs.map((c) => (c.id === slabDialogId ? { ...c, card_name: n } : c)))}
      />
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
                <p className="text-sm font-bold text-ink">Diamond tier requires ${(diamondMin / 100).toLocaleString()}+ per card</p>
                <p className="mt-0.5 text-sm text-ink">
                  Each Diamond card must be declared at ${(diamondMin / 100).toLocaleString()} or more. Please raise its declared value, or choose a different tier for it.
                </p>
              </div>
            </div>
            </Need>
          )}

          {/* A tier on the order closed or sold out: pick another before signing */}
          {step === 4 && <TierAvailabilityNotice problems={tierProblems} onChooseTier={chooseAnotherTier} />}

          <div data-total-bar-avoid className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-6">
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
              <Button size="lg" onClick={trySign} disabled={submitting} className="h-auto min-h-14 min-w-0 shrink px-6 py-3 text-center leading-tight whitespace-normal sm:px-8">
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
              // Phones: the total pinned to the bottom of the screen (./mobile-total-bar.tsx)
              phoneBar
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
