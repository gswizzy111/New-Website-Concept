import { bagCode, cardCode, effectiveTier, nextCardSeqs, normalizeTier, tierDisplayName, tierLetter, tierRank } from "@/lib/intake/codes";
import type { IntakeCardRow, IntakeOrderRow, TierBagRow } from "@/lib/intake/types";

/**
 * What receiving some of an order's cards changes, worked out without the
 * database (lib/intake/receiving.ts loads the rows, calls this, then writes).
 * Pure, so the rules are unit tested (tests/intake/receiving.test.ts).
 */

export type PlanCard = Pick<IntakeCardRow,
  "id" | "order_id" | "card_name" | "tier" | "status" | "completed" | "created_at" | "card_seq" | "card_code" | "received_at" | "awaiting_arrival" | "bag_id">;
export type PlanBag = Pick<TierBagRow, "id" | "tier" | "batch" | "bag_code" | "received_on" | "completed_at">;
export type PlanOrder = Pick<IntakeOrderRow, "id" | "order_number" | "restoration_tier" | "status">;

/** One bag the received cards go into: an open bag of that tier received the same day, or a new batch. */
export type PlannedBag = {
  tier: string;
  tierName: string;
  batch: number;
  code: string;
  /** The bag to reuse; null = create it. */
  existingId: string | null;
  cardIds: string[];
};

export type ReceivingPlan = {
  /** Card IDs to assign first (cards of the order without one), in (created_at, id) order. */
  seqs: { id: string; seq: number; code: string }[];
  /** One per tier received now, fastest tier first. */
  bags: PlannedBag[];
  /** Asked for but already received (left alone). */
  alreadyReceived: string[];
  /** Cards of the order still not here, to flag awaiting_arrival (so they stay out of the backlog). */
  markAwaiting: string[];
  /** Non-refunded cards on the order. */
  totalCards: number;
  receivedBefore: number;
  receivedAfter: number;
  /** The order_events line, e.g. "Received 3 of 5 cards: Platinum bag CD-2549-P (2), Gold bag CD-2549-G (1)". */
  eventText: string;
};

/** A card that needs a tier before it can be received. */
export type NeedsTier = { cardId: string; seq: number | null; name: string };

export type PlanResult =
  | { ok: true; plan: ReceivingPlan }
  | { ok: false; status: number; error: string; needsTier?: NeedsTier[] };

export const MAX_CARDS_PER_RECEIPT = 500;

const isRefunded = (c: { status: string | null }) => c.status === "refunded";

/**
 * Plan receiving `cardIds` of an order on `receivedOn` (NY day).
 * Refuses cards that aren't on the order or were refunded, and cards with no
 * tier (on the card or the order): `needsTier` lists them so staff can pick
 * one. Cards already received are skipped. Cards already in a bag with no
 * receipt record (the Historical Order Setup bags an order's cards even when
 * its received date is unknown) are refused: they are never received again
 * into a new bag; staff enter that bag's received date instead.
 * `markOthersAwaiting` (default true) flags the order's other cards that
 * aren't here and aren't in a bag; the Historical Order Setup passes false.
 */
export function planReceiving(input: {
  order: PlanOrder;
  cards: readonly PlanCard[];
  bags: readonly PlanBag[];
  cardIds: readonly string[];
  receivedOn: string;
  markOthersAwaiting?: boolean;
  tierNames?: Readonly<Record<string, string>>;
}): PlanResult {
  const { order, cards, bags, receivedOn, markOthersAwaiting = true, tierNames } = input;
  const wanted = [...new Set(input.cardIds)];
  if (!wanted.length) return { ok: false, status: 400, error: "Tick the cards that arrived." };
  if (wanted.length > MAX_CARDS_PER_RECEIPT) return { ok: false, status: 400, error: `Receive at most ${MAX_CARDS_PER_RECEIPT} cards at a time.` };

  const byId = new Map(cards.filter((c) => c.order_id === order.id).map((c) => [c.id, c]));
  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length) return { ok: false, status: 400, error: `${missing.length === 1 ? "A card isn't" : `${missing.length} cards aren't`} on this order.` };

  // Card IDs for every card of the order (new numbers after the highest)
  const orderCards = [...byId.values()];
  const seqs = nextCardSeqs(orderCards).map((s) => ({ ...s, code: cardCode(order.order_number, s.seq) }));
  const seqOf = new Map<string, number | null>(orderCards.map((c) => [c.id, c.card_seq]));
  for (const s of seqs) seqOf.set(s.id, s.seq);
  const label = (id: string) => `#${seqOf.get(id) ?? "?"}`;

  const refunded = wanted.filter((id) => isRefunded(byId.get(id)!));
  if (refunded.length) return { ok: false, status: 400, error: `Card ${refunded.map(label).join(", ")} was refunded, so it can't be received.` };

  // Bagged without a receipt record (historical setup): enter the bag's received date instead
  const inBag = wanted.filter((id) => !byId.get(id)!.received_at && !!byId.get(id)!.bag_id);
  if (inBag.length) {
    const codeOf = new Map(bags.map((b) => [b.id, b.bag_code]));
    const codes = [...new Set(inBag.map((id) => codeOf.get(byId.get(id)!.bag_id!) ?? "a bag"))];
    const one = inBag.length === 1;
    return {
      ok: false, status: 409,
      error: `Card ${inBag.map(label).join(", ")} ${one ? "is" : "are"} already in ${codes.length === 1 ? `bag ${codes[0]}` : `bags ${codes.join(", ")}`}. Enter the bag's received date instead of receiving ${one ? "it" : "them"} again.`,
    };
  }

  const toReceive = wanted.filter((id) => !byId.get(id)!.received_at);
  const alreadyReceived = wanted.filter((id) => !!byId.get(id)!.received_at);

  const noTier = toReceive.filter((id) => !effectiveTier(byId.get(id)!.tier, order.restoration_tier));
  if (noTier.length) {
    return {
      ok: false, status: 400,
      error: `Pick a tier for card ${noTier.map(label).join(", ")} first.`,
      needsTier: noTier.map((id) => ({ cardId: id, seq: seqOf.get(id) ?? null, name: byId.get(id)!.card_name ?? "Card" })),
    };
  }

  // Group by tier; reuse an open bag of that tier received the same day, else the next batch
  const byTier = new Map<string, string[]>();
  for (const id of toReceive) {
    const tier = effectiveTier(byId.get(id)!.tier, order.restoration_tier)!;
    byTier.set(tier, [...(byTier.get(tier) ?? []), id]);
  }
  const usedCodes = new Set(bags.map((b) => b.bag_code.toUpperCase()));
  const planned: PlannedBag[] = [];
  for (const [tier, ids] of [...byTier].sort((a, b) => tierRank(a[0]) - tierRank(b[0]) || a[0].localeCompare(b[0]))) {
    const ordered = [...ids].sort((a, b) => (seqOf.get(a) ?? 0) - (seqOf.get(b) ?? 0));
    const open = bags
      .filter((b) => normalizeTier(b.tier) === tier && b.received_on === receivedOn && !b.completed_at)
      .sort((a, b) => a.batch - b.batch)[0];
    if (open) {
      planned.push({ tier, tierName: tierDisplayName(tier, tierNames), batch: open.batch, code: open.bag_code, existingId: open.id, cardIds: ordered });
      continue;
    }
    // Batches count per letter, so two unknown tiers ("U") never share a Bag ID
    const letter = tierLetter(tier);
    let batch = 1 + Math.max(0, ...bags.filter((b) => tierLetter(b.tier) === letter).map((b) => b.batch),
      ...planned.filter((p) => tierLetter(p.tier) === letter).map((p) => p.batch));
    while (usedCodes.has(bagCode(order.order_number, tier, batch))) batch++;
    const code = bagCode(order.order_number, tier, batch);
    usedCodes.add(code);
    planned.push({ tier, tierName: tierDisplayName(tier, tierNames), batch, code, existingId: null, cardIds: ordered });
  }

  const live = orderCards.filter((c) => !isRefunded(c));
  const receivingNow = new Set(toReceive);
  // A card in a bag is here (a historical bag may have no received date yet): never flagged
  const markAwaiting = markOthersAwaiting
    ? live.filter((c) => !c.received_at && !c.bag_id && !receivingNow.has(c.id) && !c.completed && !c.awaiting_arrival).map((c) => c.id)
    : [];
  const receivedBefore = live.filter((c) => c.received_at || c.bag_id).length;
  const receivedAfter = receivedBefore + toReceive.length;
  const n = toReceive.length;
  const head = receivedBefore === 0
    ? `Received ${n} of ${live.length} card${live.length === 1 ? "" : "s"}`
    : `Received ${n} more card${n === 1 ? "" : "s"} (${receivedAfter} of ${live.length} in)`;
  const eventText = `${head}: ${planned.map((b) => `${b.tierName} bag ${b.code} (${b.cardIds.length})`).join(", ")}`;

  return {
    ok: true,
    plan: { seqs, bags: planned, alreadyReceived, markAwaiting, totalCards: live.length, receivedBefore, receivedAfter, eventText },
  };
}
