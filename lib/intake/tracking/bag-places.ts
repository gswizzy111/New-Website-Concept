import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { isBagComplete, keepsHistoricalCompletion } from "@/lib/intake/stage-plan";
import type { IntakeResult } from "@/lib/intake/types";
import { OPEN_BAGS_CODE, OPEN_BAGS_NAME, bagPlaceOf, bagsToOpen } from "@/lib/intake/tracking/bag-home";
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
  const bagIds = [...new Set(moves.map((m) => m.bagId).filter((id): id is string => !!id))];
  const bags: TrackBagPlace[] = [];
  for (const bagId of bagIds) {
    const bag = ctx.bags.get(bagId);
    if (!bag) continue;
    const isOpened = opened.includes(bagId);
    bags.push(bagPlaceOf({
      bag,
      customer: ctx.orders.get(bag.order_id)?.customer_name ?? null,
      location: isOpened ? openPlace : bag.location_id ? ctx.locations.get(bag.location_id) ?? null : null,
      cards: ctx.cards.filter((c) => c.bag_id === bagId).map((c) => ({ completed: !!c.completed || doneNow.has(c.id), refunded: isRefunded(c) })),
      opened: isOpened,
      returned: moves.filter((m) => m.bagId === bagId && isReturned(m)).length,
    }));
  }
  return { bags, returned: moves.filter(isReturned).length };
}

type BagRow = Pick<TrackBagRow, "id" | "order_id" | "bag_code" | "location_id" | "completed_at" | "source">;
type BagCardRow = { id: string; order_id: string; bag_id: string | null; status: string | null; completed: boolean | null; location_id: string | null };

/** Bags with their order's customer, status and cards, and the places they sit in. Throws on a failed read. */
async function loadBagPlaces(admin: SupabaseClient, bagIds: readonly string[]): Promise<{
  bags: BagRow[];
  orders: Map<string, { customer_name: string | null; status: string }>;
  cards: BagCardRow[];
  places: Map<string, LocationRef>;
}> {
  const ids = [...new Set(bagIds)];
  const bags = (await Promise.all(chunks(ids).map(async (part) => {
    const { data, error } = await admin.from("tier_bags").select(TRACK_BAG_COLUMNS).in("id", part);
    if (error) throw new Error(error.message);
    return (data ?? []) as BagRow[];
  }))).flat();
  const orderIds = [...new Set(bags.map((b) => b.order_id))];
  const placeIds = [...new Set(bags.map((b) => b.location_id).filter((id): id is string => !!id))];
  const [orders, cards, places] = await Promise.all([
    Promise.all(chunks(orderIds).map(async (part) => {
      const { data, error } = await admin.from("orders").select("id, customer_name, status").in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; customer_name: string | null; status: string }[];
    })).then((p) => p.flat()),
    Promise.all(chunks(ids).map((part) => fetchAll<BagCardRow>((from, to) =>
      admin.from("cards").select("id, order_id, bag_id, status, completed, location_id").in("bag_id", part).order("id").range(from, to)))).then((p) => p.flat()),
    Promise.all(chunks(placeIds).map(async (part) => {
      const { data, error } = await admin.from("locations").select(LOCATION_REF_COLUMNS).in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as Pick<LocationRow, "id" | "code" | "name" | "kind" | "station" | "serial" | "stage">[];
    })).then((p) => p.flat()),
  ]);
  return {
    bags,
    orders: new Map(orders.map((o) => [o.id, o])),
    cards,
    places: new Map(places.map((p) => [p.id, locationRef(p)])),
  };
}

/**
 * The step picker's Done (advanceCards, "complete"): the cards it just marked
 * done go back in their bag like the tracking Done: out of their holder or
 * desk (location null, the slot frees up; a card_moves 'done' row each), only
 * where each card still is where it was read. `cards`: the cards marked done,
 * with their step before. Answers their bags and where each is. Never throws
 * (the cards are done already; a failure leaves a card where it was).
 */
export async function returnCardsToBags(
  admin: SupabaseClient,
  input: { cards: readonly { id: string; stageBefore: string | null }[]; by: string | null },
): Promise<{ bags: TrackBagPlace[]; returned: number }> {
  const ids = [...new Set(input.cards.map((c) => c.id))].filter((id) => UUID.test(id));
  if (!ids.length) return { bags: [], returned: 0 };
  try {
    const rows = (await Promise.all(chunks(ids).map(async (part) => {
      const { data, error } = await admin.from("cards").select("id, order_id, bag_id, location_id").in("id", part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; order_id: string; bag_id: string | null; location_id: string | null }[];
    }))).flat();

    // Out of their holder or desk, only from where they were read (another phone's move wins)
    const placed = rows.filter((r) => r.location_id);
    const byFrom = new Map<string, string[]>();
    for (const r of placed) byFrom.set(r.location_id!, [...(byFrom.get(r.location_id!) ?? []), r.id]);
    const moved = new Set<string>();
    for (const [from, part] of byFrom) {
      for (const chunk of chunks(part)) {
        const { data, error } = await admin.from("cards").update({ location_id: null, located_at: null })
          .in("id", chunk).eq("location_id", from).select("id");
        if (error) throw new Error(error.message);
        for (const r of data ?? []) moved.add(r.id as string);
      }
    }
    if (moved.size) {
      const before = new Map(input.cards.map((c) => [c.id, c.stageBefore]));
      const { error } = await admin.from("card_moves").insert(placed.filter((r) => moved.has(r.id)).map((r) => ({
        card_id: r.id,
        order_id: r.order_id,
        bag_id: r.bag_id,
        from_location_id: r.location_id,
        to_location_id: null,
        stage_before: before.get(r.id) ?? null,
        stage_after: DONE_STAGE_KEY,
        action: "done",
        by: input.by,
        session_id: null,
      })));
      if (error) console.warn("[intake] done card's move not logged:", error.message);
    }

    const bagIds = [...new Set(rows.map((r) => r.bag_id).filter((id): id is string => !!id))];
    if (!bagIds.length) return { bags: [], returned: rows.length };
    const read = await loadBagPlaces(admin, bagIds);
    const bags = read.bags.map((bag) => bagPlaceOf({
      bag,
      customer: read.orders.get(bag.order_id)?.customer_name ?? null,
      location: bag.location_id ? read.places.get(bag.location_id) ?? null : null,
      cards: read.cards.filter((c) => c.bag_id === bag.id).map((c) => ({ completed: !!c.completed, refunded: isRefunded(c) })),
      returned: rows.filter((r) => r.bag_id === bag.id).length,
    }));
    return { bags, returned: rows.length };
  } catch (e) {
    console.warn("[intake] done cards not put back in their bags:", errText(e));
    return { bags: [], returned: 0 };
  }
}

/**
 * POST /api/admin/track/bag-ready: a finished bag (every non-refunded card
 * done) is in the Ready to ship bin: tier_bags.location_id = LOC-SHIP (made if
 * missing). Refused (409) while a card is still to do, so a bag can't be
 * filed as ready by mistake. A bag already there changes nothing.
 */
export async function putBagReadyToShip(
  admin: SupabaseClient,
  input: { bagId: string; by: string | null },
): Promise<IntakeResult<{ bag: TrackBagPlace; changed: boolean; message: string }>> {
  if (!UUID.test(input.bagId)) return { ok: false, status: 404, error: "Bag not found" };
  let read: Awaited<ReturnType<typeof loadBagPlaces>>;
  try {
    read = await loadBagPlaces(admin, [input.bagId]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the bag. Nothing was changed. (${errText(e)})` };
  }
  const bag = read.bags[0];
  if (!bag) return { ok: false, status: 404, error: "Bag not found" };
  const order = read.orders.get(bag.order_id);
  const cards = read.cards.filter((c) => c.bag_id === bag.id);
  const live = cards.filter((c) => !isRefunded(c));
  const finished = isBagComplete(cards) || (!!bag.completed_at && keepsHistoricalCompletion(bag, order?.status ?? null));
  if (!live.length) return { ok: false, status: 409, error: `${bag.bag_code} has no cards to ship.` };
  if (!finished) {
    const done = live.filter((c) => c.completed).length;
    return { ok: false, status: 409, error: `Not every card in ${bag.bag_code} is done yet (${done} of ${live.length} done).` };
  }
  try {
    const bin = await ensureShipBin(admin, input.by);
    const changed = (await placeBags(admin, [bag.id], bin.id)).length > 0;
    return {
      ok: true,
      changed,
      message: "In the Ready to ship bin.",
      bag: bagPlaceOf({
        bag,
        customer: order?.customer_name ?? null,
        location: locationRef(bin),
        cards: cards.map((c) => ({ completed: !!c.completed, refunded: isRefunded(c) })),
      }),
    };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't save where the bag is. (${errText(e)})` };
  }
}
