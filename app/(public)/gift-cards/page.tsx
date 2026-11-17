"use client";

import { useState } from "react";
import { MissingNote, Need, Req, revealMissing } from "@/components/checkout/required";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { cn } from "@/lib/utils";

const PRESET_AMOUNTS = [25, 50, 75, 100, 150, 200];

// The field look: 48px tall, 12px corners, a 1.5px edge, cobalt focus.
const FIELD =
  "h-12 w-full min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-4 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft hover:border-ink-soft focus-visible:border-cobalt focus-visible:shadow-[0_0_0_4px_var(--cobalt-wash)] md:text-[15px]";
const STEP = "label-caps mb-4 flex items-center gap-3 text-[18px] text-ink";

/** The amount chips: sun when chosen, a white tile otherwise. */
function chip(on: boolean) {
  return cn(
    "inline-flex h-14 w-full items-center justify-center rounded-[14px] font-display text-[24px] font-black tabular-nums transition-[background-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100",
    on
      ? "bg-sun text-ink shadow-[0_0_0_2px_var(--ink)]"
      : "bg-white text-ink shadow-[0_0_0_1.5px_var(--line-strong)] hover:shadow-[0_0_0_1.5px_var(--ink)]"
  );
}

export default function GiftCardsPage() {
  const [amountDollars, setAmountDollars] = useState<number | null>(50);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const [purchaserName, setPurchaserName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");

  const [sendToRecipient, setSendToRecipient] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Pressed purchase with something missing: outline it in red
  const [showMissing, setShowMissing] = useState(false);

  const effectiveAmountDollars = useCustom
    ? parseFloat(customAmount.replace(/[^0-9.]/g, "")) || null
    : amountDollars;

  const isValid =
    effectiveAmountDollars !== null &&
    effectiveAmountDollars >= 10 &&
    effectiveAmountDollars <= 1000 &&
    purchaserName.trim().length > 0 &&
    purchaserEmail.trim().length > 0 &&
    (!sendToRecipient || (recipientName.trim().length > 0 && recipientEmail.trim().length > 0));

  const amountOk = effectiveAmountDollars !== null && effectiveAmountDollars >= 10 && effectiveAmountDollars <= 1000;
  const miss = (v: string) => showMissing && !v.trim();

  async function handleCheckout() {
    if (!isValid || !effectiveAmountDollars) {
      setShowMissing(true);
      revealMissing();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/gift-cards/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_cents: Math.round(effectiveAmountDollars * 100),
          purchaser_name: purchaserName.trim(),
          purchaser_email: purchaserEmail.trim(),
          recipient_name: sendToRecipient ? recipientName.trim() : purchaserName.trim(),
          recipient_email: sendToRecipient ? recipientEmail.trim() : purchaserEmail.trim(),
          personal_message: personalMessage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "Something went wrong.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="surface-chalk min-h-screen overflow-x-clip">
      <div className="wrap pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
          {/* The gift card itself: a live preview of the chosen amount */}
          <div className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+32px)]">
            <p className="hero-in eyebrow mb-5 inline-flex items-center gap-2.5 text-cobalt">
              <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
              The Card Doc
            </p>
            <h1 className="hero-in font-display text-[clamp(3.25rem,13vw,4.5rem)] leading-[0.88] font-black text-ink md:text-[clamp(4.5rem,7vw,6.75rem)]">
              Gift Cards
            </h1>
            <p className="hero-in lead mt-6 text-ink-soft" style={{ ["--d" as string]: 120 }}>
              Give the gift of card restoration. The recipient gets a code they can apply at checkout.
            </p>

            <div aria-hidden className="hero-in relative mx-auto mt-10 w-full max-w-[26rem] md:mt-14 lg:mx-0 lg:max-w-[30rem]" style={{ ["--d" as string]: 220 }}>
              <div className="surface-cobalt relative isolate aspect-[8/5] -rotate-[3deg] overflow-hidden rounded-[22px] p-[7%] shadow-[0_0_0_4px_var(--white),var(--print-shadow)] transition-transform duration-500 ease-[var(--ease-out)] hover:rotate-0 motion-reduce:transition-none">
                <span className="halftone-dots -right-[20%] -top-[30%] h-[150%] w-[80%]" />
                <span className="absolute inset-y-0 right-[16%] w-[11%] bg-sun" />
                <div className="relative flex h-full flex-col justify-between">
                  <BrandLogo size={40} surface="dark" wordmarkClassName="text-[22px] md:text-[26px] text-white" />
                  <div className="flex items-end justify-between gap-4">
                    <span className="label-caps text-[15px] text-cobalt-tint md:text-[17px]">Gift Card</span>
                    <span className="font-display text-[clamp(56px,14vw,92px)] font-black leading-[0.8] text-white tabular-nums">
                      {effectiveAmountDollars ? `$${effectiveAmountDollars}` : "$"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel flex min-w-0 flex-col gap-8 p-6 md:p-10">

          {/* Amount selection */}
          <Need missing={showMissing && !amountOk} note="Choose an amount from $10 to $1,000.">
            <p className={STEP}>
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-ink text-[14px] font-bold text-white">1</span>
              <span>Select Amount<Req /></span>
            </p>
            <div className="mb-3 grid grid-cols-3 gap-3">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => { setAmountDollars(amt); setUseCustom(false); }}
                  aria-pressed={!useCustom && amountDollars === amt}
                  className={chip(!useCustom && amountDollars === amt)}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setUseCustom(true); setAmountDollars(null); }}
              aria-pressed={useCustom}
              className={cn(chip(useCustom), "font-sans text-[16px] font-bold")}
            >
              Custom amount
            </button>
            {useCustom && (
              <div className="mt-4 flex items-center gap-3">
                <span aria-hidden className="font-display text-[32px] font-black text-ink">$</span>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={1}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="Enter amount (10–1000)"
                  aria-label="Custom amount"
                  className={cn(FIELD, "flex-1")}
                  autoFocus
                />
              </div>
            )}
          </Need>

          {/* Purchaser info */}
          <div className="border-t border-line pt-8">
            <p className={STEP}>
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-ink text-[14px] font-bold text-white">2</span>
              <span>Your Info<Req /></span>
            </p>
            <div className="flex flex-col gap-3">
              <Need className="flex flex-col" missing={miss(purchaserName)} note="Enter your name.">
                <input
                  type="text"
                  value={purchaserName}
                  onChange={(e) => setPurchaserName(e.target.value)}
                  placeholder="Your name"
                  aria-label="Your name"
                  autoComplete="name"
                  className={FIELD}
                />
              </Need>
              <Need className="flex flex-col" missing={miss(purchaserEmail)} note="Enter your email.">
                <input
                  type="email"
                  value={purchaserEmail}
                  onChange={(e) => setPurchaserEmail(e.target.value)}
                  placeholder="Your email (we'll send you a receipt)"
                  aria-label="Your email"
                  autoComplete="email"
                  className={FIELD}
                />
              </Need>
            </div>
          </div>

          {/* Send to recipient toggle */}
          <div className="border-t border-line pt-8">
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={sendToRecipient}
                onChange={(e) => setSendToRecipient(e.target.checked)}
                className="size-5 shrink-0 accent-cobalt"
              />
              <span className="text-[16px] font-bold text-ink">Send the gift card directly to someone else</span>
            </label>
            {sendToRecipient && (
              <div className="mt-4 flex flex-col gap-3">
                <Need className="flex flex-col" missing={miss(recipientName)} note="Enter the recipient's name.">
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Recipient's name"
                    aria-label="Recipient's name"
                    className={FIELD}
                  />
                </Need>
                <Need className="flex flex-col" missing={miss(recipientEmail)} note="Enter the recipient's email.">
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="Recipient's email"
                    aria-label="Recipient's email"
                    className={FIELD}
                  />
                </Need>
                <textarea
                  value={personalMessage}
                  onChange={(e) => setPersonalMessage(e.target.value)}
                  placeholder="Personal message (optional)"
                  aria-label="Personal message (optional)"
                  rows={3}
                  className={cn(FIELD, "h-auto resize-none py-3")}
                />
              </div>
            )}
          </div>

          {error && <p role="alert" className="rounded-[12px] bg-[#fdecea] px-4 py-3 text-sm font-bold text-destructive">{error}</p>}

          <div>
          <button
            type="button"
            onClick={handleCheckout}
            disabled={loading}
            className="btn btn-sun btn-lg w-full disabled:opacity-60"
          >
            {loading
              ? "Redirecting..."
              : effectiveAmountDollars
              ? `Purchase $${effectiveAmountDollars} Gift Card`
              : "Purchase Gift Card"
            }
            {!loading && <ArrowRight aria-hidden className="size-5" strokeWidth={2} />}
          </button>
          <MissingNote show={showMissing && !isValid} />
          </div>

          <p className="text-[14px] leading-relaxed text-ink-soft">
            The gift card code will be emailed immediately after purchase.
            Gift cards never expire and can be used on any restoration order.
          </p>
          </div>
        </div>
      </div>
    </div>
  );
}
