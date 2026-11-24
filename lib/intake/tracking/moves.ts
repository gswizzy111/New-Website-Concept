import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { codeKind, normalizeCode } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";
import { cardStageState } from "@/lib/intake/stage-plan";
import { refreshBagCompletion } from "@/lib/intake/stages";
import type { IntakeResult } from "@/lib/intake/types";
import { chunks, loadOrdersContext, type OrdersContext } from "@/lib/intake/tracking/context";
import { getLocationById, getLocationByCode } from "@/lib/intake/tracking/locations";
import { planMove, type PlanCard, type PlanCode, type PlannedMove } from "@/lib/intake/tracking/move-plan";
import { locationRef } from "@/lib/intake/tracking/places";
import { sendStageUpdateEmail } from "@/lib/intake/tracking/stage-email";
import { bySeq, isReceived, isRefunded, type TrackCardRow } from "@/lib/intake/tracking/summaries";
import type { LocationRow, MoveAction, MoveResponse } from "@/lib/intake/tracking/types";

/**
 * Moving cards and bags to a place (the Scan page's MOVE), server only. Admin
 * access is checked by the calling route. The rules are in move-plan.ts
 * (planMove); this file reads, then writes in this order:
 *   1. stage_update events for station moves: exactly what the stage buttons
 *      and advanceCards() write ("Stage: <stage> [card:<id>]", metadata
 *      { card_id, stage, round, by, bulk }, customer visible);
 *   2. cards marked done at a Done place (as POST /api/admin/cards/[id]/complete);
 *   3. card_moves rows (history);
 *   4. cards.location_id / located_at;
 *   5. tier_bags.location_id / located_at;
 *   6. at most ONE customer email per order (stage moves only, none for done);
 *   7. bag completion refresh for cards marked done.
 * A failed write stops there and answers 500; scanning again is safe (cards
 * already there at that step are left alone).
 */

export const MAX_CODES = 200;

type MoveInput = { by: string | null; sessionId?: string | null; action?: MoveAction };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function placeProblem(loc: LocationRow | null, raw: string): { status: number; error: string } | null {
  if (!loc) return { status: 404, error: `No place has the code ${normalizeCode(raw) || raw.trim().slice(0, 60) || "(blank)"}.` };
  if (loc.active === false) return { status: 409, error: `${loc.name} is switched off. Turn it back on in Places first.` };
  return null;
}

/**
 * POST /api/admin/track/move: move every card of the scanned codes (Card IDs,
 * Bag IDs, order codes or their QR links) to the place `locationCode`.
 */
export async function moveToLocation(
  admin: SupabaseClient,
  input: MoveInput & { locationCode: string; codes: readonly string[] },
): Promise<IntakeResult<MoveResponse>> {
  if (!input.codes.length) return { ok: false, status: 400, error: "Scan at least one card or bag." };
  if (input.codes.length > MAX_CODES) return { ok: false, status: 400, error: `Scan at most ${MAX_CODES} codes at a time.` };
  const placeCode = normalizeCode(input.locationCode);
  if (!placeCode || codeKind(placeCode) !== "location") return { ok: false, status: 400, error: "Scan a place first (its sign starts with LOC-)." };
  let loc: LocationRow | null;
  try {
    loc = await getLocationByCode(admin, placeCode);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the place. Nothing was changed. (${e instanceof Error ? e.message : String(e)})` };
  }
  const bad = placeProblem(loc, placeCode);
  if (bad) return { ok: false, ...bad };

  // Resolve the codes (each kind only where it lives)
  const parsed = input.codes.map((raw) => {
    const code = normalizeCode(raw);
    return { raw, code, kind: code ? codeKind(code) : null };
  });
  const cardCodes = [...new Set(parsed.filter((p) => p.kind === "card").map((p) => p.code))];
  const bagCodes = [...new Set(parsed.filter((p) => p.kind === "bag").map((p) => p.code))];
  const orderCodes = [...new Set(parsed.filter((p) => p.kind === "order").map((p) => p.code))];
  let cardByCode: Map<string, { id: string; order_id: string }>;
  let bagByCode: Map<string, { id: string; order_id: string }>;
  const orderByCode = new Map<string, string>();
  try {
    const [cardRows, bagRows] = await Promise.all([
      Promise.all(chunks(cardCodes).map(async (part) => {
        const { data, error } = await admin.from("cards").select("id, order_id, card_code").in("card_code", part);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; order_id: string; card_code: string }[];
      })).then((p) => p.flat()),
      Promise.all(chunks(bagCodes).map(async (part) => {
        const { data, error } = await admin.from("tier_bags").select("id, order_id, bag_code").in("bag_code", part);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; order_id: string; bag_code: string }[];
      })).then((p) => p.flat()),
      ...orderCodes.map(async (code) => {
        const found = await resolveCode(admin, code);
        if (found?.kind === "order") orderByCode.set(code, found.id);
      }),
    ]);
    cardByCode = new Map(cardRows.map((r) => [r.card_code, r]));
    bagByCode = new Map(bagRows.map((r) => [r.bag_code, r]));
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't look up the codes. Nothing was changed. (${e instanceof Error ? e.message : String(e)})` };
  }

  const orderIds = new Set<string>();
  for (const r of cardByCode.values()) orderIds.add(r.order_id);
  for (const r of bagByCode.values()) orderIds.add(r.order_id);
  for (const id of orderByCode.values()) orderIds.add(id);
  let ctx: OrdersContext;
  try {
    ctx = await loadOrdersContext(admin, [...orderIds]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the cards. Nothing was changed. (${e instanceof Error ? e.message : String(e)})` };
  }

  const codes: PlanCode[] = parsed.map(({ raw, code, kind }): PlanCode => {
    const shown = code || String(raw ?? "").trim().slice(0, 60);
    if (!code || !kind) return { code: shown, kind: null, error: `${shown || "That"} isn't a card, bag or order code.` };
    if (kind === "location") return { code, kind, error: "That's a place. Scan the place first, then the cards or bags." };
    if (kind === "card") {
      const c = cardByCode.get(code);
      return c ? { code, kind, id: c.id, cardIds: [c.id] } : { code, kind, error: `No card has the code ${code}.` };
    }
    if (kind === "bag") {
      const b = bagByCode.get(code);
      if (!b) return { code, kind, error: `No bag has the code ${code}.` };
      return { code, kind, id: b.id, cardIds: ctx.cards.filter((c) => c.bag_id === b.id).sort(bySeq).map((c) => c.id) };
    }
    const orderId = orderByCode.get(code);
    if (!orderId) return { code, kind, error: `No order has the number ${code}.` };
    return { code, kind, id: orderId, cardIds: ctx.cards.filter((c) => c.order_id === orderId).sort(bySeq).map((c) => c.id) };
  });

  return executeMove(admin, loc!, codes, ctx, input);
}

/**
 * Move cards by id to a place by id (for Receiving's "Put in shelf": pass
 * action "receive"). Same rules and writes as moveToLocation; one result per
 * card, keyed by its Card ID (or id when it has none).
 */
export async function moveCardsToLocation(
  admin: SupabaseClient,
  input: MoveInput & { locationId: string; cardIds: readonly string[] },
): Promise<IntakeResult<MoveResponse>> {
  const ids = [...new Set(input.cardIds)].filter((id) => UUID.test(id));
  if (!ids.length) return { ok: false, status: 400, error: "Pick at least one card." };
  if (ids.length > 1000) return { ok: false, status: 400, error: "Move at most 1,000 cards at a time." };
  let loc: LocationRow | null;
  let ctx: OrdersContext;
  try {
    loc = await getLocationById(admin, input.locationId);
    const bad = placeProblem(loc, input.locationId);
    if (bad) return { ok: false, ...bad };
    const orderIds = new Set<string>();
    for (const part of chunks(ids)) {
      const { data, error } = await admin.from("cards").select("id, order_id").in("id", part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) orderIds.add(r.order_id as string);
    }
    ctx = await loadOrdersContext(admin, [...orderIds]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the cards. Nothing was changed. (${e instanceof Error ? e.message : String(e)})` };
  }
  const byId = new Map(ctx.cards.map((c) => [c.id, c]));
  const codes: PlanCode[] = ids.map((id) => {
    const c = byId.get(id);
    return c ? { code: c.card_code ?? id, kind: "card", id, cardIds: [id] } : { code: id, kind: "card", error: "Card not found." };
  });
  return executeMove(admin, loc!, codes, ctx, input);
}

/** A card as the planner sees it (its step from the order's stage events). */
export function planCardOf(c: TrackCardRow, ctx: Pick<OrdersContext, "events">): PlanCard {
  const st = cardStageState({ id: c.id, completed: c.completed, current_round: c.current_round }, ctx.events.get(c.order_id) ?? []);
  return {
    id: c.id,
    code: c.card_code,
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

async function executeMove(
  admin: SupabaseClient,
  loc: LocationRow,
  codes: PlanCode[],
  ctx: OrdersContext,
  input: MoveInput,
): Promise<IntakeResult<MoveResponse>> {
  const plan = planMove({
    location: { id: loc.id, code: loc.code, name: loc.name, kind: loc.kind, stage: loc.stage },
    codes,
    cards: ctx.cards.map((c) => planCardOf(c, ctx)),
    bags: [...ctx.bags.values()].map((b) => ({ id: b.id, code: b.bag_code, locationId: b.location_id })),
    action: input.action,
  });
  const by = input.by;
  const sessionId = input.sessionId && UUID.test(input.sessionId) ? input.sessionId : null;
  const now = new Date().toISOString();
  const response: MoveResponse = { location: locationRef(loc), results: plan.results, emailedOrders: [], bagsCompleted: [] };
  if (!plan.moves.length && !plan.bagIds.length) return { ok: true, ...response };

  // 1. Steps (one stage_update per card, as the stage buttons write them)
  const staged = plan.moves.filter((m): m is PlannedMove & { stageEvent: NonNullable<PlannedMove["stageEvent"]> } => !!m.stageEvent);
  const stagedPerOrder = new Map<string, typeof staged>();
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

  // 2. Done (as the card Done toggle: completed + completed_at)
  const completes = plan.moves.filter((m) => m.complete).map((m) => m.cardId);
  const completed: string[] = [];
  for (const part of chunks(completes)) {
    const { data, error } = await admin.from("cards").update({ completed: true, completed_at: now })
      .in("id", part).not("completed", "is", true).select("id");
    if (error) return { ok: false, status: 500, error: `Couldn't mark the cards done. (${error.message})` };
    completed.push(...(data ?? []).map((r) => r.id as string));
  }

  // 3. History
  if (plan.moves.length) {
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
  }

  // 4. Where the cards are
  const relocated = plan.moves.filter((m) => m.locationChanges).map((m) => m.cardId);
  for (const part of chunks(relocated)) {
    const { error } = await admin.from("cards").update({ location_id: loc.id, located_at: now }).in("id", part);
    if (error) return { ok: false, status: 500, error: `Couldn't save where the cards are. (${error.message})` };
  }

  // 5. Where the bags are
  for (const part of chunks(plan.bagIds)) {
    const { error } = await admin.from("tier_bags").update({ location_id: loc.id, located_at: now }).in("id", part);
    if (error) return { ok: false, status: 500, error: `Couldn't save where the bag is. (${error.message})` };
  }

  // 6. One email per order for the steps
  const names = new Map(ctx.cards.map((c) => [c.id, c.card_name]));
  for (const [orderId, moves] of stagedPerOrder) {
    const order = ctx.orders.get(orderId);
    if (!order) continue;
    const sent = await sendStageUpdateEmail(
      { customer_email: order.customer_email, customer_name: order.customer_name, order_number: order.order_number },
      moves.map((m) => ({ name: names.get(m.cardId) ?? null, stage: m.stageEvent.stage, round: m.stageEvent.round })),
    );
    if (sent) response.emailedOrders.push(orderId);
  }

  // 7. Bags whose last card was just marked done
  if (completed.length) {
    const bagIds = [...new Set(ctx.cards.filter((c) => completed.includes(c.id) && c.bag_id).map((c) => c.bag_id as string))];
    response.bagsCompleted = (await refreshBagCompletion(admin, bagIds)).completed;
  }
  return { ok: true, ...response };
}
