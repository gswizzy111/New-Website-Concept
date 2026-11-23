import { STAGES, adminStageLabel, currentStages, parseStageEvent } from "@/lib/restoration-stages";
import type { BagStageGroup, CardStageState, NextStep, StageEventRow, StageHistoryEntry } from "@/lib/intake/types";

/**
 * Per-card restoration progress over the 8 existing steps (STAGES in
 * lib/restoration-stages.ts, stored as order_events 'stage_update' rows),
 * worked out without the database. Pure (safe in client components and
 * tests); lib/intake/stages.ts does the writes.
 */

export const NOT_STARTED_LABEL = "Not started";
export const DONE_LABEL = "Done";
const LAST = STAGES.length - 1;

/** Index of a stored stage name in STAGES, -1 if unknown or null. */
export function stageIndex(stage: string | null | undefined): number {
  return stage ? (STAGES as readonly string[]).indexOf(stage) : -1;
}

/** The step after `stage` (null = not started): the next stage, or "complete" after Final Dry. */
export function nextStepAfter(stage: string | null): NextStep {
  const i = stage === null ? -1 : stageIndex(stage);
  if (stage !== null && i === -1) throw new Error(`Unknown stage ${stage}`);
  if (i === LAST) return { kind: "complete", label: DONE_LABEL };
  const next = STAGES[i + 1];
  return { kind: "stage", stage: next, label: adminStageLabel(next) };
}

type StageCard = {
  id: string;
  completed: boolean | null;
  completed_at?: string | null;
  current_round?: number | null;
  received_at?: string | null;
  received_by?: string | null;
};

type EventMeta = { by?: unknown; bulk?: unknown; card_id?: unknown; round?: unknown };
const meta = (e: StageEventRow): EventMeta => (e.metadata && typeof e.metadata === "object" ? e.metadata as EventMeta : {});
const timeOf = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Where a card is now, what's done and left, and its history.
 * `events`: the order's order_events, NEWEST FIRST (as currentStages() wants);
 * only 'stage_update' and 'round_started' rows of this card are used.
 */
export function cardStageState(card: StageCard, events: readonly StageEventRow[]): CardStageState {
  const round = card.current_round ?? 1;
  const completed = !!card.completed;
  const current = completed ? null : currentStages(events as StageEventRow[], { [card.id]: round })[card.id] ?? null;
  const idx = completed ? STAGES.length : stageIndex(current);

  const history: StageHistoryEntry[] = [];
  let updatedAt: string | null = null;
  // Oldest first (events come newest first; keep the order of equal times)
  [...events].reverse().forEach((e) => {
    if (e.event_type === "stage_update") {
      const s = parseStageEvent(e);
      if (!s || s.card_id !== card.id) return;
      const m = meta(e);
      history.push({
        kind: "stage", at: e.created_at, by: typeof m.by === "string" ? m.by : null, round: s.round, stage: s.stage,
        label: s.round > 1 ? `Round ${s.round} · ${adminStageLabel(s.stage)}` : adminStageLabel(s.stage),
        bulk: m.bulk === true,
      });
      if (s.round === round) updatedAt = e.created_at;
    } else if (e.event_type === "round_started") {
      const m = meta(e);
      if (m.card_id !== card.id) return;
      const r = Number(m.round) || round;
      history.push({ kind: "round_started", at: e.created_at, by: typeof m.by === "string" ? m.by : null, round: r, stage: null, label: `Round ${r} started`, bulk: false });
    }
  });
  if (card.received_at) {
    history.push({ kind: "received", at: card.received_at, by: card.received_by ?? null, round: 1, stage: null, label: "Received", bulk: false });
  }
  if (completed && card.completed_at) {
    history.push({ kind: "completed", at: card.completed_at, by: null, round, stage: null, label: DONE_LABEL, bulk: false });
    updatedAt = card.completed_at;
  }
  history.sort((a, b) => timeOf(a.at) - timeOf(b.at));

  return {
    round,
    completed,
    currentIndex: idx,
    current,
    currentLabel: completed ? DONE_LABEL : current ? adminStageLabel(current) : NOT_STARTED_LABEL,
    doneStages: completed ? [...STAGES] : idx > 0 ? STAGES.slice(0, idx) : [],
    remainingStages: completed ? [] : STAGES.slice(idx + 1),
    next: completed ? null : nextStepAfter(idx === -1 ? null : current),
    updatedAt,
    history,
  };
}

/** A card as advanceCards() sees it. */
export type AdvanceCard = {
  id: string;
  current: string | null;     // current stage this round (null = not started)
  completed: boolean;
  refunded: boolean;
  awaiting: boolean;          // flagged awaiting_arrival
  round: number;
};

export type SkipReason = "different_stage" | "done" | "refunded" | "awaiting_arrival" | "not_on_order";

export type AdvancePlan = {
  target: NextStep;
  /** Cards to give a stage_update event (stage = target). */
  moves: { cardId: string; stage: string; round: number }[];
  /** Cards to mark done (target "complete", i.e. from Final Dry). */
  completes: string[];
  /** Cards left alone, with why and where they are. */
  skipped: { cardId: string; reason: SkipReason; current: string | null }[];
};

/**
 * Move the chosen cards that are at `fromStage` (null = not started) to
 * `toStage` (default: the next step; "complete" after Final Dry marks them
 * done). Cards at any other step, done, refunded or still awaiting arrival
 * are skipped, never overwritten.
 */
export function planAdvance(input: {
  cards: readonly AdvanceCard[];
  cardIds: readonly string[];
  fromStage: string | null;
  toStage?: string | "complete";
}): { ok: true; plan: AdvancePlan } | { ok: false; status: number; error: string } {
  const { fromStage } = input;
  if (fromStage !== null && stageIndex(fromStage) === -1) return { ok: false, status: 400, error: "Unknown stage" };
  let target: NextStep;
  if (input.toStage === undefined) target = nextStepAfter(fromStage);
  else if (input.toStage === "complete") target = { kind: "complete", label: DONE_LABEL };
  else if (stageIndex(input.toStage) === -1) return { ok: false, status: 400, error: "Unknown stage" };
  else if (input.toStage === fromStage) return { ok: false, status: 400, error: "The cards are already at that step." };
  else target = { kind: "stage", stage: input.toStage, label: adminStageLabel(input.toStage) };

  const ids = [...new Set(input.cardIds)];
  if (!ids.length) return { ok: false, status: 400, error: "Pick at least one card." };
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const plan: AdvancePlan = { target, moves: [], completes: [], skipped: [] };
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) plan.skipped.push({ cardId: id, reason: "not_on_order", current: null });
    else if (c.refunded) plan.skipped.push({ cardId: id, reason: "refunded", current: c.current });
    else if (c.completed) plan.skipped.push({ cardId: id, reason: "done", current: null });
    else if (c.awaiting) plan.skipped.push({ cardId: id, reason: "awaiting_arrival", current: c.current });
    else if (c.current !== fromStage) plan.skipped.push({ cardId: id, reason: "different_stage", current: c.current });
    else if (target.kind === "complete") plan.completes.push(id);
    else plan.moves.push({ cardId: id, stage: target.stage, round: c.round });
  }
  return { ok: true, plan };
}

type CompletionCard = { completed: boolean | null; completed_at?: string | null; status: string | null };

/** A bag is complete when it has a non-refunded card and every non-refunded card is done. */
export function isBagComplete(cards: readonly CompletionCard[]): boolean {
  const live = cards.filter((c) => c.status !== "refunded");
  return live.length > 0 && live.every((c) => !!c.completed);
}

/**
 * The tier_bags change that keeps completed_at in step with the cards, or
 * null when none is needed: set it once complete (the last card's done time,
 * else `now`; an existing time is kept), clear it (and the seen mark) when a
 * card reopens.
 */
export function bagCompletionPatch(
  bag: { completed_at: string | null; source?: string | null },
  cards: readonly CompletionCard[],
  now: string,
  orderStatus?: string | null,
): { completed_at: string | null; completion_seen_at?: null } | null {
  const complete = isBagComplete(cards);
  if (complete && !bag.completed_at) {
    const last = cards.filter((c) => c.status !== "refunded").map((c) => c.completed_at).filter((t): t is string => !!t)
      .sort((a, b) => timeOf(a) - timeOf(b)).pop();
    return { completed_at: last ?? now };
  }
  if (!complete && bag.completed_at && !keepsHistoricalCompletion(bag, orderStatus)) return { completed_at: null, completion_seen_at: null };
  return null;
}

/**
 * A Historical Order Setup bag of a finished order (completed, shipped back,
 * delivered) stays completed even though older orders' cards were never
 * ticked done: finished historical orders are never reopened.
 */
export function keepsHistoricalCompletion(bag: { source?: string | null }, orderStatus?: string | null): boolean {
  return bag.source === "migration" && ["completed", "shipped_back", "delivered"].includes(orderStatus ?? "");
}

/** Cards grouped by step for bulk moves: not started, the 8 steps in order, done. Refunded cards are left out. */
export function stageGroups(cards: readonly { id: string; refunded: boolean; stage: CardStageState }[]): BagStageGroup[] {
  const groups = new Map<string, BagStageGroup>();
  for (const c of cards) {
    if (c.refunded) continue;
    const key = c.stage.completed ? "done" : c.stage.current ?? "not_started";
    const g = groups.get(key) ?? {
      key,
      stage: c.stage.completed ? null : c.stage.current,
      completed: c.stage.completed,
      label: c.stage.currentLabel,
      cardIds: [],
    };
    g.cardIds.push(c.id);
    groups.set(key, g);
  }
  const rank = (g: BagStageGroup) => (g.completed ? STAGES.length + 1 : g.stage ? stageIndex(g.stage) + 1 : 0);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
