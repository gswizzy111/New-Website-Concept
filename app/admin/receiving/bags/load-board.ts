import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { parseStageEvent } from "@/lib/restoration-stages";
import { tierDisplayName } from "@/lib/intake/codes";
import { loadTierNames } from "@/lib/intake/data";
import { loadHolidays } from "@/lib/intake/due-dates";
import { cardStageState, keepsHistoricalCompletion, stageGroups } from "@/lib/intake/stage-plan";
import { byBagOrder, labelIsOutdated } from "@/lib/intake/views";
import { filingLetter } from "@/lib/intake/filing-letter";
import { bagPlaceText, isReadyToShipPlace } from "@/lib/intake/tracking/bag-home";
import { LOCATION_REF_COLUMNS } from "@/lib/intake/tracking/places";
import type { LocationRef } from "@/lib/intake/tracking/types";
import type { BagStageGroup, DueStatus, StageEventRow } from "@/lib/intake/types";
import { isMissingSchema } from "../_components/schema";

/**
 * The Bags board's data: every open tier bag of an order that isn't finished
 * (completed, shipped back, delivered) or cancelled, each one its own work
 * order, with its cards' steps and the order's other bags. Open: completed_at
 * null, or set but a card in the bag was reopened since somewhere that doesn't
 * refresh bags (the bag page clears it on its next load), as BagSummary.complete.
 * Also the finished bags waiting to ship ("Ready to ship", done flow Nov 25
 * 2026): every non-refunded card done, the order not shipped back,
 * delivered or cancelled (a Completed order's bags included), so staff see
 * what's in the bin and what still has to go in it.
 *
 * Reads only (no healing, no writes), all paged with fetchAll (1,000-row API
 * cap) and chunked by order so no "in" list grows past 100 ids:
 *   1. tier_bags + orders!inner, orders not shipped back, delivered or
 *      cancelled: open and done bags (the done ones are listed as "other
 *      bags in this order" and, finished, under Ready to ship)
 *   2. cards of those orders (order_id in chunk)
 *   3. order_events 'stage_update' of the board's orders (not Completed), newest first
 *   4. tier_bag_due_changes of those bags (best effort, for "label out of date")
 *   5. where each bag is (tier_bags.location_id and its place; best effort,
 *      so the board works before the card tracking update is applied)
 *   plus restoration_settings names and business_holidays.
 */

/** Orders whose bags are off the board (mirrors the Receiving page's label queue). */
const CLOSED_STATUSES = ["completed", "shipped_back", "delivered", "cancelled"];
/** Orders whose bags are gone or never go (read): a Completed order's finished bags still wait to ship. */
const GONE_STATUSES = "(shipped_back,delivered,cancelled)";
const CHUNK = 100;

const BAG_SELECT =
  "id, order_id, tier, batch, bag_code, received_on, due_date, due_status, completed_at, label_printed_at, source, created_at, orders!inner(order_number, customer_name, status)";
const CARD_SELECT = "id, order_id, bag_id, card_code, status, completed, completed_at, current_round, received_at, received_by";

type BagJoinRow = {
  id: string;
  order_id: string;
  tier: string;
  batch: number;
  bag_code: string;
  received_on: string | null;
  due_date: string | null;
  due_status: DueStatus;
  completed_at: string | null;
  label_printed_at: string | null;
  source: string | null;
  created_at: string;
  orders: { order_number: string; customer_name: string | null; status: string } | null;
};

type CardRow = {
  id: string;
  order_id: string;
  bag_id: string | null;
  card_code: string | null;
  status: string | null;
  completed: boolean | null;
  completed_at: string | null;
  current_round: number | null;
  received_at: string | null;
  received_by: string | null;
};

export type OtherBag = {
  id: string; code: string; tier: string; tierName: string; cardCount: number; done: boolean;
  /** Where the bag is ("Ready to ship"); null when not recorded. */
  place: string | null;
};

export type BoardBag = {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  tier: string;
  tierName: string;
  batch: number;
  code: string;
  receivedOn: string | null;
  dueDate: string | null;
  dueStatus: DueStatus;
  labelPrintedAt: string | null;
  /** Printed, then the due date changed or a card joined the bag: reprint it. */
  labelOutdated: boolean;
  /** Non-refunded cards in the bag. */
  cardCount: number;
  completedCount: number;
  /** Every card done but the bag not closed yet (it closes on the next order or Completed page load). */
  allCardsDone: boolean;
  /** Cards by step, in step order (not started first, done last). */
  stageGroups: BagStageGroup[];
  /** Card IDs in the bag, so a scanned card finds its bag. */
  cardCodes: string[];
  /** Where the bag is: "Open bags · R", "Shelf DUE MON DEC 7", "Ready to ship"; null when not recorded. */
  place: string | null;
  /** The order's other bags, open or done, in tier order. */
  otherBags: OtherBag[];
};

/**
 * A finished bag waiting to ship: every non-refunded card done (or a
 * historical bag kept complete), the order not shipped back, delivered or
 * cancelled. Not one of the board's open bags.
 */
export type ReadyBag = {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  tier: string;
  tierName: string;
  code: string;
  /** Non-refunded cards in the bag (all done). */
  cardCount: number;
  /** When the bag's last card was done (tier_bags.completed_at); null when not recorded. */
  finishedAt: string | null;
  /** Where the bag is: "Ready to ship", "Open bags · R", "Shelf DUE MON DEC 7"; null when not recorded. */
  place: string | null;
  /** In the Ready to ship bin (LOC-SHIP or any Shipping place). */
  inBin: boolean;
  /** Card IDs in the bag, so a scanned card finds its bag. */
  cardCodes: string[];
};

export type BoardLoad =
  | { ok: true; bags: BoardBag[]; ready: ReadyBag[]; holidays: Set<string>; tierNames: Record<string, string> }
  | { ok: false; missingSchema: boolean; error: string };

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Latest tier_bag_due_changes time per bag; none if it can't be read (as lib/intake/data.ts). */
async function dueChangeTimes(admin: SupabaseClient, bagIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = (await Promise.all(chunks(bagIds).map((ids) =>
      fetchAll<{ bag_id: string; created_at: string }>((from, to) =>
        admin.from("tier_bag_due_changes").select("bag_id, created_at").in("bag_id", ids).order("id").range(from, to))))).flat();
    for (const r of rows) {
      const seen = out.get(r.bag_id);
      if (!seen || Date.parse(r.created_at) > Date.parse(seen)) out.set(r.bag_id, r.created_at);
    }
  } catch (e) {
    console.warn("[intake] bags board: due changes not read:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** Each bag's place (tier_bags.location_id); empty when it can't be read (the tracking update not applied yet). */
async function bagLocations(admin: SupabaseClient, bagIds: string[]): Promise<Map<string, Pick<LocationRef, "code" | "kind" | "name">>> {
  const out = new Map<string, Pick<LocationRef, "code" | "kind" | "name">>();
  try {
    const rows = (await Promise.all(chunks(bagIds).map((ids) =>
      fetchAll<{ id: string; location_id: string | null }>((from, to) =>
        admin.from("tier_bags").select("id, location_id").in("id", ids).not("location_id", "is", null).order("id").range(from, to))))).flat();
    const placeIds = [...new Set(rows.map((r) => r.location_id).filter((id): id is string => !!id))];
    const places = (await Promise.all(chunks(placeIds).map(async (ids) => {
      const { data, error } = await admin.from("locations").select(LOCATION_REF_COLUMNS).in("id", ids);
      if (error) throw new Error(error.message);
      return (data ?? []) as (Pick<LocationRef, "id" | "code" | "kind" | "name">)[];
    }))).flat();
    const byId = new Map(places.map((p) => [p.id, p]));
    for (const r of rows) {
      const place = r.location_id ? byId.get(r.location_id) : undefined;
      if (place) out.set(r.id, place);
    }
  } catch (e) {
    console.warn("[intake] bags board: bag places not read:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** Not in the bin yet first (something to do), then the longest waiting, then by Bag ID. */
const byWaiting = (a: ReadyBag, b: ReadyBag) =>
  Number(a.inBin) - Number(b.inBin)
  || (a.finishedAt ?? "9999").localeCompare(b.finishedAt ?? "9999")
  || a.code.localeCompare(b.code);

const byDue = (a: BoardBag, b: BoardBag) => {
  // Bags whose cards are all done (closing on the next bag page load) after the
  // work; then overdue first (earliest due), then soonest; no due date last
  if (a.allCardsDone !== b.allCardsDone) return a.allCardsDone ? 1 : -1;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return (a.receivedOn ?? "9999").localeCompare(b.receivedOn ?? "9999") || a.code.localeCompare(b.code);
};

export async function loadBoard(admin: SupabaseClient): Promise<BoardLoad> {
  const settings = Promise.all([loadHolidays(admin), loadTierNames(admin)]);
  let bagRows: BagJoinRow[];
  try {
    // orders!inner is many-to-one: PostgREST returns one object (the select parser types it as a list)
    bagRows = (await fetchAll((from, to) =>
      admin.from("tier_bags").select(BAG_SELECT)
        .not("orders.status", "in", GONE_STATUSES)
        .order("id").range(from, to))) as unknown as BagJoinRow[];
  } catch (e) {
    await settings.catch(() => null);
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, missingSchema: isMissingSchema({ message: error }), error };
  }

  const rows = bagRows.filter((b) => b.orders);
  if (!rows.length) {
    const [holidays, tierNames] = await settings;
    return { ok: true, bags: [], ready: [], holidays, tierNames };
  }

  const orderIds = [...new Set(rows.map((b) => b.order_id))];
  // The board's own orders (not Completed): only their steps are shown
  const boardOrderIds = [...new Set(rows.filter((b) => !CLOSED_STATUSES.includes(b.orders!.status)).map((b) => b.order_id))];
  let cards: CardRow[];
  let events: StageEventRow[];
  let dueChanged: Map<string, string>;
  let places: Map<string, Pick<LocationRef, "code" | "kind" | "name">>;
  let holidays: Set<string>;
  let tierNames: Record<string, string>;
  try {
    const [cardPages, eventPages, changes, at, [h, names]] = await Promise.all([
      Promise.all(chunks(orderIds).map((ids) => fetchAll<CardRow>((from, to) =>
        admin.from("cards").select(CARD_SELECT).in("order_id", ids).order("id").range(from, to)))),
      // Newest first, as cardStageState wants; a card's events all sit in its order's chunk
      Promise.all(chunks(boardOrderIds).map((ids) => fetchAll<StageEventRow>((from, to) =>
        admin.from("order_events").select("event_type, description, metadata, created_at")
          .in("order_id", ids).eq("event_type", "stage_update")
          .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)))),
      dueChangeTimes(admin, rows.map((b) => b.id)),
      bagLocations(admin, rows.map((b) => b.id)),
      settings,
    ]);
    cards = cardPages.flat();
    events = eventPages.flat();
    dueChanged = changes;
    places = at;
    holidays = h;
    tierNames = names;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, missingSchema: isMissingSchema({ message: error }), error };
  }

  // Each card's stage events, newest first (the order they were read in)
  const eventsByCard = new Map<string, StageEventRow[]>();
  for (const e of events) {
    const cardId = parseStageEvent(e)?.card_id;
    if (!cardId) continue;
    const list = eventsByCard.get(cardId);
    if (list) list.push(e);
    else eventsByCard.set(cardId, [e]);
  }

  const liveByBag = new Map<string, CardRow[]>();
  for (const c of cards) {
    if (!c.bag_id || c.status === "refunded") continue;
    const list = liveByBag.get(c.bag_id);
    if (list) list.push(c);
    else liveByBag.set(c.bag_id, [c]);
  }

  const isOpen = (b: BagJoinRow) => !b.completed_at || (liveByBag.get(b.id) ?? []).some((c) => !c.completed);
  const onBoard = (b: BagJoinRow) => !CLOSED_STATUSES.includes(b.orders!.status);
  const open = rows.filter((b) => onBoard(b) && isOpen(b));
  const openIds = new Set(open.map((b) => b.id));
  // Finished, as the Ready to ship button checks it (putBagReadyToShip): every live card done, or a
  // historical bag kept complete; not one of the board's open rows (a bag not closed yet stays there)
  const finished = (b: BagJoinRow) => {
    const live = liveByBag.get(b.id) ?? [];
    if (!live.length) return false;
    return live.every((c) => c.completed) || (!!b.completed_at && keepsHistoricalCompletion(b, b.orders!.status));
  };

  const bagsByOrder = new Map<string, BagJoinRow[]>();
  for (const b of rows) {
    const list = bagsByOrder.get(b.order_id);
    if (list) list.push(b);
    else bagsByOrder.set(b.order_id, [b]);
  }

  const placeOf = (b: BagJoinRow, compact: boolean) => bagPlaceText(places.get(b.id), filingLetter(b.orders?.customer_name), compact);
  const bags: BoardBag[] = open.map((b) => {
    const live = liveByBag.get(b.id) ?? [];
    const withStage = live.map((c) => ({
      id: c.id,
      refunded: false,
      stage: cardStageState(c, eventsByCard.get(c.id) ?? []),
    }));
    const completedCount = live.filter((c) => c.completed).length;
    const others = (bagsByOrder.get(b.order_id) ?? [])
      .filter((o) => o.id !== b.id)
      .sort(byBagOrder)
      .map((o) => ({
        id: o.id,
        code: o.bag_code,
        tier: o.tier,
        tierName: tierDisplayName(o.tier, tierNames),
        cardCount: (liveByBag.get(o.id) ?? []).length,
        done: !isOpen(o),
        place: placeOf(o, false),
      }));
    return {
      id: b.id,
      orderId: b.order_id,
      orderNumber: b.orders!.order_number,
      customerName: b.orders!.customer_name?.trim() || null,
      tier: b.tier,
      tierName: tierDisplayName(b.tier, tierNames),
      batch: b.batch,
      code: b.bag_code,
      receivedOn: b.received_on,
      dueDate: b.due_date,
      dueStatus: b.due_status,
      labelPrintedAt: b.label_printed_at,
      labelOutdated: labelIsOutdated(b.label_printed_at, live.map((c) => c.received_at), dueChanged.get(b.id) ?? null),
      cardCount: live.length,
      completedCount,
      allCardsDone: live.length > 0 && completedCount === live.length,
      stageGroups: stageGroups(withStage),
      cardCodes: live.map((c) => c.card_code).filter((code): code is string => !!code),
      place: placeOf(b, true),
      otherBags: others,
    };
  });

  const ready: ReadyBag[] = rows.filter((b) => !openIds.has(b.id) && finished(b)).map((b) => {
    const live = liveByBag.get(b.id) ?? [];
    return {
      id: b.id,
      orderId: b.order_id,
      orderNumber: b.orders!.order_number,
      customerName: b.orders!.customer_name?.trim() || null,
      tier: b.tier,
      tierName: tierDisplayName(b.tier, tierNames),
      code: b.bag_code,
      cardCount: live.length,
      finishedAt: b.completed_at,
      place: placeOf(b, true),
      inBin: isReadyToShipPlace(places.get(b.id)),
      cardCodes: live.map((c) => c.card_code).filter((code): code is string => !!code),
    };
  });

  return { ok: true, bags: bags.sort(byDue), ready: ready.sort(byWaiting), holidays, tierNames };
}
