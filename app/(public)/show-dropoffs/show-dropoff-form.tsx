"use client";

import { useRef, useState } from "react";
import { Check, Layers, ListPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { StepCustomer } from "@/components/order-builder/step-customer";
import { SigningSection, emptySigning, signingReady, type SigningState } from "@/components/checkout/signing-section";
import { MissingNote, Need, Req, revealMissing } from "@/components/checkout/required";
import {
  BLOCK_TITLE, CHOICE, CHOICE_FOCUS, CHOICE_ON, FORM_PANEL, NOTE_ERROR, STEP_TITLE, TEXT_ACTION,
} from "@/components/checkout/form-styles";
import { Input, PIXEL_FIELD } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cta } from "@/components/brand/button-class";
import { contactOk } from "@/lib/checkout-validation";
import { TERMS_VERSION } from "@/lib/legal/current-terms";
import {
  FIVE_PLUS_LABEL, MAX_LISTED_CARDS, serviceName,
  type DropoffService, type DropoffServiceId,
} from "@/lib/show-dropoffs";
import type { CustomerInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

type CardRow = { id: string; name: string; details: string; service: DropoffServiceId | "" };

const emptyCustomer = (): CustomerInfo => ({
  name: "", email: "", phone: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US",
});
const newCard = (): CardRow => ({ id: crypto.randomUUID(), name: "", details: "", service: "" });

const SELECT_CN = cn(PIXEL_FIELD, "w-full cursor-pointer appearance-none bg-white pr-9");

export function ShowDropoffForm({ services, show }: { services: DropoffService[]; show: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [customer, setCustomer] = useState<CustomerInfo>(emptyCustomer);
  const [picked, setPicked] = useState<DropoffServiceId[]>([]);
  const [fivePlus, setFivePlus] = useState<boolean | null>(null);
  const [cardCount, setCardCount] = useState("");
  const [cards, setCards] = useState<CardRow[]>([newCard()]);
  const [notes, setNotes] = useState("");
  const [signing, setSigning] = useState<SigningState>(emptySigning);
  const [honeypot, setHoneypot] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ number: number; name: string; cards: string } | null>(null);

  const pickedServices = services.filter((s) => picked.includes(s.id));
  const filledCards = cards.filter((c) => c.name.trim());
  const multiService = picked.length > 1;

  // What's missing, for the red outlines
  const servicesMissing = picked.length === 0;
  const modeMissing = fivePlus === null;
  const cardsMissing = fivePlus === false && filledCards.length === 0;
  const cardServiceMissing = (c: CardRow) => multiService && !!c.name.trim() && !c.service;
  const countBad = fivePlus === true && cardCount.trim() !== "" && !(Number(cardCount) >= 5);
  const ready =
    contactOk(customer) && !servicesMissing && !modeMissing && !cardsMissing && !countBad
    && !filledCards.some(cardServiceMissing) && signingReady(signing, []);

  function toggleService(id: DropoffServiceId) {
    setPicked((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      // A card's service must still be one of the picked ones
      setCards((cs) => cs.map((c) => (c.service && !next.includes(c.service) ? { ...c, service: "" } : c)));
      return next;
    });
  }

  function updateCard(id: string, patch: Partial<CardRow>) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function reset() {
    setCustomer(emptyCustomer());
    setPicked([]);
    setFivePlus(null);
    setCardCount("");
    setCards([newCard()]);
    setNotes("");
    setSigning(emptySigning());
    setShowMissing(false);
    setError("");
    setDone(null);
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    setError("");
    if (!ready) {
      setShowMissing(true);
      revealMissing(rootRef.current);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/show-dropoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show,
          customer: {
            name: customer.name, email: customer.email, phone: customer.phone,
            street1: customer.street1, street2: customer.street2, city: customer.city,
            state: customer.state, zip: customer.zip,
          },
          services: picked,
          five_plus: fivePlus === true,
          card_count: fivePlus && cardCount.trim() ? Number(cardCount) : null,
          cards: fivePlus ? [] : filledCards.map((c) => ({
            name: c.name.trim(),
            details: c.details.trim(),
            ...(multiService ? { service: c.service } : {}),
          })),
          notes: notes.trim(),
          signing: {
            version: TERMS_VERSION,
            signer_name: signing.signerName.trim(),
            agreed: signing.agreed,
            esign_consent: signing.esign,
            media: signing.media,
            tag_name: signing.media && signing.tagName,
          },
          website: honeypot,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "We couldn't save your drop-off. Please try again.");
        return;
      }
      setDone({
        number: data.dropoffNumber,
        name: customer.name.trim().split(/\s+/)[0] ?? "",
        cards: fivePlus
          ? `${FIVE_PLUS_LABEL}${cardCount.trim() ? ` (about ${cardCount.trim()})` : ""}`
          : `${filledCards.length} card${filledCards.length === 1 ? "" : "s"}`,
      });
      window.scrollTo({ top: 0 });
    } catch {
      setError("No connection. Check the Wi-Fi or signal and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-success-tint text-success">
          <Check className="size-10" strokeWidth={2.5} aria-hidden />
        </span>
        <div>
          <p className="eyebrow text-cobalt">Drop-off saved</p>
          <h2 className="mt-3 font-heading text-[3.5rem] leading-[0.9] font-black text-ink tabular-nums md:text-[4.5rem]">
            #{done.number}
          </h2>
        </div>
        <div className={cn(FORM_PANEL, "w-full max-w-md text-left")}>
          <p className="text-[17px] leading-relaxed text-ink">
            Thanks{done.name ? `, ${done.name}` : ""}! We have your {done.cards} and your details.
            Show this screen to us at the table so we can write <strong>#{done.number}</strong> on your cards.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            We&apos;ll log your cards and email you when your order is in our system. Nothing is charged online.
          </p>
        </div>
        <button type="button" onClick={reset} className={cta({ tone: "ink", size: "lg" })}>
          Start the next drop-off
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-8 md:gap-10">
      {/* Bots fill every field; people never see this one */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </label>
      </div>

      {/* 1. Customer and return address */}
      <StepCustomer customer={customer} onChange={setCustomer} showMissing={showMissing} />

      {/* 2. Services */}
      <section className="flex flex-col gap-4" aria-labelledby="dropoff-services">
        <div>
          <h2 id="dropoff-services" className={STEP_TITLE}>Which services?</h2>
          <p className="lead mt-3 text-ink-soft">Pick every service your cards are going in.</p>
        </div>
        <Need missing={showMissing && servicesMissing} note="Pick at least one service">
          <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
            {services.map((s) => {
              const on = picked.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={cn("flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3", CHOICE, CHOICE_FOCUS, on && CHOICE_ON)}
                >
                  <input type="checkbox" className="shrink-0" checked={on} onChange={() => toggleService(s.id)} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[16px] font-bold leading-tight text-ink">{s.name}</span>
                    <span className="text-[13px] text-ink-soft">{s.price}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Need>
      </section>

      {/* 3. Cards */}
      <section className="flex flex-col gap-4" aria-labelledby="dropoff-cards">
        <div>
          <h2 id="dropoff-cards" className={STEP_TITLE}>Your cards</h2>
          <p className="lead mt-3 text-ink-soft">Up to {MAX_LISTED_CARDS} cards? List them. Dropping off more? Choose {FIVE_PLUS_LABEL} and we&apos;ll log them for you.</p>
        </div>

        <Need missing={showMissing && modeMissing} note="Choose one">
          <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="How many cards">
            {([
              { value: false, label: `1 to ${MAX_LISTED_CARDS} cards`, hint: "I'll list them", Icon: ListPlus },
              { value: true, label: FIVE_PLUS_LABEL, hint: "You log them later", Icon: Layers },
            ] as const).map(({ value, label, hint, Icon }) => {
              const on = fivePlus === value;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setFivePlus(value)}
                  className={cn("flex min-h-20 flex-col items-start justify-center gap-1 px-4 py-3 text-left", CHOICE, CHOICE_FOCUS, on && CHOICE_ON)}
                >
                  <Icon className={cn("size-5", on ? "text-cobalt" : "text-ink-soft")} strokeWidth={1.75} aria-hidden />
                  <span className="font-heading text-[1.35rem] leading-none font-extrabold text-ink">{label}</span>
                  <span className="text-[13px] text-ink-soft">{hint}</span>
                </button>
              );
            })}
          </div>
        </Need>

        {fivePlus === true && (
          <div className={cn(FORM_PANEL, "flex flex-col gap-3")}>
            <p className="text-[15px] leading-relaxed text-ink">
              No need to type in every card. We&apos;ll enter each one when we get back from the show.
            </p>
            <Need missing={countBad} note="Enter 5 or more, or leave it blank" className="flex flex-col gap-1.5 sm:max-w-56">
              <Label htmlFor="card-count">About how many cards? <span className="font-normal text-ink-soft">(optional)</span></Label>
              <Input
                id="card-count"
                type="number"
                inputMode="numeric"
                min={5}
                max={1000}
                value={cardCount}
                onChange={(e) => setCardCount(e.target.value)}
              />
            </Need>
          </div>
        )}

        {fivePlus === false && (
          <div className="flex flex-col gap-3">
            {cards.map((card, i) => (
              <div key={card.id} className={cn(FORM_PANEL, "flex flex-col gap-4")}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className={BLOCK_TITLE}>Card {i + 1}</h3>
                  {cards.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setCards((cs) => cs.filter((c) => c.id !== card.id))}
                      className={cn(TEXT_ACTION, "gap-1.5 text-destructive hover:bg-red-50")}
                      aria-label={`Remove card ${i + 1}`}
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} aria-hidden /> Remove
                    </button>
                  )}
                </div>
                <Need
                  missing={showMissing && cardsMissing && i === 0}
                  note="Enter the card's name"
                  className="flex flex-col gap-1.5"
                >
                  <Label htmlFor={`card-${card.id}-name`}>Card name<Req /></Label>
                  <Input
                    id={`card-${card.id}-name`}
                    value={card.name}
                    maxLength={160}
                    placeholder="e.g. Charizard Holo"
                    onChange={(e) => updateCard(card.id, { name: e.target.value })}
                  />
                </Need>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`card-${card.id}-details`}>Details <span className="font-normal text-ink-soft">(optional)</span></Label>
                  <textarea
                    id={`card-${card.id}-details`}
                    value={card.details}
                    maxLength={600}
                    rows={2}
                    placeholder="Year, set, card number, what you want fixed"
                    onChange={(e) => updateCard(card.id, { details: e.target.value })}
                    className={cn(PIXEL_FIELD, "h-auto min-h-20 py-2.5")}
                  />
                </div>
                {multiService && (
                  <Need missing={showMissing && cardServiceMissing(card)} note="Pick this card's service" className="flex flex-col gap-1.5">
                    <Label htmlFor={`card-${card.id}-service`}>Service for this card<Req /></Label>
                    <select
                      id={`card-${card.id}-service`}
                      value={card.service}
                      onChange={(e) => updateCard(card.id, { service: e.target.value as DropoffServiceId | "" })}
                      className={SELECT_CN}
                    >
                      <option value="">Choose a service</option>
                      {pickedServices.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </Need>
                )}
                {!multiService && picked.length === 1 && (
                  <p className="text-sm text-ink-soft">Service: <strong className="text-ink">{serviceName(services, picked[0])}</strong></p>
                )}
              </div>
            ))}
            {cards.length < MAX_LISTED_CARDS ? (
              <button
                type="button"
                onClick={() => setCards((cs) => [...cs, newCard()])}
                className={cta({ tone: "outline", className: "self-start" })}
              >
                <Plus className="size-4" strokeWidth={2} aria-hidden /> Add another card
              </button>
            ) : (
              <p className="text-sm text-ink-soft">
                More than {MAX_LISTED_CARDS}?{" "}
                <button type="button" className="font-bold text-cobalt underline underline-offset-4" onClick={() => setFivePlus(true)}>
                  Switch to {FIVE_PLUS_LABEL}
                </button>
              </p>
            )}
          </div>
        )}
      </section>

      {/* 4. Notes */}
      <section className={cn(FORM_PANEL, "flex flex-col gap-1.5")}>
        <Label htmlFor="dropoff-notes">Anything we should know? <span className="font-normal text-ink-soft">(optional)</span></Label>
        <textarea
          id="dropoff-notes"
          value={notes}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          className={cn(PIXEL_FIELD, "h-auto min-h-24 py-2.5")}
        />
      </section>

      {/* 5. Sign */}
      <SigningSection state={signing} onChange={setSigning} showMissing={showMissing} />

      <div className="flex flex-col gap-3">
        {error && <p role="alert" className={NOTE_ERROR}>{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className={cta({ tone: "sun", size: "xl", className: "w-full justify-center disabled:opacity-70" })}
        >
          {submitting ? <><Loader2 className="size-5 animate-spin" aria-hidden /> Saving…</> : "Submit Drop-off"}
        </button>
        <MissingNote show={showMissing && !ready} />
        <p className="text-center text-sm text-ink-soft">No payment is taken online. We&apos;ll confirm your order by email.</p>
      </div>
    </div>
  );
}
