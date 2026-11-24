import { adminStageLabel } from "@/lib/restoration-stages";
import type { CodeKind } from "@/lib/intake/codes";
import { stageIndex } from "@/lib/intake/stage-plan";
import { DONE_STAGE_KEY } from "@/lib/intake/tracking/places";
import type { LocationKind, MoveAction, MoveResultItem } from "@/lib/intake/tracking/types";

/**
 * What a scan at a place does, worked out without the database (pure; safe in
 * tests). lib/intake/tracking/moves.ts loads the cards, calls planMove and
 * writes the result.
 *
 * Rules:
 * - Every arrived, non-refunded card of each scanned code moves to the place
 *   (a Bag ID = its cards, an order code = all its cards). Refunded cards and
 *   cards not received yet are left out and named in the message; a single
 *   card that is refunded or not received is refused.
 * - A station (kind 'station') also sets the step to the station's stage,
 *   forward only: a card at an earlier step (or not started) jumps to it; a
 *   card already at a later step keeps its step (the place still changes, and
 *   the message says so); a done card stays done.
 * - A Done place (kind 'done') marks the cards done.
 * - Shelves, Shipping and other places only change the place.
 * - Idempotent: a card already there, at that step, is left alone (no move
 *   row, no event, no email). A card scanned twice in one request counts once.
 * - Bags: a scanned bag moves with its cards; any other bag moves when every
 *   arrived, non-refunded card of it ends up at the place.
 */

/** The place being moved to. */
export type PlanLocation = { id: string; code: string; name: string; kind: LocationKind; stage: string | null };

/** A card as the planner sees it. */
export type PlanCard = {
  id: string;
  code: string | null;
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
};

export type PlanBag = { id: string; code: string; locationId: string | null };

/** A scanned code: resolved to its cards, or refused before planning. */
export type PlanCode =
  | { code: string; kind: "card" | "bag" | "order"; id: string; cardIds: string[] }
  | { code: string; kind: CodeKind | null; error: string };

/** One card's change. */
export type PlannedMove = {
  cardId: string;
  orderId: string;
  bagId: string | null;
  fromLocationId: string | null;
  toLocationId: string;
  /** Stored stage name, "done" or null (not started), before and after. */
  stageBefore: string | null;
  stageAfter: string | null;
  locationChanges: boolean;
  /** A stage_update event to write (station moves). */
  stageEvent: { stage: string; round: number } | null;
  /** Mark the card done (Done place). */
  complete: boolean;
  action: MoveAction;
};

export type MovePlan = {
  moves: PlannedMove[];
  results: MoveResultItem[];
  /** Bags whose location becomes the place. */
  bagIds: string[];
};

const stageKey = (c: PlanCard): string | null => (c.completed ? DONE_STAGE_KEY : c.current);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cardsWord = (n: number) => plural(n, "card");

type CardOutcome =
  | { kind: "refunded" }
  | { kind: "not_received" }
  | { kind: "unchanged" }
  | { kind: "moved"; move: PlannedMove; note: "stage_set" | "later_kept" | "done_kept" | "completed" | null };

function cardOutcome(card: PlanCard, loc: PlanLocation, action: MoveAction | undefined): CardOutcome {
  if (card.refunded) return { kind: "refunded" };
  if (!card.received) return { kind: "not_received" };
  const before = stageKey(card);
  let stageEvent: PlannedMove["stageEvent"] = null;
  let complete = false;
  let note: "stage_set" | "later_kept" | "done_kept" | "completed" | null = null;
  if (loc.kind === "station" && loc.stage) {
    if (card.completed) note = "done_kept";
    else {
      const have = stageIndex(card.current);
      const want = stageIndex(loc.stage);
      if (have < want) {
        stageEvent = { stage: loc.stage, round: card.round };
        note = "stage_set";
      } else if (have > want) note = "later_kept";
    }
  } else if (loc.kind === "done" && !card.completed) {
    complete = true;
    note = "completed";
  }
  const locationChanges = card.locationId !== loc.id;
  if (!locationChanges && !stageEvent && !complete) return { kind: "unchanged" };
  return {
    kind: "moved",
    note,
    move: {
      cardId: card.id,
      orderId: card.orderId,
      bagId: card.bagId,
      fromLocationId: card.locationId,
      toLocationId: loc.id,
      stageBefore: before,
      stageAfter: complete ? DONE_STAGE_KEY : stageEvent ? stageEvent.stage : before,
      locationChanges,
      stageEvent,
      complete,
      action: action ?? (complete ? "done" : "move"),
    },
  };
}

/**
 * Plan a move of the scanned codes to `location`. `cards` holds every card of
 * the orders involved (the bag rule needs a bag's other cards); `bags` the
 * bags involved. `action` overrides the move rows' action (e.g. "receive").
 */
export function planMove(input: {
  location: PlanLocation;
  codes: readonly PlanCode[];
  cards: readonly PlanCard[];
  bags?: readonly PlanBag[];
  action?: MoveAction;
}): MovePlan {
  const loc = input.location;
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const moves: PlannedMove[] = [];
  const results: MoveResultItem[] = [];
  const scannedBags = new Set<string>();
  const stageLabel = loc.kind === "station" && loc.stage ? adminStageLabel(loc.stage) : null;

  for (const code of input.codes) {
    if ("error" in code) {
      results.push({ code: code.code, ok: false, kind: code.kind, moved: 0, unchanged: 0, message: code.error, cardIds: [] });
      continue;
    }
    const counts = { moved: 0, unchanged: 0, refunded: 0, notReceived: 0, stageSet: 0, laterKept: 0, doneKept: 0, completed: 0 };
    let atStage = 0; // covered cards at the station's step afterwards
    const laterStages = new Set<string>();
    const covered: string[] = [];
    let missing = 0;
    for (const id of code.cardIds) {
      const card = byId.get(id);
      if (!card) { missing++; continue; }
      if (seen.has(id)) {
        // Already counted earlier in this request (a card and its bag both scanned)
        counts.unchanged++;
        covered.push(id);
        if (loc.stage && (moves.find((m) => m.cardId === id)?.stageAfter ?? stageKey(card)) === loc.stage) atStage++;
        continue;
      }
      const out = cardOutcome(card, loc, input.action);
      if (out.kind === "refunded") counts.refunded++;
      else if (out.kind === "not_received") counts.notReceived++;
      else {
        seen.add(id);
        covered.push(id);
        if (out.kind === "unchanged") {
          counts.unchanged++;
          if (loc.stage && stageKey(card) === loc.stage) atStage++;
        } else {
          if (loc.stage && out.move.stageAfter === loc.stage) atStage++;
          counts.moved++;
          moves.push(out.move);
          if (out.note === "stage_set") counts.stageSet++;
          if (out.note === "completed") counts.completed++;
          if (out.note === "done_kept") counts.doneKept++;
          if (out.note === "later_kept") { counts.laterKept++; if (card.current) laterStages.add(adminStageLabel(card.current)); }
        }
      }
    }
    if (code.kind === "bag" && covered.length) scannedBags.add(code.id);

    const ok = covered.length > 0;
    const result: MoveResultItem = {
      code: code.code, ok, kind: code.kind, moved: counts.moved, unchanged: counts.unchanged,
      message: "", cardIds: covered,
    };
    if (loc.kind === "station" && loc.stage && atStage > 0) {
      result.stage = loc.stage;
      result.stageLabel = stageLabel ?? undefined;
    }
    result.message = code.kind === "card"
      ? cardMessage(code.code, loc, counts, [...laterStages][0] ?? null, stageLabel, missing > 0)
      : groupMessage(code.kind, code.code, loc, counts, laterStages, stageLabel, code.cardIds.length - missing);
    results.push(result);
  }

  // Bags: scanned ones, and any whose arrived, non-refunded cards all end up here
  const after = new Map(input.cards.map((c) => [c.id, c.locationId]));
  for (const m of moves) after.set(m.cardId, m.toLocationId);
  const bagIds: string[] = [];
  for (const bag of input.bags ?? []) {
    if (bag.locationId === loc.id) continue;
    const live = input.cards.filter((c) => c.bagId === bag.id && !c.refunded && c.received);
    const touched = moves.some((m) => m.bagId === bag.id) || scannedBags.has(bag.id);
    if (!touched) continue;
    if (scannedBags.has(bag.id) || (live.length > 0 && live.every((c) => after.get(c.id) === loc.id))) bagIds.push(bag.id);
  }
  return { moves, results, bagIds };
}

type Counts = { moved: number; unchanged: number; refunded: number; notReceived: number; stageSet: number; laterKept: number; doneKept: number; completed: number };

function cardMessage(code: string, loc: PlanLocation, c: Counts, laterStage: string | null, stageLabel: string | null, missing: boolean): string {
  if (missing) return `${code} wasn't found.`;
  if (c.refunded) return `${code} was refunded. Not moved.`;
  if (c.notReceived) return `${code} hasn't been received yet. Receive it first.`;
  if (c.unchanged) return `Already at ${loc.name}.`;
  if (c.completed) return `Marked done. Moved to ${loc.name}.`;
  if (c.stageSet) return `Moved to ${loc.name}. Step: ${stageLabel}.`;
  if (c.laterKept) return `Moved to ${loc.name}. Step stays ${laterStage ?? "as it was"} (past ${stageLabel}).`;
  if (c.doneKept) return `Moved to ${loc.name}. It's done, so the step wasn't changed.`;
  return `Moved to ${loc.name}.`;
}

function groupMessage(
  kind: "bag" | "order",
  code: string,
  loc: PlanLocation,
  c: Counts,
  laterStages: Set<string>,
  stageLabel: string | null,
  total: number,
): string {
  const what = kind === "bag" ? `Bag ${code}` : `Order ${code}`;
  if (total === 0) return `${what} has no cards.`;
  const covered = c.moved + c.unchanged;
  const left: string[] = [];
  if (c.refunded) left.push(`${c.refunded} refunded`);
  if (c.notReceived) left.push(`${c.notReceived} not received yet`);
  if (!covered) return `${what}: nothing moved (${left.join(", ")}).`;
  const parts: string[] = [];
  if (c.moved) parts.push(`${what}: ${cardsWord(c.moved)} moved to ${loc.name}.`);
  else parts.push(`${what}: already at ${loc.name}.`);
  if (c.moved && c.unchanged) parts.push(`${c.unchanged} already there.`);
  if (c.completed) parts.push(`${cardsWord(c.completed)} marked done.`);
  if (c.stageSet) parts.push(`Step: ${stageLabel}${c.stageSet < covered ? ` for ${cardsWord(c.stageSet)}` : ""}.`);
  if (c.laterKept) parts.push(`${cardsWord(c.laterKept)} past ${stageLabel} kept ${c.laterKept === 1 ? "its" : "their"} step${laterStages.size === 1 ? ` (${[...laterStages][0]})` : ""}.`);
  if (c.doneKept) parts.push(`${cardsWord(c.doneKept)} already done.`);
  if (left.length) parts.push(`Left out: ${left.join(", ")}.`);
  return parts.join(" ");
}
