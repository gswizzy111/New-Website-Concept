import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { DONE_LABEL } from "@/lib/intake/stage-plan";

/**
 * The step picker's logic (StepPicker in components/intake/tracking-actions.tsx),
 * pure (safe in client components and tests). Staff tap any of the 8 steps or
 * Done, in any order (the owner, Nov 25 2026): one card on its card page, a
 * group or a whole bag on the bag page and the Bags board.
 */

/** What a chip sets: a stored stage name ("Book"), or "done". */
export const DONE_TARGET = "done";

/** A card as the picker sees it: its step now (null = not started) and whether it is done. */
export type PickerCard = { id: string; current: string | null; completed?: boolean };

export type PickerChip = {
  /** Stored stage name, or "done". */
  target: string;
  /** 1-8 for the steps, null for Done. */
  number: number | null;
  /** "Ready for Slab Crack", "Drying", "Done". */
  label: string;
  /** Every card is here already: highlighted, nothing to tap. */
  current: boolean;
  /** Cards here now. */
  count: number;
  /** Reached earlier this round (a check mark), not the current one. */
  reached: boolean;
};

/**
 * The 9 chips in order (the 8 steps, then Done). `reached`: the steps one
 * card reached this round (CardStageState.doneStages); leave it out for a
 * group or a bag.
 */
export function pickerChips(cards: readonly PickerCard[], reached: readonly string[] = []): PickerChip[] {
  const at = (target: string) => cards.filter((c) => (target === DONE_TARGET ? !!c.completed : !c.completed && c.current === target)).length;
  const chip = (target: string, number: number | null, label: string): PickerChip => {
    const count = at(target);
    const current = cards.length > 0 && count === cards.length;
    return { target, number, label, current, count, reached: !current && target !== DONE_TARGET && reached.includes(target) };
  };
  return [...STAGES.map((s, i) => chip(s, i + 1, adminStageLabel(s))), chip(DONE_TARGET, null, DONE_LABEL)];
}

/** A bag's cards for its picker, from its step groups (BagSummary.stageGroups; refunded cards are already left out). */
export function groupPickerCards(groups: readonly { stage: string | null; completed: boolean; cardIds: readonly string[] }[]): PickerCard[] {
  return groups.flatMap((g) => g.cardIds.map((id) => ({ id, current: g.completed ? null : g.stage, completed: g.completed })));
}

/** The body for POST /api/admin/intake/stages. */
export type PickerRequest = { orderId: string; cardIds: string[]; toStage: string; fromStages: Record<string, string | null> };

/**
 * The request that puts `cards` at `target` (a stored stage name or "done"):
 * every card not done and not there already, each with the step the page
 * shows for it (the route's guard: a card someone moved meanwhile is left
 * alone). Null when there is nothing to move.
 */
export function pickerRequest(orderId: string, cards: readonly PickerCard[], target: string): PickerRequest | null {
  const moving = cards.filter((c) => !c.completed && (target === DONE_TARGET || c.current !== target));
  if (!moving.length) return null;
  return {
    orderId,
    cardIds: moving.map((c) => c.id),
    toStage: target,
    fromStages: Object.fromEntries(moving.map((c) => [c.id, c.current])),
  };
}

/** Done for more than one card asks once more (a bag's cards all marked done completes the bag). */
export function pickerNeedsConfirm(target: string, cards: readonly PickerCard[]): boolean {
  return target === DONE_TARGET && cards.filter((c) => !c.completed).length > 1;
}

/** The route's answer as far as the picker reads it. */
export type PickerResponse = {
  moved?: unknown;
  newStep?: unknown;
  skipped?: { reason?: string }[];
  emailed?: boolean;
};

const count = (x: unknown) => (Array.isArray(x) ? x.length : Number(x) || 0);
const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
const was = (n: number) => (n === 1 ? "was" : "were");

/** The line staff see after a tap, from the route's answer; "warn" when some cards were left alone. */
export function pickerOutcome(target: string, requested: number, res: PickerResponse): { tone: "ok" | "warn"; text: string } {
  const label = target === DONE_TARGET ? DONE_LABEL : adminStageLabel(target);
  const moved = count(res.moved);
  const fresh = count(res.newStep);
  const skipped = new Map<string, number>();
  for (const s of res.skipped ?? []) skipped.set(s.reason ?? "", (skipped.get(s.reason ?? "") ?? 0) + 1);
  const n = (reason: string) => skipped.get(reason) ?? 0;
  const parts: string[] = [];

  if (moved) {
    if (target === DONE_TARGET) parts.push(requested === 1 && moved === 1 ? "Marked done." : `${cards(moved)} marked done.`);
    else parts.push(requested === 1 && moved === 1 ? `Now at ${label}.` : `${cards(moved)} moved to ${label}.`);
    if (target !== DONE_TARGET) {
      if (!fresh) parts.push("No customer email: they already heard about this step or a later one.");
      else if (res.emailed) parts.push(fresh === moved ? "Customer emailed." : `Customer emailed about ${fresh} of them.`);
    }
  } else if (n("already_there") && n("already_there") === (res.skipped ?? []).length) {
    return { tone: "ok", text: `Already at ${label}.` };
  } else if (n("done") && n("done") === (res.skipped ?? []).length) {
    return { tone: "ok", text: "Already done." };
  }

  if (n("different_stage")) {
    parts.push(moved
      ? `${cards(n("different_stage"))} ${was(n("different_stage"))} moved on another screen just now and left alone.`
      : "Nothing changed: the step was changed on another screen just now. The page now shows where things are.");
  }
  if (moved && n("already_there")) parts.push(`${n("already_there")} already at ${label}.`);
  if (n("done") && (moved || n("done") < (res.skipped ?? []).length)) parts.push(`${n("done")} already done.`);
  if (n("awaiting_arrival")) parts.push(`${cards(n("awaiting_arrival"))} not received yet.`);
  if (n("refunded")) parts.push(`${cards(n("refunded"))} refunded.`);
  if (n("not_on_order")) parts.push(`${cards(n("not_on_order"))} not on this order.`);
  if (!parts.length) parts.push("Nothing changed.");
  const warn = !moved || ["different_stage", "awaiting_arrival", "refunded", "not_on_order"].some((r) => n(r) > 0);
  return { tone: warn ? "warn" : "ok", text: parts.join(" ") };
}
