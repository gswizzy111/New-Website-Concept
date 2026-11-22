import { z } from "zod";
import { MEDIA_LABEL, TAG_LABEL, TERMS_VERSION, masterSignatureText } from "@/lib/legal/current-terms";
import { isValidEmail, isValidPhone, isUSState } from "@/lib/checkout-validation";
import type { RestorationTierId } from "@/lib/restoration-tiers";

/**
 * Show Dropoffs: in-person intake at card shows (/show-dropoffs). The
 * customer fills in who they are, where to ship back, which services and
 * (under five cards) which cards, then signs the Terms. Nothing is paid
 * online; the admin turns each one into a drop-off order later
 * (/admin/show-dropoffs). Browser-safe; the API route stores it.
 */

export type DropoffServiceId = RestorationTierId | "prep";
export const DROPOFF_SERVICE_IDS = ["regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass", "prep"] as const;
export type DropoffService = { id: DropoffServiceId; name: string; price: string };

/** Up to this many cards are typed in; more is the "5+ Cards" option. */
export const MAX_LISTED_CARDS = 4;
export const FIVE_PLUS_LABEL = "5+ Cards";

const line = (max: number) => z.string().trim().max(max);

export const DropoffCardSchema = z.object({
  name: line(160).min(1, "Enter the card's name"),
  details: line(600).optional().default(""),
  service: z.enum(DROPOFF_SERVICE_IDS).optional(),
});
export type DropoffCard = z.infer<typeof DropoffCardSchema>;

export const ShowDropoffSchema = z.object({
  show: line(120).optional().default(""),
  customer: z.object({
    name: line(120).min(2),
    email: line(200).refine(isValidEmail),
    phone: line(40).refine(isValidPhone),
    street1: line(200).min(1),
    street2: line(200).optional().default(""),
    city: line(120).min(1),
    state: line(2).refine(isUSState),
    zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/),
  }),
  services: z.array(z.enum(DROPOFF_SERVICE_IDS)).min(1).max(DROPOFF_SERVICE_IDS.length),
  five_plus: z.boolean(),
  card_count: z.number().int().min(5).max(1000).nullable().optional(),
  cards: z.array(DropoffCardSchema).max(MAX_LISTED_CARDS),
  notes: line(1000).optional().default(""),
  signing: z.object({
    version: z.string(),
    signer_name: line(120).min(2),
    agreed: z.literal(true),
    esign_consent: z.literal(true),
    media: z.boolean(),
    tag_name: z.boolean(),
  }),
  // Left empty by people; filled by bots
  website: z.string().max(0).optional().default(""),
}).superRefine((d, ctx) => {
  if (!d.five_plus && d.cards.length === 0) {
    ctx.addIssue({ code: "custom", path: ["cards"], message: "Add at least one card, or choose 5+ Cards." });
  }
  for (const [i, c] of d.cards.entries()) {
    if (c.service && !d.services.includes(c.service)) {
      ctx.addIssue({ code: "custom", path: ["cards", i, "service"], message: "Pick one of the services you chose." });
    }
  }
});
export type ShowDropoffInput = z.infer<typeof ShowDropoffSchema>;

export const serviceName = (services: DropoffService[], id: string | null | undefined) =>
  services.find((s) => s.id === id)?.name ?? (id === "prep" ? "PSA Prep" : id ?? "");

export function addressLine(a: { street1?: string; street2?: string | null; city?: string; state?: string; zip?: string }): string {
  return [a.street1, a.street2, [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
    .filter((s) => s && String(s).trim())
    .join(", ");
}

/**
 * What the customer signs at the table: the certification and E-SIGN
 * consent (the same text as checkout's master signature), then exactly what
 * they handed over. Stored with the drop-off; its hash covers the Terms too.
 */
export function dropoffSignedText(d: ShowDropoffInput, services: DropoffService[]): string {
  const c = d.customer;
  const cardLines = d.five_plus
    ? [`${FIVE_PLUS_LABEL}${d.card_count ? ` (about ${d.card_count})` : ""}: The Card Doc will log each card after the show.`]
    : d.cards.map((card, i) => {
        const svc = card.service ?? (d.services.length === 1 ? d.services[0] : undefined);
        return `${i + 1}. ${card.name}${card.details ? ` (${card.details})` : ""}${svc ? ` | ${serviceName(services, svc)}` : ""}`;
      });
  return [
    masterSignatureText(),
    `Show drop-off${d.show ? ` at ${d.show}` : ""}: cards handed to The Card Doc in person. No online payment was taken.`,
    `Customer: ${c.name}, ${c.email}, ${c.phone}`,
    `Return shipping address: ${addressLine(c)}`,
    `Services: ${d.services.map((s) => serviceName(services, s)).join(", ")}`,
    ["Cards:", ...cardLines].join("\n"),
    ...(d.notes ? [`Notes: ${d.notes}`] : []),
    `[${d.signing.media ? "x" : " "}] ${MEDIA_LABEL}`,
    `[${d.signing.media && d.signing.tag_name ? "x" : " "}] ${TAG_LABEL}`,
    `Signed by typing: ${d.signing.signer_name} (Terms of Service v${TERMS_VERSION})`,
  ].join("\n\n");
}
