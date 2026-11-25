import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { tierDisplayName } from "@/lib/intake/codes";
import { loadTierNames } from "@/lib/intake/data";
import { isBagComplete, keepsHistoricalCompletion } from "@/lib/intake/stage-plan";
import type { IntakeResult } from "@/lib/intake/types";
import {
  OPEN_BAGS_CODE, OPEN_BAGS_NAME, bagPlaceOf, bagsToOpen, binAllowed, binClosedText, isBackInBag, isReadyToShipPlace, stillOutText,
} from "@/lib/intake/tracking/bag-home";
import { chunks, type OrdersContext } from "@/lib/intake/tracking/context";
import type { PlanAction, PlannedMove } from "@/lib/intake/tracking/move-plan";
import { DONE_STAGE_KEY, LOCATION_COLUMNS, LOCATION_REF_COLUMNS, SHIP_LOCATION_CODE, locationRef } from "@/lib/intake/tracking/places";
import { TRACK_BAG_COLUMNS, isRefunded, type TrackBagRow } from "@/lib/intake/tracking/summaries";
import type { LocationKind, LocationRef, LocationRow, TrackBagPlace } from "@/lib/intake/tracking/types";

/**
 * Where bags go (owner, Nov 25 2026), server only; the rules and words are in
 * bag-home.ts (pure). Admin access is checked by the calling route.
 *
 * - A card that comes out of its bag (to a desk or holder, any page) files the
 *   bag in the Open bags box (LOC-OPEN-BAGS, made on first use): settleBags,
 *   called by every assign / move / done in moves.ts.
 * - Done puts the card back in its bag (no place); the step picker's Done
 *   (advanceCards) does the same through returnCardsToBags.
 * - A finished bag goes in the Ready to ship bin (LOC-SHIP): putBagReadyToShip.
 * Bags have no move history table: tier_bags.location_id / located_at only,
 * as shelveBags writes them.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type PlaceSpec = { code: string; name: string; kind: LocationKind; sort: number };
const OPEN_BAGS: PlaceSpec = { code: OPEN_BAGS_CODE, name: OPEN_BAGS_NAME, kind: "other", sort: 0 };
const SHIP_BIN: PlaceSpec = { code: SHIP_LOCATION_CODE, name: "Shipping", kind: "shipping", sort: 1000 };

/**
 * The place `spec.code`, made if missing (insert ... on conflict (code) do
 * nothing, then read it, race-safe like ensureDesk) and switched back on if
 * it was off: bags are filed there automatically. An existing place keeps its
 * name and kind. Throws on a database error.
 */
async function ensurePlace(admin: SupabaseClient, spec: PlaceSpec, by: string | null): Promise<LocationRow> {
  const { data: inserted, error: insErr } = await admin.from("locations")
    .upsert({ code: spec.code, name: spec.name, kind: spec.kind, stage: null, sort: spec.sort, active: true, created_by: by }, { onConflict: "code", ignoreDuplicates: true })
    .select(LOCATION_COLUMNS);
  if (insErr) throw new Error(insErr.message);
  if (inserted?.length) return inserted[0] as LocationRow;
  const { data, error } = await admin.from("locations").select(LOCATION_COLUMNS).eq("code", spec.code).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`The place ${spec.code} could not be made`);
  const row = data as LocationRow;
  if (row.active !== false) return row;
  const { data: on, error: onErr } = await admin.from("locations").update({ active: true }).eq("id", row.id).select(LOCATION_COLUMNS).maybeSingle();
  if (onErr) throw new Error(onErr.message);
  return (on as LocationRow | null) ?? row;
}

/** The Open bags box, LOC-OPEN-BAGS "OPEN BAGS" (kind 'other'), made on first use. Throws on a database error. */
export function ensureOpenBags(admin: SupabaseClient, by: string | null = null): Promise<LocationRow> {
  return ensurePlace(admin, OPEN_BAGS, by);
}

/** The Ready to ship bin, LOC-SHIP (seeded by 20261124_card_tracking.sql as "Shipping"; made if missing). Throws on a database error. */
export function ensureShipBin(admin: SupabaseClient, by: string | null = null): Promise<LocationRow> {
  return ensurePlace(admin, SHIP_BIN, by);
}

/** Put bags at a place (tier_bags.location_id / located_at); bags already there are left alone. Returns the bags it moved. */
async function placeBags(admin: SupabaseClient, bagIds: readonly string[], placeId: string): Promise<string[]> {
  const moved: string[] = [];
  const now = new Date().toISOString();
  for (const part of chunks([...new Set(bagIds)])) {
    const { data, error } = await admin.from("tier_bags").update({ location_id: placeId, located_at: now })
      .in("id", part).or(`location_id.is.null,location_id.neq.${placeId}`).select("id");
    if (error) throw new Error(error.message);
    moved.push(...(data ?? []).map((r) => r.id as string));
  }
  return moved;
}

/**
 * After an assign / move / done (moves.ts planAndRun, with the moves that
 * were written): files in the Open bags box every bag a card came out of
 * (bagsToOpen), and answers each touched bag with where it is now. `returned`
 * counts the cards put back in their bag (Done: no place). Best effort and
 * never throws: the cards' own moves are saved already; a bag that couldn't
 * be filed keeps its place and the page doesn't tell staff to move it.
 */
export async function settleBags(
  admin: SupabaseClient,
  input: { action: PlanAction; target: Pick<LocationRow, "code" | "kind"> | null; moves: readonly PlannedMove[]; ctx: OrdersContext; by: string | null },
): Promise<{ bags: TrackBagPlace[]; returned: number }> {
  const { ctx, moves } = input;
  if (!moves.length) return { bags: [], returned: 0 };
  let opened: string[] = [];
  let openPlace: LocationRef | null = null;
  try {
    const toOpen = input.action === "assign" || input.action === "move"
      ? bagsToOpen(
          input.target,
          moves.map((m) => ({
            bagId: m.bagId,
            // A place that isn't in the list any more counts as out of the bag
            from: m.fromLocationId ? ctx.locations.get(m.fromLocationId) ?? { code: "", kind: "other" } : null,
            locationChanges: m.locationChanges,
          })),
          (bagId) => {
            const bag = ctx.bags.get(bagId);
            if (!bag) return undefined;
            return bag.location_id ? ctx.locations.get(bag.location_id) ?? { code: "" } : null;
          },
        )
      : [];
    if (toOpen.length) {
      const box = await ensureOpenBags(admin, input.by);
      openPlace = locationRef(box);
      await placeBags(admin, toOpen, box.id);
      // A bag someone else filed there meanwhile is in the box all the same
      opened = toOpen;
    }
  } catch (e) {
    console.warn("[tracking] bag not filed in the Open bags box:", errText(e));
    opened = [];
  }

  const isReturned = (m: PlannedMove) => m.toLocationId === null && (m.complete || input.action === "done");
  const doneNow = new Set(moves.filter((m) => m.complete).map((m) => m.cardId));
  // Where each card is after this request (a moved card at its new place)
  const placeNow = new Map(moves.map((m) => [m.cardId, m.toLocationId]));
  const bagIds = [...new Set(moves.map((m) => m.bagId).filter((id): id is string => !!id))];
  const bags: TrackBagPlace[] = [];
  for (const bagId of bagIds) {
    const bag = ctx.bags.get(bagId);
    if (!bag) continue;
    const isOpened = opened.includes(bagId);
    const back = moves.filter((m) => m.bagId === bagId && isReturned(m));
    bags.push(bagPlaceOf({
      bag,
      customer: ctx.orders.get(bag.order_id)?.customer_name ?? null,
      location: isOpened ? openPlace : bag.location_id ? ctx.locations.get(bag.location_id) ?? null : null,
      cards: ctx.cards.filter((c) => c.bag_id === bagId).map((c) => {
        const at = placeNow.has(c.id) ? placeNow.get(c.id)! : c.location_id;
        return { completed: !!c.completed || doneNow.has(c.id), refunded: isRefunded(c), inBag: isBackInBag(at ? ctx.locations.get(at) ?? { code: "", kind: "other" } : null) };
      }),
      opened: isOpened,
      returned: back.length,
      tierName: tierDisplayName(bag.tier, ctx.tierNames),
      returnedCodes: back.map((m) => ctx.cards.find((c) => c.id === m.cardId)?.card_code ?? null),
    }));
  }
  return { bags, returned: moves.filter(isReturned).length };
}

type BagRow = Pick<TrackBagRow, "id" | "order_id" | "bag_code" | "tier" | "location_id" | "completed_at" | "source">;
type BagCardRow = {
  id: string; order_id: string; bag_id: string | null; card_code: string | null; status: string | null; completed: boolean | null; location_id: string | null;
};
type BagPlaces = {
  bags: BagRow[];
  orders: Map<string, { customer_name: string | null; status: string }>;
  cards: BagCardRow[];
  /** The places the bags and their cards are in. */
  places: Map<string, LocationRef>;
  tierNames: Record<string, string>;
};

/** Bags with their order's customer, status and cards, and the places the bags and cards sit in. Throws on a failed read. */
async function loadBagPlaces(admin: SupabaseClient, bagIds: readonly string[]): Promise<BagPlaces> {
  const ids = [...new Set(bagIds)];
  const bags = (await Promise.all(chunks(ids).map(async (part) => {
    const { data, error } = await admin.from("tier_bags").select(TRACK_BAG_COLUMNS).in("id", part);
    if (error) throw new Error(error.message);
    return (data ?? []) as BagRow[];
  }))).flat();
  const orderIds = [...new Set(bags.map((b) => b.order_id))];
  const [orders, cards, tierNames] = await Promise.all([
    Promise.all(chunks(orderIds).map(async (part) => {
      const { data, error } = await admin.from("orders").select("id, customer_name, status").in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; customer_name: string | null; status: string }[];
    })).then((p) => p.flat()),
    Promise.all(chunks(ids).map((part) => fetchAll<BagCardRow>((from, to) =>
      admin.from("cards").select("id, order_id, bag_id, card_code, status, completed, location_id").in("bag_id", part).order("id").range(from, to)))).then((p) => p.flat()),
    loadTierNames(admin).catch(() => ({} as Record<string, string>)),
  ]);
  const placeIds = [...new Set([...bags.map((b) => b.location_id), ...cards.map((c) => c.location_id)].filter((id): id is string => !!id))];
  const places = (await Promise.all(chunks(placeIds).map(async (part) => {
    const { data, error } = await admin.from("locations").select(LOCATION_REF_COLUMNS).in("id", part);
    if (error) throw new Error(error.message);
    return (data ?? []) as Pick<LocationRow, "id" | "code" | "name" | "kind" | "station" | "serial" | "stage">[];
  }))).flat();
  return {
    bags,
    orders: new Map(orders.map((o) => [o.id, o])),
    cards,
    places: new Map(places.map((p) => [p.id, locationRef(p)])),
    tierNames,
  };
}

/** A card's place as read (a place no longer listed counts as somewhere out of the bag). */
const cardPlace = (read: BagPlaces, c: BagCardRow): LocationRef | null =>
  c.location_id ? read.places.get(c.location_id) ?? { id: c.location_id, code: "", name: "another place", kind: "other", station: null, serial: null, stage: null } : null;

/** The bag's words from a read (bagPlaceOf): its place (or `location`), its cards done and back in it. */
function placeFromRead(read: BagPlaces, bag: BagRow, extra: { location?: LocationRef | null; returned?: number; returnedCodes?: (string | null)[] } = {}): TrackBagPlace {
  return bagPlaceOf({
    bag,
    customer: read.orders.get(bag.order_id)?.customer_name ?? null,
    location: extra.location !== undefined ? extra.location : bag.location_id ? read.places.get(bag.location_id) ?? null : null,
    cards: read.cards.filter((c) => c.bag_id === bag.id).map((c) => ({ completed: !!c.completed, refunded: isRefunded(c), inBag: isBackInBag(cardPlace(read, c)) })),
    returned: extra.returned,
    tierName: tierDisplayName(bag.tier, read.tierNames),
    returnedCodes: extra.returnedCodes,
  });
}

/**
 * The step picker's Done (advanceCards, "complete") and the order page's
 * Done toggle: the cards just marked done go back in their bag like the
 * tracking Done: out of their holder or desk (location null, the slot frees
 * up), only where each card still is where it was read (another phone's move
 * wins). Each group's 'done' card_moves rows are written right after that
 * group's move, and a failed write stops there and answers it (as writePlan:
 * no move goes unlogged without the request saying so). `cards`: the cards
 * marked done, with their step before. Answers their bags and where each is
 * (best effort: a failed read for the words answers no bags).
 */
export async function returnCardsToBags(
  admin: SupabaseClient,
  input: { cards: readonly { id: string; stageBefore: string | null }[]; by: string | null },
): Promise<{ ok: true; bags: TrackBagPlace[]; returned: number } | { ok: false; status: number; error: string }> {
  const ids = [...new Set(input.cards.map((c) => c.id))].filter((id) => UUID.test(id));
  if (!ids.length) return { ok: true, bags: [], returned: 0 };
  let rows: { id: string; order_id: string; bag_id: string | null; card_code: string | null; location_id: string | null }[];
  try {
    rows = (await Promise.all(chunks(ids).map(async (part) => {
      const { data, error } = await admin.from("cards").select("id, order_id, bag_id, card_code, location_id").in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as typeof rows;
    }))).flat();
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read where the cards are. (${errText(e)})` };
  }

  // Out of their holder or desk, only from where they were read; each group's history right after its move
  const before = new Map(input.cards.map((c) => [c.id, c.stageBefore]));
  const byFrom = new Map<string, typeof rows>();
  for (const r of rows) if (r.location_id) byFrom.set(r.location_id, [...(byFrom.get(r.location_id) ?? []), r]);
  for (const [from, group] of byFrom) {
    for (const part of chunks(group)) {
      const { data, error } = await admin.from("cards").update({ location_id: null, located_at: null })
        .in("id", part.map((r) => r.id)).eq("location_id", from).select("id");
      if (error) return { ok: false, status: 500, error: `Couldn't take the cards out of their holders. (${error.message})` };
      const moved = new Set((data ?? []).map((r) => r.id as string));
      const logged = part.filter((r) => moved.has(r.id));
      if (!logged.length) continue;
      const { error: logErr } = await admin.from("card_moves").insert(logged.map((r) => ({
        card_id: r.id,
        order_id: r.order_id,
        bag_id: r.bag_id,
        from_location_id: from,
        to_location_id: null,
        stage_before: before.get(r.id) ?? null,
        stage_after: DONE_STAGE_KEY,
        action: "done",
        by: input.by,
        session_id: null,
      })));
      if (logErr) return { ok: false, status: 500, error: `Couldn't save the move. (${logErr.message})` };
    }
  }

  const bagIds = [...new Set(rows.map((r) => r.bag_id).filter((id): id is string => !!id))];
  if (!bagIds.length) return { ok: true, bags: [], returned: rows.length };
  try {
    const read = await loadBagPlaces(admin, bagIds);
    const bags = read.bags.map((bag) => {
      const back = rows.filter((r) => r.bag_id === bag.id);
      return placeFromRead(read, bag, { returned: back.length, returnedCodes: back.map((r) => r.card_code) });
    });
    return { ok: true, bags, returned: rows.length };
  } catch (e) {
    console.warn("[intake] done cards' bags not read:", errText(e));
    return { ok: true, bags: [], returned: rows.length };
  }
}

/**
 * POST /api/admin/track/bag-ready: a finished bag (every non-refunded card
 * done and back in it) is in the Ready to ship bin: tier_bags.location_id =
 * LOC-SHIP (made if missing). Refused (409) while a card is still to do, while
 * a done card is still out of the bag (in a holder, on a desk, on the old Done
 * shelf: "CD-2549-03 is still in CLAMP 07: tap Done on it first."), and for an
 * order shipped back, delivered or cancelled. A bag already there changes nothing.
 */
export async function putBagReadyToShip(
  admin: SupabaseClient,
  input: { bagId: string; by: string | null },
): Promise<IntakeResult<{ bag: TrackBagPlace; changed: boolean; message: string }>> {
  if (!UUID.test(input.bagId)) return { ok: false, status: 404, error: "Bag not found" };
  let read: BagPlaces;
  try {
    read = await loadBagPlaces(admin, [input.bagId]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the bag. Nothing was changed. (${errText(e)})` };
  }
  const bag = read.bags[0];
  if (!bag) return { ok: false, status: 404, error: "Bag not found" };
  const order = read.orders.get(bag.order_id);
  if (order && !binAllowed(order.status)) return { ok: false, status: 409, error: binClosedText(bag.bag_code, order.status) };
  const cards = read.cards.filter((c) => c.bag_id === bag.id);
  const live = cards.filter((c) => !isRefunded(c));
  const finished = isBagComplete(cards) || (!!bag.completed_at && keepsHistoricalCompletion(bag, order?.status ?? null));
  if (!live.length) return { ok: false, status: 409, error: `${bag.bag_code} has no cards to ship.` };
  if (!finished) {
    const done = live.filter((c) => c.completed).length;
    return { ok: false, status: 409, error: `Not every card in ${bag.bag_code} is done yet (${done} of ${live.length} done).` };
  }
  const out = stillOutText(live.map((c) => ({ code: c.card_code, location: cardPlace(read, c) })));
  if (out) return { ok: false, status: 409, error: out };
  try {
    const bin = await ensureShipBin(admin, input.by);
    const changed = (await placeBags(admin, [bag.id], bin.id)).length > 0;
    return { ok: true, changed, message: "In the Ready to ship bin.", bag: placeFromRead(read, bag, { location: locationRef(bin) }) };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't save where the bag is. (${errText(e)})` };
  }
}

/**
 * A card un-done (the order page's toggle, a new round) reopened finished
 * bags: the ones sitting in the Ready to ship bin go back in the Open bags box
 * (work goes on: the bag isn't ready to ship any more). Called by
 * refreshBagCompletion with the bags it reopened. Never throws; answers the
 * bags it moved (with where they are now), [] when none or on a failure.
 */
export async function unbinReopenedBags(admin: SupabaseClient, bagIds: readonly string[], by: string | null = null): Promise<TrackBagPlace[]> {
  const ids = [...new Set(bagIds)].filter((id) => UUID.test(id));
  if (!ids.length) return [];
  try {
    const read = await loadBagPlaces(admin, ids);
    const inBin = read.bags.filter((b) => isReadyToShipPlace(b.location_id ? read.places.get(b.location_id) : null));
    if (!inBin.length) return [];
    const box = await ensureOpenBags(admin, by);
    const moved = new Set(await placeBags(admin, inBin.map((b) => b.id), box.id));
    return inBin.filter((b) => moved.has(b.id)).map((b) => placeFromRead(read, b, { location: locationRef(box) }));
  } catch (e) {
    console.warn("[intake] reopened bag not taken out of the Ready to ship bin:", errText(e));
    return [];
  }
}
