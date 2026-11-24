import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCode } from "@/lib/intake/codes";
import { cardStageState } from "@/lib/intake/stage-plan";
import { refreshBagCompletion } from "@/lib/intake/stages";
import { chunks, loadOrdersContext, type OrdersContext } from "@/lib/intake/tracking/context";
import { getLocationByCode, getLocationById } from "@/lib/intake/tracking/locations";
import { overCapacity, planCards, type CardPlan, type PlanAction, type PlanCard, type PlanLocation, type PlannedMove } from "@/lib/intake/tracking/move-plan";
import { DONE_LOCATION_CODE, isSlot, locationRef } from "@/lib/intake/tracking/places";
import { loadCardSummaries } from "@/lib/intake/tracking/resolve";
import { sendStageUpdateEmail } from "@/lib/intake/tracking/stage-email";
import { isReceived, isRefunded, type TrackCardRow } from "@/lib/intake/tracking/summaries";
import type { CapacityConflict, LocationRef, LocationRow, MoveAction, TrackActionResponse, TrackCardResult } from "@/lib/intake/tracking/types";

/**
 * Putting cards in slots and taking them out (the Scan page's assign, move,
 * take out and done), server only. Admin access is checked by the calling
 * route. The rules are in move-plan.ts (planCards); this file reads, checks
 * the slot's capacity, then writes in this order:
 *   1. stage_update events for cards going into a slot at a later step:
 *      exactly what the stage buttons and advanceCards() write ("Stage:
 *      <stage> [card:<id>]", metadata { card_id, stage, round, by, bulk },
 *      customer visible);
 *   2. cards marked done (as POST /api/admin/cards/[id]/complete);
 *   3. card_moves rows (history);
 *   4. cards.location_id / located_at (the old slot frees up);
 *   5. at most ONE customer email per order (step changes only, none for done);
 *   6. bag completion refresh for cards marked done.
 * A failed write stops there and answers 500; doing it again is safe (cards
 * already there at that step are left alone).
 */

export const MAX_CARDS = 200;

export type TrackResult =
  | ({ ok: true } & TrackActionResponse)
  | { ok: false; status: number; error: string; conflict?: CapacityConflict };

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
  const st = cardStageState({ id: c.id, completed: c.completed, current_round: c.current_round }, ctx.events.get(c.order_id) ?? []);
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

/** The 409 for a full slot, or null when there's room (or `force`). */
async function capacityCheck(admin: SupabaseClient, loc: LocationRow, plan: CardPlan, force: boolean | undefined): Promise<CapacityConflict | null> {
  if (force || loc.capacity == null) return null;
  // Only cards that would go in count; cards already inside never trip it
  const going = plan.moves.filter((m) => m.locationChanges && m.toLocationId === loc.id).map((m) => m.cardId);
  if (!going.length) return null;
  const inside = await occupantIds(admin, loc.id);
  if (!overCapacity(loc.capacity, inside, going)) return null;
  const others = inside.filter((id) => !going.includes(id));
  return {
    error: `${loc.name} holds ${loc.capacity === 1 ? "1 card" : `${loc.capacity} cards`} and ${others.length === 1 ? "has 1" : `has ${others.length}`} in it. Add anyway?`,
    overCapacity: true,
    capacity: loc.capacity,
    occupants: await loadCardSummaries(admin, others),
  };
}

/**
 * POST /api/admin/track/assign: put cards (by id) in the slot or place
 * `locationCode`. Each card leaves its old slot; in a slot its step becomes
 * the slot's step (forward only). Over the slot's capacity it answers 409
 * with the cards already in it, unless `force`.
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
 * only `cardIds`) to the slot `toCode`. Their step follows the new slot.
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

/** POST /api/admin/track/release: take cards out of their slots (no place; the step stays). */
export async function releaseCards(admin: SupabaseClient, input: Common & { cardIds: readonly string[] }): Promise<TrackResult> {
  const bad = cardIdsProblem(input.cardIds);
  if (bad) return { ok: false, status: 400, error: bad };
  return planAndRun(admin, "release", null, input.cardIds, input, []);
}

/**
 * POST /api/admin/track/done: mark cards done (as the card's Done toggle);
 * they leave their slot and go to the Done place (LOC-DONE; nowhere if it is
 * missing or switched off). Bags whose last card this was become complete.
 */
export async function markCardsDone(admin: SupabaseClient, input: Common & { cardIds: readonly string[] }): Promise<TrackResult> {
  const bad = cardIdsProblem(input.cardIds);
  if (bad) return { ok: false, status: 400, error: bad };
  let done: LocationRow | null;
  try {
    done = await getLocationByCode(admin, DONE_LOCATION_CODE);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the Done place. Nothing was changed. (${errText(e)})` };
  }
  return planAndRun(admin, "done", done?.active === false ? null : done, input.cardIds, input, []);
}

/**
 * Put cards (by id) in a place by id, e.g. Receiving placing cards on their
 * due-date shelf slot with action "receive". Same rules and writes as
 * assignCards; no capacity check (shelves have none).
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
): Promise<TrackResult> {
  let ctx: OrdersContext;
  try {
    ctx = await loadForCards(admin, cardIds);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the cards. Nothing was changed. (${errText(e)})` };
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
      const conflict = await capacityCheck(admin, target, plan, force);
      if (conflict) return { ok: false, status: 409, error: conflict.error, conflict };
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't read ${target.name}. Nothing was changed. (${errText(e)})` };
    }
  }
  const run = await writePlan(admin, plan, ctx, target, input);
  if (!run.ok) return run;
  return {
    ok: true,
    location: target ? locationRef(target) : null,
    results: [...plan.results, ...extraResults],
    message: plan.message,
    changed: plan.moves.length,
    emailedOrders: run.emailedOrders,
    bagsCompleted: run.bagsCompleted,
    freed: run.freed,
  };
}

async function writePlan(
  admin: SupabaseClient,
  plan: CardPlan,
  ctx: OrdersContext,
  target: LocationRow | null,
  input: Common,
): Promise<{ ok: true; emailedOrders: string[]; bagsCompleted: string[]; freed: LocationRef[] } | { ok: false; status: number; error: string }> {
  const out = { ok: true as const, emailedOrders: [] as string[], bagsCompleted: [] as string[], freed: [] as LocationRef[] };
  if (!plan.moves.length) return out;
  const by = input.by;
  const sessionId = input.sessionId && UUID.test(input.sessionId) ? input.sessionId : null;
  const now = new Date().toISOString();

  // 1. Steps (one stage_update per card, as the stage buttons write them)
  type Staged = PlannedMove & { stageEvent: NonNullable<PlannedMove["stageEvent"]> };
  const staged = plan.moves.filter((m): m is Staged => !!m.stageEvent);
  const stagedPerOrder = new Map<string, Staged[]>();
  for (const m of staged) stagedPerOrder.set(m.orderId, [...(stagedPerOrder.get(m.orderId) ?? []), m]);
  if (staged.length) {
    const { error } = await admin.from("order_events").insert(staged.map((m) => ({
      order_id: m.orderId,
      event_type: "stage_update",
      description: `Stage: ${m.stageEvent.stage} [card:${m.cardId}]`,
      metadata: { card_id: m.cardId, stage: m.stageEvent.stage, round: m.stageEvent.round, by, bulk: (stagedPerOrder.get(m.orderId)?.length ?? 0) > 1 },
      is_customer_visible: true,
    })));
    if (error) return { ok: false, status: 500, error: `Couldn't save the step. Nothing was changed. (${error.message})` };
  }

  // 2. Done (as the card's Done toggle: completed + completed_at)
  const completed: string[] = [];
  for (const part of chunks(plan.moves.filter((m) => m.complete).map((m) => m.cardId))) {
    const { data, error } = await admin.from("cards").update({ completed: true, completed_at: now })
      .in("id", part).not("completed", "is", true).select("id");
    if (error) return { ok: false, status: 500, error: `Couldn't mark the cards done. (${error.message})` };
    completed.push(...(data ?? []).map((r) => r.id as string));
  }

  // 3. History
  for (const part of chunks(plan.moves, 500)) {
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

  // 4. Where the cards are (the old slot frees up)
  const relocated = plan.moves.filter((m) => m.locationChanges);
  for (const part of chunks(relocated.map((m) => m.cardId))) {
    const { error } = await admin.from("cards")
      .update({ location_id: target?.id ?? null, located_at: target ? now : null })
      .in("id", part);
    if (error) return { ok: false, status: 500, error: `Couldn't save where the cards are. (${error.message})` };
  }

  // 5. One email per order for the steps
  const names = new Map(ctx.cards.map((c) => [c.id, c.card_name]));
  for (const [orderId, moves] of stagedPerOrder) {
    const order = ctx.orders.get(orderId);
    if (!order) continue;
    const sent = await sendStageUpdateEmail(
      { customer_email: order.customer_email, customer_name: order.customer_name, order_number: order.order_number },
      moves.map((m) => ({ name: names.get(m.cardId) ?? null, stage: m.stageEvent.stage, round: m.stageEvent.round })),
    );
    if (sent) out.emailedOrders.push(orderId);
  }

  // 6. Bags whose last card was just marked done
  if (completed.length) {
    const bagIds = [...new Set(ctx.cards.filter((c) => completed.includes(c.id) && c.bag_id).map((c) => c.bag_id as string))];
    out.bagsCompleted = (await refreshBagCompletion(admin, bagIds)).completed;
  }

  // Slots left empty (best effort: the move itself is saved)
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
