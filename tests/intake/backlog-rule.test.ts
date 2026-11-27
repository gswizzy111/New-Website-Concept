/**
 * The backlog rule (supabase/migrations/20261127_backlog_restoration_only.sql):
 * restoration cards we've received and haven't finished, in paid orders that
 * are Cards Received or In Progress. Runs the real migrations in PGlite
 * (in-memory Postgres): the minimal tables they read, then
 * 20261023_dashboard_metrics.sql, 20261123_intake_tracking.sql and the new
 * file twice (it must be rerunnable). Also checks that the SQL "added after the
 * order arrived" rule agrees with the intake code it mirrors
 * (lib/intake/prepare-labels.ts arrivedBy / inShopSetupPlan), and the loader's
 * defaults (lib/dashboard-metrics.ts).
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PlanInput, SetupCard } from "@/lib/intake/migration";
import { normalizeBacklogDay, normalizeBacklogNow } from "@/lib/dashboard-metrics";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const sqlFile = (name: string) => readFileSync(path.join(MIGRATIONS, name), "utf8");
const NEW_MIGRATION = "20261127_backlog_restoration_only.sql";

// The columns the backlog functions and the two earlier migrations read
const SCHEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create or replace function forbid_change() returns trigger language plpgsql as $$ begin raise exception 'rows here never change'; end $$;
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  status text not null,
  payment_status text not null default 'paid' check (payment_status in ('pending', 'paid', 'refunded', 'failed')),
  restoration_tier text,
  inbound_method text,
  total_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table cards (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  card_name text,
  tier text,
  status text default 'active',
  completed boolean not null default false,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);
create table order_services (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  service_id text,
  service_name text,
  quantity integer not null default 1
);
create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  event_type text not null,
  description text,
  created_at timestamptz not null default now()
);
create table shop_orders (id uuid primary key default gen_random_uuid(), total_cents integer not null default 0, created_at timestamptz not null default now());
create table show_dropoffs (id uuid primary key default gen_random_uuid(), order_id uuid, created_at timestamptz not null default now());
`;

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<T>(sql, params)).rows[0];
const json = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await one<{ j: T }>(sql, params)).j;

type Now = { total: number; orders: number; unknown_orders: number; prep: number; prep_cards: number; prep_orders: number; not_received: number; rule: string };
type Day = { day: string; total: number; orders: number; prep: number; prep_cards: number; added: number; completed: number; rule: string };

before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(sqlFile("20261023_dashboard_metrics.sql"));
  await db.exec(sqlFile("20261123_intake_tracking.sql"));
  await db.exec(sqlFile(NEW_MIGRATION));
  await db.exec(sqlFile(NEW_MIGRATION)); // rerunnable
});

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Noon in New York, `daysAgo` days before today (New York), as SQL. */
const noon = (daysAgo: number, plusMinutes = 0) =>
  `(et_day_start((now() at time zone 'America/New_York')::date - ${daysAgo}) + interval '12 hours' + interval '${plusMinutes} minutes')`;

async function order(o: { number: string; status: string; tier?: string | null; payment?: string; inbound?: string; createdDaysAgo?: number }): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into orders (order_number, status, payment_status, restoration_tier, inbound_method, created_at)
     values ($1, $2, $3, $4, $5, ${noon(o.createdDaysAgo ?? 20)}) returning id`,
    [o.number, o.status, o.payment ?? "paid", o.tier ?? null, o.inbound ?? "self_ship"],
  );
  return r.id;
}

async function card(orderId: string, c: { tier?: string | null; completed?: boolean; status?: string; awaiting?: boolean; createdDaysAgo?: number; createdMinutes?: number; receivedDaysAgo?: number } = {}): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into cards (order_id, tier, completed, status, awaiting_arrival, created_at, received_at)
     values ($1, $2, $3, $4, $5, ${noon(c.createdDaysAgo ?? 20, c.createdMinutes ?? 0)}, ${c.receivedDaysAgo == null ? "null" : noon(c.receivedDaysAgo)}) returning id`,
    [orderId, c.tier ?? null, c.completed ?? false, c.status ?? "active", c.awaiting ?? false],
  );
  return r.id;
}

async function receivedEvent(orderId: string, daysAgo: number) {
  await db.query(`insert into order_events (order_id, event_type, description, created_at) values ($1, 'status_updated', 'Status updated to: Cards Received', ${noon(daysAgo)})`, [orderId]);
}

const backlogNow = () => json<Now>(`select backlog_now() j`);
const todayRow = async () => (await json<Day[]>(`select backlog_compute((now() at time zone 'America/New_York')::date, (now() at time zone 'America/New_York')::date) j`))[0];

/** Starts each scenario from an empty database (backlog_events is insert-only: its guard is lifted for the reset). */
async function reset() {
  await db.exec(`
    alter table backlog_events disable trigger backlog_events_immutable;
    delete from backlog_events; delete from backlog_daily; delete from refunds;
    delete from cards; delete from order_services; delete from order_events; delete from show_dropoffs; delete from orders;
    alter table backlog_events enable trigger backlog_events_immutable;
    update metrics_settings set value_ts = now() - interval '30 days' where key = 'backlog_tracking_start';
  `);
}

// ── Today's number ──────────────────────────────────────────────────────────

test("backlog_now: restoration cards received and unfinished; prep, unreceived, done, refunded and closed orders stay out", async () => {
  await reset();
  // Counted: 2 cards
  const a = await order({ number: "CD-1", status: "received", tier: "regular" });
  await receivedEvent(a, 10);
  await card(a); await card(a);
  // A done card and a refunded card in an open order: out
  await card(a, { completed: true });
  await card(a, { status: "refunded" });
  // PSA Prep order: out of the total, in prep_cards
  const p = await order({ number: "CD-2", status: "in_progress", tier: "prep_standard" });
  await card(p); await card(p); await card(p);
  // Mixed order (no order tier): only its restoration cards count
  const m = await order({ number: "CD-3", status: "in_progress" });
  await card(m, { tier: "prep" }); await card(m, { tier: "premium" }); await card(m, { tier: "expedited" });
  // Prep order with one restoration card: that card counts
  const pm = await order({ number: "CD-4", status: "received", tier: "prep" });
  await card(pm); await card(pm, { tier: "regular" });
  // Completed, shipped back and awaiting-cards orders with unticked cards: out
  for (const status of ["completed", "shipped_back", "delivered", "awaiting_cards", "cancelled"]) {
    const o = await order({ number: `CD-${status}`, status });
    await card(o);
  }
  // Not paid, and refunded in full: out
  const unpaid = await order({ number: "CD-5", status: "received", payment: "pending" });
  await card(unpaid);
  const refunded = await order({ number: "CD-6", status: "in_progress", payment: "refunded" });
  await card(refunded);
  // Not received: flagged awaiting arrival, and added after the order arrived (no bag, no received_at)
  const r = await order({ number: "CD-7", status: "received", tier: "elite" });
  await receivedEvent(r, 10);
  await card(r, { createdDaysAgo: 12 });                     // here
  await card(r, { createdDaysAgo: 12, awaiting: true });     // awaiting arrival
  await card(r, { createdDaysAgo: 3 });                      // added after arrival, not received
  await card(r, { createdDaysAgo: 3, receivedDaysAgo: 1 });  // added after arrival, received since
  // Prep by its service lines (May 2026 orders without a tier)
  const lines = await order({ number: "CD-8", status: "received" });
  await db.query(`insert into order_services (order_id, service_name, quantity) values ($1, 'PSA Prep', 2)`, [lines]);
  await card(lines); await card(lines);
  // Manual orders without card rows: counted by quantity, or unknown
  const qty = await order({ number: "CD-9", status: "in_progress" });
  await db.query(`insert into order_services (order_id, service_id, service_name, quantity) values ($1, 'restoration', 'Card Restoration', 4)`, [qty]);
  await order({ number: "CD-10", status: "received" });

  const now = await backlogNow();
  assert.equal(now.rule, "restoration_received");
  // 2 (CD-1) + 2 (CD-3) + 1 (CD-4) + 2 (CD-7: the one here, the one received later) + 4 (CD-9 by quantity)
  assert.equal(now.total, 11);
  assert.equal(now.orders, 5);
  assert.equal(now.unknown_orders, 1);
  assert.equal(now.prep, 0, "prep means 'of which PSA Prep': nothing now");
  // 3 (CD-2) + 1 (CD-3) + 1 (CD-4) + 2 (CD-8)
  assert.equal(now.prep_cards, 7);
  assert.equal(now.prep_orders, 4);
  assert.equal(now.not_received, 2);

  // Today's row of the history says the same
  const row = await todayRow();
  assert.equal(row.total, now.total);
  assert.equal(row.prep_cards, now.prep_cards);
  assert.equal(row.orders, now.orders);
  assert.equal(row.prep, 0);
  assert.equal(row.rule, "restoration_received");
});

test("backlog_now: a drop-off's cards typed in with the order are here; a card added hours later isn't until received", async () => {
  await reset();
  const d = await order({ number: "CD-20", status: "received", inbound: "dropoff", createdDaysAgo: 5 });
  await card(d, { createdDaysAgo: 5, createdMinutes: 30 });       // within the hour: typed in with it
  await card(d, { createdDaysAgo: 5, createdMinutes: 180 });      // same day, after the hour: added later
  await card(d, { createdDaysAgo: 4 });                           // a later day
  // A show drop-off form handed over the day before the order was entered: the entry (plus an hour) still counts
  const s = await order({ number: "CD-21", status: "in_progress", inbound: "dropoff", createdDaysAgo: 3 });
  await db.query(`insert into show_dropoffs (order_id, created_at) values ($1, ${noon(4)})`, [s]);
  await card(s, { createdDaysAgo: 3, createdMinutes: 10 });
  // An order with no recorded arrival at all: every card counts
  const n = await order({ number: "CD-22", status: "in_progress", createdDaysAgo: 9 });
  await card(n, { createdDaysAgo: 9 }); await card(n, { createdDaysAgo: 1 });

  const now = await backlogNow();
  assert.equal(now.total, 4);
  assert.equal(now.not_received, 2);
  assert.equal((await todayRow()).total, 4);
});

// ── History ─────────────────────────────────────────────────────────────────

test("backlog_compute: prep and not-yet-received cards are out of every day; a late card enters when received", async () => {
  await reset();
  // Events written by hand at past times (the triggers would stamp them now)
  await db.exec(`alter table orders disable trigger orders_backlog_history; alter table cards disable trigger cards_backlog_history;`);
  const a = await order({ number: "CD-30", status: "received", tier: "regular", createdDaysAgo: 9 });
  const c1 = await card(a, { createdDaysAgo: 9 });
  const c2 = await card(a, { createdDaysAgo: 5, receivedDaysAgo: 2 });   // added after arrival, received 2 days ago
  const c3 = await card(a, { createdDaysAgo: 4 });                       // added after arrival, still not here
  const p = await order({ number: "CD-31", status: "received", tier: "prep", createdDaysAgo: 9 });
  const p1 = await card(p, { createdDaysAgo: 9 });
  await receivedEvent(a, 8);
  await receivedEvent(p, 8);
  await db.exec(`alter table orders enable trigger orders_backlog_history; alter table cards enable trigger cards_backlog_history;`);
  await db.query(
    `insert into backlog_events (at, order_id, card_id, event, status, card_created_at) values
      (${noon(9)}, $1, null, 'order_status', 'awaiting_cards', null),
      (${noon(9)}, $1, $3, 'card_added', null, ${noon(9)}),
      (${noon(8)}, $1, null, 'order_status', 'received', null),
      (${noon(5)}, $1, $4, 'card_added', null, ${noon(5)}),
      (${noon(4)}, $1, $5, 'card_added', null, ${noon(4)}),
      (${noon(9)}, $2, null, 'order_status', 'awaiting_cards', null),
      (${noon(9)}, $2, $6, 'card_added', null, ${noon(9)}),
      (${noon(8)}, $2, null, 'order_status', 'received', null),
      (${noon(1)}, $1, $3, 'card_completed', null, ${noon(9)})`,
    [a, p, c1, c2, c3, p1],
  );
  await db.query(`update cards set completed = true where id = $1`, [c1]); // logs card_completed now too: harmless (already done)

  const days = await json<Day[]>(`select backlog_compute((now() at time zone 'America/New_York')::date - 9, (now() at time zone 'America/New_York')::date) j`);
  const at = (daysAgo: number) => days[days.length - 1 - daysAgo];
  assert.equal(days.length, 10);
  assert.deepEqual([at(9).total, at(9).prep_cards], [0, 0], "nine days ago: not received yet");
  assert.deepEqual([at(8).total, at(8).orders, at(8).prep_cards, at(8).added], [1, 1, 1, 1], "received: c1 in, p1 only in prep_cards");
  assert.deepEqual([at(5).total, at(5).added], [1, 0], "c2 added after arrival: not here yet");
  assert.deepEqual([at(4).total, at(4).added], [1, 0], "c3 added after arrival: not here");
  assert.deepEqual([at(2).total, at(2).added], [2, 1], "c2 received");
  assert.deepEqual([at(1).total, at(1).completed], [1, 1], "c1 ticked done");
  assert.equal(at(0).total, 1);
  assert.ok(days.every((d) => d.prep === 0 && d.rule === "restoration_received"));
  const now = await backlogNow();
  assert.deepEqual([now.total, now.prep_cards, now.not_received], [at(0).total, at(0).prep_cards, 1]);
});

test("backlog_compute: an order refunded in full leaves when it was refunded", async () => {
  await reset();
  await db.exec(`alter table orders disable trigger orders_backlog_history; alter table cards disable trigger cards_backlog_history;`);
  const a = await order({ number: "CD-40", status: "in_progress", payment: "refunded", tier: "premium", createdDaysAgo: 6 });
  const c = await card(a, { createdDaysAgo: 6 });
  await db.exec(`alter table orders enable trigger orders_backlog_history; alter table cards enable trigger cards_backlog_history;`);
  await db.query(
    `insert into backlog_events (at, order_id, card_id, event, status, card_created_at) values
      (${noon(6)}, $1, null, 'order_status', 'received', null),
      (${noon(6)}, $1, $2, 'card_added', null, ${noon(6)})`,
    [a, c],
  );
  await db.query(
    `insert into refunds (stripe_refund_id, amount_cents, status, refunded_at, order_id, kind) values ('re_1', 1000, 'succeeded', ${noon(3)}, $1, 'restoration')`,
    [a],
  );
  const days = await json<Day[]>(`select backlog_compute((now() at time zone 'America/New_York')::date - 6, (now() at time zone 'America/New_York')::date) j`);
  assert.deepEqual(days.map((d) => d.total), [1, 1, 1, 0, 0, 0, 0]);
  assert.equal((await backlogNow()).total, 0);
});

// ── Saved days ──────────────────────────────────────────────────────────────

test("backlog_report: rows saved under the earlier rule are recomputed and kept in previous_rule_data; the migration reruns cleanly", async () => {
  await reset();
  const a = await order({ number: "CD-50", status: "received", tier: "prep" });
  await card(a);
  const old = { day: "x", total: 99, prep: 40, quality: "recorded" };
  await db.query(
    `insert into backlog_daily (day, data) values
      ((now() at time zone 'America/New_York')::date - 3, $1::jsonb),
      ((now() at time zone 'America/New_York')::date - 2, $1::jsonb)`,
    [JSON.stringify(old)],
  );
  await db.exec(sqlFile(NEW_MIGRATION)); // recomputes the two old rows
  const rows = (await db.query<{ data: Day; previous_rule_data: typeof old | null }>(
    `select data, previous_rule_data from backlog_daily order by day`)).rows;
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(r.data.rule, "restoration_received");
  assert.deepEqual(rows.slice(0, 2).map((r) => r.previous_rule_data), [old, old], "the earlier rows are kept");
  const stamps = (await db.query<{ computed_at: string }>(`select computed_at::text from backlog_daily order by day`)).rows;

  await db.exec(sqlFile(NEW_MIGRATION)); // nothing left to recompute
  const again = (await db.query<{ computed_at: string; previous_rule_data: unknown }>(`select computed_at::text, previous_rule_data from backlog_daily order by day`)).rows;
  assert.deepEqual(again.map((r) => r.computed_at), stamps.map((r) => r.computed_at));
  assert.deepEqual(again.slice(0, 2).map((r) => r.previous_rule_data), [old, old]);

  // backlog_report returns current-rule rows only, and today's live row
  const report = await json<Day[]>(`select backlog_report((now() at time zone 'America/New_York')::date - 3, (now() at time zone 'America/New_York')::date) j`);
  assert.equal(report.length, 4);
  assert.ok(report.every((d) => d.rule === "restoration_received" && d.total === 0));
});

test("search_path is set on every function the migration makes", async () => {
  const rows = (await db.query<{ proname: string; proconfig: string[] | null }>(
    `select proname, proconfig from pg_proc where proname in ('backlog_now', 'backlog_report', 'backlog_compute', 'card_effective_tier', 'card_service', 'order_arrival', 'card_added_after_arrival')`)).rows;
  assert.equal(rows.length, 7);
  for (const r of rows) assert.deepEqual(r.proconfig, ["search_path=public"], r.proname);
});

// ── Same rule as the intake code ────────────────────────────────────────────

test("order_arrival + card_added_after_arrival agree with lib/intake/prepare-labels.ts (arrivedBy, inShopSetupPlan)", async () => {
  const pure = await import("@/lib/intake/prepare-labels");
  type Case = { name: string; inbound: string; created: string; event?: string; dropoff?: string; firstBag?: string; cards: string[]; late: number };
  const cases: Case[] = [
    { name: "event", inbound: "self_ship", created: "2026-11-01T15:00:00Z", event: "2026-11-05T15:00:00Z",
      cards: ["2026-11-01T15:01:00Z", "2026-11-05T14:59:59Z", "2026-11-05T15:00:01Z", "2026-11-09T15:00:00Z"], late: 2 },
    { name: "drop-off, no form", inbound: "dropoff", created: "2026-11-10T20:00:00Z",
      cards: ["2026-11-10T20:30:00Z", "2026-11-10T21:00:01Z", "2026-11-11T04:30:00Z", "2026-11-11T05:30:00Z"], late: 3 },
    { name: "drop-off, form the day before", inbound: "dropoff", created: "2026-11-12T16:00:00Z", dropoff: "2026-11-11T16:00:00Z",
      cards: ["2026-11-12T16:20:00Z", "2026-11-12T17:30:00Z", "2026-11-13T16:00:00Z"], late: 2 },
    { name: "late night drop-off (the hour crosses midnight)", inbound: "dropoff", created: "2026-11-14T04:30:00Z",
      // 05:15Z is inside the hour but on the next New York day: late by the day rule (planOrderSetup's addedLater)
      cards: ["2026-11-14T04:45:00Z", "2026-11-14T05:15:00Z", "2026-11-14T05:45:00Z"], late: 2 },
    { name: "first bag only", inbound: "self_ship", created: "2026-11-02T15:00:00Z", firstBag: "2026-11-20T15:00:00Z",
      cards: ["2026-11-02T15:00:00Z", "2026-11-20T16:00:00Z"], late: 1 },
    { name: "nothing on record", inbound: "self_ship", created: "2026-11-02T15:00:00Z", cards: ["2026-11-03T15:00:00Z", "2026-11-25T15:00:00Z"], late: 0 },
  ];
  for (const c of cases) {
    await reset();
    const id = (await one<{ id: string }>(
      `insert into orders (order_number, status, inbound_method, created_at) values ($1, 'received', $2, $3) returning id`,
      ["CD-60", c.inbound, c.created])).id;
    if (c.event) await db.query(`insert into order_events (order_id, event_type, description, created_at) values ($1, 'status_updated', 'Status updated to: Cards Received', $2)`, [id, c.event]);
    if (c.dropoff) await db.query(`insert into show_dropoffs (order_id, created_at) values ($1, $2)`, [id, c.dropoff]);
    if (c.firstBag) await db.query(`insert into tier_bags (order_id, tier, bag_code, created_at) values ($1, 'regular', 'CD-60-B', $2)`, [id, c.firstBag]);
    const ids: string[] = [];
    for (const t of c.cards) ids.push((await one<{ id: string }>(`insert into cards (order_id, tier, created_at) values ($1, 'regular', $2) returning id`, [id, t])).id);

    const sql = await one<{ arrived_by: string | null }>(`select (select arrived_by from order_arrival($1))::text arrived_by`, [id]);
    const lateSql = new Set((await db.query<{ id: string }>(
      `select c.id from cards c cross join lateral order_arrival(c.order_id) a
       where c.order_id = $1 and card_added_after_arrival(c.created_at, a.arrived_by, a.known_by)`, [id])).rows.map((r) => r.id));

    const setup: PlanInput = {
      order: { id, order_number: "CD-60", status: "received", inbound_method: c.inbound, created_at: c.created, restoration_tier: null },
      cards: c.cards.map((t, i): SetupCard => ({
        id: ids[i], created_at: t, tier: "regular", photo_urls: null, catalog_image_url: null, completed: false, completed_at: null,
        status: "active", card_seq: null, card_code: null, bag_id: null, received_at: null, awaiting_arrival: false,
      })),
      bags: [], receivedEventAt: c.event ?? null, finishedEventAt: null, dropoffAt: c.dropoff ?? null,
      holidays: new Set(), turnaroundMaxDays: { regular: 60 },
    };
    const tsArrived = pure.arrivedBy(setup, c.firstBag ?? null);
    assert.equal(sql.arrived_by == null ? null : new Date(sql.arrived_by).toISOString(), tsArrived, `${c.name}: arrived by`);
    const { plan, late } = pure.inShopSetupPlan(setup, { now: new Date("2026-11-27T17:00:00Z"), firstBagAt: c.firstBag ?? null });
    const lateTs = new Set([...late, ...plan.addedLater.map((r) => r.cardId)]);
    assert.deepEqual([...lateSql].sort(), [...lateTs].sort(), `${c.name}: cards added after the order arrived`);
    assert.equal(lateSql.size, c.late, `${c.name}: how many were added later`);
  }
});

// ── Loader defaults ─────────────────────────────────────────────────────────

test("lib/dashboard-metrics: the new fields default to 0 when the database hasn't the migration yet", () => {
  const before = { total: 689, prep: 134, orders: 264, unknown_orders: 3, as_of: "2026-11-27T17:44:33Z", tracking_start: null };
  const n = normalizeBacklogNow(before);
  assert.deepEqual([n.total, n.orders, n.prep_cards, n.prep_orders, n.not_received, n.rule], [689, 264, 0, 0, 0, null]);
  const d = normalizeBacklogDay({ day: "2026-11-01", total: 5, prep: 1, quality: "recorded" });
  assert.deepEqual([d.total, d.orders, d.prep_cards, d.rule], [5, 0, 0, null]);
  const after = normalizeBacklogNow({ ...before, prep: 0, prep_cards: 140, prep_orders: 30, not_received: 2, rule: "restoration_received" });
  assert.deepEqual([after.prep_cards, after.prep_orders, after.not_received, after.rule], [140, 30, 2, "restoration_received"]);
});
