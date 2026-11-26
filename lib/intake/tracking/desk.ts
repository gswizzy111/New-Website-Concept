import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { normalizeCode } from "@/lib/intake/codes";
import type { StageEventRow } from "@/lib/intake/types";
import { DESK_CODE, DESK_NAME, isDeskCode } from "@/lib/intake/tracking/desk-codes";
import { LOCATION_COLUMNS, LOCATION_REF_COLUMNS, locationRef, locationView } from "@/lib/intake/tracking/places";
import {
  TRACK_BAG_COLUMNS, TRACK_CARD_COLUMNS, TRACK_ORDER_COLUMNS, cardSummary, webUrls,
  type SummaryContext, type TrackBagRow, type TrackCardRow, type TrackOrderRow,
} from "@/lib/intake/tracking/summaries";
import type { LocationRef, LocationRow, MoveAction, TrackCardSummary, TrackLocation } from "@/lib/intake/tracking/types";

/**
 * Desks (owner's request, Nov 24 2026): a desk is a place with a QR sign
 * (kind 'other', code LOC-DESK, more as LOC-DESK-<NAME>, e.g. "DESK GAVIN").
 * Cards come off a holder in a stack (scan HEAT PRESS 01, Move, scan DESK)
 * and the Desk page (/admin/receiving/desk) shows each card on the desk with
 * its photos, its order's details and notes. Moving cards to a desk changes
 * where they are only, never their step (the rule for 'other' places).
 *
 * The code helpers (isDeskCode, deskPagePath ...) live in desk-codes.ts,
 * which client components import (it needs only lib/intake/codes.ts); they
 * are re-exported here. This file imports nothing server-only either, but
 * its loaders take the service-role client and run on the server only;
 * admin access is checked by the caller.
 */

export { DESK_CODE, DESK_NAME, DESK_PAGE, deskPagePath, isDeskCode } from "@/lib/intake/tracking/desk-codes";

/** A desk with how many cards are on it. */
export type DeskPlace = TrackLocation & { cardCount: number };

/** Desk order: switched-on first, LOC-DESK first, then by sort and name. */
export function compareDesks(a: Pick<TrackLocation, "code" | "name" | "active" | "sort">, b: Pick<TrackLocation, "code" | "name" | "active" | "sort">): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  if ((a.code === DESK_CODE) !== (b.code === DESK_CODE)) return a.code === DESK_CODE ? -1 : 1;
  if ((a.sort ?? 0) !== (b.sort ?? 0)) return (a.sort ?? 0) - (b.sort ?? 0);
  return a.name.localeCompare(b.name, "en", { numeric: true }) || a.code.localeCompare(b.code);
}

/**
 * The desk to show: the one asked for (?desk=<code>, even when switched off),
 * else the first switched-on desk (LOC-DESK first), else the first desk;
 * null when there are none. `desks` in compareDesks order.
 */
export function pickDesk<T extends Pick<TrackLocation, "code" | "active">>(desks: readonly T[], requested?: string | null): T | null {
  const want = normalizeCode(requested);
  if (want) {
    const hit = desks.find((d) => d.code === want);
    if (hit) return hit;
  }
  return desks.find((d) => d.active) ?? desks[0] ?? null;
}

/**
 * Every desk (switched-off ones too), in compareDesks order, with its card
 * count. Only 'other' places count, as on the Scan and Places pages (a Done
 * or Shipping place someone named "Desk" isn't one: putting cards back on it
 * would change them). Throws on a failed read (the tracking update not
 * applied included).
 */
export async function deskPlaces(admin: SupabaseClient): Promise<DeskPlace[]> {
  const rows = (await fetchAll<LocationRow>((from, to) =>
    admin.from("locations").select(LOCATION_COLUMNS).eq("kind", "other").like("code", `${DESK_CODE}%`).order("id").range(from, to)))
    .filter((r) => isDeskCode(r.code));
  if (!rows.length) return [];
  const held = await fetchAll<{ id: string; location_id: string | null }>((from, to) =>
    admin.from("cards").select("id, location_id").in("location_id", rows.map((r) => r.id)).order("id").range(from, to));
  const counts = new Map<string, number>();
  for (const c of held) if (c.location_id) counts.set(c.location_id, (counts.get(c.location_id) ?? 0) + 1);
  return rows.map((r) => ({ ...locationView(r), cardCount: counts.get(r.id) ?? 0 })).sort(compareDesks);
}

/**
 * The first desk, LOC-DESK "DESK" (kind 'other'), made if it doesn't exist
 * yet. Race-safe like ensureShelfSlot: insert ... on conflict (code) do
 * nothing, then read it. A desk switched off in Places stays off (that was
 * someone's choice). Throws on a database error.
 */
export async function ensureDesk(admin: SupabaseClient, by: string | null = null): Promise<{ location: TrackLocation; created: boolean }> {
  const { data: inserted, error: insErr } = await admin.from("locations")
    .upsert(
      { code: DESK_CODE, name: DESK_NAME, kind: "other", stage: null, sort: 0, active: true, created_by: by },
      { onConflict: "code", ignoreDuplicates: true },
    )
    .select(LOCATION_COLUMNS);
  if (insErr) throw new Error(insErr.message);
  if (inserted?.length) return { location: locationView(inserted[0] as LocationRow), created: true };
  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("code", DESK_CODE).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`The desk ${DESK_CODE} could not be made`);
  return { location: locationView(data as LocationRow), created: false };
}

// ─── The cards on a desk ────────────────────────────────────────────────

/** The move that put a card on the desk. */
export type DeskArrival = {
  /** The holder it came from (null: it was in no holder, e.g. in its bag). */
  from: LocationRef | null;
  at: string;
  by: string | null;
  action: MoveAction;
};

/** One card on a desk: what the Scan page shows, plus what its order page shows for it. */
export type DeskCard = TrackCardSummary & {
  variation: string | null;
  /** The value the customer declared (cards.estimated_value_cents). */
  declaredValueCents: number | null;
  /** The customer's note on this card (cards.notes). */
  notes: string | null;
  knownDefects: string | null;
  /** The order's notes from the customer (orders.customer_notes). */
  customerNotes: string | null;
  /** Web addresses only, in the order taken. */
  receivingPhotos: string[];
  customerPhotos: string[];
  catalogImageUrl: string | null;
  /** The order page: /admin/orders/<orderId>. */
  orderUrl: string;
  /** The newest move onto this desk (card_moves); null when history doesn't have one. */
  arrival: DeskArrival | null;
};

/** The extra cards columns the desk reads. */
export const DESK_CARD_COLUMNS = `${TRACK_CARD_COLUMNS}, variation, notes, known_defects, estimated_value_cents`;

export type DeskCardRow = TrackCardRow & {
  variation?: string | null;
  notes?: string | null;
  known_defects?: string | null;
  estimated_value_cents?: number | null;
};
export type DeskOrderRow = TrackOrderRow & { customer_notes?: string | null };
export type ArrivalRow = { id: string; card_id: string; from_location_id: string | null; to_location_id: string | null; action: MoveAction; by: string | null; created_at: string };

const CHUNK = 100;
function chunks<T>(xs: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const text = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Each card's newest move onto `deskId` (card_moves rows of any order).
 * Rows that didn't change the place (from the desk to the desk) are skipped.
 */
export function latestArrivals(rows: readonly ArrivalRow[], deskId: string): Map<string, ArrivalRow> {
  const out = new Map<string, ArrivalRow>();
  for (const r of rows) {
    if (r.to_location_id !== deskId || r.from_location_id === deskId) continue;
    const seen = out.get(r.card_id);
    if (!seen || time(r.created_at) > time(seen.created_at) || (time(r.created_at) === time(seen.created_at) && r.created_at > seen.created_at)) {
      out.set(r.card_id, r);
    }
  }
  return out;
}

/** Newest on the desk first (a stack moved together stays together), then by Card ID. */
export function compareDeskCards(a: Pick<DeskCard, "locatedAt" | "code" | "id">, b: Pick<DeskCard, "locatedAt" | "code" | "id">): number {
  const t = time(b.locatedAt) - time(a.locatedAt);
  if (t && !Number.isNaN(t)) return t > 0 ? 1 : -1;
  if (!a.code || !b.code) {
    if (a.code !== b.code) return a.code ? -1 : 1;
  } else {
    const c = a.code.localeCompare(b.code, "en", { numeric: true });
    if (c) return c;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One desk card from rows already read (pure). */
export function deskCardView(
  row: DeskCardRow,
  ctx: Omit<SummaryContext, "orders"> & { orders: ReadonlyMap<string, DeskOrderRow> },
  arrival: ArrivalRow | null,
): DeskCard {
  const summary = cardSummary(row, ctx);
  const order = ctx.orders.get(row.order_id);
  return {
    ...summary,
    variation: text(row.variation),
    declaredValueCents: typeof row.estimated_value_cents === "number" && row.estimated_value_cents > 0 ? row.estimated_value_cents : null,
    notes: text(row.notes),
    knownDefects: text(row.known_defects),
    customerNotes: text(order?.customer_notes),
    receivingPhotos: webUrls(row.receiving_photo_urls),
    customerPhotos: webUrls(row.photo_urls),
    catalogImageUrl: text(row.catalog_image_url),
    orderUrl: `/admin/orders/${encodeURIComponent(row.order_id)}`,
    arrival: arrival
      ? {
          from: arrival.from_location_id ? ctx.locations.get(arrival.from_location_id) ?? null : null,
          at: arrival.created_at,
          by: arrival.by,
          action: arrival.action,
        }
      : null,
  };
}

/**
 * Every card on the desk `locationId` (one view each: photos, card and
 * order details, the order's customer notes, the card's notes and known
 * defects, when it came and from where), newest on the desk first. Reads
 * only; lists are paged (lib/fetch-all.ts) and id lists chunked. Throws on a
 * failed read.
 */
export async function loadDeskCards(admin: SupabaseClient, locationId: string): Promise<DeskCard[]> {
  const rows = await fetchAll<DeskCardRow>((from, to) =>
    admin.from("cards").select(DESK_CARD_COLUMNS).eq("location_id", locationId).order("id").range(from, to));
  if (!rows.length) return [];
  const cardIds = rows.map((r) => r.id);
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const bagIds = [...new Set(rows.map((r) => r.bag_id).filter((b): b is string => !!b))];

  const [orders, bags, events, moves, tierNames] = await Promise.all([
    Promise.all(chunks(orderIds).map(async (part) => {
      const { data, error } = await admin.from("orders").select(`${TRACK_ORDER_COLUMNS}, customer_notes`).in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as DeskOrderRow[];
    })).then((p) => p.flat()),
    Promise.all(chunks(bagIds).map(async (part) => {
      const { data, error } = await admin.from("tier_bags").select(TRACK_BAG_COLUMNS).in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as TrackBagRow[];
    })).then((p) => p.flat()),
    // Stage events newest first per order (as loadOrdersContext reads them)
    Promise.all(chunks(orderIds).map((part) => fetchAll<StageEventRow & { order_id: string }>((from, to) =>
      admin.from("order_events").select("order_id, event_type, description, metadata, created_at").in("order_id", part)
        .in("event_type", ["stage_update", "round_started"])
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)))).then((p) => p.flat()),
    Promise.all(chunks(cardIds).map((part) => fetchAll<ArrivalRow>((from, to) =>
      admin.from("card_moves").select("id, card_id, from_location_id, to_location_id, action, by, created_at")
        .in("card_id", part).eq("to_location_id", locationId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)))).then((p) => p.flat()),
    // Tier names as the admin set them (best effort, like loadTierNames)
    admin.from("restoration_settings").select("tier, display_name").then(({ data }) =>
      Object.fromEntries(((data ?? []) as { tier: string; display_name: string | null }[]).filter((r) => r.display_name).map((r) => [r.tier, r.display_name as string]))),
  ]);

  const arrivals = latestArrivals(moves, locationId);
  // The desk itself and the holders the cards came from
  const placeIds = [...new Set([locationId, ...[...arrivals.values()].map((a) => a.from_location_id).filter((id): id is string => !!id)])];
  const places = (await Promise.all(chunks(placeIds).map(async (part) => {
    const { data, error } = await admin.from("locations").select(LOCATION_REF_COLUMNS).in("id", part);
    if (error) throw new Error(error.message);
    return (data ?? []) as Pick<LocationRow, "id" | "code" | "name" | "kind" | "station" | "serial" | "stage">[];
  }))).flat();

  const byOrder = new Map<string, StageEventRow[]>();
  for (const e of events) {
    const list = byOrder.get(e.order_id) ?? [];
    list.push(e);
    byOrder.set(e.order_id, list);
  }
  const ctx = {
    orders: new Map(orders.map((o) => [o.id, o])),
    bags: new Map(bags.map((b) => [b.id, b])),
    events: byOrder,
    locations: new Map(places.map((p) => [p.id, locationRef(p)])),
    tierNames,
  };
  return rows.map((r) => deskCardView(r, ctx, arrivals.get(r.id) ?? null)).sort(compareDeskCards);
}
