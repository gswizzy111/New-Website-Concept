"use client";

import { useState } from "react";
import { SigningSection, emptySigning, signingReady, submittedSigning, type SigningState } from "@/components/checkout/signing-section";
import { CardIdentityFields, emptyIdentity, identityPayload, type CardIdentity } from "@/components/checkout/card-identity-fields";
import { MissingNote, Need, Req, revealMissing } from "@/components/checkout/required";
import { SIGN_BUTTON_LABEL, VALUE_HELP } from "@/lib/legal/current-terms";
import { formatCurrency } from "@/lib/utils";
import type { RestorationTier } from "@/lib/restoration-tiers";
import { PhotoUploader } from "@/components/order-builder/photo-uploader";
import { addedCardsBulkPercent, isBulkEligible } from "@/lib/bulk-pricing";
import { Plus } from "lucide-react";
import { cta } from "@/components/brand";
import { Eyebrow, PANEL, PANEL_TITLE } from "@/components/account/portal";

const TAX_RATE = 0.06625;

type CardEntry = CardIdentity & {
  name: string;
  declaredValue: string;
  photoUrls: string[];
};

interface Props {
  orderNumber: string;
  customerEmail: string;
  /** The order's tier with the admin's name and price (add-cards-section.tsx) */
  tierInfo: RestorationTier;
  /** Cards already on the order (with the added ones, it sets the bulk percent) */
  cardsOnOrder: number;
}

function emptyCard(): CardEntry {
  return { name: "", declaredValue: "", photoUrls: [], ...emptyIdentity() };
}

const valueCents = (c: CardEntry) => Math.round((parseFloat(c.declaredValue.replace(/[^0-9.]/g, "")) || 0) * 100);

const inputCls =
  "w-full min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 py-2 min-h-11 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]";

export function AddCardsForm({ orderNumber, customerEmail, tierInfo, cardsOnOrder }: Props) {
  const tier = tierInfo.id;
  const isElite = tier === "elite";
  const priceRate = tierInfo.pricing_rate ?? 0.07;
  const maxCents = tierInfo.max_card_value_cents;

  const [cards, setCards] = useState<CardEntry[]>([emptyCard()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The Terms of Service v1.0 signature for the added cards
  const [signing, setSigning] = useState<SigningState>(emptySigning());
  // Pressed the sign button with something missing: outline it in red
  const [showMissing, setShowMissing] = useState(false);

  function updateCard(i: number, patch: Partial<CardEntry>) {
    setCards((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function addCard() {
    setCards((prev) => [...prev, emptyCard()]);
  }

  function removeCard(i: number) {
    setCards((prev) => prev.filter((_, idx) => idx !== i));
  }

  function cardPrice(card: CardEntry): number {
    if (isElite) return Math.round(valueCents(card) * priceRate);
    return tierInfo.price_cents;
  }

  // Same pricing as the add-cards route: the order's new size sets the bulk percent
  const listSubtotal = cards.reduce((sum, c) => sum + cardPrice(c), 0);
  const bulkPercent = addedCardsBulkPercent(tier, cardsOnOrder, cards.length);
  const bulkDiscount = Math.round(listSubtotal * bulkPercent / 100);
  const subtotal = listSubtotal - bulkDiscount;
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  const overCap = (c: CardEntry) => maxCents !== null && valueCents(c) > maxCents;
  const cardsOk = cards.every((c) => c.name.trim().length > 0 && valueCents(c) > 0 && !overCap(c));
  const ready = cardsOk && signingReady(signing, []);

  async function handleSubmit() {
    if (loading) return;
    if (!ready) {
      setShowMissing(true);
      revealMissing();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderNumber}/add-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: customerEmail,
          cards: cards.map((c) => ({ name: c.name.trim(), ...identityPayload(c), declaredValueCents: valueCents(c), photoUrls: c.photoUrls })),
          ...submittedSigning(signing, []),
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className={PANEL}>
      <Eyebrow>Add to Your Order</Eyebrow>
      <h2 className="mb-2 font-heading text-[2rem] leading-[0.95] font-black text-ink">Add More Cards</h2>
      <p className="mb-5 text-[15px] text-ink-soft">
        Add cards before we receive your shipment. Priced at your {tierInfo.name} rate
        {isElite
          ? ` (${(priceRate * 100).toFixed(0)}% of declared value)`
          : ` (${formatCurrency(tierInfo.price_cents)}/card)`}
        {maxCents !== null ? `, for cards worth up to $${(maxCents / 100).toLocaleString()}` : ""}.
      </p>
      {isBulkEligible(tier) && (
        <p className="text-xs text-muted-foreground -mt-3 mb-5">
          Bulk pricing counts your whole order: at 10+ cards the added cards are 10% off, at 20+ they&apos;re 15% off.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {cards.map((card, i) => (
          <div key={i} className="rounded-[18px] bg-chalk p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className={`${PANEL_TITLE} text-[1.35rem]`}>Card {i + 1}</p>
              {cards.length > 1 && (
                <button
                  onClick={() => removeCard(i)}
                  disabled={loading}
                  className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-destructive hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Need missing={showMissing && !card.name.trim()}>
                <label className="mb-1.5 block text-sm font-semibold text-ink">Card Name<Req /></label>
                <input
                  type="text"
                  value={card.name}
                  onChange={(e) => updateCard(i, { name: e.target.value })}
                  placeholder="e.g. Charizard"
                  disabled={loading}
                  className={inputCls}
                />
              </Need>

              <CardIdentityFields idPrefix={`add-${i}`} value={card} onChange={(patch) => updateCard(i, patch)} />

              <Need missing={showMissing && (valueCents(card) <= 0 || overCap(card))} note={overCap(card) ? null : "Enter a declared value."}>
                <label className="mb-1.5 block text-sm font-semibold text-ink">Declared Value<Req /></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={card.declaredValue}
                    onChange={(e) => updateCard(i, { declaredValue: e.target.value })}
                    disabled={loading}
                    className={`${inputCls} pl-6`}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{VALUE_HELP}</p>
                {isElite && <p className="text-xs text-muted-foreground mt-1">Service fee: {formatCurrency(cardPrice(card))}</p>}
                {overCap(card) && (
                  <p className="text-xs text-destructive font-semibold mt-1">
                    This is above the {tierInfo.name} tier&apos;s ${(maxCents! / 100).toLocaleString()}{" "}cap, so it can&apos;t be added to this order. Please place a new order for it with a higher tier.
                  </p>
                )}
              </Need>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink">Photos (optional)</label>
                <PhotoUploader
                  photoUrls={card.photoUrls}
                  onChange={(urls) => updateCard(i, { photoUrls: urls })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addCard}
        disabled={loading}
        className={cta({ tone: "outline", size: "sm", className: "mt-4 w-full gap-1.5" })}
      >
        <Plus aria-hidden className="size-4" strokeWidth={2.5} />
        Add Another Card
      </button>

      <div className="mt-5 rounded-[18px] bg-cobalt-wash p-4 sm:p-5">
        <div className="flex justify-between text-sm text-muted-foreground mb-1">
          <span>
            {cards.length} card{cards.length !== 1 ? "s" : ""}
          </span>
          <span>{formatCurrency(listSubtotal)}</span>
        </div>
        {bulkDiscount > 0 && (
          <div className="mb-1 flex justify-between text-sm font-semibold text-cobalt-deep">
            <span>Bulk discount ({bulkPercent}% off, {cardsOnOrder + cards.length} cards on the order)</span>
            <span>−{formatCurrency(bulkDiscount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm text-muted-foreground mb-2">
          <span>Tax (6.625%)</span>
          <span>{formatCurrency(tax)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between border-t-2 border-ink pt-3 font-heading text-[1.75rem] leading-none font-black text-ink">
          <span>Total Due</span>
          <span>{formatCurrency(total)}</span>
        </div>
      </div>

      <div className="mt-6">
        <SigningSection state={signing} onChange={setSigning} showMissing={showMissing} />
      </div>

      {error && <p className="text-sm text-destructive mt-3">{error}</p>}

      <MissingNote show={showMissing && !ready} />
      <button
        onClick={handleSubmit}
        disabled={loading}
        className={cta({ tone: "sun", size: "lg", className: "mt-4 h-auto w-full py-3 leading-tight whitespace-normal" })}
      >
        {loading ? "Redirecting to checkout…" : SIGN_BUTTON_LABEL}
      </button>
    </div>
  );
}
