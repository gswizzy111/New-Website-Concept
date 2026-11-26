import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/intake/codes";
import { cardStageState, furthestStageIndex } from "@/lib/intake/stage-plan";
import { refreshBagCompletion } from "@/lib/intake/stages";
import { completeOrdersIfAllDone, type OrderAutoComplete } from "@/lib/intake/order-autocomplete";
import { chunks, loadOrdersContext, type OrdersContext } from "@/lib/intake/tracking/context";
import { getLocationByCode, getLocationById } from "@/lib/intake/tracking/locations";
import {
  holderTakenText, oneCardOnlyText, oneCardRefusal, overCapacity, planCards,
  type CardPlan, type PlanAction, type PlanCard, type PlanLocation, type PlannedMove,
} from "@/lib/intake/tracking/move-plan";
import { withBagSentences } from "@/lib/intake/tracking/bag-home";
import { settleBags } from "@/lib/intake/tracking/bag-places";
import { isDeskCode } from "@/lib/intake/tracking/desk-codes";
import { holdsOneCard, isSlot, locationRef } from "@/lib/intake/tracking/places";
import { loadCardSummaries } from "@/lib/intake/tracking/resolve";
import { sendStageUpdateEmail } from "@/lib/intake/tracking/stage-email";
import { isReceived, isRefunded, type TrackCardRow } from "@/lib/intake/tracking/summaries";
import type {
  CapacityConflict, HolderFull, LocationRef, LocationRow, MoveAction, TrackActionResponse, TrackCardResult, TrackCardSummary,
} from "@/lib/intake/tracking/types";

/**
 * Putting cards in slots and taking them out (the Scan page's assign, move,
 * take out and done), server only. Admin access is checked by the calling
 * route. The rules are in move-plan.ts (planCards); this file reads, checks
 * the place's room (capacityCheck), then writes in this order:
 *   1. cards.location_id / located_at (the old slot frees up), only where
 *      each card still is where it was read: a second phone moving the same
 *      card, or the same request sent twice, finds it gone and writes nothing
 *      for it (no second step event, history row or email); into a one-card
 *      holder the holder is read again right after, and if another card got
 *      in at the same moment (two phones) this request's card goes back where
 *      it was and the answer is the 409 HolderFull, before anything else is
 *      written;
 *   2. card_moves rows (history);
 *   3. stage_update events for cards going into a slot at another step
 *      (later or earlier): exactly what the stage buttons and advanceCards()
 *      write ("Stage: <stage> [card:<id>]", metadata { card_id, stage, round,
 *      by, bulk }); customer visible only for a step new to the customer
 *      (the move's `email`, stepEmailsCustomer), staff only otherwise;
 *   4. cards marked done (as POST /api/admin/cards/[id]/complete);
 *   5. at most ONE customer email per order, listing only the cards at a new
 *      step for the customer (none for going back, re-entering, or done);
 *   6. bag completion refresh for cards marked done;
 *   7. orders whose last cards were just marked done become Completed
 *      (completeOrderIfAllDone: the status button's event and emails, once);
 *   8. bags (settleBags in bag-places.ts, best effort): a card that came out
 *      of its bag to a desk or holder files the bag in the Open bags box, and
 *      the answer says where each touched bag is (Done: "Put it back in
 *      REYES's bag: Open bags box, under R.").
 * A failed write stops there and answers 500; doing it again is safe (cards
 * already there at that step are left alone; a card already in its new slot
 * still gets its step).
 *
 * Room (owner, Nov 26 2026: "I want every single sticker station thingy to
 * only be able to hold one card other than my desk"): a one-card holder
 * (every station slot, every other place but a desk or the Open bags box:
 * places.ts holdsOneCard) takes ONE card whatever its stored capacity says,
 * and `force` never bypasses it: a second card, or several at once, is the
 * 409 HolderFull ("CLAMP 07 already has a card (CD-2549-03 · Charizard).
 * Take it out first, or pick another holder." / "CLAMP 07 holds one card.
 * Pick one card to put here."). Putting a card in the holder it is already
 * in is no change (200). A desk has no limit; a desk with a limit set (the
 * capacity column) answers the 409 CapacityConflict, which `force` adds
 * anyway ("Add anyway?"). Shelves, Done and Shipping have no limit.
 */

export const MAX_CARDS = 200;

export type TrackResult =
  | ({ ok: true } & TrackActionResponse)
  | { ok: false; status: number; error: string; conflict?: CapacityConflict; full?: HolderFull };

type Common = { by: string | null; sessionId?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function cardIdsProblem(cardIds: readonly string[] | undefined): string | null {
  if (!cardIds?.length) return "Pick at least one card.";
  if (cardIds.length > MAX_CARDS) return `Pick at most ${MAX_CARDS} cards at a time.`;
  if (cardIds.some((id) => typeof id !== "string" || !UUID.test(id))) return "Invalid card.";
  return null;
}

async function placeByCode(admin: SupabaseClient, raw: string): Promise<{ loc: LocationRow } | { ok: false; status: number; error: string }> {
  const code = normalizeCode(raw);
  let loc: LocationRow | null;
  try {
    loc = await getLocationByCode(admin, raw);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the slot. Nothing was changed. (${errText(e)})` };
  }
  if (!loc) return { ok: false, status: 404, error: `No slot or place has the code ${code || String(raw ?? "").trim().slice(0, 60) || "(blank)"}.` };
  if (loc.active === false) return { ok: false, status: 409, error: `${loc.name} is switched off. Turn it back on in Places first.` };
  return { loc };
}

const planLocation = (l: LocationRow): PlanLocation => ({ id: l.id, code: l.code, name: l.name, kind: l.kind, stage: l.stage });

/** A card as the planner sees it (its step from the order's stage events). */
export function planCardOf(c: TrackCardRow, ctx: Pick<OrdersContext, "events">): PlanCard {
  const events = ctx.events.get(c.order_id) ?? [];
  const st = cardStageState({ id: c.id, completed: c.completed, current_round: c.current_round }, events);
  return {
    id: c.id,
    code: c.card_code,
    name: c.card_name,
    orderId: c.order_id,
    bagId: c.bag_id,
    locationId: c.location_id,
    refunded: isRefunded(c),
    received: isReceived(c),
    completed: st.completed,
    current: st.current,
    round: st.round,
    furthest: furthestStageIndex(c.id, st.round, events),
  };
}

/** The requested cards' orders, all their cards and stage events. */
async function loadForCards(admin: SupabaseClient, cardIds: readonly string[]): Promise<OrdersContext> {
  const orderIds = new Set<string>();
  for (const part of chunks([...new Set(cardIds)])) {
    const { data, error } = await admin.from("cards").select("id, order_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.order_id) orderIds.add(r.order_id as string);
  }
  return loadOrdersContext(admin, [...orderIds]);
}

async function occupantIds(admin: SupabaseClient, locationId: string): Promise<string[]> {
  const { data, error } = await admin.from("cards").select("id").eq("location_id", locationId).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

/** The 409 HolderFull for a one-card holder (holdsOneCard): what's in it now, and what to do. */
function holderFull(loc: Pick<LocationRow, "code" | "name">, why: "taken" | "several", occupants: TrackCardSummary[]): HolderFull {
  return {
    error: why === "taken" ? holderTakenText(loc.name, occupants) : oneCardOnlyText(loc.name),
    holderFull: true,
    holder: { code: loc.code, name: loc.name },
    occupants,
  };
}

/**
 * Whether the place has room for the cards the plan puts in it: null when it
 * has; `full` (409 HolderFull) for a one-card holder that can't take them,
 * whatever `force` says; `conflict` (409 CapacityConflict, "Add anyway?")
 * for any other place with a capacity set (a desk with a limit), unless
 * `force`. Only cards that would go in count; cards already inside never
 * trip it.
 */
async function capacityCheck(
  admin: SupabaseClient,
  loc: LocationRow,
  plan: CardPlan,
  force: boolean | undefined,
): Promise<{ full: HolderFull } | { conflict: CapacityConflict } | null> {
  const going = plan.moves.filter((m) => m.locationChanges && m.toLocationId === loc.id).map((m) => m.cardId);
  if (!going.length) return null;
  if (holdsOneCard(loc)) {
    // The owner's rule: one card, whatever capacity is stored; force can't add a second
    const inside = await occupantIds(admin, loc.id);
    const others = inside.filter((id) => !going.includes(id));
    const why = oneCardRefusal(going, others);
    if (!why) return null;
    return { full: holderFull(loc, why, why === "taken" ? await loadCardSummaries(admin, others) : []) };
  }
  if (force || loc.capacity == null) return null;
  const inside = await occupantIds(admin, loc.id);
  if (!overCapacity(loc.capacity, inside, going)) return null;
  const others = inside.filter((id) => !going.includes(id));
  return {
    conflict: {
      error: `${loc.name} holds ${loc.capacity === 1 ? "1 card" : `${loc.capacity} cards`} and ${others.length === 1 ? "has 1" : `has ${others.length}`} in it. Add anyway?`,
      overCapacity: true,
      capacity: loc.capacity,
      occupants: await loadCardSummaries(admin, others),
    },
  };
}

/**
 * POST /api/admin/track/assign: put cards (by id) in the slot or place
 * `locationCode`. Each card leaves its old slot; in a slot its step becomes
 * the slot's step (later or earlier). A one-card holder that has a card, or
 * several cards at once into one, is the 409 HolderFull (force or not); a
 * desk with a limit set that is full is the 409 CapacityConflict unless
 * `force`.
 */
export async function assignCards(
  admin: SupabaseClient,
  input: Common & { locationCode: string; cardIds: readonly string[]; force?: boolean; action?: MoveAction },
): Promise<TrackResult> {
  const bad = cardIdsProblem(input.cardIds);
  if (bad) return { ok: false, status: 400, error: bad };
  const place = await placeByCode(admin, input.locationCode);
  if (!("loc" in place)) return place;
  return planAndRun(admin, "assign", place.loc, input.cardIds, input, [], input.force);
}

/**
 * POST /api/admin/track/move: move the cards in the slot `fromCode` (all, or
 * only `cardIds`) to the slot `toCode`. Their step follows the new slot. Room
 * as assignCards: a one-card holder takes one card (409 HolderFull).
 */
export async function moveSlot(
  admin: SupabaseClient,
  input: Common & { fromCode: string; toCode: string; cardIds?: readonly string[]; force?: boolean },
): Promise<TrackResult> {
  if (input.cardIds !== undefined) {
    const bad = cardIdsProblem(input.cardIds);
    if (bad) return { ok: false, status: 400, error: bad };
  }
  const from = await placeByCode(admin, input.fromCode);
  if (!("loc" in from)) return from;
  const to = await placeByCode(admin, input.toCode);
  if (!("loc" in to)) return to;
  if (from.loc.id === to.loc.id) return { ok: false, status: 400, error: `That's ${to.loc.name} again. Scan the slot the cards go to.` };
  let inside: string[];
  try {
    inside = await occupantIds(admin, from.loc.id);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read ${from.loc.name}. Nothing was changed. (${errText(e)})` };
  }
  const wanted = input.cardIds ? [...new Set(input.cardIds)] : inside;
  const moving = wanted.filter((id) => inside.includes(id));
  if (!moving.length) {
    return { ok: false, status: 409, error: input.cardIds ? `Those cards aren't in ${from.loc.name} any more.` : `${from.loc.name} is empty.` };
  }
  const notInside: TrackCardResult[] = wanted.filter((id) => !inside.includes(id))
    .map((id) => ({ cardId: id, code: null, name: null, ok: false, changed: false, message: `Not in ${from.loc.name} any more.` }));
  return planAndRun(admin, "move", to.loc, moving, input, notInside, input.force);
}

/**
 * The place a Done or Take out names (`fromCode`: the holder the cards were
 * shown in). Unlike a move's places it may be switched off: its cards can
 * still be finished or taken out.
 */
async function fromPlace(admin: SupabaseClient, raw: string): Promise<{ loc: LocationRow } | { ok: false; status: number; error: string }> {
  let loc: LocationRow | null;
  try {
    loc = await getLocationByCode(admin, raw);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the slot. Nothing was changed. (${errText(e)})` };
  }
  if (!loc) return { ok: false, status: 404, error: `No slot or place has the code ${normalizeCode(raw) || String(raw ?? "").trim().slice(0, 60) || "(blank)"}.` };
  return { loc };
}

/** Where a card is now, for "Not in CLAMP 07 any more (now in HEAT PRESS 01)": in a holder, on a desk, on a shelf, in its bag. */
export function nowAtText(loc: Pick<LocationRef, "code" | "name" | "kind"> | null | undefined): string {
  if (!loc) return "now in its bag";
  if (loc.kind === "other" && isDeskCode(loc.code)) return `now on ${loc.name}`;
  if (loc.kind === "shelf") return `now on shelf ${loc.name}`;
  if (loc.kind === "other") return `now at ${loc.name}`;
  return `now in ${loc.name}`;
}

/** A card refused because it isn't in the holder the request named any more. */
export function notInPlaceText(placeName: string, now: Pick<LocationRef, "code" | "name" | "kind"> | null | undefined): string {
  return `Not in ${placeName} any more (${nowAtText(now)}).`;
}

/**
 * POST /api/admin/track/release: take cards out of their slots (no place; the
 * step stays). With `fromCode` (the holder they were shown in) only cards
 * still in it are taken out; the others are refused, each with "Not in
 * CLAMP 07 any more (now in HEAT PRESS 01)." (none left in it: 409).
 */
export async function releaseCards(admin: SupabaseClient, input: Common & { cardIds: readonly string[]; fromCode?: string | null }): Promise<TrackResult> {
  const bad = cardIdsProblem(input.cardIds);
  if (bad) return { ok: false, status: 400, error: bad };
  let only: LocationRow | null = null;
  if (input.fromCode != null) {
    const from = await fromPlace(admin, input.fromCode);
    if (!("loc" in from)) return from;
    only = from.loc;
  }
  return planAndRun(admin, "release", null, input.cardIds, input, [], undefined, only);
}

/**
 * POST /api/admin/track/done: mark cards done (as the card's Done toggle);
 * they leave their holder or desk and go back IN THEIR BAG (no place: owner,
 * Nov 25 2026, cards carry no sticker, so a loose card on a shared Done pile
 * can't be matched). The answer's message says where the bag is ("Done. Put
 * it back in REYES's bag: Open bags box, under R."). Bags whose last card
 * this was become complete. LOC-DONE stays a place for anyone scanning cards
 * to it (assign), but Done never uses it. With `fromCode` (the holder the
 * cards were shown in, e.g. the Scan page's holder view) only cards still in
 * it are marked done; the others are refused, each with "Not in CLAMP 07 any
 * more (now in HEAT PRESS 01)." (none left in it: 409), so a card someone
 * moved meanwhile is never finished from a stale screen.
 */
export async function markCardsDone(admin: SupabaseClient, input: Common & { cardIds: readonly string[]; fromCode?: string | null }): Promise<TrackResult> {
  const bad = cardIdsProblem(input.cardIds);
  if (bad) return { ok: false, status: 400, error: bad };
  let only: LocationRow | null = null;
  if (input.fromCode != null) {
    const from = await fromPlace(admin, input.fromCode);
    if (!("loc" in from)) return from;
    only = from.loc;
  }
  return planAndRun(admin, "done", null, input.cardIds, input, [], undefined, only);
}

/**
 * Put cards (by id) in a place by id, e.g. Receiving placing cards on their
 * due-date shelf slot with action "receive". Same rules and writes as
 * assignCards; `force` defaults to true (shelves have no limit), but a
 * one-card holder still takes one card.
 */
export async function placeCards(
  admin: SupabaseClient,
  input: Common & { locationId: string; cardIds: readonly string[]; action?: MoveAction; force?: boolean },
): Promise<TrackResult> {
  if (!input.cardIds.length) return { ok: false, status: 400, error: "Pick at least one card." };
  if (input.cardIds.some((id) => !UUID.test(id))) return { ok: false, status: 400, error: "Invalid card." };
  let loc: LocationRow | null;
  try {
    loc = await getLocationById(admin, input.locationId);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the place. Nothing was changed. (${errText(e)})` };
  }
  if (!loc) return { ok: false, status: 404, error: "Place not found" };
  return planAndRun(admin, "assign", loc, input.cardIds, input, [], input.force ?? true);
}

async function planAndRun(
  admin: SupabaseClient,
  action: PlanAction,
  target: LocationRow | null,
  cardIds: readonly string[],
  input: Common & { action?: MoveAction },
  extraResults: TrackCardResult[],
  force?: boolean,
  only?: LocationRow | null,
): Promise<TrackResult> {
  let ctx: OrdersContext;
  try {
    ctx = await loadForCards(admin, cardIds);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the cards. Nothing was changed. (${errText(e)})` };
  }
  // `only`: the holder the cards must still be in (Done / Take out from a holder's screen). A card
  // read elsewhere is refused; one moved after this read is left alone by writePlan (lost)
  if (only) {
    const split = splitByPlace(ctx, cardIds, only);
    if (!split.keep.length) return { ok: false, status: 409, error: split.error ?? `Those cards aren't in ${only.name} any more.` };
    cardIds = split.keep;
    extraResults = [...extraResults, ...split.refused];
  }
  const plan = planCards({
    action,
    target: target ? planLocation(target) : null,
    cardIds,
    cards: ctx.cards.map((c) => planCardOf(c, ctx)),
    actionName: input.action,
  });
  if (target && (action === "assign" || action === "move")) {
    try {
      const room = await capacityCheck(admin, target, plan, force);
      if (room && "full" in room) return { ok: false, status: 409, error: room.full.error, full: room.full };
      if (room) return { ok: false, status: 409, error: room.conflict.error, conflict: room.conflict };
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't read ${target.name}. Nothing was changed. (${errText(e)})` };
    }
  }
  const run = await writePlan(admin, plan, ctx, target, input);
  if (!run.ok) return run;
  // Cards someone else moved between the read and the write (left alone)
  const lost = new Set(run.lost);
  const results = plan.results.map((r) => (lost.has(r.cardId)
    ? { cardId: r.cardId, code: r.code, name: r.name, ok: false, changed: false, message: MOVED_MEANWHILE }
    : r));
  const line = !lost.size ? plan.message
    : plan.results.length === 1 ? MOVED_MEANWHILE
    : `${plan.message} ${lost.size === 1 ? "1 card was" : `${lost.size} cards were`} moved by someone else just now: scan again.`;
  // Bags: a card out files its bag in the Open bags box; Done puts cards back in their bag (bag-places.ts)
  const settled = await settleBags(admin, { action, target, moves: plan.moves.filter((m) => !lost.has(m.cardId)), ctx, by: input.by });
  const message = withBagSentences(line, settled.bags, settled.returned);
  return {
    ok: true,
    location: target ? locationRef(target) : null,
    results: [...results, ...extraResults],
    message,
    changed: plan.moves.length - lost.size,
    emailedOrders: run.emailedOrders,
    bagsCompleted: run.bagsCompleted,
    freed: run.freed,
    ...(run.orderCompletions.length ? { orderCompletions: run.orderCompletions } : {}),
    ...(settled.bags.length ? { bags: settled.bags } : {}),
  };
}

const MOVED_MEANWHILE = "Someone moved it just now. Scan the slot again.";

/**
 * The requested cards still in `place` (or unknown: the planner says "Card
 * not found."), and the others refused with where each is now. `error`: the
 * whole request's sentence when none is left in it ("CD-2549-07 isn't in
 * CLAMP 07 any more (now in HEAT PRESS 01).").
 */
function splitByPlace(ctx: Pick<OrdersContext, "cards" | "locations">, cardIds: readonly string[], place: Pick<LocationRow, "id" | "name">): { keep: string[]; refused: TrackCardResult[]; error: string | null } {
  const byId = new Map(ctx.cards.map((c) => [c.id, c]));
  const keep: string[] = [];
  const refused: TrackCardResult[] = [];
  const away: { label: string; now: string }[] = [];
  for (const id of [...new Set(cardIds)]) {
    const c = byId.get(id);
    if (!c || c.location_id === place.id) {
      keep.push(id);
      continue;
    }
    const now = c.location_id ? ctx.locations.get(c.location_id) ?? null : null;
    refused.push({ cardId: id, code: c.card_code, name: c.card_name, ok: false, changed: false, message: notInPlaceText(place.name, now) });
    away.push({ label: c.card_code ?? c.card_name ?? "A card", now: nowAtText(now) });
  }
  const error = keep.length ? null
    : away.length === 1 ? `${away[0].label} isn't in ${place.name} any more (${away[0].now}).`
    : `Those cards aren't in ${place.name} any more: ${away.map((a) => `${a.label} (${a.now})`).join(", ")}.`;
  return { keep, refused, error };
}

/**
 * After `mine` went into the one-card holder `target`: when another card is
 * in it too (put there at the same moment from another phone), `mine` go
 * back where they were (place and time) and the answer is the 409 HolderFull;
 * null when the holder holds only `mine`. A failed read leaves the move as
 * it is (capacityCheck found it empty just before).
 */
async function undoIfShared(
  admin: SupabaseClient,
  target: LocationRow,
  mine: readonly PlannedMove[],
  ctx: Pick<OrdersContext, "cards">,
): Promise<{ ok: false; status: number; error: string; full?: HolderFull } | null> {
  const { data, error } = await admin.from("cards").select("id").eq("location_id", target.id).limit(10);
  if (error) {
    console.warn("[tracking] one-card holder not read again:", error.message);
    return null;
  }
  const ours = new Set(mine.map((m) => m.cardId));
  const others = (data ?? []).map((r) => r.id as string).filter((id) => !ours.has(id));
  if (!others.length) return null;
  const was = new Map(ctx.cards.map((c) => [c.id, c.located_at]));
  for (const m of mine) {
    const { error: backErr } = await admin.from("cards")
      .update({ location_id: m.fromLocationId, located_at: m.fromLocationId ? was.get(m.cardId) ?? null : null })
      .eq("id", m.cardId).eq("location_id", target.id);
    if (backErr) return { ok: false, status: 500, error: `Couldn't save where the cards are. (${backErr.message})` };
  }
  let occupants: TrackCardSummary[] = [];
  try {
    occupants = await loadCardSummaries(admin, others);
  } catch (e) {
    console.warn("[tracking] the holder's card not read:", errText(e));
  }
  const full = holderFull(target, "taken", occupants);
  return { ok: false, status: 409, error: full.error, full };
}

async function writePlan(
  admin: SupabaseClient,
  plan: CardPlan,
  ctx: OrdersContext,
  target: LocationRow | null,
  input: Common,
): Promise<{ ok: true; emailedOrders: string[]; bagsCompleted: string[]; freed: LocationRef[]; lost: string[]; orderCompletions: OrderAutoComplete[] } | { ok: false; status: number; error: string; full?: HolderFull }> {
  const out = { ok: true as const, emailedOrders: [] as string[], bagsCompleted: [] as string[], freed: [] as LocationRef[], lost: [] as string[], orderCompletions: [] as OrderAutoComplete[] };
  if (!plan.moves.length) return out;
  const by = input.by;
  const sessionId = input.sessionId && UUID.test(input.sessionId) ? input.sessionId : null;
  const now = new Date().toISOString();

  // 1. Where the cards are (the old slot frees up). Only a card still where
  // it was read moves: one moved meanwhile (another phone, or this request
  // sent twice) is left alone and nothing else is written for it
  const fromGroups = new Map<string | null, string[]>();
  for (const m of plan.moves) if (m.locationChanges) fromGroups.set(m.fromLocationId, [...(fromGroups.get(m.fromLocationId) ?? []), m.cardId]);
  const lost = new Set<string>();
  for (const [from, ids] of fromGroups) {
    for (const part of chunks(ids)) {
      const q = admin.from("cards").update({ location_id: target?.id ?? null, located_at: target ? now : null }).in("id", part);
      const { data, error } = await (from ? q.eq("location_id", from) : q.is("location_id", null)).select("id");
      if (error) return { ok: false, status: 500, error: `Couldn't save where the cards are. (${error.message})` };
      const got = new Set((data ?? []).map((r) => r.id as string));
      for (const id of part) if (!got.has(id)) lost.add(id);
    }
  }
  out.lost = [...lost];
  const moves = plan.moves.filter((m) => !lost.has(m.cardId));
  if (!moves.length) return out;

  // 1b. A one-card holder: capacityCheck read it before this write, so two phones putting a card in
  // the same holder at the same moment could both have got in. Read it again: another card in it
  // now means this request's card goes back where it was, and nothing else is written
  if (target && holdsOneCard(target)) {
    const mine = moves.filter((m) => m.locationChanges && m.toLocationId === target.id);
    if (mine.length) {
      const back = await undoIfShared(admin, target, mine, ctx);
      if (back) return back;
    }
  }

  // 2. History
  for (const part of chunks(moves, 500)) {
    const { error } = await admin.from("card_moves").insert(part.map((m) => ({
      card_id: m.cardId,
      order_id: m.orderId,
      bag_id: m.bagId,
      from_location_id: m.fromLocationId,
      to_location_id: m.toLocationId,
      stage_before: m.stageBefore,
      stage_after: m.stageAfter,
      action: m.action,
      by,
      session_id: sessionId,
    })));
    if (error) return { ok: false, status: 500, error: `Couldn't save the move. (${error.message})` };
  }

  // 3. Steps (one stage_update per card, as the stage buttons write them)
  type Staged = PlannedMove & { stageEvent: NonNullable<PlannedMove["stageEvent"]> };
  const staged = moves.filter((m): m is Staged => !!m.stageEvent);
  const stagedPerOrder = new Map<string, Staged[]>();
  for (const m of staged) stagedPerOrder.set(m.orderId, [...(stagedPerOrder.get(m.orderId) ?? []), m]);
  if (staged.length) {
    const { error } = await admin.from("order_events").insert(staged.map((m) => ({
      order_id: m.orderId,
      event_type: "stage_update",
      description: `Stage: ${m.stageEvent.stage} [card:${m.cardId}]`,
      metadata: { card_id: m.cardId, stage: m.stageEvent.stage, round: m.stageEvent.round, by, bulk: (stagedPerOrder.get(m.orderId)?.length ?? 0) > 1 },
      // Going back (or to a step it already reached) isn't news for the customer
      is_customer_visible: m.email,
    })));
    if (error) return { ok: false, status: 500, error: `Couldn't save the step. (${error.message})` };
  }

  // 4. Done (as the card's Done toggle: completed + completed_at)
  const completed: string[] = [];
  for (const part of chunks(moves.filter((m) => m.complete).map((m) => m.cardId))) {
    const { data, error } = await admin.from("cards").update({ completed: true, completed_at: now })
      .in("id", part).not("completed", "is", true).select("id");
    if (error) return { ok: false, status: 500, error: `Couldn't mark the cards done. (${error.message})` };
    completed.push(...(data ?? []).map((r) => r.id as string));
  }

  // 5. One email per order, for the cards at a step new to the customer
  const names = new Map(ctx.cards.map((c) => [c.id, c.card_name]));
  for (const [orderId, staged] of stagedPerOrder) {
    const orderMoves = staged.filter((m) => m.email);
    const order = ctx.orders.get(orderId);
    if (!order || !orderMoves.length) continue;
    const sent = await sendStageUpdateEmail(
      { customer_email: order.customer_email, customer_name: order.customer_name, order_number: order.order_number },
      orderMoves.map((m) => ({ name: names.get(m.cardId) ?? null, stage: m.stageEvent.stage, round: m.stageEvent.round })),
    );
    if (sent) out.emailedOrders.push(orderId);
  }

  // 6. Bags whose last card was just marked done
  if (completed.length) {
    const bagIds = [...new Set(ctx.cards.filter((c) => completed.includes(c.id) && c.bag_id).map((c) => c.bag_id as string))];
    out.bagsCompleted = (await refreshBagCompletion(admin, bagIds)).completed;
  }

  // 7. Orders whose last cards were just marked done: Completed, once each
  if (completed.length) {
    const orderIds = ctx.cards.filter((c) => completed.includes(c.id)).map((c) => c.order_id);
    out.orderCompletions = await completeOrdersIfAllDone(admin, orderIds, by);
  }

  // Slots left empty (best effort: the move itself is saved)
  const relocated = moves.filter((m) => m.locationChanges);
  const left = [...new Set(relocated.map((m) => m.fromLocationId).filter((id): id is string => !!id && id !== target?.id))];
  if (left.length) {
    try {
      const still = new Set<string>();
      for (const part of chunks(left)) {
        const { data, error } = await admin.from("cards").select("location_id").in("location_id", part);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) still.add(r.location_id as string);
      }
      out.freed = left.filter((id) => !still.has(id)).map((id) => ctx.locations.get(id)).filter((l): l is LocationRef => !!l && isSlot(l));
    } catch (e) {
      console.warn("[tracking] freed slots not read:", errText(e));
    }
  }
  return out;
}
