import { adminStageLabel } from "@/lib/restoration-stages";
import { stageIndex, stepEmailsCustomer } from "@/lib/intake/stage-plan";
import { DONE_STAGE_KEY } from "@/lib/intake/tracking/places";
import type { LocationKind, MoveAction, TrackCardResult } from "@/lib/intake/tracking/types";

/**
 * What assign / move / release / done do to each card, worked out without
 * the database (pure; safe in tests). lib/intake/tracking/moves.ts reads the
 * cards, calls planCards and writes the result.
 *
 * Rules:
 * - A refunded card, or one not received yet, is refused (named in its result),
 *   except by `release`: a card refunded while it sat in a slot can still be
 *   taken out, so the slot frees up.
 * - Into a slot (kind 'station'): the card's step becomes the slot's step,
 *   whether that is later or earlier than its step now: steps are taken in
 *   any order (the owner, Nov 25 2026), so a Clamp Work card put in a heat
 *   press is at Heat Press. A done card stays done (un-done it on the order
 *   page first).
 * - The customer is emailed only about a step past the furthest one the card
 *   reached this round (stepEmailsCustomer in lib/intake/stage-plan.ts; the
 *   move's `email`); going back, or to a step it already reached, writes a
 *   staff-only step event and no email.
 * - Into a Done place (kind 'done'), or `done`: the card is marked done.
 * - Shelves, Shipping and other places only change where the card is.
 * - A one-card holder (every slot, every other place but a desk or the Open
 *   bags box: holdsOneCard in places.ts) takes one card: moves.ts refuses a
 *   second card, or several at once, before anything is written
 *   (oneCardRefusal below; force never bypasses it).
 * - `release` takes the card out of its slot (no place); its step stays.
 * - A card is in one place at a time, so going anywhere frees its old slot.
 * - Idempotent: a card already there, at that step, is left alone (no move
 *   row, no event, no email). A card listed twice counts once.
 */

/** The place cards go to. */
export type PlanLocation = { id: string; code: string; name: string; kind: LocationKind; stage: string | null };

/** A card as the planner sees it. */
export type PlanCard = {
  id: string;
  code: string | null;
  name: string | null;
  orderId: string;
  bagId: string | null;
  locationId: string | null;
  refunded: boolean;
  /** Arrived through Receiving (received_at or a bag) and not flagged awaiting arrival. */
  received: boolean;
  completed: boolean;
  /** Current stage this round (stored name), null = not started. */
  current: string | null;
  round: number;
  /** furthestStageIndex() this round, for the email rule; default: the current step's index. */
  furthest?: number;
};

/** One card's change. */
export type PlannedMove = {
  cardId: string;
  orderId: string;
  bagId: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  /** Stored stage name, "done" or null (not started), before and after. */
  stageBefore: string | null;
  stageAfter: string | null;
  locationChanges: boolean;
  /** A stage_update event to write (into a slot). */
  stageEvent: { stage: string; round: number } | null;
  /** The step is new for the customer (stepEmailsCustomer): in the order's one email, event customer visible. */
  email: boolean;
  /** Mark the card done. */
  complete: boolean;
  action: MoveAction;
};

export type CardPlan = {
  moves: PlannedMove[];
  results: TrackCardResult[];
  /** One line for the whole request. */
  message: string;
};

export type PlanAction = "assign" | "move" | "release" | "done";

const stageKey = (c: Pick<PlanCard, "completed" | "current">): string | null => (c.completed ? DONE_STAGE_KEY : c.current);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cardsWord = (n: number) => plural(n, "card");
const label = (c: Pick<PlanCard, "code" | "name">) => c.code ?? c.name ?? "This card";

type Note = "stage_set" | "done_kept" | "completed" | "released" | null;

/**
 * Plan `action` for the cards `cardIds` (in that order; repeats count once).
 * `target` is where they go: the slot or place for assign / move, the Done
 * place for done (null if there is none: the cards then leave their slot),
 * ignored for release. `cards` holds at least the requested cards.
 * `actionName` overrides the move rows' action (e.g. "receive").
 */
export function planCards(input: {
  action: PlanAction;
  target: PlanLocation | null;
  cardIds: readonly string[];
  cards: readonly PlanCard[];
  actionName?: MoveAction;
}): CardPlan {
  const { action } = input;
  const target = action === "release" ? null : input.target;
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const moves: PlannedMove[] = [];
  const results: TrackCardResult[] = [];
  const notes = { stageSet: 0, doneKept: 0, completed: 0, released: 0 };
  const refused: string[] = [];
  const stageLabel = target?.kind === "station" && target.stage ? adminStageLabel(target.stage) : null;

  for (const id of [...new Set(input.cardIds)]) {
    const card = byId.get(id);
    if (!card) {
      results.push({ cardId: id, code: null, name: null, ok: false, changed: false, message: "Card not found." });
      refused.push("not found");
      continue;
    }
    const base = { cardId: id, code: card.code, name: card.name };
    if (card.refunded && action !== "release") {
      results.push({ ...base, ok: false, changed: false, message: `${label(card)} was refunded. Not moved.` });
      refused.push("refunded");
      continue;
    }
    if (!card.received && action !== "release") {
      results.push({ ...base, ok: false, changed: false, message: `${label(card)} hasn't been received yet. Receive it first.` });
      refused.push("not received yet");
      continue;
    }

    const before = stageKey(card);
    let stageEvent: PlannedMove["stageEvent"] = null;
    let complete = false;
    let note: Note = null;
    if (action === "done" || target?.kind === "done") {
      if (!card.completed) { complete = true; note = "completed"; }
    } else if (target?.kind === "station" && target.stage) {
      if (card.completed) note = "done_kept";
      else if (card.current !== target.stage) { stageEvent = { stage: target.stage, round: card.round }; note = "stage_set"; }
    }
    const email = !!stageEvent && stepEmailsCustomer(stageEvent.stage, card.furthest ?? stageIndex(card.current));
    const toId = target?.id ?? null;
    const locationChanges = card.locationId !== toId;
    if (action === "release" && locationChanges) note = "released";
    const after = complete ? DONE_STAGE_KEY : stageEvent ? stageEvent.stage : before;
    const atStage = target?.kind === "station" && !!target.stage && after === target.stage;
    const stageFields = atStage && stageLabel ? { stage: target!.stage!, stageLabel } : {};

    if (!locationChanges && !stageEvent && !complete) {
      const message = action === "release" ? "Not in a slot."
        : action === "done" ? "Already done."
        : `Already in ${target!.name}.`;
      results.push({ ...base, ok: true, changed: false, ...stageFields, message });
      continue;
    }
    moves.push({
      cardId: id,
      orderId: card.orderId,
      bagId: card.bagId,
      fromLocationId: card.locationId,
      toLocationId: toId,
      stageBefore: before,
      stageAfter: after,
      locationChanges,
      stageEvent,
      email,
      complete,
      action: input.actionName ?? (complete ? "done" : action === "release" ? "release" : action),
    });
    if (note === "stage_set") notes.stageSet++;
    if (note === "completed") notes.completed++;
    if (note === "done_kept") notes.doneKept++;
    if (note === "released") notes.released++;
    results.push({ ...base, ok: true, changed: true, ...stageFields, message: cardMessage(action, target, note, stageLabel) });
  }

  return { moves, results, message: summary(action, target, moves.length, results, notes, stageLabel, refused) };
}

function cardMessage(action: PlanAction, target: PlanLocation | null, note: Note, stageLabel: string | null): string {
  if (action === "release") return "Taken out of its slot.";
  if (note === "completed") return target ? `Done. In ${target.name}.` : "Done.";
  if (action === "done") return target ? `Already done. In ${target.name}.` : "Already done. Taken out of its slot.";
  const where = `In ${target!.name}.`;
  if (note === "stage_set") return `${where} Step: ${stageLabel}.`;
  if (note === "done_kept") return `${where} It's done, so the step wasn't changed.`;
  return where;
}

function summary(
  action: PlanAction,
  target: PlanLocation | null,
  changed: number,
  results: readonly TrackCardResult[],
  notes: { stageSet: number; doneKept: number; completed: number; released: number },
  stageLabel: string | null,
  refused: readonly string[],
): string {
  const parts: string[] = [];
  const ok = results.filter((r) => r.ok).length;
  if (results.length === 1 && changed + refused.length === 1) {
    // One card: its own sentence
    return results[0].message;
  }
  if (changed) {
    if (action === "release") parts.push(`${cardsWord(changed)} taken out.`);
    else if (action === "done") parts.push(`${cardsWord(notes.completed || changed)} done.`);
    else parts.push(`${cardsWord(changed)} in ${target!.name}.`);
  } else if (ok) {
    parts.push(action === "release" ? "Not in a slot." : action === "done" ? "Already done." : `Already in ${target!.name}.`);
  }
  if (changed && ok > changed) parts.push(`${ok - changed} already there.`);
  if (action !== "done" && notes.completed) parts.push(`${cardsWord(notes.completed)} marked done.`);
  if (notes.stageSet) parts.push(`Step: ${stageLabel}${notes.stageSet < ok ? ` for ${cardsWord(notes.stageSet)}` : ""}.`);
  if (notes.doneKept) parts.push(`${cardsWord(notes.doneKept)} already done.`);
  if (refused.length) {
    const counts = new Map<string, number>();
    for (const r of refused) counts.set(r, (counts.get(r) ?? 0) + 1);
    parts.push(`Not moved: ${[...counts].map(([why, n]) => `${n} ${why}`).join(", ")}.`);
  }
  return parts.join(" ") || "Nothing to do.";
}

/**
 * Whether putting `movingIds` into a slot that holds `occupantIds` now would
 * go over `capacity` (null = no limit). Cards already in the slot count once.
 */
export function overCapacity(capacity: number | null | undefined, occupantIds: readonly string[], movingIds: readonly string[]): boolean {
  if (capacity == null) return false;
  return new Set([...occupantIds, ...movingIds]).size > capacity;
}

/** A card in a sentence: "CD-2549-03 · Charizard" (what's known of it). */
function cardRef(c: { code: string | null; name: string | null }): string {
  return [c.code, c.name?.trim() || null].filter(Boolean).join(" · ") || "a card";
}

/** "CLAMP 07 holds one card. Pick one card to put here." (several cards at once into a one-card holder). */
export function oneCardOnlyText(holderName: string): string {
  return `${holderName} holds one card. Pick one card to put here.`;
}

/**
 * A one-card holder that has a card in it already: "CLAMP 07 already has a
 * card (CD-2549-03 · Charizard). Take it out first, or pick another holder."
 * (2+ from before the rule: "already has 2 cards (…, …). Take them out first,
 * …"; not known: "already has a card. Take it out first, …").
 */
export function holderTakenText(holderName: string, occupants: readonly { code: string | null; name: string | null }[]): string {
  const tail = occupants.length > 1 ? "Take them out first, or pick another holder." : "Take it out first, or pick another holder.";
  if (!occupants.length) return `${holderName} already has a card. ${tail}`;
  if (occupants.length === 1) return `${holderName} already has a card (${cardRef(occupants[0])}). ${tail}`;
  return `${holderName} already has ${occupants.length} cards (${occupants.map(cardRef).join(", ")}). ${tail}`;
}

/**
 * The owner's one-card rule for a request into a one-card holder (places.ts
 * holdsOneCard), whatever its stored capacity and whatever `force` says:
 * `going` = the cards that would go in (a card already in it isn't going:
 * putting it there again is no change), `others` = the cards in it now that
 * aren't going. "taken" when it has another card (whatever is going),
 * "several" when 2+ would go in at once, else null (allowed).
 */
export function oneCardRefusal(going: readonly string[], others: readonly string[]): "taken" | "several" | null {
  const g = new Set(going);
  if (!g.size) return null;
  if (others.some((id) => !g.has(id))) return "taken";
  return g.size > 1 ? "several" : null;
}
