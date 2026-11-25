import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { STAGES, STAGE_INFO, currentStages, friendlyStage } from "@/lib/restoration-stages";
import { escapeHtml, sendOrderUpdateEmail } from "@/lib/customer-email";
import {
  bagCompletionPatch, cardStageState, furthestStageIndex, planAdvance, stepEmailsCustomer,
  type AdvanceCard, type AdvancePlan, type SkipReason,
} from "@/lib/intake/stage-plan";
import type { NextStep, StageEventRow } from "@/lib/intake/types";
import { completeOrderIfAllDone, type OrderAutoComplete } from "@/lib/intake/order-autocomplete";
import { returnCardsToBags, unbinReopenedBags } from "@/lib/intake/tracking/bag-places";
import type { TrackBagPlace } from "@/lib/intake/tracking/types";

/**
 * Moving cards through the 8 steps and keeping bag completion in step, server
 * only. Admin access is checked by the calling route. Pure helpers
 * (cardStageState, planAdvance, stageGroups, isBagComplete) are in
 * lib/intake/stage-plan.ts and re-exported here.
 */
export {
  cardStageState, furthestStageIndex, isBagComplete, nextStepAfter, planAdvance, stageGroups, stageIndex, stepEmailsCustomer,
} from "@/lib/intake/stage-plan";
export type { AdvanceCard, AdvancePlan, SkipReason } from "@/lib/intake/stage-plan";

/**
 * Every stage event of an order, newest first, read in pages (the API returns
 * at most 1,000 rows per request, so a big order's furthest step and the
 * fromStages guard would read a cut list). Stable order: created_at, then id.
 */
async function loadStageEvents(admin: SupabaseClient, orderId: string): Promise<StageEventRow[]> {
  return fetchAll((from, to) => admin.from("order_events").select("event_type, description, metadata, created_at").eq("order_id", orderId)
    .eq("event_type", "stage_update").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)) as Promise<StageEventRow[]>;
}

const stageBox = (stage: string, friendly: string) => `
     <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px;margin:20px 0">
       <p style="margin:0;font-size:13px;color:#6d28d9;font-weight:700">${escapeHtml(friendly)}</p>
       <p style="margin:6px 0 0;font-size:15px">${escapeHtml(STAGE_INFO[stage]?.explanation ?? "")}</p>
     </div>`;

export type SetCardStageResult =
  | {
      ok: true;
      /** An event was written (false: the card was at that step already). */
      changed: boolean;
      /** A step past the furthest this round: customer visible and emailed. */
      email: boolean;
      /** The email went out. */
      emailed: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * One card to one of the 8 steps (POST /api/admin/orders/[id]/stage, the
 * order page's Restoration Stages buttons), under the same email rule as
 * advanceCards: only a step past the furthest the card reached this round is
 * customer visible and emails the customer ("Restoration Update"); going back
 * or re-entering a step writes a staff-only event and sends nothing. A card
 * already at that step writes nothing. Done cards can still be given a step
 * (as before); the step is the card's newest stage event of its round.
 */
export async function setCardStage(
  admin: SupabaseClient,
  input: { orderId: string; cardId: string; stage: string; by: string | null },
): Promise<SetCardStageResult> {
  const { orderId, cardId, stage } = input;
  if (!(STAGES as readonly string[]).includes(stage)) return { ok: false, status: 400, error: "Unknown stage" };
  let read: [
    { data: Record<string, unknown> | null; error: { message: string } | null },
    { data: Record<string, unknown> | null; error: { message: string } | null },
    StageEventRow[],
  ];
  try {
    read = await Promise.all([
      admin.from("cards").select("id, card_name, current_round").eq("id", cardId).eq("order_id", orderId).maybeSingle(),
      admin.from("orders").select("customer_email, customer_name, order_number").eq("id", orderId).maybeSingle(),
      loadStageEvents(admin, orderId),
    ]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${e instanceof Error ? e.message : e})` };
  }
  const [{ data: card, error: cErr }, { data: order, error: oErr }, events] = read;
  const readErr = cErr ?? oErr;
  if (readErr) return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${readErr.message})` };
  if (!card || !order) return { ok: false, status: 404, error: "Card not found on this order" };

  const round = (card.current_round as number | null) ?? 1;
  if (currentStages(events, { [cardId]: round })[cardId] === stage) return { ok: true, changed: false, email: false, emailed: false };
  const email = stepEmailsCustomer(stage, furthestStageIndex(cardId, round, events));

  // The description keeps the old format for anything still reading it; the
  // card, stage and round are read from metadata
  const { error } = await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "stage_update",
    description: `Stage: ${stage} [card:${cardId}]`,
    metadata: { card_id: cardId, stage, round, by: input.by },
    // Going back (or to a step it already reached) isn't news for the customer
    is_customer_visible: email,
  });
  if (error) return { ok: false, status: 500, error: error.message };
  if (!email) return { ok: true, changed: true, email, emailed: false };

  const friendly = friendlyStage(stage, round);
  const emailed = await sendOrderUpdateEmail(
    order as { customer_email: string | null; customer_name: string | null; order_number: string },
    `Update on your card — ${friendly} (Order #${order.order_number})`,
    "Restoration Update",
    `<p><strong>${escapeHtml((card.card_name as string | null) ?? "Your card")}</strong> has moved to a new stage.</p>${stageBox(stage, friendly)}`,
  );
  return { ok: true, changed: true, email, emailed };
}

export type AdvanceResult =
  | {
      ok: true;
      target: NextStep;
      /** `email`: a new step for the customer (in the email, customer visible); false: staff only, no email. */
      moved: AdvancePlan["moves"];
      completed: string[];
      skipped: { cardId: string; reason: SkipReason; current: string | null }[];
      /** The one customer email for this move was sent (only moves with `email` go in it). */
      emailed: boolean;
      /** Bags that became complete with this move (show the alert). */
      bagsCompleted: string[];
      /** Cards were marked done: the order auto-complete check (lib/intake/order-autocomplete.ts). */
      orderCompletion?: OrderAutoComplete;
      /** Cards were marked done: they went back in their bag (out of any holder); each bag and where it is. */
      bagPlaces?: TrackBagPlace[];
    }
  | { ok: false; status: number; error: string };

/**
 * Put the chosen cards of an order at `toStage`: any of the 8 steps, earlier
 * or later than now, or "complete" (done, like POST
 * /api/admin/cards/[id]/complete). Without `toStage`: the step after
 * `fromStage` (the old one-tap advance; from Final Dry it marks the card
 * done). Rules (guard, skips, already there) are planAdvance's: a card moves
 * only while it is still at the step the page showed (`fromStages[id]`, else
 * `fromStage`), so two people tapping at once never clobber each other.
 * Recorded exactly as the existing stage buttons record it: one
 * 'stage_update' event per card ("Stage: <stage> [card:<id>]", metadata
 * { card_id, stage, round, by, bulk }). The customer email rule
 * (stepEmailsCustomer): one email lists every card that moved to a step past
 * the furthest it reached this round (customer visible events); going back or
 * re-entering a step sends nothing and its event is staff only. No step email
 * for "done", as before (the order's last card done completes the order,
 * with its completed email: orderCompletion). Cards marked done go back in their bag like the
 * tracking Done (out of any holder or desk; returnCardsToBags), and
 * `bagPlaces` says where each bag is.
 */
export async function advanceCards(
  admin: SupabaseClient,
  input: {
    orderId: string;
    cardIds: string[];
    fromStage?: string | null;
    fromStages?: Record<string, string | null>;
    toStage?: string | "complete";
    by: string | null;
  },
): Promise<AdvanceResult> {
  let read: [
    { data: Record<string, unknown> | null; error: { message: string } | null },
    Record<string, unknown>[],
    StageEventRow[],
  ];
  try {
    read = await Promise.all([
      admin.from("orders").select("customer_email, customer_name, order_number").eq("id", input.orderId).maybeSingle(),
      // Paged, both: the API returns at most 1,000 rows per request
      fetchAll((from, to) => admin.from("cards").select("id, card_name, completed, current_round, status, awaiting_arrival, bag_id")
        .eq("order_id", input.orderId).order("created_at").order("id").range(from, to)),
      loadStageEvents(admin, input.orderId),
    ]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${e instanceof Error ? e.message : e})` };
  }
  const [{ data: order, error: oErr }, rows, evs] = read;
  if (oErr) return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${oErr.message})` };
  if (!order) return { ok: false, status: 404, error: "Order not found" };

  const advanceCardsIn: AdvanceCard[] = rows.map((c) => {
    const st = cardStageState({ id: c.id as string, completed: c.completed as boolean | null, current_round: c.current_round as number | null }, evs);
    return {
      id: c.id as string,
      current: st.current,
      completed: st.completed,
      refunded: c.status === "refunded",
      awaiting: !!c.awaiting_arrival,
      round: st.round,
      furthest: st.furthestIndex,
    };
  });
  const planned = planAdvance({
    cards: advanceCardsIn, cardIds: input.cardIds, fromStage: input.fromStage, fromStages: input.fromStages, toStage: input.toStage,
  });
  if (!planned.ok) return planned;
  const { plan } = planned;
  const bulk = new Set(input.cardIds).size > 1;

  if (plan.moves.length) {
    const { error } = await admin.from("order_events").insert(plan.moves.map((m) => ({
      order_id: input.orderId,
      event_type: "stage_update",
      description: `Stage: ${m.stage} [card:${m.cardId}]`,
      metadata: { card_id: m.cardId, stage: m.stage, round: m.round, by: input.by, bulk },
      // Going back (or to a step it already reached) isn't news for the customer
      is_customer_visible: m.email,
    })));
    if (error) return { ok: false, status: 500, error: `Couldn't save the step. Nothing was changed. (${error.message})` };
  }

  let completed: string[] = [];
  if (plan.completes.length) {
    const { data, error } = await admin.from("cards")
      .update({ completed: true, completed_at: new Date().toISOString() })
      .in("id", plan.completes)
      .not("completed", "is", true)
      .select("id");
    if (error) return { ok: false, status: 500, error: `Couldn't mark the cards done. (${error.message})` };
    completed = (data ?? []).map((r) => r.id as string);
  }

  // One email for the whole move: only the cards at a new step for the customer
  let emailed = false;
  const news = plan.moves.filter((m) => m.email);
  if (news.length) {
    const nameOf = new Map(rows.map((c) => [c.id as string, (c.card_name as string | null) ?? "Your card"]));
    const lines = news.map((m) => ({ name: nameOf.get(m.cardId) ?? "Your card", stage: m.stage, friendly: friendlyStage(m.stage, m.round) }));
    const friendlies = [...new Set(lines.map((l) => l.friendly))];
    const stages = [...new Set(lines.map((l) => l.stage))];
    const box = stageBox;
    const single = lines.length === 1;
    const subject = single
      ? `Update on your card — ${lines[0].friendly} (Order #${order.order_number})`
      : friendlies.length === 1
        ? `Update on your cards — ${friendlies[0]} (Order #${order.order_number})`
        : `Update on your cards (Order #${order.order_number})`;
    const body = single
      ? `<p><strong>${escapeHtml(lines[0].name)}</strong> has moved to a new stage.</p>${box(lines[0].stage, lines[0].friendly)}`
      : `<p>${lines.length} of your cards have moved to a new stage:</p>
     <ul style="padding-left:20px;margin:12px 0">${lines.map((l) => `<li><strong>${escapeHtml(l.name)}</strong> — ${escapeHtml(l.friendly)}</li>`).join("")}</ul>
     ${stages.map((s) => box(s, lines.find((l) => l.stage === s)!.friendly)).join("")}`;
    emailed = await sendOrderUpdateEmail(order as { customer_email: string | null; customer_name: string | null; order_number: string }, subject, "Restoration Update", body);
  }

  const bagIds = [...new Set(rows.filter((c) => completed.includes(c.id as string) && c.bag_id).map((c) => c.bag_id as string))];
  const { completed: bagsCompleted } = await refreshBagCompletion(admin, bagIds);
  // Done cards go back in their bag, out of any holder or desk (as the tracking Done)
  const current = new Map(advanceCardsIn.map((c) => [c.id, c.current]));
  const home = completed.length
    ? await returnCardsToBags(admin, { cards: completed.map((id) => ({ id, stageBefore: current.get(id) ?? null })), by: input.by })
    : null;
  // The order's last cards done: the order becomes Completed (once). The cards are done whatever happened to their holders
  const orderCompletion = completed.length ? await completeOrderIfAllDone(admin, input.orderId, input.by) : undefined;
  // A card's move out of its holder not saved (or not logged): said, as the tracking routes do
  if (home && !home.ok) return { ok: false, status: home.status, error: `Marked done, but not put back in the bag: ${home.error}` };

  return {
    ok: true,
    target: plan.target,
    moved: plan.moves,
    completed,
    skipped: [...plan.skipped, ...plan.completes.filter((id) => !completed.includes(id)).map((id) => ({ cardId: id, reason: "done" as const, current: null }))],
    emailed,
    bagsCompleted,
    ...(orderCompletion ? { orderCompletion } : {}),
    ...(home?.ok && home.bags.length ? { bagPlaces: home.bags } : {}),
  };
}

/**
 * Keep tier_bags.completed_at in step with the bags' cards: set once every
 * non-refunded card is done (the earliest time is kept), cleared when a card
 * reopens (new round, un-done). A reopened bag that sits in the Ready to ship
 * bin goes back in the Open bags box (unbinReopenedBags: it isn't ready to
 * ship any more); `unbinned` names those bags and where they are now. Never
 * throws; returns which bags changed.
 */
export async function refreshBagCompletion(
  admin: SupabaseClient,
  bagIds: readonly string[],
  by: string | null = null,
): Promise<{ completed: string[]; reopened: string[]; unbinned: TrackBagPlace[] }> {
  const ids = [...new Set(bagIds.filter(Boolean))];
  const out = { completed: [] as string[], reopened: [] as string[], unbinned: [] as TrackBagPlace[] };
  if (!ids.length) return out;
  try {
    const [{ data: bags, error: bErr }, { data: cards, error: cErr }] = await Promise.all([
      admin.from("tier_bags").select("id, completed_at, source, orders(status)").in("id", ids),
      admin.from("cards").select("bag_id, completed, completed_at, status").in("bag_id", ids),
    ]);
    if (bErr || cErr) throw new Error((bErr ?? cErr)!.message);
    const now = new Date().toISOString();
    for (const bag of bags ?? []) {
      const order = bag.orders as { status?: string } | { status?: string }[] | null;
      const patch = bagCompletionPatch(
        { completed_at: bag.completed_at as string | null, source: bag.source as string | null },
        (cards ?? []).filter((c) => c.bag_id === bag.id) as { completed: boolean | null; completed_at: string | null; status: string | null }[],
        now,
        (Array.isArray(order) ? order[0] : order)?.status ?? null,
      );
      if (!patch) continue;
      // Completing only claims a bag that isn't complete yet (keeps the earliest
      // time); reopening only clears the completion that was read, so a bag
      // completed again in the meantime is never cleared by a stale read
      const q = admin.from("tier_bags").update(patch).eq("id", bag.id);
      const { data, error } = await (patch.completed_at ? q.is("completed_at", null) : q.eq("completed_at", bag.completed_at as string)).select("id");
      if (error) throw new Error(error.message);
      if (data?.length) (patch.completed_at ? out.completed : out.reopened).push(bag.id as string);
    }
  } catch (e) {
    console.error("[intake] bag completion not refreshed:", e instanceof Error ? e.message : e);
  }
  // Reopened: out of the Ready to ship bin, back in the Open bags box (best effort)
  if (out.reopened.length) out.unbinned = await unbinReopenedBags(admin, out.reopened, by);
  return out;
}

/**
 * A card's step right now (this round's newest step, Done left aside), for
 * the move row the order page's Done toggle writes; null when it has none
 * or the order's events can't be read. Never throws.
 */
export async function currentStageOf(
  admin: SupabaseClient,
  input: { orderId: string; cardId: string; round: number | null },
): Promise<string | null> {
  try {
    const events = await loadStageEvents(admin, input.orderId);
    return cardStageState({ id: input.cardId, completed: false, current_round: input.round }, events).current;
  } catch (e) {
    console.warn("[intake] card's step not read:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * One-line hook for the existing card routes (complete, round): refresh the
 * card's bag, if it has one. Never throws, and does nothing before the intake
 * migration is applied (no bag_id column yet).
 */
export async function refreshBagCompletionForCard(cardId: string, admin: SupabaseClient = createAdminClient(), by: string | null = null): Promise<{ unbinned: TrackBagPlace[] }> {
  try {
    const { data, error } = await admin.from("cards").select("bag_id").eq("id", cardId).maybeSingle();
    if (error || !data?.bag_id) return { unbinned: [] };
    const { unbinned } = await refreshBagCompletion(admin, [data.bag_id as string], by);
    return { unbinned };
  } catch (e) {
    console.error("[intake] bag completion hook:", e instanceof Error ? e.message : e);
    return { unbinned: [] };
  }
}
