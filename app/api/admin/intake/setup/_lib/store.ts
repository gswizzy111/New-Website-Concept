import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { loadHolidays, loadTurnarounds } from "@/lib/intake/due-dates";
import { ensureCardCodes } from "@/lib/intake/receiving";
import { refreshBagCompletion } from "@/lib/intake/stages";
import {
  applyOrderSetup,
  FINISHED_EVENT_PREFIXES,
  planOrderSetup,
  RECEIVED_EVENT,
  SETUP_STATUSES,
  type ApplyResult,
  type OrderPlan,
  type PlanInput,
  type SetupBag,
  type SetupCard,
  type SetupOrder,
  type SetupStore,
} from "@/lib/intake/migration";

/**
 * Server side of the Historical Order Setup: reads every row a plan needs
 * (paged, never more than 1,000 rows per request) and writes plans through
 * guarded fills. Admin routes only (they check requireAdmin / isAdmin).
 */

export const SETUP_ORDER_COLUMNS = "id, order_number, status, inbound_method, created_at, restoration_tier, customer_name, customer_email";
const CARD_COLUMNS =
  "id, order_id, created_at, tier, card_name, card_set, card_number, photo_urls, receiving_photo_urls, catalog_image_url, completed, completed_at, status, card_seq, card_code, bag_id, received_at, awaiting_arrival";
const BAG_COLUMNS = "id, order_id, tier, batch, bag_code, received_on, due_date, due_status, turnaround_days, completed_at, source";

export type SetupOrderRow = SetupOrder & { customer_name: string | null; customer_email: string | null };
type CardRow = SetupCard & { order_id: string };
type BagRow = SetupBag & { order_id: string };
type EventRow = { order_id: string; description: string | null; created_at: string };

export type SetupData = {
  orders: SetupOrderRow[];
  inputs: Map<string, PlanInput>;
};

/** True when a Supabase error means the intake migration isn't applied yet. */
export function isMissingIntakeTables(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /(tier_bags|card_code|card_seq|bag_id|received_at|awaiting_arrival|receiving_photo_urls|business_holidays)/.test(error.message ?? "")
    && /(does not exist|could not find|schema cache)/i.test(error.message ?? "");
}

export class MissingTablesError extends Error {
  constructor() {
    super("The intake database update (supabase/migrations/20261123_intake_tracking.sql) isn't applied yet.");
  }
}

export const MISSING_TABLES_NOTICE =
  "The intake database update (supabase/migrations/20261123_intake_tracking.sql) isn't applied yet, so orders can't be set up. Apply it, then reload this page.";

/** Are the new tables and columns there? (one cheap read of each) */
export async function intakeTablesReady(admin: SupabaseClient): Promise<boolean> {
  const [bags, cards] = await Promise.all([
    admin.from("tier_bags").select("id, source, completion_seen_at").limit(1),
    admin.from("cards").select("id, card_seq, card_code, bag_id, received_at, awaiting_arrival, receiving_photo_urls").limit(1),
  ]);
  if (isMissingIntakeTables(bags.error) || isMissingIntakeTables(cards.error)) return false;
  if (bags.error) throw new Error(bags.error.message);
  if (cards.error) throw new Error(cards.error.message);
  return true;
}

function rethrow(error: { code?: string; message: string }, what: string): never {
  if (isMissingIntakeTables(error)) throw new MissingTablesError();
  throw new Error(`Couldn't read ${what}: ${error.message}`);
}

const CHUNK = 100;
function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Every row of a query, 1,000 at a time; a missing table becomes MissingTablesError. */
function paged<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> {
  return fetchAll<T>(async (from, to) => {
    const res = await page(from, to);
    if (res.error) rethrow(res.error, what);
    return res;
  });
}

const isFinishedEvent = (d: string | null) => !!d && FINISHED_EVENT_PREFIXES.some((p) => d.startsWith(p));

/**
 * Everything planOrderSetup needs, for every order the setup works on
 * (`all`) or for the given orders (any status: the plan says why one isn't
 * eligible). Orders are returned newest first.
 */
export async function loadSetupData(admin: SupabaseClient, scope: { all: true } | { orderIds: string[] }): Promise<SetupData> {
  const statuses = [...SETUP_STATUSES];
  let orders: SetupOrderRow[];
  let cards: CardRow[];
  let bags: BagRow[];
  let events: EventRow[];

  if ("all" in scope) {
    [orders, cards, bags, events] = await Promise.all([
      paged<SetupOrderRow>("orders", (from, to) =>
        admin.from("orders").select(SETUP_ORDER_COLUMNS).in("status", statuses).order("id").range(from, to)),
      paged<CardRow & { orders?: unknown }>("cards", (from, to) =>
        admin.from("cards").select(`${CARD_COLUMNS}, orders!inner(status)`).in("orders.status", statuses).order("id").range(from, to)),
      paged<BagRow>("bags", (from, to) => admin.from("tier_bags").select(BAG_COLUMNS).order("id").range(from, to)),
      Promise.all([
        paged<EventRow>("order events", (from, to) =>
          admin.from("order_events").select("order_id, description, created_at").eq("description", RECEIVED_EVENT).order("id").range(from, to)),
        ...FINISHED_EVENT_PREFIXES.map((prefix) =>
          paged<EventRow>("order events", (from, to) =>
            admin.from("order_events").select("order_id, description, created_at")
              .eq("event_type", "status_updated").like("description", `${prefix}%`).order("id").range(from, to))),
      ]).then((lists) => lists.flat()),
    ]);
  } else {
    const ids = [...new Set(scope.orderIds)];
    const parts = await mapLimit(chunks(ids), 4, (chunk) => Promise.all([
      paged<SetupOrderRow>("orders", (from, to) => admin.from("orders").select(SETUP_ORDER_COLUMNS).in("id", chunk).order("id").range(from, to)),
      paged<CardRow>("cards", (from, to) => admin.from("cards").select(CARD_COLUMNS).in("order_id", chunk).order("id").range(from, to)),
      paged<BagRow>("bags", (from, to) => admin.from("tier_bags").select(BAG_COLUMNS).in("order_id", chunk).order("id").range(from, to)),
      paged<EventRow>("order events", (from, to) =>
        admin.from("order_events").select("order_id, description, created_at")
          .in("order_id", chunk).eq("event_type", "status_updated").order("id").range(from, to)),
    ]));
    orders = parts.flatMap((p) => p[0]);
    cards = parts.flatMap((p) => p[1]);
    bags = parts.flatMap((p) => p[2]);
    events = parts.flatMap((p) => p[3]);
  }

  const [holidays, turnaroundMaxDays] = await Promise.all([loadHolidays(admin), loadTurnarounds(admin)]);

  const group = <T extends { order_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.order_id, [...(m.get(r.order_id) ?? []), r]);
    return m;
  };
  const cardsBy = group(cards.map((c) => {
    const row = { ...c } as CardRow & { orders?: unknown };
    delete row.orders;
    return row;
  }));
  const bagsBy = group(bags);
  const firstReceived = new Map<string, string>();
  const firstFinished = new Map<string, string>();
  for (const e of events) {
    const target = e.description === RECEIVED_EVENT ? firstReceived : isFinishedEvent(e.description) ? firstFinished : null;
    if (!target) continue;
    const prev = target.get(e.order_id);
    if (!prev || Date.parse(e.created_at) < Date.parse(prev)) target.set(e.order_id, e.created_at);
  }

  orders.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : 1));
  const inputs = new Map<string, PlanInput>();
  for (const o of orders) {
    inputs.set(o.id, {
      order: o,
      cards: cardsBy.get(o.id) ?? [],
      bags: bagsBy.get(o.id) ?? [],
      receivedEventAt: firstReceived.get(o.id) ?? null,
      finishedEventAt: firstFinished.get(o.id) ?? null,
      holidays,
      turnaroundMaxDays,
    });
  }
  return { orders, inputs };
}

/** The setup's writes on the real database: each one only fills empty fields. */
export function supabaseSetupStore(admin: SupabaseClient): SetupStore {
  return {
    async ensureCardCodes(orderId) {
      // How many get a number now (ensureCardCodes returns every code of the order)
      const { data: before, error } = await admin.from("cards").select("id").eq("order_id", orderId).is("card_seq", null);
      if (error) throw new Error(`Couldn't read the cards: ${error.message}`);
      if (!before?.length) return 0;
      const codes = await ensureCardCodes(admin, orderId);
      return before.filter((c) => codes.has(c.id as string)).length;
    },

    async createBag(row) {
      // insert ... on conflict (order_id, tier, batch) do nothing
      const { data, error } = await admin.from("tier_bags")
        .upsert(row, { onConflict: "order_id,tier,batch", ignoreDuplicates: true })
        .select("id");
      if (error) {
        if (error.code === "23505") throw new Error(`Bag ID ${row.bag_code} is already taken by another bag.`);
        throw new Error(`Couldn't create bag ${row.bag_code}: ${error.message}`);
      }
      if (data && data.length > 0) return { id: data[0].id as string, created: true };
      const { data: existing, error: readErr } = await admin.from("tier_bags").select("id")
        .eq("order_id", row.order_id).eq("tier", row.tier).eq("batch", row.batch).maybeSingle();
      if (readErr || !existing) throw new Error(`Couldn't read bag ${row.bag_code}: ${readErr?.message ?? "not found"}`);
      return { id: existing.id as string, created: false };
    },

    async linkCards(bagId, cardIds) {
      if (cardIds.length === 0) return 0;
      const { data, error } = await admin.from("cards").update({ bag_id: bagId }).in("id", cardIds).is("bag_id", null).select("id");
      if (error) throw new Error(`Couldn't put cards in their bag: ${error.message}`);
      return data?.length ?? 0;
    },

    async fillReceivedAt(cardIds, at) {
      if (cardIds.length === 0) return 0;
      const { data, error } = await admin.from("cards").update({ received_at: at }).in("id", cardIds).is("received_at", null).select("id");
      if (error) throw new Error(`Couldn't save the cards' received time: ${error.message}`);
      return data?.length ?? 0;
    },

    async fillBag(fill, seenAt) {
      if (fill.receivedOn) {
        const { error } = await admin.from("tier_bags").update({ received_on: fill.receivedOn }).eq("id", fill.bagId).is("received_on", null);
        if (error) throw new Error(`Couldn't save the received date of ${fill.bagCode}: ${error.message}`);
      }
      if (fill.dueStatus) {
        const { error } = await admin.from("tier_bags")
          .update({ due_date: fill.dueDate ?? null, due_status: fill.dueStatus, turnaround_days: fill.turnaroundDays ?? null })
          .eq("id", fill.bagId).is("due_date", null).in("due_status", ["missing_received_date", "pending"]);
        if (error) throw new Error(`Couldn't save the due date of ${fill.bagCode}: ${error.message}`);
      }
      if (fill.completedAt) {
        const { error } = await admin.from("tier_bags")
          .update({ completed_at: fill.completedAt, completion_seen_at: seenAt })
          .eq("id", fill.bagId).is("completed_at", null);
        if (error) throw new Error(`Couldn't mark ${fill.bagCode} completed: ${error.message}`);
      }
    },

    async refreshBagCompletion(bagIds) {
      await refreshBagCompletion(admin, bagIds);
    },

    async logSetup(orderId, description, metadata) {
      const { error } = await admin.from("order_events").insert({
        order_id: orderId,
        event_type: "intake_setup",
        description,
        metadata,
        is_customer_visible: false,
      });
      // The work is done; a missing activity line shouldn't turn it into an error
      if (error) console.error("[intake setup] activity not logged:", error.message);
    },
  };
}

export type RunOutcome = {
  orderId: string;
  orderNumber: string | null;
  outcome: "ok" | "skipped" | "error";
  message: string;
  changes: ApplyResult | null;
  missingImages: number;
  missingTiers: number;
  missingReceivedDate: boolean;
};

function describe(r: ApplyResult): string {
  const parts: string[] = [];
  if (r.cardCodes) parts.push(`${r.cardCodes} Card ID${r.cardCodes === 1 ? "" : "s"}`);
  if (r.bagsCreated.length) parts.push(`bag${r.bagsCreated.length === 1 ? "" : "s"} ${r.bagsCreated.join(", ")}`);
  if (r.cardsLinked) parts.push(`${r.cardsLinked} card${r.cardsLinked === 1 ? "" : "s"} bagged`);
  if (r.receivedAtSet) parts.push(`received date on ${r.receivedAtSet} card${r.receivedAtSet === 1 ? "" : "s"}`);
  if (r.bagsFilled) parts.push(`${r.bagsFilled} bag${r.bagsFilled === 1 ? "" : "s"} updated`);
  return parts.length ? parts.join(", ") : "Already set up";
}

/** Set up one order from its plan; never throws. */
export async function runPlan(plan: OrderPlan, store: SetupStore, by: string | null): Promise<RunOutcome> {
  const base = {
    orderId: plan.orderId,
    orderNumber: plan.orderNumber,
    changes: null,
    missingImages: plan.missingImages.length,
    missingTiers: plan.missingTiers.length,
    missingReceivedDate: plan.missingReceivedDate,
  };
  if (!plan.eligible) return { ...base, outcome: "skipped", message: plan.ineligibleReason ?? "Not eligible" };
  if (plan.errors.length > 0) return { ...base, outcome: "error", message: plan.errors.join(" ") };
  if (plan.alreadySetUp) return { ...base, outcome: "skipped", message: "Already set up" };
  try {
    const changes = await applyOrderSetup(plan, store, by);
    const total = changes.cardCodes + changes.bagsCreated.length + changes.cardsLinked + changes.receivedAtSet + changes.bagsFilled;
    // Someone else (another tab, Receiving) did it first
    if (total === 0) return { ...base, changes, outcome: "skipped", message: "Already set up" };
    return { ...base, changes, outcome: "ok", message: describe(changes) };
  } catch (e) {
    return { ...base, outcome: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Run `fn` over `items`, at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** Plan every order in `data`. */
export function planAll(data: SetupData): OrderPlan[] {
  return data.orders.map((o) => planOrderSetup(data.inputs.get(o.id)!));
}
