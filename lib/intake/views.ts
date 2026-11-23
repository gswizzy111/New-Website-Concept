import { ORDER_STATUSES, type OrderStatus } from "@/lib/constants";
import { toNyDate } from "@/lib/intake/business-days";
import { compareCardsForSeq, effectiveTier, normalizeTier, qrUrl, tierDisplayName, tierLetter, tierRank } from "@/lib/intake/codes";
import { cardStageState, keepsHistoricalCompletion, stageGroups } from "@/lib/intake/stage-plan";
import type {
  BagSummary, CompletionStatus, IntakeCard, IntakeCardRow, IntakeOrder, IntakeOrderRow, OrderIntake,
  ReceivingStatus, StageEventRow, TierBagRow,
} from "@/lib/intake/types";

/**
 * Builds the receiving pages' view models from database rows (lib/intake/data.ts
 * loads the rows). Pure.
 */

/** The event the status button writes when cards arrive (dashboard and backlog read this exact text). */
export const RECEIVED_EVENT_TEXT = "Status updated to: Cards Received";

/** Statuses after the cards arrived: an order here without a received day is missing one. */
const ARRIVED_STATUSES = ["received", "in_progress", "completed", "shipped_back", "delivered"];

/**
 * The real day an order's cards arrived before this system: the first
 * 'Status updated to: Cards Received' event, else a drop-off order's creation
 * day; null when unknown (never invented). `events` in any order.
 */
export function historicalReceivedOn(order: Pick<IntakeOrderRow, "inbound_method" | "created_at">, events: readonly StageEventRow[]): string | null {
  const received = events
    .filter((e) => e.event_type === "status_updated" && e.description === RECEIVED_EVENT_TEXT && e.created_at)
    .map((e) => e.created_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (received) return toNyDate(received);
  const dropoff = order.inbound_method === "dropoff"
    || events.some((e) => e.event_type === "manual_order_created" && /^Drop-off order created/i.test(e.description ?? ""));
  return dropoff ? toNyDate(order.created_at) : null;
}

export function orderView(row: IntakeOrderRow, events: readonly StageEventRow[], tierNames?: Readonly<Record<string, string>>): IntakeOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    status: row.status,
    statusLabel: ORDER_STATUSES[row.status as OrderStatus]?.label ?? row.status,
    paymentStatus: row.payment_status,
    restorationTier: normalizeTier(row.restoration_tier),
    tierName: row.restoration_tier ? tierDisplayName(row.restoration_tier, tierNames) : "Mixed / per card",
    inboundMethod: row.inbound_method,
    isDropoff: row.inbound_method === "dropoff",
    customerNotes: row.customer_notes,
    createdAt: row.created_at,
    historicalReceivedOn: historicalReceivedOn(row, events),
  };
}

/** `events`: the order's events NEWEST FIRST. */
export function cardView(
  row: IntakeCardRow,
  order: IntakeOrder,
  bag: Pick<TierBagRow, "id" | "bag_code" | "received_on"> | null,
  events: readonly StageEventRow[],
  tierNames?: Readonly<Record<string, string>>,
): IntakeCard {
  const tier = effectiveTier(row.tier, order.restorationTier);
  const refunded = row.status === "refunded";
  const customerPhotos = (row.photo_urls ?? []).filter(Boolean);
  const receivingPhotos = (row.receiving_photo_urls ?? []).filter(Boolean);
  const awaitingArrival = !!row.awaiting_arrival;
  const receivedOn = bag?.received_on ?? toNyDate(row.received_at);
  const missingReceivedDate = !refunded && !awaitingArrival && (
    bag ? !bag.received_on
      : !row.received_at && ARRIVED_STATUSES.includes(order.status) && !order.historicalReceivedOn
  );
  return {
    id: row.id,
    orderId: row.order_id,
    seq: row.card_seq,
    code: row.card_code,
    qrUrl: row.card_code ? qrUrl(row.card_code) : null,
    name: row.card_name?.trim() || "Card",
    set: row.card_set,
    year: row.card_year,
    number: row.card_number,
    variation: row.variation,
    notes: row.notes,
    tier,
    tierName: tierDisplayName(tier, tierNames),
    tierSource: normalizeTier(row.tier) ? "card" : tier ? "order" : null,
    status: row.status ?? "active",
    refunded,
    customerPhotos,
    catalogImageUrl: row.catalog_image_url,
    receivingPhotos,
    receivedAt: row.received_at,
    receivedBy: row.received_by,
    receivedOn,
    awaitingArrival,
    bagId: row.bag_id,
    bagCode: bag?.bag_code ?? null,
    completed: !!row.completed,
    completedAt: row.completed_at,
    stage: cardStageState(row, events),
    flags: {
      missingImage: customerPhotos.length === 0 && receivingPhotos.length === 0,
      missingTier: !tier,
      missingReceivedDate,
    },
  };
}

/**
 * `cards`: the bag's cards (any order; refunded ones are left out of the
 * counts and label lines). A Historical Order Setup bag of a finished order
 * stays complete even if its old cards were never ticked done.
 */
export function bagView(
  bag: TierBagRow,
  order: Pick<IntakeOrder, "id" | "orderNumber" | "customerName" | "status">,
  cards: readonly IntakeCard[],
  tierNames?: Readonly<Record<string, string>>,
): BagSummary {
  const live = [...cards].filter((c) => !c.refunded).sort(byCardNumber);
  const groups = stageGroups(live);
  const completedCount = live.filter((c) => c.completed).length;
  return {
    id: bag.id,
    orderId: bag.order_id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    tier: bag.tier,
    tierName: tierDisplayName(bag.tier, tierNames),
    tierLetter: tierLetter(bag.tier),
    batch: bag.batch,
    code: bag.bag_code,
    qrUrl: qrUrl(bag.bag_code),
    receivedOn: bag.received_on,
    dueDate: bag.due_date,
    dueStatus: bag.due_status,
    turnaroundDays: bag.turnaround_days,
    dueNote: bag.due_note,
    completedAt: bag.completed_at,
    completionSeenAt: bag.completion_seen_at,
    labelPrintedAt: bag.label_printed_at,
    source: bag.source,
    createdAt: bag.created_at,
    createdBy: bag.created_by,
    cardCount: live.length,
    completedCount,
    complete: (live.length > 0 && completedCount === live.length) || (!!bag.completed_at && keepsHistoricalCompletion(bag, order.status)),
    stagesDiffer: groups.length > 1,
    stageGroups: groups,
    cards: live.map((c) => ({ id: c.id, seq: c.seq, code: c.code, qrUrl: c.qrUrl, name: c.name, set: c.set, number: c.number })),
  };
}

/** Card number order; cards without a number yet last (by id). */
export function byCardNumber(a: Pick<IntakeCard, "seq" | "id">, b: Pick<IntakeCard, "seq" | "id">): number {
  if (a.seq != null && b.seq != null) return a.seq - b.seq;
  if (a.seq != null) return -1;
  if (b.seq != null) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Bags fastest tier first, then by batch. */
export function byBagOrder(a: Pick<BagSummary, "tier" | "batch">, b: Pick<BagSummary, "tier" | "batch">): number {
  return tierRank(a.tier) - tierRank(b.tier) || a.tier.localeCompare(b.tier) || a.batch - b.batch;
}

export function receivingStatus(cards: readonly Pick<IntakeCard, "refunded" | "receivedAt">[]): ReceivingStatus {
  const live = cards.filter((c) => !c.refunded);
  const received = live.filter((c) => c.receivedAt).length;
  if (!received) return "not received";
  return received === live.length ? "received" : "partially received";
}

/** Every non-refunded card done: "all cards done"; some: "partially completed"; none: "in progress". */
export function completionStatus(cards: readonly Pick<IntakeCard, "refunded" | "completed">[]): CompletionStatus {
  const live = cards.filter((c) => !c.refunded);
  const done = live.filter((c) => c.completed).length;
  if (live.length && done === live.length) return "all cards done";
  return done ? "partially completed" : "in progress";
}

/** Order rows to the whole receiving workspace. `events` NEWEST FIRST. */
export function buildOrderIntake(input: {
  order: IntakeOrderRow;
  cards: readonly IntakeCardRow[];
  bags: readonly TierBagRow[];
  events: readonly StageEventRow[];
  tierNames?: Readonly<Record<string, string>>;
}): OrderIntake {
  const { tierNames, events } = input;
  const order = orderView(input.order, events, tierNames);
  const bagById = new Map(input.bags.map((b) => [b.id, b]));
  const sortedRows = [...input.cards].sort((a, b) =>
    (a.card_seq ?? Infinity) - (b.card_seq ?? Infinity) || compareCardsForSeq(a, b));
  const cards = sortedRows.map((r) => cardView(r, order, r.bag_id ? bagById.get(r.bag_id) ?? null : null, events, tierNames));
  const bags = input.bags
    .map((b) => bagView(b, order, cards.filter((c) => c.bagId === b.id), tierNames))
    .sort(byBagOrder);
  const live = cards.filter((c) => !c.refunded);
  return {
    order,
    cards,
    bags,
    receiving: receivingStatus(cards),
    completion: completionStatus(cards),
    counts: {
      total: live.length,
      received: live.filter((c) => c.receivedAt).length,
      awaiting: live.filter((c) => c.awaitingArrival).length,
      notReceived: live.filter((c) => !c.receivedAt).length,
      completed: live.filter((c) => c.completed).length,
      refunded: cards.length - live.length,
      missingImage: live.filter((c) => c.flags.missingImage).length,
      missingTier: live.filter((c) => c.flags.missingTier).length,
      missingReceivedDate: live.filter((c) => c.flags.missingReceivedDate).length,
    },
  };
}
