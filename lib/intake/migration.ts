/**
 * Historical Order Setup (/admin/receiving/setup): brings orders that came in
 * before Receiving existed into the tier-bag system, without touching what
 * already happened to them.
 *
 * Pure: `planOrderSetup()` turns one order's rows into the exact list of
 * writes, and `applyOrderSetup()` carries a plan out through a small store
 * interface (Supabase on the server, an in-memory fake in the tests). Every
 * write is a fill: it only sets a field that is still empty, and bags are
 * created with "on conflict do nothing", so running the setup twice changes
 * nothing the second time and never makes a second bag, code or card.
 *
 * What a plan does, per order:
 * - Card IDs for cards that have none (lib/intake/codes.ts numbering).
 * - One bag per effective tier (cards.tier ?? orders.restoration_tier), batch
 *   1, source 'migration'; an existing bag of that tier is reused.
 * - Links each arrived, non-refunded card with a tier to its bag.
 * - received_on: the order's first 'Status updated to: Cards Received' event
 *   (New York day); a drop-off order's drop-off day (its show drop-off form
 *   when it came from one, else the order's creation); otherwise none,
 *   flagged "Missing receiving date". Never invented: cards added to the
 *   order on a later day are bagged but get no received_at.
 * - Due date from received_on with business days and the tier's current max
 *   turnaround, marked 'needs_review' (the settings of the past are unknown);
 *   no date -> 'missing_received_date'.
 * - A bag is created completed when all its non-refunded cards are done
 *   (latest card completed_at), or when the order itself is already finished
 *   (completed / shipped back / delivered: its first such status event), so
 *   finished orders stay finished. Completed historical bags are marked seen,
 *   so they don't raise the "bag completed" alert. Bags Receiving made follow
 *   the live rule only (refreshBagCompletion), whatever the order's status.
 * Never: order status, cards.completed, stage events, awaiting_arrival, or
 * any field that already has a value.
 */

import { bagCode, cardCode, effectiveTier, nextCardSeqs, normalizeTier, tierLetter, tierRank } from "@/lib/intake/codes";
import { toNyDate } from "@/lib/intake/business-days";
import { computeDueDate } from "@/lib/intake/due-dates";
import type { DueStatus } from "@/lib/intake/types";

export type { DueStatus };

/** Orders the setup works on; the others go through Receiving. */
export const SETUP_STATUSES = ["received", "in_progress", "completed", "shipped_back", "delivered"] as const;
/** Orders whose work is over: their bags are created completed. */
export const FINISHED_STATUSES = ["completed", "shipped_back", "delivered"] as const;
/** The exact event text the dashboards and the backlog read (never change it). */
export const RECEIVED_EVENT = "Status updated to: Cards Received";
/**
 * Status events (event_type 'status_updated') that finish an order, as
 * prefixes: the status button ("Shipped Back — Tracking: ..."), the delivery
 * sync and return-label detection, and buying the return label ("Return label
 * purchased — marked Shipped Back."; the only finishing event of many orders).
 */
export const FINISHED_EVENT_PREFIXES = [
  "Status updated to: Completed",
  "Status updated to: Shipped Back",
  "Status updated to: Delivered",
  "Marked Shipped Back",
  "Marked Delivered",
  "Return label purchased",
] as const;
/** Most orders one run call may set up (the page sends batches of this size). */
export const SETUP_BATCH = 25;

export type SetupOrder = {
  id: string;
  order_number: string | null;
  status: string;
  inbound_method: string | null;
  created_at: string;
  restoration_tier: string | null;
};

export type SetupCard = {
  id: string;
  created_at: string;
  tier: string | null;
  card_name?: string | null;
  card_set?: string | null;
  card_number?: string | null;
  photo_urls: string[] | null;
  receiving_photo_urls?: string[] | null;
  catalog_image_url: string | null;
  completed: boolean | null;
  completed_at: string | null;
  status: string | null;
  card_seq: number | null;
  card_code: string | null;
  bag_id: string | null;
  received_at: string | null;
  awaiting_arrival: boolean | null;
};

export type SetupBag = {
  id: string;
  tier: string;
  batch: number;
  bag_code: string;
  received_on: string | null;
  due_date: string | null;
  due_status: string;
  turnaround_days: number | null;
  completed_at: string | null;
  source: string;
};

export type PlanInput = {
  order: SetupOrder;
  cards: SetupCard[];
  bags: SetupBag[];
  /** created_at of the order's first RECEIVED_EVENT, if any. */
  receivedEventAt: string | null;
  /** created_at of the order's first finishing status event, if any. */
  finishedEventAt: string | null;
  /** created_at of the show drop-off form the order was entered from, if any (the day the cards were handed over). */
  dropoffAt?: string | null;
  holidays: ReadonlySet<string>;
  /** restoration_settings.turnaround_max_days by tier (prep has none). */
  turnaroundMaxDays: Readonly<Record<string, number | null | undefined>>;
};

export type CardRef = { cardId: string; code: string | null; seq: number | null; name: string };

export type PlannedBag = {
  /** "<tier>#<batch>": the bag's identity within the order. */
  key: string;
  tier: string;
  batch: number;
  bagCode: string;
  receivedOn: string | null;
  dueDate: string | null;
  dueStatus: DueStatus;
  turnaroundDays: number | null;
  completedAt: string | null;
  cardIds: string[];
};

export type BagFill = {
  bagId: string;
  bagCode: string;
  /** Each field is only written where the bag's own value is still empty. */
  receivedOn?: string;
  dueDate?: string | null;
  dueStatus?: DueStatus;
  turnaroundDays?: number | null;
  completedAt?: string;
};

export type OrderPlan = {
  orderId: string;
  orderNumber: string | null;
  status: string;
  /** In a status the setup works on and has at least one card. */
  eligible: boolean;
  ineligibleReason: string | null;
  receivedOn: string | null;
  receivedSource: "event" | "dropoff" | null;
  /** Timestamp written to cards.received_at where empty. */
  receivedAt: string | null;
  cardCodes: { cardId: string; seq: number; code: string }[];
  newBags: PlannedBag[];
  /** Existing bags that get cards (by id) and/or empty fields filled. */
  links: { cardId: string; bagKey: string; bagId: string | null; bagCode: string }[];
  bagFills: BagFill[];
  /** Existing bags that got new cards (their completion is refreshed). */
  touchedBagIds: string[];
  receivedAtFills: string[];
  /** Issues to show; never block the rest of the plan. */
  missingImages: CardRef[];
  missingTiers: CardRef[];
  missingReceivedDate: boolean;
  finishedDateUnknown: boolean;
  /** Errors that stop this order from being set up (it is skipped). */
  errors: string[];
  /** Cards that will change (code, bag or received time). */
  cardsToUpdate: number;
  bagsToCreate: number;
  /** Nothing left to do (issues may remain). */
  alreadySetUp: boolean;
};

const isFinished = (status: string) => (FINISHED_STATUSES as readonly string[]).includes(status);

const hasImage = (c: SetupCard) =>
  (c.photo_urls?.length ?? 0) > 0 || (c.receiving_photo_urls?.length ?? 0) > 0 || !!c.catalog_image_url;

const latest = (values: (string | null)[]): string | null =>
  values.reduce<string | null>((max, v) => (v && (!max || Date.parse(v) > Date.parse(max)) ? v : max), null);

/** The due date a historical bag gets (lib/intake/due-dates.ts): computed, but always for review. */
export function historicalDue(
  receivedOn: string | null,
  tier: string,
  turnaroundMaxDays: PlanInput["turnaroundMaxDays"],
  holidays: ReadonlySet<string>,
): { dueDate: string | null; dueStatus: DueStatus; turnaroundDays: number | null } {
  const due = computeDueDate({ receivedOn, turnaroundDays: turnaroundMaxDays[tier] ?? null, holidays, historical: true });
  return { dueDate: due.due_date, dueStatus: due.due_status, turnaroundDays: due.turnaround_days };
}

/**
 * When a bag of `cards` is finished: all non-refunded cards done -> the
 * latest card completed_at (else the order's finishing event); a finished
 * order -> its finishing event (else the latest card completed_at). Null
 * means "not finished" or "finished, date unknown" (see finishedDateUnknown).
 */
function bagCompletion(cards: SetupCard[], order: SetupOrder, finishedEventAt: string | null): { at: string | null; unknown: boolean } {
  const live = cards.filter((c) => c.status !== "refunded");
  if (live.length === 0) return { at: null, unknown: false };
  const allDone = live.every((c) => !!c.completed);
  const latestDone = latest(live.map((c) => (c.completed ? c.completed_at : null)));
  if (allDone) {
    const at = latestDone ?? finishedEventAt;
    return { at, unknown: !at };
  }
  if (isFinished(order.status)) {
    const at = finishedEventAt ?? latestDone;
    return { at, unknown: !at };
  }
  return { at: null, unknown: false };
}

/** Exactly what setting up one order would write. Pure. */
export function planOrderSetup(input: PlanInput): OrderPlan {
  const { order, cards, bags, holidays, turnaroundMaxDays } = input;

  const plan: OrderPlan = {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    eligible: false,
    ineligibleReason: null,
    receivedOn: null,
    receivedSource: null,
    receivedAt: null,
    cardCodes: [],
    newBags: [],
    links: [],
    bagFills: [],
    touchedBagIds: [],
    receivedAtFills: [],
    missingImages: [],
    missingTiers: [],
    missingReceivedDate: false,
    finishedDateUnknown: false,
    errors: [],
    cardsToUpdate: 0,
    bagsToCreate: 0,
    alreadySetUp: true,
  };

  if (!(SETUP_STATUSES as readonly string[]).includes(order.status)) {
    plan.ineligibleReason = order.status === "awaiting_cards"
      ? "Cards haven't arrived yet: use Receiving."
      : "Only received, in progress and finished orders are set up here.";
    return plan;
  }
  if (cards.length === 0) {
    plan.ineligibleReason = "The order has no cards.";
    return plan;
  }
  if (!order.order_number) {
    plan.ineligibleReason = "The order has no order number.";
    return plan;
  }
  plan.eligible = true;
  const orderNumber = order.order_number;

  // Received date: the real one or nothing
  const eventDay = toNyDate(input.receivedEventAt);
  // A show drop-off can be entered as an order days after the show: the form's time is the hand-over
  const dropoffAt = order.inbound_method === "dropoff" ? (input.dropoffAt || order.created_at) : null;
  const dropoffDay = toNyDate(dropoffAt);
  if (input.receivedEventAt && eventDay) {
    plan.receivedOn = eventDay;
    plan.receivedAt = input.receivedEventAt;
    plan.receivedSource = "event";
  } else if (dropoffAt && dropoffDay) {
    plan.receivedOn = dropoffDay;
    plan.receivedAt = dropoffAt;
    plan.receivedSource = "dropoff";
  }

  // Card IDs (missing ones only; never renumbered)
  // (the same numbering ensureCardCodes writes: cards without a number get the next ones)
  for (const { id, seq } of nextCardSeqs(cards)) {
    plan.cardCodes.push({ cardId: id, seq, code: cardCode(orderNumber, seq) });
  }
  const codeOf = new Map(plan.cardCodes.map((p) => [p.cardId, p]));
  const ref = (c: SetupCard): CardRef => ({
    cardId: c.id,
    code: c.card_code ?? codeOf.get(c.id)?.code ?? null,
    seq: c.card_seq ?? codeOf.get(c.id)?.seq ?? null,
    name: c.card_name?.trim() || "Unnamed card",
  });
  const bySeq = (a: CardRef, b: CardRef) => (a.seq ?? 1e9) - (b.seq ?? 1e9);

  // Cards that are physically here and part of the work
  const present = cards.filter((c) => !c.awaiting_arrival && c.status !== "refunded");

  plan.missingImages = present.filter((c) => !hasImage(c)).map(ref).sort(bySeq);

  // Bags: one per effective tier, reusing what exists
  const bagsByTier = new Map<string, SetupBag[]>();
  for (const b of bags) {
    const t = normalizeTier(b.tier) ?? b.tier;
    bagsByTier.set(t, [...(bagsByTier.get(t) ?? []), b]);
  }
  for (const list of bagsByTier.values()) list.sort((a, b) => a.batch - b.batch);
  const usedCodes = new Set(bags.map((b) => b.bag_code.toUpperCase()));

  const unbagged = new Map<string, SetupCard[]>();
  const missingTier: SetupCard[] = [];
  for (const c of present) {
    if (c.bag_id) continue;
    const tier = effectiveTier(c.tier, order.restoration_tier);
    if (!tier) {
      missingTier.push(c);
      continue;
    }
    unbagged.set(tier, [...(unbagged.get(tier) ?? []), c]);
  }
  plan.missingTiers = missingTier.map(ref).sort(bySeq);

  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const bagCards = (bagId: string) => cards.filter((c) => c.bag_id === bagId);

  for (const [tier, tierCards] of [...unbagged].sort(([a], [b]) => tierRank(a) - tierRank(b) || a.localeCompare(b))) {
    const existing = bagsByTier.get(tier) ?? [];
    // A bag this setup made before, else one with the same received day that
    // is still open; otherwise a new bag (batch 1, or the next free batch).
    const reuse = existing.find((b) => b.source === "migration")
      ?? existing.find((b) => !b.completed_at && b.received_on === plan.receivedOn);
    const ordered = [...tierCards].sort((a, b) => (ref(a).seq ?? 0) - (ref(b).seq ?? 0));
    if (reuse) {
      for (const c of ordered) plan.links.push({ cardId: c.id, bagKey: `${reuse.tier}#${reuse.batch}`, bagId: reuse.id, bagCode: reuse.bag_code });
      plan.touchedBagIds.push(reuse.id);
      continue;
    }
    // Batches count per Bag ID letter (as receiving does), so two unknown
    // tiers ("U") never share a Bag ID
    const letter = tierLetter(tier);
    let batch = 1 + Math.max(0,
      ...bags.filter((b) => tierLetter(b.tier) === letter).map((b) => b.batch),
      ...plan.newBags.filter((b) => tierLetter(b.tier) === letter).map((b) => b.batch));
    while (usedCodes.has(bagCode(orderNumber, tier, batch).toUpperCase())) batch++;
    const code = bagCode(orderNumber, tier, batch);
    usedCodes.add(code.toUpperCase());
    const due = historicalDue(plan.receivedOn, tier, turnaroundMaxDays, holidays);
    const done = bagCompletion(ordered, order, input.finishedEventAt);
    if (done.unknown) plan.finishedDateUnknown = true;
    const key = `${tier}#${batch}`;
    plan.newBags.push({
      key, tier, batch, bagCode: code,
      receivedOn: plan.receivedOn,
      ...due,
      completedAt: done.at,
      cardIds: ordered.map((c) => c.id),
    });
    for (const c of ordered) plan.links.push({ cardId: c.id, bagKey: key, bagId: null, bagCode: code });
  }

  // Bags this setup made earlier: fill a received date found since, and
  // finish bags whose cards (or order) are now done. Never clears anything.
  const linkedLater = new Map<string, SetupCard[]>();
  for (const l of plan.links) {
    if (!l.bagId) continue;
    const c = cardsById.get(l.cardId);
    if (c) linkedLater.set(l.bagId, [...(linkedLater.get(l.bagId) ?? []), c]);
  }
  for (const b of bags) {
    const touched = linkedLater.has(b.id);
    if (b.source !== "migration" && !touched) continue;
    const fill: BagFill = { bagId: b.id, bagCode: b.bag_code };
    if (b.source === "migration" && !b.received_on && plan.receivedOn) {
      fill.receivedOn = plan.receivedOn;
      if (!b.due_date && (b.due_status === "missing_received_date" || b.due_status === "pending")) {
        // The turnaround the bag was made with, as receiving does
        const due = historicalDue(plan.receivedOn, b.tier, { [b.tier]: b.turnaround_days ?? turnaroundMaxDays[b.tier] }, holidays);
        fill.dueDate = due.dueDate;
        fill.dueStatus = due.dueStatus;
        fill.turnaroundDays = due.turnaroundDays;
      }
    }
    // Only bags this setup made get the historical completion; a Receiving
    // bag follows its cards (refreshed after linking)
    if (b.source === "migration" && !b.completed_at) {
      const done = bagCompletion([...bagCards(b.id), ...(linkedLater.get(b.id) ?? [])], order, input.finishedEventAt);
      if (done.at) fill.completedAt = done.at;
      else if (done.unknown) plan.finishedDateUnknown = true;
    }
    if (fill.receivedOn || fill.completedAt) plan.bagFills.push(fill);
  }

  // received_at for arrived cards, where a real date is known: only cards the
  // order already had when it was received (a drop-off's cards are entered
  // with the order); a card added on a later day arrived on a day nobody
  // recorded
  if (plan.receivedAt && plan.receivedOn) {
    const lastDay = plan.receivedSource === "dropoff" ? (toNyDate(order.created_at) ?? plan.receivedOn) : plan.receivedOn;
    const knownBy = lastDay > plan.receivedOn ? lastDay : plan.receivedOn;
    plan.receivedAtFills = present
      .filter((c) => !c.received_at && (toNyDate(c.created_at) ?? "9999-12-31") <= knownBy)
      .map((c) => c.id);
  }

  plan.missingReceivedDate = !plan.receivedOn && (
    plan.newBags.length > 0
    || bags.some((b) => b.source === "migration" && !b.received_on)
  );

  const changedCards = new Set<string>([
    ...plan.cardCodes.map((p) => p.cardId),
    ...plan.links.map((l) => l.cardId),
    ...plan.receivedAtFills,
  ]);
  plan.cardsToUpdate = changedCards.size;
  plan.bagsToCreate = plan.newBags.length;
  plan.alreadySetUp = plan.errors.length === 0
    && changedCards.size === 0
    && plan.newBags.length === 0
    && plan.bagFills.length === 0;
  return plan;
}

// ── Apply ───────────────────────────────────────────────────────────────────

export type NewBagRow = {
  order_id: string;
  tier: string;
  batch: number;
  bag_code: string;
  received_on: string | null;
  due_date: string | null;
  due_status: DueStatus;
  turnaround_days: number | null;
  completed_at: string | null;
  completion_seen_at: string | null;
  source: "migration";
  created_by: string | null;
};

/**
 * The writes the setup needs. Every method is a guarded fill (it only sets
 * empty fields) so a repeat, or two people running it at once, is harmless.
 */
export interface SetupStore {
  /** Give every card of the order without one its Card ID (lib/intake ensureCardCodes); returns how many got one. */
  ensureCardCodes(orderId: string): Promise<number>;
  /** Insert the bag; if (order, tier, batch) exists already, return that bag instead. */
  createBag(row: NewBagRow): Promise<{ id: string; created: boolean }>;
  /** cards.bag_id = bagId where it is still null; returns how many changed. */
  linkCards(bagId: string, cardIds: string[]): Promise<number>;
  /** cards.received_at = at where it is still null. */
  fillReceivedAt(cardIds: string[], at: string): Promise<number>;
  /** Fill a bag's empty fields (received_on, due_*, completed_at + completion_seen_at). */
  fillBag(fill: BagFill, seenAt: string): Promise<void>;
  /** Recompute completion of bags of an open order (lib/intake refreshBagCompletion). */
  refreshBagCompletion(bagIds: string[]): Promise<void>;
  /** One activity entry on the order (not shown to the customer). */
  logSetup(orderId: string, description: string, metadata: Record<string, unknown>): Promise<void>;
}

export type ApplyResult = {
  cardCodes: number;
  bagsCreated: string[];
  cardsLinked: number;
  receivedAtSet: number;
  bagsFilled: number;
};

/** Carry out a plan. Run planOrderSetup again afterwards: it comes back empty. */
export async function applyOrderSetup(plan: OrderPlan, store: SetupStore, by: string | null, now = new Date()): Promise<ApplyResult> {
  const result: ApplyResult = { cardCodes: 0, bagsCreated: [], cardsLinked: 0, receivedAtSet: 0, bagsFilled: 0 };
  if (!plan.eligible || plan.errors.length > 0 || plan.alreadySetUp) return result;
  const seenAt = now.toISOString();

  if (plan.cardCodes.length > 0) {
    result.cardCodes = await store.ensureCardCodes(plan.orderId);
  }

  const bagIdByKey = new Map<string, string>();
  for (const b of plan.newBags) {
    const { id, created } = await store.createBag({
      order_id: plan.orderId,
      tier: b.tier,
      batch: b.batch,
      bag_code: b.bagCode,
      received_on: b.receivedOn,
      due_date: b.dueDate,
      due_status: b.dueStatus,
      turnaround_days: b.turnaroundDays,
      completed_at: b.completedAt,
      // Historical completions are not news: no "bag completed" alert
      completion_seen_at: b.completedAt ? seenAt : null,
      source: "migration",
      created_by: by,
    });
    bagIdByKey.set(b.key, id);
    if (created) result.bagsCreated.push(b.bagCode);
  }

  const byBag = new Map<string, string[]>();
  for (const l of plan.links) {
    const bagId = l.bagId ?? bagIdByKey.get(l.bagKey);
    if (!bagId) continue;
    byBag.set(bagId, [...(byBag.get(bagId) ?? []), l.cardId]);
  }
  for (const [bagId, cardIds] of byBag) result.cardsLinked += await store.linkCards(bagId, cardIds);

  if (plan.receivedAt && plan.receivedAtFills.length > 0) {
    result.receivedAtSet = await store.fillReceivedAt(plan.receivedAtFills, plan.receivedAt);
  }

  const finished = isFinished(plan.status);
  for (const fill of plan.bagFills) {
    // An open order's touched bags follow the live rule (refreshed below);
    // a finished order's setup bags are filled with the plan's completion date.
    const f = !finished && plan.touchedBagIds.includes(fill.bagId) ? { ...fill, completedAt: undefined } : fill;
    if (!f.receivedOn && !f.completedAt) continue;
    await store.fillBag(f, seenAt);
    result.bagsFilled += 1;
  }
  // Bags that got cards: the live rule (a finished order's setup bag stays
  // completed: keepsHistoricalCompletion)
  if (plan.touchedBagIds.length > 0) await store.refreshBagCompletion(plan.touchedBagIds);

  const changed = result.cardCodes + result.bagsCreated.length + result.cardsLinked + result.receivedAtSet + result.bagsFilled;
  if (changed > 0) {
    const parts: string[] = [];
    if (result.cardCodes) parts.push(`Card IDs for ${result.cardCodes} card${result.cardCodes === 1 ? "" : "s"}`);
    if (result.bagsCreated.length) parts.push(`bag${result.bagsCreated.length === 1 ? "" : "s"} ${result.bagsCreated.join(", ")}`);
    if (result.cardsLinked) parts.push(`${result.cardsLinked} card${result.cardsLinked === 1 ? "" : "s"} bagged`);
    if (plan.missingReceivedDate) parts.push("receiving date missing");
    await store.logSetup(plan.orderId, `Historical setup: ${parts.join(", ")}`, {
      by,
      card_codes: result.cardCodes,
      bags_created: result.bagsCreated,
      cards_linked: result.cardsLinked,
      received_at_set: result.receivedAtSet,
      bags_filled: result.bagsFilled,
      received_on: plan.receivedOn,
      received_source: plan.receivedSource,
    });
  }
  return result;
}

// ── Totals for the preview ──────────────────────────────────────────────────

export type SetupTotals = {
  orders: number;
  ordersToChange: number;
  alreadySetUp: number;
  notEligible: number;
  withErrors: number;
  cardsToUpdate: number;
  cardCodes: number;
  bagsToCreate: number;
  completedBags: number;
  missingImages: number;
  missingTiers: number;
  missingReceivedDates: number;
};

export function totalsFor(plans: OrderPlan[]): SetupTotals {
  const t: SetupTotals = {
    orders: plans.length, ordersToChange: 0, alreadySetUp: 0, notEligible: 0, withErrors: 0,
    cardsToUpdate: 0, cardCodes: 0, bagsToCreate: 0, completedBags: 0,
    missingImages: 0, missingTiers: 0, missingReceivedDates: 0,
  };
  for (const p of plans) {
    if (!p.eligible) { t.notEligible += 1; continue; }
    if (p.errors.length) t.withErrors += 1;
    else if (p.alreadySetUp) t.alreadySetUp += 1;
    else t.ordersToChange += 1;
    t.cardsToUpdate += p.cardsToUpdate;
    t.cardCodes += p.cardCodes.length;
    t.bagsToCreate += p.bagsToCreate;
    t.completedBags += p.newBags.filter((b) => b.completedAt).length;
    t.missingImages += p.missingImages.length;
    t.missingTiers += p.missingTiers.length;
    if (p.missingReceivedDate) t.missingReceivedDates += 1;
  }
  return t;
}
