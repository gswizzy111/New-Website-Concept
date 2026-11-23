import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAGE_INFO, friendlyStage } from "@/lib/restoration-stages";
import { escapeHtml, sendOrderUpdateEmail } from "@/lib/customer-email";
import { bagCompletionPatch, cardStageState, planAdvance, type AdvanceCard, type SkipReason } from "@/lib/intake/stage-plan";
import type { NextStep, StageEventRow } from "@/lib/intake/types";

/**
 * Moving cards through the 8 steps and keeping bag completion in step, server
 * only. Admin access is checked by the calling route. Pure helpers
 * (cardStageState, planAdvance, stageGroups, isBagComplete) are in
 * lib/intake/stage-plan.ts and re-exported here.
 */
export { cardStageState, isBagComplete, nextStepAfter, planAdvance, stageGroups, stageIndex } from "@/lib/intake/stage-plan";
export type { AdvanceCard, AdvancePlan, SkipReason } from "@/lib/intake/stage-plan";

export type AdvanceResult =
  | {
      ok: true;
      target: NextStep;
      moved: { cardId: string; stage: string; round: number }[];
      completed: string[];
      skipped: { cardId: string; reason: SkipReason; current: string | null }[];
      /** The one customer email for this move was sent. */
      emailed: boolean;
      /** Bags that became complete with this move (show the alert). */
      bagsCompleted: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Move the chosen cards of an order from `fromStage` (null = not started) to
 * the next step (or `toStage`), exactly as the existing stage buttons record
 * it: one 'stage_update' event per card ("Stage: <stage> [card:<id>]",
 * metadata { card_id, stage, round, by, bulk }, customer visible). Cards at
 * another step are skipped and reported, never overwritten. From Final Dry
 * the next step marks the card done (like POST /api/admin/cards/[id]/complete).
 * One customer email lists every card that moved (none for "done", as before).
 */
export async function advanceCards(
  admin: SupabaseClient,
  input: { orderId: string; cardIds: string[]; fromStage: string | null; toStage?: string | "complete"; by: string | null },
): Promise<AdvanceResult> {
  const [{ data: order, error: oErr }, { data: cards, error: cErr }, { data: events, error: eErr }] = await Promise.all([
    admin.from("orders").select("customer_email, customer_name, order_number").eq("id", input.orderId).maybeSingle(),
    admin.from("cards").select("id, card_name, completed, current_round, status, awaiting_arrival, bag_id").eq("order_id", input.orderId),
    admin.from("order_events").select("event_type, description, metadata, created_at").eq("order_id", input.orderId)
      .eq("event_type", "stage_update").order("created_at", { ascending: false }),
  ]);
  const readErr = oErr ?? cErr ?? eErr;
  if (readErr) return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${readErr.message})` };
  if (!order) return { ok: false, status: 404, error: "Order not found" };

  const rows = cards ?? [];
  const evs = (events ?? []) as StageEventRow[];
  const advanceCardsIn: AdvanceCard[] = rows.map((c) => {
    const st = cardStageState({ id: c.id as string, completed: c.completed as boolean | null, current_round: c.current_round as number | null }, evs);
    return {
      id: c.id as string,
      current: st.current,
      completed: st.completed,
      refunded: c.status === "refunded",
      awaiting: !!c.awaiting_arrival,
      round: st.round,
    };
  });
  const planned = planAdvance({ cards: advanceCardsIn, cardIds: input.cardIds, fromStage: input.fromStage, toStage: input.toStage });
  if (!planned.ok) return planned;
  const { plan } = planned;
  const bulk = new Set(input.cardIds).size > 1;

  if (plan.moves.length) {
    const { error } = await admin.from("order_events").insert(plan.moves.map((m) => ({
      order_id: input.orderId,
      event_type: "stage_update",
      description: `Stage: ${m.stage} [card:${m.cardId}]`,
      metadata: { card_id: m.cardId, stage: m.stage, round: m.round, by: input.by, bulk },
      is_customer_visible: true,
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

  // One email for the whole move
  let emailed = false;
  if (plan.moves.length) {
    const nameOf = new Map(rows.map((c) => [c.id as string, (c.card_name as string | null) ?? "Your card"]));
    const lines = plan.moves.map((m) => ({ name: nameOf.get(m.cardId) ?? "Your card", stage: m.stage, friendly: friendlyStage(m.stage, m.round) }));
    const friendlies = [...new Set(lines.map((l) => l.friendly))];
    const stages = [...new Set(lines.map((l) => l.stage))];
    const box = (stage: string, friendly: string) => `
     <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px;margin:20px 0">
       <p style="margin:0;font-size:13px;color:#6d28d9;font-weight:700">${escapeHtml(friendly)}</p>
       <p style="margin:6px 0 0;font-size:15px">${escapeHtml(STAGE_INFO[stage]?.explanation ?? "")}</p>
     </div>`;
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

  return {
    ok: true,
    target: plan.target,
    moved: plan.moves,
    completed,
    skipped: [...plan.skipped, ...plan.completes.filter((id) => !completed.includes(id)).map((id) => ({ cardId: id, reason: "done" as const, current: null }))],
    emailed,
    bagsCompleted,
  };
}

/**
 * Keep tier_bags.completed_at in step with the bags' cards: set once every
 * non-refunded card is done (the earliest time is kept), cleared when a card
 * reopens (new round, un-done). Never throws; returns which bags changed.
 */
export async function refreshBagCompletion(
  admin: SupabaseClient,
  bagIds: readonly string[],
): Promise<{ completed: string[]; reopened: string[] }> {
  const ids = [...new Set(bagIds.filter(Boolean))];
  const out = { completed: [] as string[], reopened: [] as string[] };
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
      // Completing only claims a bag that isn't complete yet (keeps the earliest time)
      const q = admin.from("tier_bags").update(patch).eq("id", bag.id);
      const { data, error } = await (patch.completed_at ? q.is("completed_at", null) : q).select("id");
      if (error) throw new Error(error.message);
      if (data?.length) (patch.completed_at ? out.completed : out.reopened).push(bag.id as string);
    }
  } catch (e) {
    console.error("[intake] bag completion not refreshed:", e instanceof Error ? e.message : e);
  }
  return out;
}

/**
 * One-line hook for the existing card routes (complete, round): refresh the
 * card's bag, if it has one. Never throws, and does nothing before the intake
 * migration is applied (no bag_id column yet).
 */
export async function refreshBagCompletionForCard(cardId: string, admin: SupabaseClient = createAdminClient()): Promise<void> {
  try {
    const { data, error } = await admin.from("cards").select("bag_id").eq("id", cardId).maybeSingle();
    if (error || !data?.bag_id) return;
    await refreshBagCompletion(admin, [data.bag_id as string]);
  } catch (e) {
    console.error("[intake] bag completion hook:", e instanceof Error ? e.message : e);
  }
}
