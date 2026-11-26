import { catalogThumb, isCatalogImageUrl } from "@/lib/card-catalog";
import { effectiveTier, orderPhotosPath, tierDisplayName, tierRank } from "@/lib/intake/codes";
import { cardStageState, isBagComplete } from "@/lib/intake/stage-plan";
import type { StageEventRow } from "@/lib/intake/types";
import type {
  LocationRef, ShipCheckCard, ShipCheckResponse, ShipCheckStatus, TrackBagSummary, TrackCardPhoto, TrackCardSummary,
} from "@/lib/intake/tracking/types";
import { productImage } from "@/lib/thumbnail";

/**
 * Builders for what the Scan page and ship checks show, from rows already
 * read (pure; safe in tests). lib/intake/tracking/resolve.ts and
 * ship-check.ts read the rows.
 */

/** The cards columns tracking reads. */
export const TRACK_CARD_COLUMNS =
  "id, order_id, card_name, card_set, card_year, card_number, tier, status, completed, completed_at, current_round, card_seq, card_code, bag_id, received_at, awaiting_arrival, photo_urls, receiving_photo_urls, catalog_image_url, location_id, located_at";
export const TRACK_ORDER_COLUMNS = "id, order_number, customer_name, customer_email, status, restoration_tier";
export const TRACK_BAG_COLUMNS = "id, order_id, bag_code, tier, batch, due_date, completed_at, source, location_id, located_at";

export type TrackCardRow = {
  id: string;
  order_id: string;
  card_name: string | null;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  tier: string | null;
  status: string | null;
  completed: boolean | null;
  completed_at: string | null;
  current_round: number | null;
  card_seq: number | null;
  card_code: string | null;
  bag_id: string | null;
  received_at: string | null;
  awaiting_arrival: boolean | null;
  photo_urls: string[] | null;
  receiving_photo_urls: string[] | null;
  catalog_image_url: string | null;
  location_id: string | null;
  located_at: string | null;
};
export type TrackOrderRow = {
  id: string;
  order_number: string;
  customer_name: string | null;
  customer_email: string | null;
  status: string;
  restoration_tier: string | null;
};
export type TrackBagRow = {
  id: string;
  order_id: string;
  bag_code: string;
  tier: string;
  batch: number;
  due_date: string | null;
  completed_at: string | null;
  source: string | null;
  location_id: string | null;
  located_at: string | null;
};

/** Arrived through Receiving (received_at or a bag) and not flagged awaiting arrival. */
export function isReceived(c: Pick<TrackCardRow, "awaiting_arrival" | "received_at" | "bag_id">): boolean {
  return !c.awaiting_arrival && (!!c.received_at || !!c.bag_id);
}

export function isRefunded(c: Pick<TrackCardRow, "status">): boolean {
  return c.status === "refunded";
}

/** Card number order (cards without a number last, then by id). */
export function bySeq(a: Pick<TrackCardRow, "card_seq" | "id">, b: Pick<TrackCardRow, "card_seq" | "id">): number {
  const sa = a.card_seq ?? Number.MAX_SAFE_INTEGER;
  const sb = b.card_seq ?? Number.MAX_SAFE_INTEGER;
  return sa !== sb ? sa - sb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Fastest tier first, then batch. */
export function byBag(a: Pick<TrackBagRow, "tier" | "batch">, b: Pick<TrackBagRow, "tier" | "batch">): number {
  return tierRank(a.tier) - tierRank(b.tier) || a.batch - b.batch;
}

export type SummaryContext = {
  orders: ReadonlyMap<string, TrackOrderRow>;
  bags: ReadonlyMap<string, TrackBagRow>;
  /** stage_update / round_started events per order, NEWEST FIRST. */
  events: ReadonlyMap<string, readonly StageEventRow[]>;
  locations: ReadonlyMap<string, LocationRef>;
  tierNames?: Readonly<Record<string, string>>;
};

/** At most this many photos per card in a summary (a search answers up to 30 cards). */
export const MAX_CARD_PHOTOS = 6;
/**
 * Thumbnail widths in real pixels: the Scan page shows a tile about 112 px
 * tall (84 px wide), so 240 serves a 2x screen and 360 a 3x one. The viewer
 * gets the desk's sizes.
 */
const TILE_WIDTHS = [240, 360];
const FULL_WIDTHS = [1280, 2048];

/** Web addresses only (a photo list can hold anything typed into it). */
export const webUrls = (urls: readonly (string | null)[] | null | undefined): string[] =>
  (urls ?? []).filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));

/**
 * A card's photos for the Scan page: receiving photos first, then the
 * customer's (web addresses only, at most MAX_CARD_PHOTOS); the catalog's
 * reference picture only when there are neither. Resized copies on Netlify
 * (lib/thumbnail.ts), so a bag of 20 cards never pulls 20 originals.
 */
export function cardPhotos(card: Pick<TrackCardRow, "receiving_photo_urls" | "photo_urls" | "catalog_image_url">): TrackCardPhoto[] {
  const own = (urls: string[], kind: "receiving" | "customer"): TrackCardPhoto[] =>
    urls.map((url) => ({ url, kind, tile: productImage(url, TILE_WIDTHS), full: productImage(url, FULL_WIDTHS) }));
  const photos = [...own(webUrls(card.receiving_photo_urls), "receiving"), ...own(webUrls(card.photo_urls), "customer")].slice(0, MAX_CARD_PHOTOS);
  if (photos.length) return photos;
  const catalog = card.catalog_image_url;
  if (!isCatalogImageUrl(catalog)) return [];
  return [{ url: catalog, kind: "reference", tile: { src: catalogThumb(catalog) }, full: { src: catalog } }];
}

export function cardSummary(card: TrackCardRow, ctx: SummaryContext): TrackCardSummary {
  const order = ctx.orders.get(card.order_id);
  const bag = card.bag_id ? ctx.bags.get(card.bag_id) ?? null : null;
  const st = cardStageState(
    { id: card.id, completed: card.completed, completed_at: card.completed_at, current_round: card.current_round },
    ctx.events.get(card.order_id) ?? [],
  );
  const tier = effectiveTier(card.tier, order?.restoration_tier);
  return {
    id: card.id,
    code: card.card_code,
    name: card.card_name,
    set: card.card_set,
    year: card.card_year,
    number: card.card_number,
    tier,
    tierName: tierDisplayName(tier, ctx.tierNames),
    customer: order?.customer_name ?? null,
    orderNumber: order?.order_number ?? "",
    orderId: card.order_id,
    bagId: card.bag_id,
    bagCode: bag?.bag_code ?? null,
    dueDate: bag?.due_date ?? null,
    stage: st.current,
    stageLabel: st.currentLabel,
    round: st.round,
    done: st.completed,
    refunded: isRefunded(card),
    awaiting: !!card.awaiting_arrival,
    received: isReceived(card),
    location: card.location_id ? ctx.locations.get(card.location_id) ?? null : null,
    locatedAt: card.located_at,
    bagLocation: bag?.location_id ? ctx.locations.get(bag.location_id) ?? null : null,
    photoUrl: card.receiving_photo_urls?.[0] ?? card.photo_urls?.[0] ?? card.catalog_image_url ?? null,
    photos: cardPhotos(card),
    photosUrl: orderPhotosPath(card.order_id, card.bag_id),
    cardUrl: `/admin/receiving/card/${encodeURIComponent(card.id)}`,
  };
}

/** A bag with its cards (non-refunded first, by card number). */
export function bagSummary(bag: TrackBagRow, cards: readonly TrackCardRow[], ctx: SummaryContext): TrackBagSummary {
  const order = ctx.orders.get(bag.order_id);
  const own = cards.filter((c) => c.bag_id === bag.id).sort((a, b) => Number(isRefunded(a)) - Number(isRefunded(b)) || bySeq(a, b));
  const views = own.map((c) => cardSummary(c, ctx));
  const live = views.filter((c) => !c.refunded);
  return {
    id: bag.id,
    code: bag.bag_code,
    tier: bag.tier,
    tierName: tierDisplayName(bag.tier, ctx.tierNames),
    orderId: bag.order_id,
    orderNumber: order?.order_number ?? "",
    customer: order?.customer_name ?? null,
    dueDate: bag.due_date,
    cardCount: live.length,
    doneCount: live.filter((c) => c.done).length,
    complete: !!bag.completed_at || isBagComplete(own),
    location: bag.location_id ? ctx.locations.get(bag.location_id) ?? null : null,
    locatedAt: bag.located_at,
    photosUrl: orderPhotosPath(bag.order_id, bag.id),
    cards: views,
  };
}

/**
 * refunded > not done > still in a work-station slot > ok. Done and out of
 * the slots (at Done, Shipping, a shelf, or nowhere) is ready to ship.
 */
export function shipCheckStatus(card: { refunded: boolean; done: boolean; location: Pick<LocationRef, "kind"> | null }): ShipCheckStatus {
  if (card.refunded) return "refunded";
  if (!card.done) return "not_done";
  if (card.location?.kind === "station") return "in_slot";
  return "ok";
}

/** The ship check of an order or one bag, from its cards (every card of the scope, refunded included). */
export function buildShipCheck(input: {
  scope: "order" | "bag";
  order: TrackOrderRow;
  bags: readonly TrackBagRow[];
  cards: readonly TrackCardRow[];
  ctx: SummaryContext;
}): ShipCheckResponse {
  const { ctx } = input;
  const cards: ShipCheckCard[] = [...input.cards].sort(bySeq).map((row) => {
    const s = cardSummary(row, ctx);
    return {
      id: s.id, code: s.code, name: s.name, bagId: s.bagId, bagCode: s.bagCode, done: s.done,
      location: s.location, lastSeen: s.locatedAt, status: shipCheckStatus(s),
    };
  });
  const counts = { ok: 0, notDone: 0, inSlot: 0, refunded: 0 };
  for (const c of cards) {
    if (c.status === "ok") counts.ok++;
    else if (c.status === "not_done") counts.notDone++;
    else if (c.status === "in_slot") counts.inSlot++;
    else counts.refunded++;
  }
  const bags = [...input.bags].sort(byBag).map((b) => {
    const own = cards.filter((c) => c.bagId === b.id && c.status !== "refunded");
    return {
      id: b.id, code: b.bag_code, tier: b.tier, tierName: tierDisplayName(b.tier, ctx.tierNames),
      cardCount: own.length, doneCount: own.filter((c) => c.done).length,
      location: b.location_id ? ctx.locations.get(b.location_id) ?? null : null,
      ok: own.length > 0 && own.every((c) => c.status === "ok"),
    };
  });
  const live = cards.filter((c) => c.status !== "refunded");
  return {
    scope: input.scope,
    order: { id: input.order.id, orderNumber: input.order.order_number, customer: input.order.customer_name, status: input.order.status },
    bags,
    cards,
    counts,
    ready: live.length > 0 && live.every((c) => c.status === "ok"),
  };
}
