import type { RestorationTierId } from "@/lib/restoration-tiers";

const TIER_IDS = new Set<string>(["regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass"]);
const asTier = (s: string | null | undefined): RestorationTierId | "" => (s && TIER_IDS.has(s) ? (s as RestorationTierId) : "");

/** What the admin's Create Manual Order form starts with when opened from a show drop-off. */
export type DropoffPrefill = {
  dropoffId: string;
  dropoffNumber: number;
  fivePlus: boolean;
  name: string;
  email: string;
  phone: string;
  defaultTier: RestorationTierId | "";
  cards: { name: string; tier: RestorationTierId | "" }[];
  notes: string;
};

type Row = {
  id: string; dropoff_number: number; show_name: string | null;
  customer_name: string; customer_email: string; customer_phone: string;
  tiers: string[]; five_plus: boolean; card_count: number | null;
  cards: { name: string; details: string | null; service: string | null }[] | null;
  customer_notes: string | null;
};

export function dropoffPrefill(d: Row): DropoffPrefill {
  const restorationTiers = d.tiers.filter((t) => TIER_IDS.has(t));
  const defaultTier = restorationTiers.length === 1 ? asTier(restorationTiers[0]) : "";
  const cards = d.cards ?? [];
  const notes = [
    `Show drop-off #${d.dropoff_number}${d.show_name ? ` at ${d.show_name}` : ""}.`,
    d.tiers.includes("prep") ? "Includes PSA Prep." : "",
    d.five_plus ? `5+ Cards${d.card_count ? ` (about ${d.card_count})` : ""}.` : "",
    ...cards.filter((c) => c.details).map((c) => `${c.name}: ${c.details}`),
    d.customer_notes ? `Customer notes: ${d.customer_notes}` : "",
  ].filter(Boolean).join("\n");

  return {
    dropoffId: d.id,
    dropoffNumber: d.dropoff_number,
    fivePlus: d.five_plus,
    name: d.customer_name,
    email: d.customer_email,
    phone: d.customer_phone,
    defaultTier,
    cards: d.five_plus ? [] : cards.map((c) => ({ name: c.name, tier: asTier(c.service) || defaultTier })),
    notes,
  };
}
