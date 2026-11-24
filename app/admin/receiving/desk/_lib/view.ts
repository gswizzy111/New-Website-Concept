import { catalogThumb, isCatalogImageUrl } from "@/lib/card-catalog";
import { dayText, daysUntil, dueHint, nyDateTime } from "@/lib/intake/tracking-format";
import type { DeskCard } from "@/lib/intake/tracking/desk";
import type { LocationKind } from "@/lib/intake/tracking/types";
import { productImage } from "@/lib/thumbnail";
import { formatCurrency } from "@/lib/utils";
import type { GridPhoto, PhotoGroup } from "@/app/admin/receiving/[orderId]/photos/photo-grid";

/**
 * One desk card as its panel shows it, made on the server: image addresses
 * (lib/thumbnail.ts reads a server-only setting), dates and money as text,
 * so the panel (a client component) never formats a date itself and the
 * page hydrates without a mismatch. The page imports deskPanelCard; client
 * components import only the type.
 */

export type DeskPanelCard = {
  id: string;
  code: string | null;
  name: string;
  /** "1999 · Base Set · #4/102 · Holo" */
  details: string;
  tier: string | null;
  tierName: string;
  customer: string | null;
  orderId: string;
  orderNumber: string;
  orderUrl: string;
  cardUrl: string;
  /** Receiving, where a photo can be added: /admin/receiving/<orderId>#card-<id> */
  receivingUrl: string;
  step: { label: string; round: number | null; done: boolean };
  refunded: boolean;
  due: { text: string; hint: string | null; overdue: boolean } | null;
  declaredValue: string | null;
  /** When it was put on the desk (ISO, for "2 h") and as text ("Nov 24, 2026, 3:12 PM"). */
  onDeskSince: string | null;
  onDeskSinceText: string | null;
  arrival: { fromName: string | null; fromKind: LocationKind | null; by: string | null; atText: string } | null;
  customerNotes: string | null;
  notes: string | null;
  knownDefects: string | null;
  /** Receiving photos, then the customer's; the catalog picture only when there are neither. */
  photos: PhotoGroup[];
  label: string;
};

function ownPhotos(urls: readonly string[], kind: "receiving" | "customer", label: string): GridPhoto[] {
  const noun = kind === "receiving" ? "Receiving photo" : "Customer photo";
  return urls.map((url, i) => ({
    url,
    kind,
    // Resized copies on Netlify (lib/thumbnail.ts), keeping the card's shape; the original elsewhere
    tile: productImage(url, [360, 720]),
    full: productImage(url, [1280, 2048]),
    alt: `${noun} ${i + 1} of ${label}`,
    position: `${noun} ${i + 1} of ${urls.length}`,
  }));
}

/** The same groups as the order photos page: receiving photos first, then the customer's, each labelled. */
export function deskPhotoGroups(card: Pick<DeskCard, "receivingPhotos" | "customerPhotos" | "catalogImageUrl" | "name">, label: string): PhotoGroup[] {
  const groups: PhotoGroup[] = [];
  const { receivingPhotos: receiving, customerPhotos: customer } = card;
  if (receiving.length) {
    groups.push({ kind: "receiving", title: receiving.length === 1 ? "Receiving photo" : `Receiving photos (${receiving.length})`, photos: ownPhotos(receiving, "receiving", label) });
  }
  if (customer.length) {
    groups.push({ kind: "customer", title: customer.length === 1 ? "Customer photo" : `Customer photos (${customer.length})`, photos: ownPhotos(customer, "customer", label) });
  }
  const catalog = card.catalogImageUrl;
  if (!groups.length && catalog && isCatalogImageUrl(catalog)) {
    const name = card.name?.trim() || "this card";
    groups.push({
      kind: "reference",
      title: "Reference photo, not the customer's card",
      photos: [{
        url: catalog,
        kind: "reference",
        tile: { src: catalogThumb(catalog) },
        full: { src: catalog },
        alt: `Reference photo of ${name} from the card catalog, not the customer's card`,
        position: "Reference photo, not the customer's card",
      }],
    });
  }
  return groups;
}

export function deskPanelCard(c: DeskCard): DeskPanelCard {
  const name = c.name?.trim() || "Card";
  const label = c.code ? `${c.code} ${name}` : name;
  const details = [c.year?.trim(), c.set?.trim(), c.number?.trim() ? `#${c.number.trim()}` : null, c.variation]
    .filter(Boolean).join(" · ") || "No year, set or number";
  const due = c.dueDate
    ? { text: dayText(c.dueDate), hint: dueHint(c.dueDate), overdue: !c.done && !c.refunded && (daysUntil(c.dueDate) ?? 0) < 0 }
    : null;
  return {
    id: c.id,
    code: c.code,
    name,
    details,
    tier: c.tier,
    tierName: c.tierName,
    customer: c.customer?.trim() || null,
    orderId: c.orderId,
    orderNumber: c.orderNumber,
    orderUrl: c.orderUrl,
    cardUrl: c.cardUrl,
    receivingUrl: `/admin/receiving/${encodeURIComponent(c.orderId)}#card-${c.id}`,
    step: { label: c.done ? "Done" : c.stageLabel, round: c.round > 1 ? c.round : null, done: c.done },
    refunded: c.refunded,
    due,
    declaredValue: c.declaredValueCents ? formatCurrency(c.declaredValueCents) : null,
    onDeskSince: c.locatedAt,
    onDeskSinceText: c.locatedAt ? nyDateTime(c.locatedAt) : null,
    arrival: c.arrival
      ? { fromName: c.arrival.from?.name ?? null, fromKind: c.arrival.from?.kind ?? null, by: c.arrival.by, atText: nyDateTime(c.arrival.at) }
      : null,
    customerNotes: c.customerNotes,
    notes: c.notes,
    knownDefects: c.knownDefects,
    photos: deskPhotoGroups(c, label),
    label,
  };
}
