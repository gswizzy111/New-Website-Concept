import type { RestorationTierId } from "@/lib/restoration-tiers";

const TIER_IDS = new Set<string>(["regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass"]);
const asTier = (s: string | null | undefined): RestorationTierId | "" => (s && TIER_IDS.has(s) ? (s as RestorationTierId) : "");

/** A card's tier on the form: a restoration tier, "" (the order's tier) or "custom" (the custom price). */
export type PrefillTier = RestorationTierId | "" | "custom";

/** What the admin's Create Manual Order form starts with when opened from a show drop-off. */
export type DropoffPrefill = {
  dropoffId: string;
  dropoffNumber: number;
  fivePlus: boolean;
  name: string;
  email: string;
  phone: string;
  defaultTier: PrefillTier;
  cards: { name: string; tier: PrefillTier }[];
  /**
   * The custom price per card, when the drop-off has PSA Prep: Prep isn't a
   * restoration tier, so its cards start as "custom" at the admin's Prep
   * price (store_config), as the Show Dropoffs tab prices them.
   */
  customPriceCents: number | null;
  notes: string;
};

type Row = {
  id: string; dropoff_number: number; show_name: string | null;
  customer_name: string; customer_email: string; customer_phone: string;
  tiers: string[]; five_plus: boolean; card_count: number | null;
  cards: { name: string; details: string | null; service: string | null }[] | null;
  customer_notes: string | null;
};

/** `prepCents`: PSA Prep's per-card price (getPrepCardCents()), needed when the drop-off includes Prep. */
export function dropoffPrefill(d: Row, prepCents: number | null = null): DropoffPrefill {
  const restorationTiers = d.tiers.filter((t) => TIER_IDS.has(t));
  const hasPrep = d.tiers.includes("prep") && prepCents !== null && prepCents > 0;
  const onlyPrep = hasPrep && restorationTiers.length === 0;
  const defaultTier: PrefillTier = restorationTiers.length === 1 ? asTier(restorationTiers[0]) : onlyPrep ? "custom" : "";
  // A card's service, or the one service picked (as the signed text reads it)
  const cardTier = (service: string | null): PrefillTier => {
    const s = service ?? (d.tiers.length === 1 ? d.tiers[0] : null);
    if (s === "prep" && hasPrep) return "custom";
    return asTier(s) || defaultTier;
  };
  const cards = d.cards ?? [];
  const notes = [
    `Show drop-off #${d.dropoff_number}${d.show_name ? ` at ${d.show_name}` : ""}.`,
    d.tiers.includes("prep") ? "Includes PSA Prep." : "",
    d.five_plus ? `5+ Cards${d.card_count ? ` (about ${d.card_count})` : ""}.` : "",
    ...cards.filter((c) => c.details).map((c) => `${c.name}: ${c.details}`),
    d.customer_notes ? `Customer notes: ${d.customer_notes}` : "",
  ].filter(Boolean).join("\n");

  const formCards = d.five_plus ? [] : cards.map((c) => ({ name: c.name, tier: cardTier(c.service) }));
  // Only when a card starts as Prep: the custom price also prices cards left without a tier
  const prepCustom = defaultTier === "custom" || formCards.some((c) => c.tier === "custom");

  return {
    dropoffId: d.id,
    dropoffNumber: d.dropoff_number,
    fivePlus: d.five_plus,
    name: d.customer_name,
    email: d.customer_email,
    phone: d.customer_phone,
    defaultTier,
    cards: formCards,
    customPriceCents: prepCustom ? prepCents : null,
    notes,
  };
}
