"use client";

import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PhotoUploader } from "./photo-uploader";
import { CardIdentityFields, emptyIdentity, type CardIdentity } from "@/components/checkout/card-identity-fields";
import { Need, Req } from "@/components/checkout/required";
import { VALUE_HELP } from "@/lib/legal/current-terms";
import type { Service, CardEntry } from "@/lib/types";
import { getAllTiers, formatCents } from "@/lib/restoration-tiers";
import type { RestorationTier, RestorationTierId } from "@/lib/restoration-tiers";
import { CHOICE, CHOICE_FOCUS, CHOICE_OFF, CHOICE_ON, FORM_PANEL, STEP_TITLE } from "@/components/checkout/form-styles";
import { cn } from "@/lib/utils";

const DEFAULT_TIERS = getAllTiers();

function parseCents(str: string): number {
  const val = parseFloat(str.replace(/[$,]/g, ""));
  return isNaN(val) ? 0 : Math.round(val * 100);
}

function tierAvailable(tier: RestorationTier, estimatedValueCents: number): boolean {
  if (estimatedValueCents === 0) return true;
  if (tier.max_card_value_cents === null) return true;
  return estimatedValueCents <= tier.max_card_value_cents;
}

interface StepCardsProps {
  cards: CardEntry[];
  services: Service[];
  selectedServiceIds: string[];
  onChange: (cards: CardEntry[]) => void;
  defaultTier?: RestorationTierId;
  /** The tiers with the admin's names and prices (lib/live-tiers.ts) */
  tiers?: RestorationTier[];
  /** Open the card's slab authorization pop-up */
  onOpenSlab?: (cardId: string) => void;
  /** The customer pressed Continue with something missing: outline it in red */
  showMissing?: boolean;
}

function identityOf(c: CardEntry): CardIdentity {
  return {
    card_set: c.card_set ?? "",
    card_year: c.card_year ?? "",
    card_number: c.card_number ?? "",
    variation: c.variation ?? "",
    grading_company: c.grading_company ?? "",
    grade: c.grade ?? "",
    cert_number: c.cert_number ?? "",
    known_defects: c.known_defects ?? "",
  };
}

/** A card is ready when it has a name, photos, a tier and a value within that tier's cap. */
export function cardProblems(c: CardEntry, defaultTier?: RestorationTierId, tiers: RestorationTier[] = DEFAULT_TIERS): string[] {
  const problems: string[] = [];
  const value = parseCents(c.estimated_value ?? "");
  const tier = tiers.find((t) => t.id === (c.tier ?? defaultTier));
  if (!c.card_name.trim()) problems.push("name");
  if (c.photo_urls.length === 0) problems.push("photos");
  if (value <= 0) problems.push("value");
  if (!tier || (tier.max_card_value_cents !== null && value > tier.max_card_value_cents)) problems.push("tier");
  return problems;
}

export function StepCards({ cards, services, selectedServiceIds, onChange, defaultTier, tiers = DEFAULT_TIERS, onOpenSlab, showMissing = false }: StepCardsProps) {
  const availableServices = services.filter((s) => selectedServiceIds.includes(s.id));

  function updateCard(id: string, patch: Partial<CardEntry>) {
    onChange(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addCard() {
    const newCard: CardEntry = {
      id: crypto.randomUUID(),
      card_name: "",
      ...emptyIdentity(),
      estimated_value: "",
      notes: "",
      photo_urls: [],
      service_ids: [...selectedServiceIds],
      tier: defaultTier,
    };
    onChange([...cards, newCard]);
  }

  function removeCard(id: string) {
    onChange(cards.filter((c) => c.id !== id));
  }

  function toggleService(cardId: string, serviceId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const has = card.service_ids.includes(serviceId);
    updateCard(cardId, {
      service_ids: has
        ? card.service_ids.filter((s) => s !== serviceId)
        : [...card.service_ids, serviceId],
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className={`${STEP_TITLE} mb-4`}>
          Tell us about your cards.
        </h2>
        <p className="lead text-ink-soft">
          Add each card you&apos;re sending. You can assign different services to different cards.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        {cards.map((card, i) => {
          const estimatedValueCents = parseCents(card.estimated_value ?? "");
          const activeTierId = card.tier ?? defaultTier;
          const activeTier = activeTierId ? tiers.find((t) => t.id === activeTierId) : null;
          const missing = new Set(showMissing ? cardProblems(card, defaultTier, tiers) : []);

          return (
            <div key={card.id} className={`${FORM_PANEL} flex flex-col gap-6`}>
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-3 font-heading text-[1.75rem] leading-none font-black text-ink">
                  <span aria-hidden className="h-7 w-1.5 rounded-full bg-sun" />
                  Card {i + 1}
                </h3>
                {cards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCard(card.id)}
                    aria-label={`Remove card ${i + 1}`}
                    className="grid size-11 place-items-center rounded-full text-ink-soft transition-colors hover:bg-red-50 hover:text-destructive focus-visible:outline-3 focus-visible:outline-cobalt"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Need missing={missing.has("name")} className="sm:col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor={`name-${card.id}`}>Card Name<Req /></Label>
                  <Input
                    id={`name-${card.id}`}
                    placeholder="e.g. 1986 Fleer Michael Jordan"
                    value={card.card_name}
                    onChange={(e) => updateCard(card.id, { card_name: e.target.value })}
                  />
                </Need>

                <div className="sm:col-span-2">
                  <CardIdentityFields
                    idPrefix={`card-${card.id}`}
                    value={identityOf(card)}
                    onChange={(patch) => updateCard(card.id, patch)}
                  />
                </div>

                <Need missing={missing.has("value")} className="sm:col-span-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`value-${card.id}`}>Declared value (USD)<Req /></Label>
                    {activeTier && (
                      <span className="text-xs text-muted-foreground">
                        {activeTier.max_card_value_cents === null
                          ? `${activeTier.name}: no max value`
                          : `${activeTier.name} max: $${(activeTier.max_card_value_cents / 100).toLocaleString()}`}
                      </span>
                    )}
                  </div>
                  <Input
                    id={`value-${card.id}`}
                    placeholder="e.g. 500"
                    inputMode="decimal"
                    value={card.estimated_value}
                    onChange={(e) => updateCard(card.id, { estimated_value: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{VALUE_HELP}</p>
                  {activeTier && activeTier.max_card_value_cents !== null && estimatedValueCents > activeTier.max_card_value_cents && (
                    <p className="text-xs text-destructive font-semibold">
                      <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" strokeWidth={2.25} />This value exceeds the {activeTier.name} tier&apos;s max of ${(activeTier.max_card_value_cents / 100).toLocaleString()}. Please select a higher tier below.
                    </p>
                  )}
                </Need>

                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor={`notes-${card.id}`}>Notes</Label>
                  <Textarea
                    id={`notes-${card.id}`}
                    placeholder="Special instructions or areas of concern"
                    value={card.notes}
                    onChange={(e) => updateCard(card.id, { notes: e.target.value })}
                    rows={2}
                  />
                </div>
              </div>

              {/* Per-card tier selector */}
              <Need missing={missing.has("tier")} note={activeTier ? "Pick a tier that allows this card's value." : "Pick a service level."} className="flex flex-col gap-2">
                <Label>Service Level<Req /></Label>
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  {tiers.map((t) => {
                    const selected = (card.tier ?? defaultTier) === t.id;
                    const available = tierAvailable(t, estimatedValueCents);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!available}
                        onClick={() => available && updateCard(card.id, { tier: t.id as RestorationTierId })}
                        title={!available && t.max_card_value_cents ? `Requires cards under $${(t.max_card_value_cents / 100).toLocaleString()}` : undefined}
                        className={cn(
                          "relative min-h-16 px-3.5 py-3 text-left text-sm",
                          CHOICE_FOCUS,
                          !available ? CHOICE_OFF : cn(CHOICE, selected && CHOICE_ON)
                        )}
                      >
                        {selected && (
                          <span aria-hidden className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-cobalt text-white">
                            <Check className="size-3.5" strokeWidth={3} />
                          </span>
                        )}
                        <span className="block pr-6 font-heading text-[1.3rem] leading-tight font-extrabold">
                          {t.name}
                          {!available && t.max_card_value_cents && (
                            <span className="ml-1 font-sans text-xs normal-case tracking-normal">(max ${(t.max_card_value_cents / 100).toLocaleString()})</span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">
                          {t.pricing_type === "percentage"
                            ? `${((t.pricing_rate ?? 0) * 100).toFixed(0)}% of value`
                            : `${formatCents(t.price_cents)}/card`}
                          {" · "}
                          {t.turnaround_label ?? `${t.turnaround_min_days}–${t.turnaround_max_days} days`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Need>

              {/* Services */}
              {availableServices.length > 1 && (
                <div className="flex flex-col gap-2">
                  <Label>Services to apply</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableServices.map((s) => {
                      const active = card.service_ids.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleService(card.id, s.id)}
                          aria-pressed={active}
                          className={cn(
                            "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold",
                            CHOICE_FOCUS,
                            active ? "bg-ink text-white" : "bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--ink-soft)]"
                          )}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Photos — required */}
              <Need missing={missing.has("photos")} note="Upload at least one photo." className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>
                    Photos<Req />
                  </Label>
                  {card.photo_urls.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-success"><Check className="size-3.5" strokeWidth={2.75} />{card.photo_urls.length} photo{card.photo_urls.length !== 1 ? "s" : ""} added</span>
                  )}
                </div>
                <PhotoUploader
                  photoUrls={card.photo_urls}
                  onChange={(urls) => updateCard(card.id, { photo_urls: urls })}
                />
                {card.photo_urls.length === 0 && !missing.has("photos") && (
                  <p className="text-xs text-destructive font-medium">Upload at least one photo to continue.</p>
                )}
              </Need>

              {/* Slab cracking */}
              <div className={cn("flex items-start gap-3.5 px-4 py-4", CHOICE, CHOICE_FOCUS, "has-[:checked]:bg-cobalt-wash has-[:checked]:shadow-[inset_0_0_0_2px_var(--cobalt)]")}>
                <input
                  type="checkbox"
                  id={`slab-${card.id}`}
                  checked={card.needs_slab_crack ?? false}
                  onChange={(e) => {
                    updateCard(card.id, { needs_slab_crack: e.target.checked });
                    // Its authorization pops up right away
                    if (e.target.checked) onOpenSlab?.(card.id);
                  }}
                  className="mt-0.5 shrink-0"
                />
                <label htmlFor={`slab-${card.id}`} className="flex-1 cursor-pointer text-sm">
                  <span className="text-[15px] font-bold text-ink">Need your slab cracked? +$7</span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">
                    Check this if your card is currently in a PSA, BGS, or other graded slab and needs to be removed before restoration.
                  </span>
                </label>
              </div>

              {/* Pregrade */}
              <div className={cn("flex items-start gap-3.5 px-4 py-4", CHOICE, CHOICE_FOCUS, "has-[:checked]:bg-cobalt-wash has-[:checked]:shadow-[inset_0_0_0_2px_var(--cobalt)]")}>
                <input
                  type="checkbox"
                  id={`pregrade-${card.id}`}
                  checked={card.needs_pregrade ?? false}
                  onChange={(e) => updateCard(card.id, { needs_pregrade: e.target.checked })}
                  className="mt-0.5 shrink-0"
                />
                <label htmlFor={`pregrade-${card.id}`} className="flex-1 cursor-pointer text-sm">
                  <span className="text-[15px] font-bold text-ink">Add Pregrade? +$25</span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">
                    We&apos;ll pregrade your card before submitting so you know what grade to expect — helping you decide whether to send it off.
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={addCard}
        className="self-start gap-2"
      >
        <Plus className="h-4 w-4" />
        Add another card
      </Button>
    </div>
  );
}
