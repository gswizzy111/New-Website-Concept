/**
 * "Print labels" for any order in one tap (owner, Nov 24 2026): fill missing
 * tiers, bag every live, arrived, unbagged card, then the UI prints every
 * bag's label (GET /api/admin/intake/labels/order/<orderId>).
 *
 * - Cards in the shop (received, in progress, completed, shipped back,
 *   delivered): bagged through the Historical Order Setup's own plan
 *   (lib/intake/migration.ts planOrderSetup / applyOrderSetup): received day
 *   from the order's records, guarded fills only, no status change, no
 *   customer email, no awaiting flags (so no backlog events).
 * - Awaiting Cards: only after "Cards arrived?", exactly the Receive button
 *   (lib/intake/receiving.ts receiveCards: status -> Cards Received + email).
 * - Missing tiers: lib/intake/tier-guess.ts; written to cards.tier first.
 *
 * Client components may import the TYPES only (`import type`): the functions
 * below reach server-only modules. Routes: app/api/admin/intake/orders/
 * [orderId]/prepare-labels/route.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BagSummary } from "@/lib/intake/types";
import {
  guessTiers, signedCardsFromDropoff, signedCardsFromSignature, tierPricing,
  type GuessCard, type ServiceLine, type SignedCard, type TierConfidence, type TierGuess, type TierGuessSource,
} from "@/lib/intake/tier-guess";
import { TIER_NAMES, TIER_ORDER, effectiveTier, normalizeTier, tierDisplayName, tierRank } from "@/lib/intake/codes";
import { nyToday } from "@/lib/intake/business-days";
import { fetchAll } from "@/lib/fetch-all";
import { BAG_COLUMNS, fillMissingDueDates, lacksDueDate, loadTurnarounds } from "@/lib/intake/due-dates";
import { FINISHED_STATUSES, SETUP_STATUSES, applyOrderSetup, planOrderSetup, type OrderPlan, type PlanInput, type SetupStore } from "@/lib/intake/migration";
import { loadOrderIntake, loadTierNames } from "@/lib/intake/data";
import { receiveCards } from "@/lib/intake/receiving";
import { planReceiving, type PlanBag, type PlanCard } from "@/lib/intake/receiving-plan";
import { shelvesFor, type BagShelf } from "@/lib/intake/tracking/shelf";
import type { OrderIntake } from "@/lib/intake/types";
import { loadSetupData, supabaseSetupStore } from "@/app/api/admin/intake/setup/_lib/store";
import { UNPAID_ERROR, paymentState, type PaymentState } from "@/app/admin/receiving/_components/payment";

export type { TierConfidence, TierGuessSource, BagShelf, PaymentState };

/**
 * What the button does for this order:
 * - `ready`: every live, arrived card is already in a bag; just print.
 * - `bag_in_shop`: cards are (or were) in the shop (received, in progress,
 *   completed, shipped back, delivered): one tap bags the unbagged cards, no
 *   status change, no customer email, then print.
 * - `receive_first`: Awaiting Cards: "Cards arrived? Receive all and print"
 *   (POST with confirmReceive: true = the Receive button: status -> Cards
 *   Received + the usual customer email), then print.
 * - `not_allowed`: awaiting payment, cancelled, refunded or not paid; `reason` says why
 *   (no button, or a disabled one with the reason).
 */
export type PrepareMode = "ready" | "bag_in_shop" | "receive_first" | "not_allowed";

export type TierChoice = { key: string; name: string };

/**
 * One question per group of cards that have no tier (neither the card's nor
 * the order's). Cards are grouped by their best guess, so most orders have a
 * single question ("Tier for these 3 cards: [Gold v]").
 * - `confidence: "sure"` (from the signed checkout record): filled
 *   automatically, `needsAnswer: false`; shown for information only.
 * - `"likely"` (what was paid fits only this tier, or the card's name says
 *   Prep) and `"unknown"` (a best guess, e.g. "Paid for 4 Gold and 2 Silver,
 *   but not which card is which", or null when nothing is on record):
 *   `needsAnswer: true`; preselect `guess` and send the confirmed tier for
 *   EVERY card id of the question in `tiers` (let staff change single cards:
 *   an order can need different tiers per card).
 */
export type TierQuestion = {
  cardIds: string[];
  cardNames: string[];
  guess: string | null;
  confidence: TierConfidence;
  /** Where the guess came from (null when unknown). */
  source: TierGuessSource | null;
  /** One plain sentence for staff, e.g. "Signed at checkout: Gold". */
  why: string;
  needsAnswer: boolean;
  /** Every tier key with its display name, fastest first (restoration tiers, then Prep). */
  choices: TierChoice[];
};

/** GET /api/admin/intake/orders/<id>/prepare-labels (also the body of a 409 from POST). */
export type PreparePlan = {
  orderId: string;
  orderNumber: string;
  /** orders.status (awaiting_payment, awaiting_cards, received, in_progress, completed, shipped_back, delivered, cancelled...). */
  status: string;
  /**
   * The order's payment as receiving treats it (orders.payment_status 'paid', 'refunded', anything else 'unpaid').
   * An unpaid Awaiting Cards order needs `allowUnpaid: true` after staff confirm UNPAID_CONFIRM, as the Receive button does.
   */
  payment: PaymentState;
  mode: PrepareMode;
  /** Why the button is disabled (not_allowed), or a note for staff. */
  reason?: string;
  /** The order's existing tier bags (fastest tier first), as the label panel shows them. */
  bags: BagSummary[];
  /** How many cards the POST will put in bags now (live, arrived, unbagged). */
  toBag: number;
  /** Tier questions for cards among `toBag` that have no tier. Empty when every card has one. */
  tierQuestions: TierQuestion[];
  /** True when at least one question still needs staff's answer (POST without it answers 409). */
  needsAnswers: boolean;
  /**
   * Bags saved without a due date (their tier had no turnaround then, e.g. Prep) that the POST dates now that
   * the tier has one (lib/intake/due-dates.ts fillMissingDueDates). When > 0 a `ready` order is POSTed too,
   * so the label shows the date.
   */
  dueDatesToFill: number;
  /** The NY day ("YYYY-MM-DD") the new bags will use as their received date. */
  receivedOn: string;
  /**
   * Where receivedOn comes from: the order's first "Cards Received" status event, its drop-off day, or today
   * (nothing on record: used for the cards bagged now only, never written to older bags). "bag" is no longer
   * produced (a day on the order's bags is never taken as the arrival day of later cards).
   */
  receivedOnSource: "event" | "dropoff" | "bag" | "today";
  /** Cards left alone: refunded ones, and ones flagged as not arrived yet (awaiting_arrival). */
  skipped: { refunded: number; awaitingArrival: number };
};

/** POST /api/admin/intake/orders/<id>/prepare-labels body. */
export type PrepareRequest = {
  /** Staff's answer per card id (tier keys as stored: regular, expedited, premium, ultra_premium, elite, fast_pass, prep). */
  tiers?: Record<string, string>;
  /** Required for an Awaiting Cards order: "Cards arrived? Receive all and print". */
  confirmReceive?: boolean;
  /** Required to receive an Awaiting Cards order that isn't paid, sent only after staff confirm (as the Receive button's allowUnpaid). */
  allowUnpaid?: boolean;
};

export type PreparedBag = { id: string; code: string; tier: string; tierName: string; cardCount: number };

/** POST 200. Then print every bag: GET /api/admin/intake/labels/order/<orderId> (PDF) or ?format=json. */
export type PrepareResponse = {
  ok: true;
  /** Every bag of the order with live cards (fastest tier first): the labels to print. */
  bags: PreparedBag[];
  /** Cards put in a bag by this request (0 when pressed again). */
  newlyBagged: number;
  /** A customer email went out (only when an Awaiting Cards order was received). */
  emailed: boolean;
  /** The order moved Awaiting Cards -> Cards Received. */
  orderStatusChanged: boolean;
  /** Awaiting Cards only: each received bag's due-date shelf slot, as the receive route answers them (shelvesFor). */
  shelves: BagShelf[];
  /** Bags that got their due date now (fillMissingDueDates): the labels show it. */
  dueDatesFilled: { bagCode: string; dueDate: string }[];
  /** One sentence for staff, e.g. "Bagged 3 cards: Gold bag CD-2549-G (3). Printing 2 labels." */
  message: string;
};

/**
 * POST 409 when staff must answer first: the PreparePlan itself plus `error`.
 * `needsConfirmReceive`: an Awaiting Cards order sent without confirmReceive.
 * `needsAllowUnpaid`: an unpaid Awaiting Cards order sent without allowUnpaid (then `error` is the
 * receive route's UNPAID_ERROR and `unpaid: true`, as its 409).
 * `unanswered`: card ids whose tier question needs an answer in `tiers`.
 */
export type PrepareConflict = PreparePlan & {
  error: string;
  needsConfirmReceive: boolean;
  needsAllowUnpaid: boolean;
  unpaid?: true;
  unanswered: string[];
};

/** Any other refusal: { error } with the HTTP status (400 bad body or tier, 401, 404, 409 cancelled/refunded/unpaid, 500). */
export type PrepareRefusal = { error: string };

// ── Planning (pure) ─────────────────────────────────────────────────────────

/** A card as the plan reads it. */
export type PrepareCard = {
  id: string;
  card_name: string | null;
  tier: string | null;
  status: string | null;
  bag_id: string | null;
  received_at: string | null;
  awaiting_arrival: boolean | null;
};

export type PrepareOrder = { id: string; order_number: string; status: string; payment_status: string | null; restoration_tier: string | null };

/** Orders whose cards are (or were) in the shop: bagged without a status change. */
export const IN_SHOP_STATUSES: readonly string[] = SETUP_STATUSES;

/** Every tier staff can pick, fastest first (Prep last), with its display name. */
export function tierChoices(names?: Readonly<Record<string, string>>): TierChoice[] {
  return TIER_ORDER.map((key) => ({ key, name: tierDisplayName(key, names) }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type BuiltPlan = {
  plan: PreparePlan;
  /** The cards the POST bags (in-shop: the Historical Order Setup plan's links; Awaiting Cards: what Receive all takes). */
  toBagIds: string[];
};

/**
 * What "Print labels" will do for one order, worked out from its rows.
 * `setupInput` (lib/intake/migration.ts PlanInput) is needed for in-shop
 * orders; `guesses` (lib/intake/tier-guess.ts guessTiers) for cards without
 * a tier. Cards with no tier are counted as if their guess were taken, so
 * `toBag` is what the POST bags once the questions are answered.
 */
export function buildPreparePlan(input: {
  order: PrepareOrder;
  cards: readonly PrepareCard[];
  bags: BagSummary[];
  guesses: Readonly<Record<string, TierGuess>>;
  tierNames?: Readonly<Record<string, string>>;
  today: string;
  /** The moment "today" stands for (the received time of cards bagged with nothing on record). Default: now. */
  now?: Date;
  setupInput?: PlanInput | null;
  /** Dateless bags the POST would date (fillMissingDueDates); 0 when not worked out. */
  dueDatesToFill?: number;
}): BuiltPlan {
  const { order, cards, guesses, tierNames, today } = input;
  const refunded = cards.filter((c) => c.status === "refunded").length;
  const awaiting = cards.filter((c) => c.status !== "refunded" && !!c.awaiting_arrival && !c.bag_id).length;
  const base: PreparePlan = {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    payment: paymentState(order.payment_status),
    mode: "not_allowed",
    bags: input.bags,
    toBag: 0,
    tierQuestions: [],
    needsAnswers: false,
    dueDatesToFill: input.dueDatesToFill ?? 0,
    receivedOn: today,
    receivedOnSource: "today",
    skipped: { refunded, awaitingArrival: awaiting },
  };
  const refuse = (reason: string): BuiltPlan => ({ plan: { ...base, reason, dueDatesToFill: 0 }, toBagIds: [] });
  const payment = paymentState(order.payment_status);
  if (order.status === "cancelled") return refuse("This order is cancelled.");
  if (payment === "refunded") return refuse("This order was refunded.");
  if (order.status === "awaiting_payment") return refuse("This order hasn't been paid yet.");

  const notes: string[] = [];
  let toBagIds: string[];
  let receivedOn = today;
  let receivedOnSource: PreparePlan["receivedOnSource"] = "today";
  const tierOf = (c: { id: string; tier: string | null }) => effectiveTier(c.tier, order.restoration_tier);

  if (order.status === "awaiting_cards") {
    // Not paid: the dialog asks UNPAID_CONFIRM (plan.payment), as the Receive button does
    toBagIds = cards.filter((c) => c.status !== "refunded" && !c.bag_id && !c.received_at && !c.awaiting_arrival).map((c) => c.id);
  } else if (IN_SHOP_STATUSES.includes(order.status)) {
    const setup = input.setupInput;
    if (!setup) return refuse("The order's records couldn't be read.");
    // The tiers the questions will settle, so the plan counts every card it would bag
    const filled: PlanInput = {
      ...setup,
      cards: setup.cards.map((c) => (tierOf(c) ? c : { ...c, tier: guesses[c.id]?.tier ?? "regular" })),
    };
    // The same rule the POST bags with (inShopSetupPlan)
    const { plan: setupPlan, source, late } = inShopSetupPlan(filled, { now: input.now, firstBagAt: firstBagAt(input.bags) });
    // In the order's card order (the questions list cards that way)
    const linked = new Set(setupPlan.links.map((l) => l.cardId));
    toBagIds = cards.filter((c) => linked.has(c.id)).map((c) => c.id);
    if (setupPlan.receivedOn) {
      receivedOn = setupPlan.receivedOn;
      receivedOnSource = source;
    }
    const addedLater = late.length + setupPlan.addedLater.length;
    if (addedLater) {
      notes.push(`${plural(addedLater, "card was", "cards were")} added after the order arrived, so ${addedLater === 1 ? "it is" : "they are"} left for Receiving.`);
    }
    if (payment === "unpaid") notes.push("This order isn't marked paid.");
  } else {
    return refuse("Labels can't be made for an order in this status.");
  }
  if (awaiting) notes.push(`${plural(awaiting, "card hasn't", "cards haven't")} arrived yet: receive ${awaiting === 1 ? "it" : "them"} on the Receiving page.`);

  // One question per guess (most orders: one)
  const byId = new Map(cards.map((c) => [c.id, c]));
  const choices = tierChoices(tierNames);
  const groups = new Map<string, TierQuestion>();
  for (const id of toBagIds) {
    const c = byId.get(id);
    if (!c || tierOf(c)) continue;
    const g: TierGuess = guesses[id] ?? { tier: null, confidence: "unknown", source: null, why: "No tier on record." };
    const key = `${g.tier}|${g.confidence}|${g.source}|${g.why}`;
    const q = groups.get(key) ?? {
      cardIds: [], cardNames: [], guess: g.tier, confidence: g.confidence, source: g.source, why: g.why,
      needsAnswer: !(g.confidence === "sure" && g.tier), choices,
    };
    q.cardIds.push(id);
    q.cardNames.push(c.card_name?.trim() || "Unnamed card");
    groups.set(key, q);
  }
  const tierQuestions = [...groups.values()];

  const hasLabels = input.bags.some((b) => b.cardCount > 0);
  if (!toBagIds.length) {
    if (hasLabels) return { plan: { ...base, mode: "ready", receivedOn, receivedOnSource, ...(notes.length ? { reason: notes.join(" ") } : {}) }, toBagIds };
    // Cards waiting for Receiving (not arrived, or added after the order arrived): say so
    const waiting = awaiting > 0 || notes.some((n) => n.includes("left for Receiving"));
    return refuse(waiting ? notes.join(" ") : order.status === "awaiting_cards" ? "This order has no cards to receive." : "This order has no cards to bag.");
  }
  return {
    plan: {
      ...base,
      mode: order.status === "awaiting_cards" ? "receive_first" : "bag_in_shop",
      ...(notes.length ? { reason: notes.join(" ") } : {}),
      toBag: toBagIds.length,
      tierQuestions,
      needsAnswers: tierQuestions.some((q) => q.needsAnswer),
      receivedOn,
      receivedOnSource,
    },
    toBagIds,
  };
}

/** The earliest created_at of the order's bags (the first time its cards were bagged), or null. */
export function firstBagAt(bags: readonly { createdAt: string | null }[]): string | null {
  return bags.map((b) => b.createdAt).filter((t): t is string => !!t && !Number.isNaN(Date.parse(t))).sort()[0] ?? null;
}

/** Cards typed in with a drop-off order: allowed this long after the order itself was entered. */
const DROPOFF_ENTRY_MS = 60 * 60 * 1000;

/**
 * The moment the order's cards were known to be here: its first "Cards
 * Received" status event; for a drop-off, the hand-over (or the order's entry
 * when later, plus an hour for the cards typed in with it); with neither, the
 * first time any of its cards were bagged (`firstBag`). Null: nothing on
 * record, so every card counts as arrived.
 */
export function arrivedBy(setup: PlanInput, firstBag: string | null): string | null {
  const at = (v: string | null | undefined) => (v && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);
  const event = at(setup.receivedEventAt);
  if (event != null) return new Date(event).toISOString();
  if (setup.order.inbound_method === "dropoff") {
    const handOver = at(setup.dropoffAt) ?? at(setup.order.created_at);
    const entered = at(setup.order.created_at);
    if (handOver != null) return new Date(Math.max(handOver, entered != null ? entered + DROPOFF_ENTRY_MS : handOver)).toISOString();
  }
  const bagged = at(firstBag);
  return bagged != null ? new Date(bagged).toISOString() : null;
}

/**
 * The Historical Order Setup plan "Print labels" bags with (the GET's plan
 * and the POST both use it, so they agree):
 * - An open order's cards created after the cards were known to be here
 *   (`arrivedBy`, to the second), not in a bag and not received, are left for
 *   Receiving (`late`): they may still be on their way. A finished order's
 *   are bagged (they were worked and shipped).
 * - The received day is the order's own record only (the "Cards Received"
 *   event or the drop-off). Otherwise today, and only for the cards bagged
 *   now: bags already missing their received date keep asking for it, and a
 *   day put on a bag by an earlier tap never becomes the arrival day of
 *   later cards.
 */
export function inShopSetupPlan(
  setup: PlanInput,
  opts: { now?: Date; firstBagAt?: string | null } = {},
): { plan: OrderPlan; source: "event" | "dropoff" | "today"; late: string[] } {
  const now = opts.now ?? new Date();
  const cutoff = arrivedBy(setup, opts.firstBagAt ?? null);
  const finished = (FINISHED_STATUSES as readonly string[]).includes(setup.order.status);
  const late = finished || !cutoff
    ? []
    : setup.cards
        .filter((c) => !c.bag_id && !c.received_at && !c.awaiting_arrival && c.status !== "refunded" && Date.parse(c.created_at) > Date.parse(cutoff))
        .map((c) => c.id);
  const lateSet = new Set(late);
  const input: PlanInput = late.length ? { ...setup, cards: setup.cards.filter((c) => !lateSet.has(c.id)) } : setup;

  const own = planOrderSetup(input);
  if (own.receivedOn && (own.receivedSource === "event" || own.receivedSource === "dropoff")) return { plan: own, source: own.receivedSource, late };
  const plan = planOrderSetup({ ...input, receivedEventAt: now.toISOString() });
  const linked = new Set(plan.links.map((l) => l.cardId));
  plan.bagFills = plan.bagFills
    .map((f) => ({ bagId: f.bagId, bagCode: f.bagCode, ...(f.completedAt ? { completedAt: f.completedAt } : {}) }))
    .filter((f) => f.completedAt);
  plan.receivedAtFills = plan.receivedAtFills.filter((id) => linked.has(id));
  plan.alreadySetUp = !plan.cardCodes.length && !plan.newBags.length && !plan.links.length && !plan.bagFills.length && !plan.receivedAtFills.length;
  return { plan, source: "today", late };
}

// ── Server ──────────────────────────────────────────────────────────────────

type CardRow = PrepareCard & GuessCard & { created_at: string };
type OrderRow = PrepareOrder & { subtotal_cents: number | null };
type Fail = { ok: false; status: number; error: string };

const CARD_COLUMNS = "id, card_name, card_set, card_number, card_year, estimated_value_cents, service_price_cents, tier, status, bag_id, received_at, awaiting_arrival, created_at";

/** A read that may fail without stopping anything (a guess source): empty then. */
async function soft<T>(what: string, run: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  try {
    const { data, error } = await run;
    if (error) {
      console.warn(`[prepare labels] ${what} not read:`, error.message);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.warn(`[prepare labels] ${what} not read:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Best guesses for the order's cards (reads the signed records, service lines and checkout events only when a card needs one). */
async function loadGuesses(admin: SupabaseClient, order: OrderRow, cards: CardRow[], names: Record<string, string>): Promise<Record<string, TierGuess>> {
  if (cards.every((c) => effectiveTier(c.tier, order.restoration_tier))) return {};
  const [services, signatures, dropoffs, events, settings] = await Promise.all([
    soft<ServiceLine>("service lines", admin.from("order_services").select("service_id, service_name, price_cents, quantity").eq("order_id", order.id)),
    soft<{ card_snapshot: unknown; document_text: string | null }>("signatures",
      admin.from("signatures").select("card_snapshot, document_text").eq("order_id", order.id).eq("type", "master_terms")),
    soft<{ tiers: string[] | null; cards: unknown }>("drop-off forms", admin.from("show_dropoffs").select("tiers, cards").eq("order_id", order.id)),
    soft<{ description: string | null }>("checkout events",
      admin.from("order_events").select("description").eq("order_id", order.id).in("event_type", ["checkout_initiated", "manual_order_created"])),
    soft<{ tier: string; price_cents: number | null; pricing_rate: number | string | null; min_card_value_cents: number | null }>("tier prices",
      admin.from("restoration_settings").select("tier, price_cents, pricing_rate, min_card_value_cents")),
  ]);
  const signed: SignedCard[] = [
    ...signatures.flatMap((s) => signedCardsFromSignature(s.card_snapshot, s.document_text, names)),
    ...dropoffs.flatMap((d) => signedCardsFromDropoff(d)),
  ];
  return guessTiers({
    orderTier: order.restoration_tier,
    cards,
    signed,
    services,
    checkoutEvents: events.map((e) => e.description ?? ""),
    subtotalCents: order.subtotal_cents,
    pricing: tierPricing(settings),
    tierNames: names,
  });
}

const readOrder = async (admin: SupabaseClient, orderId: string) =>
  admin.from("orders").select("id, order_number, status, payment_status, restoration_tier, subtotal_cents").eq("id", orderId).maybeSingle();

type Context = { order: OrderRow; cards: CardRow[]; built: BuiltPlan; guesses: Record<string, TierGuess>; names: Record<string, string> };

/** How many of the bags would get a due date now (lacksDueDate, and the tier has a turnaround today). Best effort: 0 on a failed read. */
async function countDueDatesToFill(admin: SupabaseClient, bags: BagSummary[]): Promise<number> {
  const dateless = bags.filter(lacksDueDate);
  if (!dateless.length) return 0;
  try {
    const turnarounds = await loadTurnarounds(admin);
    return dateless.filter((b) => (b.turnaroundDays ?? turnarounds[normalizeTier(b.tier) ?? ""] ?? null) != null).length;
  } catch (e) {
    console.warn("[prepare labels] turnarounds not read:", e instanceof Error ? e.message : e);
    return 0;
  }
}

async function loadContext(admin: SupabaseClient, orderId: string, preloaded?: OrderIntake): Promise<({ ok: true } & Context) | Fail> {
  let rows: [Awaited<ReturnType<typeof readOrder>>, CardRow[], Awaited<ReturnType<typeof loadOrderIntake>>, Record<string, string>];
  try {
    rows = await Promise.all([
      readOrder(admin, orderId),
      fetchAll<CardRow>((from, to) => admin.from("cards").select(CARD_COLUMNS).eq("order_id", orderId).order("created_at").order("id").range(from, to)),
      preloaded && preloaded.order.id === orderId ? { ok: true as const, intake: preloaded } : loadOrderIntake(admin, orderId, { heal: false }),
      loadTierNames(admin),
    ]);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the order: ${e instanceof Error ? e.message : String(e)}` };
  }
  const [{ data: order, error: oErr }, cards, intake, settingsNames] = rows;
  if (oErr) return { ok: false, status: 500, error: `Couldn't read the order: ${oErr.message}` };
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (!intake.ok) return intake;
  // The names the pages use: restoration_settings display names over the built-in ones
  const names: Record<string, string> = { ...TIER_NAMES, ...settingsNames };

  let setupInput: PlanInput | null = null;
  if (IN_SHOP_STATUSES.includes(order.status as string)) {
    try {
      setupInput = (await loadSetupData(admin, { orderIds: [orderId] })).inputs.get(orderId) ?? null;
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't read the order's records: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const [guesses, dueDatesToFill] = await Promise.all([
    loadGuesses(admin, order as OrderRow, cards, names),
    countDueDatesToFill(admin, intake.intake.bags),
  ]);
  const built = buildPreparePlan({
    order: order as OrderRow, cards, bags: intake.intake.bags, guesses, tierNames: names, today: nyToday(), setupInput, dueDatesToFill,
  });
  return { ok: true, order: order as OrderRow, cards, built, guesses, names };
}

/**
 * GET: what "Print labels" will do for the order. `opts.intake`: the order's
 * intake when the caller has just loaded it (the receiving workspace), so it
 * isn't read twice.
 */
export async function loadPreparePlan(admin: SupabaseClient, orderId: string, opts: { intake?: OrderIntake } = {}): Promise<({ ok: true; plan: PreparePlan }) | Fail> {
  const ctx = await loadContext(admin, orderId, opts.intake);
  return ctx.ok ? { ok: true, plan: ctx.built.plan } : ctx;
}

export type PrepareOutcome = ({ ok: true } & { response: PrepareResponse }) | (Fail & { conflict?: PrepareConflict });

/** Fill the confirmed tiers (only cards still without one and not in a bag); one staff-only activity line. */
async function writeTiers(admin: SupabaseClient, orderId: string, answers: Map<string, string>, ctx: Context, by: string | null): Promise<Fail | null> {
  if (!answers.size) return null;
  const byTier = new Map<string, string[]>();
  for (const [id, t] of answers) byTier.set(t, [...(byTier.get(t) ?? []), id]);
  const written: Record<string, string> = {};
  for (const [tier, ids] of byTier) {
    const { data, error } = await admin.from("cards").update({ tier }).in("id", ids).is("tier", null).is("bag_id", null).select("id");
    if (error) return { ok: false, status: 500, error: `Couldn't save the cards' tiers. Nothing was bagged. (${error.message})` };
    for (const r of data ?? []) written[r.id as string] = tier;
  }
  const ids = Object.keys(written);
  if (ids.length) {
    const counts = new Map<string, number>();
    for (const t of Object.values(written)) counts.set(t, (counts.get(t) ?? 0) + 1);
    const list = [...counts].sort(([a], [b]) => tierRank(a) - tierRank(b)).map(([t, n]) => `${tierDisplayName(t, ctx.names)} (${n})`).join(", ");
    const { error } = await admin.from("order_events").insert({
      order_id: orderId,
      event_type: "tier_changed",
      description: `Tiers filled in for labels: ${list}${by ? ` by ${by}` : ""}`,
      metadata: {
        via: "prepare_labels", by,
        tiers: written,
        sources: Object.fromEntries(ids.map((id) => [id, { guess: ctx.guesses[id]?.tier ?? null, confidence: ctx.guesses[id]?.confidence ?? "unknown", source: ctx.guesses[id]?.source ?? null }])),
      },
      is_customer_visible: false,
    });
    if (error) console.error("[prepare labels] tier fill not logged:", error.message);
  }
  return null;
}

/** The Setup store, with this action's own activity line. */
function labelStore(admin: SupabaseClient, source: string): SetupStore {
  const base = supabaseSetupStore(admin);
  return {
    ...base,
    logSetup: (orderId, description, metadata) =>
      base.logSetup(orderId, description.replace(/^Historical setup:/, "Bagged for labels:"), { ...metadata, via: "prepare_labels", received_source: source }),
  };
}

/**
 * POST: fill the tiers, bag the cards (in-shop) or receive them all
 * (Awaiting Cards, after confirmReceive), and answer every bag to print.
 * Idempotent: a repeat bags nothing new and answers the same bags.
 */
export async function prepareLabels(
  admin: SupabaseClient,
  input: { orderId: string; tiers?: Record<string, string>; confirmReceive?: boolean; allowUnpaid?: boolean; by: string | null },
): Promise<PrepareOutcome> {
  for (const v of Object.values(input.tiers ?? {})) {
    const t = normalizeTier(v);
    if (!t || !TIER_ORDER.includes(t)) return { ok: false, status: 400, error: `Unknown tier "${String(v)}".` };
  }

  const ctx = await loadContext(admin, input.orderId);
  if (!ctx.ok) return ctx;
  const { plan } = ctx.built;
  if (plan.mode === "not_allowed") return { ok: false, status: 409, error: plan.reason ?? "Labels can't be made for this order." };

  // Every question answered (sure guesses fill themselves)
  const answers = new Map<string, string>();
  const unanswered: string[] = [];
  for (const q of plan.tierQuestions) {
    for (const id of q.cardIds) {
      const given = normalizeTier(input.tiers?.[id]);
      if (given) answers.set(id, given);
      else if (!q.needsAnswer && q.guess) answers.set(id, q.guess);
      else unanswered.push(id);
    }
  }
  // The order's tier, written onto its cards as they go into bags (a filled tier is part of receiving;
  // the order tier stays as it is). Only cards with no tier of their own.
  const orderTier = normalizeTier(ctx.order.restoration_tier);
  if (orderTier) {
    const byId = new Map(ctx.cards.map((c) => [c.id, c]));
    for (const id of ctx.built.toBagIds) if (!byId.get(id)?.tier && !answers.has(id)) answers.set(id, orderTier);
  }
  const needsConfirm = plan.mode === "receive_first" && input.confirmReceive !== true;
  // As the receive route's paymentBlock: an unpaid order is received only with allowUnpaid (staff confirmed)
  const needsAllowUnpaid = plan.mode === "receive_first" && plan.payment === "unpaid" && input.allowUnpaid !== true;
  if (needsConfirm || needsAllowUnpaid || unanswered.length) {
    const error = needsAllowUnpaid
      ? UNPAID_ERROR
      : unanswered.length
        ? `Pick a tier for ${plural(unanswered.length, "card")} first.`
        : "Cards arrived? Confirm to receive all of them and print the labels.";
    return {
      ok: false, status: 409, error,
      conflict: { ...plan, error, needsConfirmReceive: needsConfirm, needsAllowUnpaid, ...(needsAllowUnpaid ? { unpaid: true as const } : {}), unanswered },
    };
  }

  // Check the receipt / bagging with the answers in memory first: tiers are written only when it can go ahead
  const first = bagFirst(ctx);
  const check = plan.mode === "receive_first"
    ? await receiveCheck(admin, ctx, answers)
    : plan.mode === "bag_in_shop"
      ? await setupCheck(admin, input.orderId, answers, first)
      : null;
  if (check) return check;

  const tierFail = await writeTiers(admin, input.orderId, answers, ctx, input.by);
  if (tierFail) return tierFail;

  let newlyBagged = 0;
  let emailed = false;
  let orderStatusChanged = false;
  let extra = "";
  let shelves: BagShelf[] = [];
  if (plan.mode === "receive_first") {
    // Exactly the Receive button: Card IDs, bags with due dates, Cards Received + the customer email
    const r = await receiveCards(admin, { orderId: input.orderId, cardIds: ctx.built.toBagIds, by: input.by });
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    newlyBagged = r.receivedCardIds.length;
    orderStatusChanged = r.orderStatusChanged;
    emailed = r.orderStatusChanged && !r.emailFailed;
    if (r.statusError) extra = ` ${r.statusError}`;
    else if (r.orderStatusChanged && r.emailFailed) extra = " The customer email didn't go out.";
    // As the receive route: each received bag's due-date shelf slot, made where missing
    shelves = await shelvesFor(admin, r.bags, input.by);
    if (paymentState(ctx.order.payment_status) !== "paid" && r.receivedCardIds.length) {
      // As the receive route logs it
      const { error } = await admin.from("order_events").insert({
        order_id: input.orderId,
        event_type: "received_unpaid",
        description: `Cards received on an order that isn't paid (payment status: ${ctx.order.payment_status ?? "none"}), confirmed by ${input.by ?? "admin"}`,
        metadata: { by: input.by, payment_status: ctx.order.payment_status ?? null, card_ids: r.receivedCardIds, via: "prepare_labels" },
        is_customer_visible: false,
      });
      if (error) console.error("[prepare labels] unpaid receipt not logged:", error.message);
    }
  } else if (plan.mode === "bag_in_shop") {
    // The order's records again, with the tiers just filled
    let setup: PlanInput | undefined;
    try {
      setup = (await loadSetupData(admin, { orderIds: [input.orderId] })).inputs.get(input.orderId);
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't read the order's records: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!setup) return { ok: false, status: 404, error: "Order not found" };
    const { plan: setupPlan, source } = inShopSetupPlan(setup, { firstBagAt: first });
    try {
      const done = await applyOrderSetup(setupPlan, labelStore(admin, source), input.by);
      newlyBagged = done.cardsLinked;
    } catch (e) {
      return { ok: false, status: 500, error: `Couldn't bag the cards: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Bags saved without a due date whose tier has a turnaround now (Prep once it is set): dated, so the label shows it
  const { filled } = await fillMissingDueDates(admin, { orderId: input.orderId, by: input.by });

  // Every bag of the order with live cards: the labels to print
  const after = await loadOrderIntake(admin, input.orderId);
  if (!after.ok) return after;
  const bags: PreparedBag[] = after.intake.bags
    .filter((b) => b.cardCount > 0)
    .map((b) => ({ id: b.id, code: b.code, tier: b.tier, tierName: b.tierName, cardCount: b.cardCount }));
  const labels = bags.length ? `${plural(bags.length, "label")} to print.` : "No labels to print.";
  const head = plan.mode === "receive_first"
    ? `Received ${plural(newlyBagged, "card")}${orderStatusChanged ? `; the order is now Cards Received${emailed ? " and the customer was emailed" : ""}` : ""}.`
    : newlyBagged ? `Bagged ${plural(newlyBagged, "card")}.` : "Nothing new to bag.";
  const dated = filled.length ? ` Due date set for ${filled.map((f) => `${f.bagCode} (${shortDay(f.dueDate)})`).join(", ")}.` : "";
  return {
    ok: true,
    response: {
      ok: true, bags, newlyBagged, emailed, orderStatusChanged, shelves,
      dueDatesFilled: filled.map((f) => ({ bagCode: f.bagCode, dueDate: f.dueDate })),
      message: `${head}${extra}${dated} ${labels}${shelfText(shelves)}`,
    },
  };
}

/** The first time the order's cards were bagged (its earliest bag), for inShopSetupPlan. */
const bagFirst = (ctx: Context) => firstBagAt(ctx.built.plan.bags);

/** The card rows with staff's answers as their tiers (in memory only). */
const withAnswers = <T extends { id: string; tier: string | null }>(cards: readonly T[], answers: ReadonlyMap<string, string>): T[] =>
  cards.map((c) => (answers.has(c.id) && !c.tier ? { ...c, tier: answers.get(c.id)! } : c));

/** Awaiting Cards: would the Receive button take these cards, with the answers as their tiers? A refusal, or null to go ahead. */
async function receiveCheck(admin: SupabaseClient, ctx: Context, answers: ReadonlyMap<string, string>): Promise<Fail | null> {
  const [{ data: cards, error: cErr }, { data: bags, error: bErr }] = await Promise.all([
    admin.from("cards").select("id, order_id, card_name, tier, status, completed, created_at, card_seq, card_code, received_at, awaiting_arrival, bag_id").eq("order_id", ctx.order.id),
    admin.from("tier_bags").select(BAG_COLUMNS).eq("order_id", ctx.order.id),
  ]);
  const err = cErr ?? bErr;
  if (err) return { ok: false, status: 500, error: `Couldn't read the order. Nothing was changed. (${err.message})` };
  const planned = planReceiving({
    order: { id: ctx.order.id, order_number: ctx.order.order_number, restoration_tier: ctx.order.restoration_tier, status: ctx.order.status },
    cards: withAnswers((cards ?? []) as PlanCard[], answers),
    bags: (bags ?? []) as PlanBag[],
    cardIds: ctx.built.toBagIds,
    receivedOn: nyToday(),
    tierNames: ctx.names,
  });
  return planned.ok ? null : { ok: false, status: planned.status, error: `${planned.error} Nothing was changed.` };
}

/** In the shop: can the order be bagged with the answers as tiers (every card it bags has one)? A refusal, or null to go ahead. */
async function setupCheck(admin: SupabaseClient, orderId: string, answers: ReadonlyMap<string, string>, first: string | null): Promise<Fail | null> {
  let setup: PlanInput | undefined;
  try {
    setup = (await loadSetupData(admin, { orderIds: [orderId] })).inputs.get(orderId);
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the order's records. Nothing was changed. (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!setup) return { ok: false, status: 404, error: "Order not found" };
  const { plan } = inShopSetupPlan({ ...setup, cards: withAnswers(setup.cards, answers) }, { firstBagAt: first });
  if (!plan.eligible) return { ok: false, status: 409, error: `${plan.ineligibleReason ?? "This order can't be bagged."} Nothing was changed.` };
  if (plan.missingTiers.length) {
    const names = plan.missingTiers.map((c) => c.name).join(", ");
    return { ok: false, status: 409, error: `${plural(plan.missingTiers.length, "card has", "cards have")} no tier yet (${names}). Tap Print labels again to pick ${plan.missingTiers.length === 1 ? "it" : "them"}. Nothing was changed.` };
  }
  return null;
}

/** "Dec 7" for a stored day. */
function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** " Put in shelf: DUE MON DEC 7." (the receiving page's wording); each bag named when they go to different shelves. */
function shelfText(shelves: readonly BagShelf[]): string {
  const list = shelves.filter((s) => s.location).map((s) => ({ bag: s.bagCode, shelf: s.location!.name }));
  const names = [...new Set(list.map((s) => s.shelf))];
  if (!names.length) return "";
  if (names.length === 1) return ` Put in shelf: ${names[0]}.`;
  return ` Put ${list.map((s) => `${s.bag} in shelf ${s.shelf}`).join("; ")}.`;
}
