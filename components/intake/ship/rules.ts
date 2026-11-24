import { INTAKE_START } from "@/lib/intake/start";
import type { LocationKind, ShipCheckStatus } from "@/lib/intake/tracking/types";

/**
 * The rules behind the ship check (/admin/receiving/ship/<orderId>) and the
 * Forgotten cards report (/admin/receiving/forgotten, and the "Check" menu
 * badge). Pure: no database, no clock (callers pass `now`), safe in client
 * components and tests (tests/intake/forgotten.test.ts).
 *
 * The owner's problem: "Once in a while a card will be forgotten to be marked
 * done. And then we have no way of knowing." A card looks forgotten when:
 *   (a) finished_not_done  its order is Completed / Shipped Back / Delivered
 *                          but the card isn't marked done;
 *   (b) final_dry          its step has been Final Dry (or it has sat at a
 *                          Final Dry station or the Done shelf) for 3+ days
 *                          without being marked done;
 *   (c) stale              its order is open (Cards Received / In Progress)
 *                          and nobody has scanned, moved or changed its step
 *                          for 14+ days;
 *   (d) a bag is past its due date with cards not done (bagPastDue).
 * The menu badge counts the cards of (a) and (b). Refunded cards and cards
 * still awaiting arrival are never forgotten; neither are the old cards of a
 * Historical Order Setup bag on a finished order (they were never ticked done
 * on purpose: keepsHistoricalCompletion in lib/intake/stage-plan.ts).
 */

export const FINAL_DRY_STAGE = "Final Dry";
/** Days at Final Dry (or on the Done shelf) before a card that isn't marked done is flagged. */
export const FINAL_DRY_DAYS = 3;
/** Days without a scan, move or step change before a card of an open order is flagged. */
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

/** "just now", "5 min ago", "3 hours ago", "1 day ago", "12 days ago". */
export function ago(iso: string | null | undefined, now: number): string {
  const t = time(iso);
  if (t === null) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** "Humidor, 2 days ago"; "Never scanned" when the card has no place yet. */
export function lastSeenText(location: { name: string } | null, at: string | null, now: number): string {
  if (!location) return "Never scanned";
  const when = ago(at, now);
  return when ? `${location.name}, ${when}` : location.name;
}

// ── Ship check ─────────────────────────────────────────────────────────────

/**
 * One card at the ship check. The contract's statuses (ShipCheckStatus:
 * refunded > not_done > not_here > ok) plus `not_received`: a card flagged
 * awaiting arrival never came in, so it can't be left behind (shown, never
 * blocks shipping). Without the places tables (`trackPlaces` false) a done
 * card is ok wherever it is.
 */
export type ShipRowStatus = ShipCheckStatus | "not_received";

export function shipCheckStatus(
  card: { refunded: boolean; done: boolean; awaiting: boolean; locationKind: LocationKind | null },
  trackPlaces = true,
): ShipRowStatus {
  if (card.refunded) return "refunded";
  if (card.awaiting && !card.done) return "not_received";
  if (!card.done) return "not_done";
  if (trackPlaces && card.locationKind !== "shipping") return "not_here";
  return "ok";
}

export type ShipCounts = { ok: number; notDone: number; notHere: number; refunded: number; notReceived: number };

export function shipCounts(statuses: readonly ShipRowStatus[]): ShipCounts {
  const c: ShipCounts = { ok: 0, notDone: 0, notHere: 0, refunded: 0, notReceived: 0 };
  for (const s of statuses) {
    if (s === "ok") c.ok++;
    else if (s === "not_done") c.notDone++;
    else if (s === "not_here") c.notHere++;
    else if (s === "refunded") c.refunded++;
    else c.notReceived++;
  }
  return c;
}

/** Ready to ship: at least one card ok and none not done or not here. */
export function readyToShip(statuses: readonly ShipRowStatus[]): boolean {
  const c = shipCounts(statuses);
  return c.ok > 0 && c.notDone === 0 && c.notHere === 0;
}

/**
 * What a code scanned on the ship check page means for this order, before
 * anything is sent: a card of this order (move it to Shipping), a bag of this
 * order (ask before moving all its cards), this order's own code, a place
 * sign, another order's card or bag, or not a code. `code` is normalized
 * (normalizeCode) and `kind` is codeKind(code).
 */
export type ShipScanIntent =
  | { kind: "card"; code: string }
  | { kind: "bag"; code: string }
  | { kind: "this_order" }
  | { kind: "place"; code: string }
  | { kind: "other_order"; code: string }
  | { kind: "not_a_code" };

export function shipScanIntent(
  code: string,
  kind: string | null,
  order: { orderNumber: string; cardCodes: readonly string[]; bagCodes: readonly string[] },
): ShipScanIntent {
  if (!code || !kind) return { kind: "not_a_code" };
  const up = code.toUpperCase();
  if (kind === "location") return { kind: "place", code: up };
  if (kind === "order") return up === order.orderNumber.toUpperCase() ? { kind: "this_order" } : { kind: "other_order", code: up };
  if (kind === "card") return order.cardCodes.some((c) => c.toUpperCase() === up) ? { kind: "card", code: up } : { kind: "other_order", code: up };
  if (kind === "bag") return order.bagCodes.some((c) => c.toUpperCase() === up) ? { kind: "bag", code: up } : { kind: "other_order", code: up };
  return { kind: "not_a_code" };
}

// ── Forgotten cards ────────────────────────────────────────────────────────

export type ForgottenRule = "finished_not_done" | "final_dry" | "stale";
/** Report order: the most certain first. A card is listed once, under its first rule. */
export const FORGOTTEN_RULES: readonly ForgottenRule[] = ["finished_not_done", "final_dry", "stale"];

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
  /** Where it is now (cards.location_id), null when never placed or before the places tables exist. */
  location: { kind: LocationKind | string; stage: string | null } | null;
  locatedAt: string | null;
};

export type ForgottenReason = {
  rule: ForgottenRule;
  /** Whole days: at Final Dry (final_dry), without any activity (stale); 0 for finished_not_done. */
  days: number;
  /** Since when: the Final Dry or shelf time (final_dry), the last activity (stale), null otherwise. */
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

/** Live: not refunded, not done, actually arrived. Only live cards can be forgotten. */
const live = (f: ForgottenCardFacts) => !f.refunded && !f.done && !f.awaiting;

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

/**
 * (b) on its own: since when the card has sat finished-looking without being
 * marked done, or null. Its step is Final Dry, or its place is the Done shelf
 * or a Final Dry station, for FINAL_DRY_DAYS or more (the earlier of the two).
 */
export function finalDrySince(f: ForgottenCardFacts, now: number): string | null {
  const cutoff = now - FINAL_DRY_DAYS * DAY_MS;
  const candidates: string[] = [];
  const st = time(f.stageSince);
  if (f.stage === FINAL_DRY_STAGE && st !== null && st <= cutoff) candidates.push(f.stageSince!);
  const lt = time(f.locatedAt);
  if (f.location && (f.location.kind === "done" || f.location.stage === FINAL_DRY_STAGE) && lt !== null && lt <= cutoff) {
    candidates.push(f.locatedAt!);
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/** Every rule the card trips, most certain first ([] when it looks fine). */
export function forgottenReasons(f: ForgottenCardFacts, now: number): ForgottenReason[] {
  if (!live(f)) return [];
  const out: ForgottenReason[] = [];
  const finished = FINISHED_ORDER_STATUSES.includes(f.orderStatus);
  if (f.orderStatus === "cancelled") return out;

  // (a) the order is finished but this card was never ticked done; old
  // Historical Order Setup bags of finished orders are complete on purpose
  if (finished && f.bagSource !== "migration") out.push({ rule: "finished_not_done", days: 0, since: null });

  // (b) at Final Dry / on the Done shelf for days (a finished order is (a) already)
  if (!finished) {
    const since = finalDrySince(f, now);
    if (since) out.push({ rule: "final_dry", days: daysSince(since, now), since });
  }

  // (c) an open order's card nobody has touched for two weeks
  if (OPEN_ORDER_STATUSES.includes(f.orderStatus)) {
    const last = latest(f.lastStageActivityAt, f.locatedAt) ?? f.orderCreatedAt;
    const days = daysSince(last, now);
    if (last && days >= STALE_DAYS) out.push({ rule: "stale", days, since: last });
  }
  return out;
}

/** The rule a card is listed under (its first), or null. */
export function primaryRule(f: ForgottenCardFacts, now: number): ForgottenRule | null {
  return forgottenReasons(f, now)[0]?.rule ?? null;
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
 * live cards not done, on an order that isn't finished or cancelled (a
 * finished order's cards are (a) already). Returns the days overdue, or null.
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

/** Short text for a reason: "Order is Completed, card not marked done", "At Final Dry for 5 days", "Not touched for 16 days". */
export function reasonText(r: ForgottenReason, orderStatusLabel: string): string {
  const days = `${r.days} day${r.days === 1 ? "" : "s"}`;
  if (r.rule === "finished_not_done") return `Order is ${orderStatusLabel}, card not marked done`;
  if (r.rule === "final_dry") return `Finished-looking for ${days} (Final Dry or Done shelf), not marked done`;
  return `No scan, move or step change for ${days}`;
}
