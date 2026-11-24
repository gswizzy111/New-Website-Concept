import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { ORDER_STATUSES } from "@/lib/constants";
import { parseStageEvent } from "@/lib/restoration-stages";
import { INTAKE_START } from "@/lib/intake/start";
import { nyToday } from "@/lib/intake/business-days";
import { tierDisplayName } from "@/lib/intake/codes";
import { loadTierNames } from "@/lib/intake/data";
import { cardStageState } from "@/lib/intake/stage-plan";
import type { StageEventRow } from "@/lib/intake/types";
import {
  FINAL_DRY_STAGE, FINISHED_ORDER_STATUSES, FORGOTTEN_RULES, SLOT_DAYS,
  bagPastDue, countsForBadge, finalDryReadBefore, finalDrySince, forgottenReasons, inNewSystem, lastSeenText, latest, reasonText,
  type ForgottenCardFacts, type ForgottenReason, type ForgottenRule,
} from "./rules";
import { chunks, lastOut, loadLastMoves, loadPlaces, type Place } from "./places-data";
import { isMissingTracking } from "./schema";

/**
 * The Forgotten cards report (/admin/receiving/forgotten) and the "Check"
 * menu badge. Reads only, every select paged with fetchAll (the API returns
 * at most 1,000 rows) and chunked by order (no "in" list past 100 ids).
 * The rules are in rules.ts.
 *
 * Which cards are read:
 *   1. live cards (not done, not refunded, arrived) of orders that are in the
 *      shop or finished (received, in_progress, completed, shipped_back,
 *      delivered); by default only the new system: cards in a tier bag, and
 *      cards of orders created since Receiving went live (INTAKE_START);
 *   2. cards in a slot (done or not) and cards on the Done place that aren't
 *      done (after supabase/migrations/20261124_card_tracking.sql; skipped
 *      before it), same orders and scope;
 * plus their orders' stage events, tier bags, places and latest card moves.
 */

/** Order statuses whose cards can be forgotten (cancelled and unpaid / not-arrived orders can't). */
const READ_STATUSES = ["received", "in_progress", "completed", "shipped_back", "delivered"];
const LIVE_IN_SHOP = ["received", "in_progress"];

type OrderJoin = { order_number: string; customer_name: string | null; status: string; created_at: string | null };
type CardRow = {
  id: string;
  order_id: string;
  bag_id: string | null;
  card_code: string | null;
  card_seq: number | null;
  card_name: string | null;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  completed: boolean | null;
  completed_at: string | null;
  status: string | null;
  awaiting_arrival: boolean | null;
  current_round: number | null;
  received_at: string | null;
  received_by: string | null;
  orders: OrderJoin | null;
  location_id?: string | null;
  located_at?: string | null;
};
type BagRow = { id: string; order_id: string; bag_code: string; tier: string; due_date: string | null; completed_at: string | null; source: string | null; location_id?: string | null };

const CARD_SELECT =
  "id, order_id, bag_id, card_code, card_seq, card_name, card_set, card_year, card_number, completed, completed_at, status, awaiting_arrival, current_round, received_at, received_by, orders!inner(order_number, customer_name, status, created_at)";

export type ForgottenCardItem = {
  id: string;
  code: string | null;
  name: string;
  detail: string;
  orderId: string;
  orderNumber: string;
  customer: string | null;
  orderStatus: string;
  orderStatusLabel: string;
  bagId: string | null;
  bagCode: string | null;
  dueDate: string | null;
  done: boolean;
  rule: ForgottenRule;
  reason: ForgottenReason;
  /** Why it's listed ("At Final Dry ... for 5 days, not marked done"). */
  reasonText: string;
  /** The other rules it trips too, as text. */
  alsoText: string[];
  /** Its step now: "Final Dry", "Drying", "Not started", "Done". */
  stageLabel: string;
  /** "CLAMP 07, 2 days ago" / "Out of CLAMP 07, 3 days ago" / "Not in a slot" ("" without places). */
  lastSeen: string;
};

export type PastDueBag = {
  id: string;
  code: string;
  tierName: string;
  orderId: string;
  orderNumber: string;
  customer: string | null;
  dueDate: string;
  daysOverdue: number;
  /** Non-refunded cards in the bag, and how many are done. */
  cardCount: number;
  doneCount: number;
  /** The shelf or place the bag is on, if recorded. */
  place: string | null;
};

export type ForgottenReport = {
  cards: ForgottenCardItem[];
  bags: PastDueBag[];
  counts: Record<ForgottenRule, number> & { pastDue: number; badge: number };
  trackPlaces: boolean;
  includeOlder: boolean;
  slotDays: number;
};

const statusLabel = (s: string) => ORDER_STATUSES[s as keyof typeof ORDER_STATUSES]?.label ?? s;

/** Live cards of the read statuses, in scope: bagged + new orders, or every order. */
async function loadLiveCards(admin: SupabaseClient, includeOlder: boolean): Promise<CardRow[]> {
  const base = () =>
    admin.from("cards").select(CARD_SELECT)
      .not("completed", "is", true)
      .neq("status", "refunded")
      .eq("awaiting_arrival", false)
      .in("orders.status", READ_STATUSES);
  // orders!inner is many-to-one: PostgREST returns one object (the select parser types it as a list)
  if (includeOlder) return (await fetchAll((from, to) => base().order("id").range(from, to))) as unknown as CardRow[];
  const [bagged, fresh] = await Promise.all([
    fetchAll((from, to) => base().not("bag_id", "is", null).order("id").range(from, to)),
    fetchAll((from, to) => base().is("bag_id", null).gte("orders.created_at", INTAKE_START).order("id").range(from, to)),
  ]);
  return [...bagged, ...fresh] as unknown as CardRow[];
}

/**
 * Cards in a slot (done or not) and cards not done on a Done place, with
 * where they are. Null when the places tables aren't there yet.
 */
async function loadPlacedCards(admin: SupabaseClient): Promise<CardRow[] | null> {
  const select = `${CARD_SELECT}, location_id, located_at, locations!inner(kind)`;
  try {
    const [inSlots, onDone] = await Promise.all([
      fetchAll((from, to) =>
        admin.from("cards").select(select).eq("locations.kind", "station")
          .neq("status", "refunded").in("orders.status", READ_STATUSES).order("id").range(from, to)),
      fetchAll((from, to) =>
        admin.from("cards").select(select).not("completed", "is", true).eq("locations.kind", "done")
          .neq("status", "refunded").in("orders.status", READ_STATUSES).order("id").range(from, to)),
    ]);
    return [...inSlots, ...onDone] as unknown as CardRow[];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTracking({ message })) return null;
    throw e;
  }
}

/** Stage events (stage_update, round_started) of the orders, newest first, by card id. */
async function loadStageEvents(admin: SupabaseClient, orderIds: string[]): Promise<Map<string, StageEventRow[]>> {
  const pages = await Promise.all(chunks(orderIds).map((ids) =>
    fetchAll<StageEventRow & { metadata: unknown }>((from, to) =>
      admin.from("order_events").select("event_type, description, metadata, created_at")
        .in("order_id", ids).in("event_type", ["stage_update", "round_started"])
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to))));
  const byCard = new Map<string, StageEventRow[]>();
  for (const e of pages.flat()) {
    const meta = e.metadata && typeof e.metadata === "object" ? (e.metadata as { card_id?: unknown }) : {};
    const cardId = parseStageEvent(e)?.card_id ?? (typeof meta.card_id === "string" ? meta.card_id : null);
    if (!cardId) continue;
    const list = byCard.get(cardId);
    if (list) list.push(e);
    else byCard.set(cardId, [e]);
  }
  return byCard;
}

async function loadBags(admin: SupabaseClient, orderIds: string[]): Promise<BagRow[]> {
  const pages = await Promise.all(chunks(orderIds).map((ids) =>
    fetchAll<BagRow>((from, to) =>
      admin.from("tier_bags").select("id, order_id, bag_code, tier, due_date, completed_at, source")
        .in("order_id", ids).order("id").range(from, to))));
  return pages.flat();
}

/** Bag id -> place id, best effort (none before the migration). */
async function loadBagPlaceIds(admin: SupabaseClient, bagIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const pages = await Promise.all(chunks(bagIds).map((ids) =>
      fetchAll<{ id: string; location_id: string | null }>((from, to) =>
        admin.from("tier_bags").select("id, location_id").in("id", ids).order("id").range(from, to))));
    for (const r of pages.flat()) if (r.location_id) out.set(r.id, r.location_id);
  } catch {
    /* no places yet */
  }
  return out;
}

/** The rules' view of one card. */
function factsOf(
  card: CardRow,
  events: StageEventRow[],
  bagSource: string | null,
  place: Place | null,
  locatedAt: string | null,
  lastMoveAt: string | null,
): { facts: ForgottenCardFacts; stageLabel: string } {
  const st = cardStageState(card, events);
  const lastStage = st.history.reduce<string | null>((acc, h) => latest(acc, h.at), null);
  return {
    stageLabel: st.currentLabel,
    facts: {
      orderStatus: card.orders?.status ?? "",
      orderCreatedAt: card.orders?.created_at ?? null,
      inBag: !!card.bag_id,
      bagSource,
      done: !!card.completed,
      refunded: card.status === "refunded",
      awaiting: !!card.awaiting_arrival,
      stage: st.current,
      stageSince: st.current ? st.updatedAt : null,
      lastStageActivityAt: lastStage,
      lastMoveAt,
      location: place ? { kind: place.kind, stage: place.stage } : null,
      locatedAt: place ? locatedAt : null,
    },
  };
}

/**
 * The report. `includeOlder` adds orders from before Receiving went live;
 * `slotDays` is rule (e)'s days in one slot (default 3).
 */
export async function loadForgotten(
  admin: SupabaseClient,
  opts: { includeOlder?: boolean; slotDays?: number; now?: number } = {},
): Promise<ForgottenReport> {
  const includeOlder = !!opts.includeOlder;
  const slotDays = opts.slotDays ?? SLOT_DAYS;
  const now = opts.now ?? Date.now();

  const [liveCards, placed, placesLoad, tierNames] = await Promise.all([
    loadLiveCards(admin, includeOlder),
    loadPlacedCards(admin),
    loadPlaces(admin),
    loadTierNames(admin),
  ]);
  const trackPlaces = placed !== null && placesLoad.ready;

  // One row per card: the placed read carries where it is
  const byId = new Map<string, CardRow>();
  for (const c of liveCards) byId.set(c.id, c);
  for (const c of placed ?? []) {
    if (!includeOlder && !inNewSystem({ inBag: !!c.bag_id, orderCreatedAt: c.orders?.created_at ?? null })) continue;
    byId.set(c.id, { ...(byId.get(c.id) ?? {}), ...c });
  }
  const cards = [...byId.values()].filter((c) => c.orders);
  const orderIds = [...new Set(cards.map((c) => c.order_id))];

  const [events, bags, moves] = await Promise.all([
    loadStageEvents(admin, orderIds),
    loadBags(admin, orderIds),
    trackPlaces ? loadLastMoves(admin, orderIds) : Promise.resolve(new Map()),
  ]);
  const bagById = new Map(bags.map((b) => [b.id, b]));

  const items: ForgottenCardItem[] = [];
  for (const card of cards) {
    const place = card.location_id ? placesLoad.places.get(card.location_id) ?? null : null;
    const move = moves.get(card.id);
    const { facts, stageLabel } = factsOf(
      card, events.get(card.id) ?? [], card.bag_id ? bagById.get(card.bag_id)?.source ?? null : null,
      place, card.located_at ?? null, move?.at ?? null,
    );
    const reasons = forgottenReasons(facts, now, slotDays);
    if (!reasons.length) continue;
    const o = card.orders!;
    const ctx = { orderStatusLabel: statusLabel(o.status), placeName: place?.name ?? null, done: facts.done };
    const bag = card.bag_id ? bagById.get(card.bag_id) : undefined;
    items.push({
      id: card.id,
      code: card.card_code,
      name: card.card_name?.trim() || "Unnamed card",
      detail: [card.card_year, card.card_set, card.card_number ? `#${card.card_number}` : ""].filter(Boolean).join(" · "),
      orderId: card.order_id,
      orderNumber: o.order_number,
      customer: o.customer_name?.trim() || null,
      orderStatus: o.status,
      orderStatusLabel: statusLabel(o.status),
      bagId: card.bag_id,
      bagCode: bag?.bag_code ?? null,
      dueDate: bag?.due_date ?? null,
      done: facts.done,
      rule: reasons[0].rule,
      reason: reasons[0],
      reasonText: reasonText(reasons[0], ctx),
      alsoText: reasons.slice(1).map((r) => reasonText(r, ctx)),
      stageLabel,
      lastSeen: trackPlaces ? lastSeenText(place, card.located_at ?? null, lastOut(move, placesLoad.places), now) : "",
    });
  }

  // (d) bags past due with cards not done
  const today = nyToday(new Date(now));
  const openByBag = new Map<string, number>();
  for (const c of liveCards) if (c.bag_id) openByBag.set(c.bag_id, (openByBag.get(c.bag_id) ?? 0) + 1);
  const orderOf = new Map(cards.map((c) => [c.order_id, c.orders!]));
  const late = bags
    .map((b) => ({ b, o: orderOf.get(b.order_id), days: 0 }))
    .filter((x) => x.o)
    .map((x) => ({ ...x, days: bagPastDue({ dueDate: x.b.due_date, orderStatus: x.o!.status, openCards: openByBag.get(x.b.id) ?? 0 }, today) ?? 0 }))
    .filter((x) => x.days > 0);
  const lateIds = late.map((x) => x.b.id);
  let bagCards: { id: string; bag_id: string; completed: boolean | null; status: string | null }[] = [];
  let bagPlaces = new Map<string, string>();
  if (lateIds.length) {
    const [cardPages, placeIds] = await Promise.all([
      Promise.all(chunks(lateIds).map((ids) =>
        fetchAll<{ id: string; bag_id: string; completed: boolean | null; status: string | null }>((from, to) =>
          admin.from("cards").select("id, bag_id, completed, status").in("bag_id", ids).order("id").range(from, to)))),
      trackPlaces ? loadBagPlaceIds(admin, lateIds) : Promise.resolve(new Map<string, string>()),
    ]);
    bagCards = cardPages.flat();
    bagPlaces = placeIds;
  }
  const pastDue: PastDueBag[] = late.map(({ b, o, days }) => {
    const inBag = bagCards.filter((c) => c.bag_id === b.id && c.status !== "refunded");
    const placeId = bagPlaces.get(b.id);
    return {
      id: b.id,
      code: b.bag_code,
      tierName: tierDisplayName(b.tier, tierNames),
      orderId: b.order_id,
      orderNumber: o!.order_number,
      customer: o!.customer_name?.trim() || null,
      dueDate: b.due_date!,
      daysOverdue: days,
      cardCount: inBag.length,
      doneCount: inBag.filter((c) => c.completed).length,
      place: placeId ? placesLoad.places.get(placeId)?.name ?? null : null,
    };
  });

  // Most certain first; within a rule the longest waiting first
  const rank = (r: ForgottenRule) => FORGOTTEN_RULES.indexOf(r);
  items.sort((a, b) =>
    rank(a.rule) - rank(b.rule)
    || (a.reason.since && b.reason.since ? Date.parse(a.reason.since) - Date.parse(b.reason.since) : 0)
    || a.orderNumber.localeCompare(b.orderNumber)
    || (a.code ?? "").localeCompare(b.code ?? ""));
  pastDue.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code));

  const counts = {
    finished_not_done: 0, final_dry: 0, slot_idle: 0, stale: 0,
    pastDue: pastDue.length,
    badge: 0,
  };
  for (const i of items) {
    counts[i.rule]++;
    if (countsForBadge(i.rule)) counts.badge++;
  }
  return { cards: items, bags: pastDue, counts, trackPlaces, includeOlder, slotDays };
}

// ── The menu badge ─────────────────────────────────────────────────────────

/**
 * The "Check" menu badge: cards the report lists under (a) finished order,
 * card not done, and (b) at Final Dry / on the Done shelf for 3+ days, new
 * system only. Built to be cheap on every admin page: two head counts for
 * (a); for (b) the Final Dry stage events 3+ New York days old on open orders
 * and the cards sitting 3+ days in a Final Dry slot or on the Done place,
 * then one read of those few cards and their orders' stage events. 0 when
 * anything fails (the layout never waits on an error).
 */
export async function countForgottenCards(admin: SupabaseClient = createAdminClient(), now = Date.now()): Promise<number> {
  try {
    // The rule counts New York days: read a little wider (finalDryReadBefore)
    // and let finalDrySince() decide exactly, as the report does
    const cutoff = finalDryReadBefore(now);
    const finished = FINISHED_ORDER_STATUSES as string[];
    const liveCount = (select: string) =>
      admin.from("cards").select(select, { count: "exact", head: true })
        .not("completed", "is", true)
        .neq("status", "refunded")
        .eq("awaiting_arrival", false)
        .in("orders.status", finished);

    // (b) by place: cards not done sitting since before the cutoff in a Final Dry slot or on the Done place
    const placedSince = (kind: "station" | "done") => fetchAll((from, to) => {
      let q = admin.from("cards").select(`${CARD_SELECT}, location_id, located_at, locations!inner(kind, stage)`)
        .not("completed", "is", true).neq("status", "refunded").eq("awaiting_arrival", false)
        .in("orders.status", LIVE_IN_SHOP).lte("located_at", cutoff)
        .eq("locations.kind", kind);
      if (kind === "station") q = q.eq("locations.stage", FINAL_DRY_STAGE);
      return q.order("id").range(from, to);
    });

    const [a1, a2, fdEvents, placed] = await Promise.all([
      // (a) bagged cards (not Historical Order Setup bags) + cards of new orders in no bag
      liveCount("id, orders!inner(status), tier_bags!inner(source)").not("bag_id", "is", null).neq("tier_bags.source", "migration"),
      liveCount("id, orders!inner(status, created_at)").is("bag_id", null).gte("orders.created_at", INTAKE_START),
      // (b) by step: Final Dry events older than the cutoff on orders in the shop
      fetchAll<StageEventRow & { order_id: string }>((from, to) =>
        admin.from("order_events").select("order_id, event_type, description, metadata, created_at, orders!inner(status)")
          .eq("event_type", "stage_update").like("description", `Stage: ${FINAL_DRY_STAGE} [card:%`)
          .lte("created_at", cutoff).in("orders.status", LIVE_IN_SHOP)
          .order("id").range(from, to)),
      // (b) by place (nothing before the places tables exist)
      Promise.all([placedSince("station"), placedSince("done")]).then((p) => p.flat() as unknown as CardRow[]).catch(() => [] as CardRow[]),
    ]);
    if (a1.error || a2.error) throw new Error((a1.error ?? a2.error)!.message);

    const inScope = (c: CardRow) => inNewSystem({ inBag: !!c.bag_id, orderCreatedAt: c.orders?.created_at ?? null });
    type Placed = CardRow & { locations?: { kind: string; stage: string | null } | null };
    const placedLongEnough = (c: Placed) => !!c.locations && !!finalDrySince(
      { stage: null, stageSince: null, location: { kind: c.locations.kind, stage: c.locations.stage }, locatedAt: c.located_at ?? null }, now);
    const stuck = new Set((placed as Placed[]).filter((c) => inScope(c) && placedLongEnough(c)).map((c) => c.id));

    // Cards whose Final Dry event is old enough: still at Final Dry this round?
    const fdCardIds = [...new Set(fdEvents.map((e) => parseStageEvent(e)?.card_id).filter((id): id is string => !!id && !stuck.has(id)))];
    if (fdCardIds.length) {
      const fdOrders = [...new Set(fdEvents.map((e) => e.order_id))];
      const [cards, events] = await Promise.all([
        Promise.all(chunks(fdCardIds).map((ids) =>
          fetchAll((from, to) =>
            admin.from("cards").select(CARD_SELECT).in("id", ids).not("completed", "is", true)
              .neq("status", "refunded").eq("awaiting_arrival", false).in("orders.status", LIVE_IN_SHOP)
              .order("id").range(from, to)))).then((p) => p.flat() as unknown as CardRow[]),
        loadStageEvents(admin, fdOrders),
      ]);
      for (const c of cards) {
        if (!inScope(c)) continue;
        const st = cardStageState(c, events.get(c.id) ?? []);
        if (finalDrySince({ stage: st.current, stageSince: st.current ? st.updatedAt : null, location: null, locatedAt: null }, now)) stuck.add(c.id);
      }
    }
    return (a1.count ?? 0) + (a2.count ?? 0) + stuck.size;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingTracking({ message })) console.error("[forgotten] badge count failed:", message);
    return 0;
  }
}
