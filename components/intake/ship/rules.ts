import { INTAKE_START } from "@/lib/intake/start";

/**
 * The rules behind the ship check (/admin/receiving/ship/<orderId>) and the
 * Forgotten cards report (/admin/receiving/forgotten, and the "Check" menu
 * badge). Pure: no database, no clock (callers pass `now`), safe in client
 * components and tests (tests/intake/forgotten.test.ts).
 *
 * The model (the owner, Nov 24 2026): cards carry no sticker and are never
 * scanned. They sit in serial-numbered SLOTS (CLAMP 07, HEAT PRESS 03: places
 * of kind "station", one step each); cards.location_id is the slot a card is
 * in now. Done, Shipping and the due-date shelves are places, not slots.
 *
 * The owner's problem: "Once in a while a card will be forgotten to be marked
 * done. And then we have no way of knowing." A card looks forgotten when:
 *   (a) finished_not_done  its order is Completed / Shipped Back / Delivered
 *                          but the card isn't marked done;
 *   (b) final_dry          its step has been Final Dry, or it has sat in a
 *                          Final Dry slot or on the Done shelf, for 3+ days
 *                          without being marked done;
 *   (e) slot_idle          it has sat in the same slot for N+ days (default
 *                          3) with no move (done cards too: a done card
 *                          still in a slot may have been left behind);
 *   (c) stale              its order is open (Cards Received / In Progress)
 *                          and nothing has happened to it (slot move, step
 *                          change) for 14+ days;
 *   (d) a bag is past its due date with cards not done (bagPastDue).
 * A card is listed once, under the first of a, b, e, c it trips. The menu
 * badge counts (a) and (b). Refunded cards and cards still awaiting arrival
 * are never forgotten; neither are the old cards of a Historical Order Setup
 * bag on a finished order (never ticked done on purpose:
 * keepsHistoricalCompletion in lib/intake/stage-plan.ts).
 */

export const FINAL_DRY_STAGE = "Final Dry";
/** Days at Final Dry (or on the Done shelf) before a card that isn't marked done is flagged. */
export const FINAL_DRY_DAYS = 3;
/** Default days in one slot with no move before a card is flagged; the report can change it. */
export const SLOT_DAYS = 3;
export const SLOT_DAY_CHOICES: readonly number[] = [2, 3, 5, 7, 14];
/** Days without a slot move or step change before a card of an open order is flagged. */
export const STALE_DAYS = 14;
/** Order statuses that mean the work is finished. */
export const FINISHED_ORDER_STATUSES: readonly string[] = ["completed", "shipped_back", "delivered"];
/** Order statuses that mean the cards are in the shop being worked on. */
export const OPEN_ORDER_STATUSES: readonly string[] = ["received", "in_progress"];

const DAY_MS = 86_400_000;
const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Whole days from `iso` to `now` (0 for the future or a missing time). */
export function daysSince(iso: string | null | undefined, now: number): number {
  const t = time(iso);
  return t === null ? 0 : Math.max(0, Math.floor((now - t) / DAY_MS));
}

/** "just now", "5 min ago", "3 h ago", "1 day ago", "12 days ago". */
export function ago(iso: string | null | undefined, now: number): string {
  const t = time(iso);
  if (t === null) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Latest of the times given (ISO), or null. */
export function latest(...isos: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const iso of isos) {
    const t = time(iso);
    if (t !== null && t > bestT) {
      best = iso!;
      bestT = t;
    }
  }
  return best;
}

/** A place as these rules see it (locations: kind and the step a slot sets). */
export type PlaceFacts = { name: string; kind: string; stage: string | null };

/** A slot: a serial-numbered holder of a station type (kind "station"), not Done, Shipping or a shelf. */
export function isSlot(place: { kind: string } | null | undefined): boolean {
  return place?.kind === "station";
}

/**
 * "Last seen" for a card: the place it's in and how long ago it went there
 * ("CLAMP 07, 2 h ago"); else the slot it last came out of ("Out of CLAMP 07,
 * 3 days ago"); else "Not in a slot".
 */
export function lastSeenText(
  place: { name: string } | null,
  placedAt: string | null,
  lastOut: { from: string | null; at: string } | null,
  now: number,
): string {
  if (place) {
    const when = ago(placedAt, now);
    return when ? `${place.name}, ${when}` : place.name;
  }
  if (lastOut?.from) return `Out of ${lastOut.from}, ${ago(lastOut.at, now)}`;
  return "Not in a slot";
}

// ── Ship check ─────────────────────────────────────────────────────────────

/**
 * One card at the ship check: refunded > not_received (flagged awaiting
 * arrival: it never came in, so it can't be left behind; shown, never blocks)
 * > not_done (not marked done) > in_slot (done but still in a slot: "still
 * in CLAMP 07") > ok (done and not in any slot).
 */
export type ShipRowStatus = "ok" | "not_done" | "in_slot" | "refunded" | "not_received";

export function shipCheckStatus(card: { refunded: boolean; done: boolean; awaiting: boolean; inSlot: boolean }): ShipRowStatus {
  if (card.refunded) return "refunded";
  if (card.awaiting && !card.done) return "not_received";
  if (!card.done) return "not_done";
  if (card.inSlot) return "in_slot";
  return "ok";
}

export type ShipCounts = { ok: number; notDone: number; inSlot: number; refunded: number; notReceived: number };

export function shipCounts(statuses: readonly ShipRowStatus[]): ShipCounts {
  const c: ShipCounts = { ok: 0, notDone: 0, inSlot: 0, refunded: 0, notReceived: 0 };
  for (const s of statuses) {
    if (s === "ok") c.ok++;
    else if (s === "not_done") c.notDone++;
    else if (s === "in_slot") c.inSlot++;
    else if (s === "refunded") c.refunded++;
    else c.notReceived++;
  }
  return c;
}

/** Every card that goes back is done and out of its slot (and there is one). */
export function allCardsOk(statuses: readonly ShipRowStatus[]): boolean {
  const c = shipCounts(statuses);
  return c.ok > 0 && c.notDone === 0 && c.inSlot === 0;
}

/**
 * Ready to ship: every card is ok and every ok card has been ticked as
 * physically in the box (`present`: card id -> ticked).
 */
export function readyToShip(rows: readonly { id: string; status: ShipRowStatus }[], present: Readonly<Record<string, boolean>>): boolean {
  if (!allCardsOk(rows.map((r) => r.status))) return false;
  return rows.every((r) => r.status !== "ok" || present[r.id] === true);
}

// ── Forgotten cards ────────────────────────────────────────────────────────

export type ForgottenRule = "finished_not_done" | "final_dry" | "slot_idle" | "stale";
/** Report order: the most certain first. A card is listed once, under its first rule. */
export const FORGOTTEN_RULES: readonly ForgottenRule[] = ["finished_not_done", "final_dry", "slot_idle", "stale"];

/** What the rules need to know about one card. Times are ISO strings. */
export type ForgottenCardFacts = {
  orderStatus: string;
  orderCreatedAt: string | null;
  /** In a tier bag (received through Receiving). */
  inBag: boolean;
  /** tier_bags.source of its bag: "receiving" or "migration" (Historical Order Setup). */
  bagSource: string | null;
  done: boolean;
  refunded: boolean;
  awaiting: boolean;
  /** Its step this round (stored name), null when not started or done. */
  stage: string | null;
  /** When it reached that step (the step's latest stage event this round). */
  stageSince: string | null;
  /** Its latest stage event or round start (any round), or when it was received. */
  lastStageActivityAt: string | null;
  /** Its latest card_moves row (into, out of or between slots). */
  lastMoveAt: string | null;
  /** Where it is now (cards.location_id), null when in no slot or before the places tables exist. */
  location: { kind: string; stage: string | null } | null;
  locatedAt: string | null;
};

export type ForgottenReason = {
  rule: ForgottenRule;
  /** Whole days: at Final Dry, in the slot, without any change; 0 for finished_not_done. */
  days: number;
  /** Since when (null for finished_not_done). */
  since: string | null;
};

/**
 * Part of the new system: the card is in a tier bag (received through
 * Receiving), or its order came in after Receiving went live (INTAKE_START).
 * Older orders stay out unless the report's "Include older orders" is on.
 */
export function inNewSystem(f: { inBag: boolean; orderCreatedAt: string | null }, start = INTAKE_START): boolean {
  if (f.inBag) return true;
  const created = time(f.orderCreatedAt);
  const from = time(start);
  return created !== null && from !== null && created >= from;
}

/**
 * (b) on its own: since when the card has sat finished-looking without being
 * marked done, or null. Its step is Final Dry, or it is in a Final Dry slot
 * or on the Done shelf, for FINAL_DRY_DAYS or more (the earlier time wins).
 */
export function finalDrySince(f: Pick<ForgottenCardFacts, "stage" | "stageSince" | "location" | "locatedAt">, now: number): string | null {
  const cutoff = now - FINAL_DRY_DAYS * DAY_MS;
  const hits: string[] = [];
  const st = time(f.stageSince);
  if (f.stage === FINAL_DRY_STAGE && st !== null && st <= cutoff) hits.push(f.stageSince!);
  const lt = time(f.locatedAt);
  if (f.location && (f.location.kind === "done" || (isSlot(f.location) && f.location.stage === FINAL_DRY_STAGE)) && lt !== null && lt <= cutoff) {
    hits.push(f.locatedAt!);
  }
  if (!hits.length) return null;
  return hits.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/** Every rule the card trips, in report order ([] when it looks fine). */
export function forgottenReasons(f: ForgottenCardFacts, now: number, slotDays = SLOT_DAYS): ForgottenReason[] {
  if (f.refunded || f.orderStatus === "cancelled") return [];
  if (f.awaiting && !f.done) return [];
  const out: ForgottenReason[] = [];
  const finished = FINISHED_ORDER_STATUSES.includes(f.orderStatus);

  if (!f.done) {
    // (a) the order is finished but this card was never ticked done; old
    // Historical Order Setup bags of finished orders are complete on purpose
    if (finished && f.bagSource !== "migration") out.push({ rule: "finished_not_done", days: 0, since: null });
    // (b) at Final Dry / on the Done shelf for days (a finished order is (a) already)
    if (!finished) {
      const since = finalDrySince(f, now);
      if (since) out.push({ rule: "final_dry", days: daysSince(since, now), since });
    }
  }

  // (e) the same slot for days with no move (done or not)
  if (isSlot(f.location) && f.locatedAt) {
    const since = latest(f.locatedAt, f.lastMoveAt);
    const days = daysSince(since, now);
    if (since && days >= slotDays) out.push({ rule: "slot_idle", days, since });
  }

  // (c) an open order's card nothing has happened to for two weeks
  if (!f.done && OPEN_ORDER_STATUSES.includes(f.orderStatus)) {
    const last = latest(f.lastStageActivityAt, f.locatedAt, f.lastMoveAt) ?? f.orderCreatedAt;
    const days = daysSince(last, now);
    if (last && days >= STALE_DAYS) out.push({ rule: "stale", days, since: last });
  }
  return out;
}

/** The rule a card is listed under (its first), or null. */
export function primaryRule(f: ForgottenCardFacts, now: number, slotDays = SLOT_DAYS): ForgottenRule | null {
  return forgottenReasons(f, now, slotDays)[0]?.rule ?? null;
}

/** Counted by the "Check" menu badge: (a) and (b). */
export function countsForBadge(rule: ForgottenRule | null): boolean {
  return rule === "finished_not_done" || rule === "final_dry";
}

/** Calendar days between two "YYYY-MM-DD" days (b - a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

/**
 * (d) A tier bag past its due date ("YYYY-MM-DD", New York) that still has
 * cards not done (`openCards`: live, not done), on an order that isn't
 * finished or cancelled (a finished order's cards are (a) already). Returns
 * the days overdue, or null.
 */
export function bagPastDue(
  bag: { dueDate: string | null; orderStatus: string; openCards: number },
  today: string,
): number | null {
  if (!bag.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(bag.dueDate)) return null;
  if (bag.orderStatus === "cancelled" || FINISHED_ORDER_STATUSES.includes(bag.orderStatus)) return null;
  if (bag.openCards <= 0) return null;
  const late = dayDiff(bag.dueDate, today);
  return late > 0 ? late : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why a card is listed, in a few words ("At Final Dry for 5 days, not marked done"). */
export function reasonText(r: ForgottenReason, ctx: { orderStatusLabel: string; placeName?: string | null; done?: boolean }): string {
  if (r.rule === "finished_not_done") return `Order is ${ctx.orderStatusLabel}, card not marked done`;
  if (r.rule === "final_dry") return `At Final Dry (or on the Done shelf) for ${plural(r.days, "day")}, not marked done`;
  if (r.rule === "slot_idle") {
    const where = ctx.placeName ? `In ${ctx.placeName}` : "In the same slot";
    return `${where} for ${plural(r.days, "day")} with no move${ctx.done ? " (marked done, still in the slot)" : ""}`;
  }
  return `No slot move or step change for ${plural(r.days, "day")}`;
}
