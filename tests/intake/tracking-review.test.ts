/**
 * Review checks of slot tracking (lib/intake/tracking): a card refunded while
 * it sat in a slot can still be taken out; names never take a shelf or slot
 * code; two phones (or one request sent twice) moving the same card write one
 * step event, one history row and one email; a round-2 card goes into a slot
 * like the stage buttons would; card summaries carry their slot's step.
 * Against the in-memory Supabase stand-in (tests/intake/harness/mock-supabase.mjs).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { planCards, type PlanCard, type PlanLocation } from "@/lib/intake/tracking/move-plan";
import { isReservedPlaceCode, locationCodeCandidates } from "@/lib/intake/tracking/places";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

let mock: Mock;
let admin: SupabaseClient;
let svc: {
  moves: typeof import("@/lib/intake/tracking/moves");
  locations: typeof import("@/lib/intake/tracking/locations");
  resolve: typeof import("@/lib/intake/tracking/resolve");
};
const sent: { to: unknown; subject: string; html: string }[] = [];
const realFetch = globalThis.fetch;

// Holds the first `n` PATCHes of `cards` until `n` have arrived, so two
// requests both read before either writes (what two phones at once do)
let barrier: { n: number; waiting: (() => void)[] } | null = null;
const raceFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (barrier && init?.method === "PATCH" && /\/rest\/v1\/cards\?/.test(url)) {
    const b = barrier;
    await new Promise<void>((release) => {
      b.waiting.push(release);
      if (b.waiting.length >= b.n) { barrier = null; b.waiting.forEach((r) => r()); }
    });
  }
  return globalThis.fetch(input, init);
};

const ORDER = "00000000-0000-4000-8000-0000000a0001";
const BAG = "00000000-0000-4000-8000-0000000ab001";
const C = (n: number) => `00000000-0000-4000-8000-0000000ac0${String(n).padStart(2, "0")}`;
const SLOT = (n: number) => `00000000-0000-4000-8000-0000000af0${String(n).padStart(2, "0")}`;

const card = (n: number, over: Row = {}): Row => ({
  id: C(n), order_id: ORDER, card_name: `Venusaur ${n}`, card_set: "Base Set", card_year: "1999",
  card_number: `${n}/102`, variation: null, notes: null, photo_urls: [], catalog_image_url: null, tier: null, status: "active",
  completed: false, completed_at: null, current_round: 1, created_at: "2026-11-23T19:00:00.000000+00:00",
  card_seq: n, card_code: `CD-5001-${String(n).padStart(2, "0")}`, bag_id: BAG, received_at: "2026-11-23T19:30:00+00:00",
  received_by: "gavin", awaiting_arrival: false, receiving_photo_urls: [], location_id: null, located_at: null,
  refunded_cents: 0, service_ids: [], slab_removal_selected: false, pregrade_selected: false, ...over,
});
const slot = (n: number, station: string, name: string, stage: string, serial: number): Row => ({
  id: SLOT(n), code: `LOC-${station.toUpperCase()}-${String(serial).padStart(2, "0")}`, name, kind: "station", station, serial,
  capacity: 1, stage, due_date: null, sort: serial, active: true, created_at: "2026-11-24T00:00:00+00:00", created_by: "gavin",
});
const stageEvent = (cardN: number, stage: string, round: number, at: string): Row => ({
  id: crypto.randomUUID(), order_id: ORDER, event_type: "stage_update", description: `Stage: ${stage} [card:${C(cardN)}]`,
  metadata: { card_id: C(cardN), stage, round, by: "gavin", bulk: false }, is_customer_visible: true, created_at: at,
});
const stageEvents = (cardId: string) => mock.store.table("order_events")
  .filter((e) => e.event_type === "stage_update" && (e.metadata as Row).card_id === cardId);
const movesOf = (cardId: string) => mock.store.table("card_moves").filter((m) => m.card_id === cardId);
const cardRow = (id: string) => mock.store.table("cards").find((c) => c.id === id)!;

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [{
        id: ORDER, order_number: "CD-5001", customer_name: "Robin Collector", customer_email: "robin@example.com", customer_phone: null,
        status: "in_progress", payment_status: "paid", restoration_tier: "premium", inbound_method: "self_ship", customer_notes: null,
        created_at: "2026-11-23T19:00:00+00:00", updated_at: "2026-11-23T19:00:00+00:00",
      }],
      tier_bags: [{
        id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-5001-G", received_on: "2026-11-16", due_date: "2026-12-07",
        due_status: "calculated", turnaround_days: 15, source: "receiving", created_at: "2026-11-23T19:30:00+00:00",
      }],
      cards: [
        card(1), card(2), card(3),
        // Refunded while it sat in CLAMP 03
        card(4, { status: "refunded", location_id: SLOT(3), located_at: "2026-11-24T09:00:00+00:00" }),
        // Round 2 (round 1 reached Final Dry); no step yet this round
        card(5, { current_round: 2 }),
      ],
      order_events: [
        stageEvent(5, "Final Dry", 1, "2026-11-24T08:00:00+00:00"),
        { id: crypto.randomUUID(), order_id: ORDER, event_type: "round_started", description: "Round 2 started for Venusaur 5",
          metadata: { card_id: C(5), round: 2 }, is_customer_visible: false, created_at: "2026-11-24T08:30:00+00:00" },
      ],
      locations: [
        { id: SLOT(90), code: "LOC-DONE", name: "Done", kind: "done", sort: 900, active: true, created_at: "2026-11-24T00:00:00+00:00" },
        slot(1, "humidor", "HUMIDOR 01", "Humidor", 1),
        slot(2, "clamp", "CLAMP 01", "Clamp Work", 1),
        slot(3, "clamp", "CLAMP 03", "Clamp Work", 3),
        slot(4, "heat", "HEAT 01", "Heat Press", 1),
        slot(5, "humidor", "HUMIDOR 02", "Humidor", 2),
      ],
      card_moves: [],
      restoration_settings: [{ tier: "premium", display_name: "Gold", turnaround_min_days: 15, turnaround_max_days: 20 }],
      business_holidays: [],
    },
  });
  const resendBase = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(resendBase) || url.startsWith("https://api.resend.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: body.to, subject: body.subject, html: body.html });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false }, global: { fetch: raceFetch } });
  svc = {
    moves: await import("@/lib/intake/tracking/moves"),
    locations: await import("@/lib/intake/tracking/locations"),
    resolve: await import("@/lib/intake/tracking/resolve"),
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await mock?.close();
});

// ── Pure ────────────────────────────────────────────────────────────────────

const CLAMP: PlanLocation = { id: "loc-clamp-07", code: "LOC-CLAMP-07", name: "CLAMP 07", kind: "station", stage: "Clamp Work" };
const planCard = (id: string, over: Partial<PlanCard> = {}): PlanCard => ({
  id, code: `CD-2549-${id.slice(-2)}`, name: `Card ${id}`, orderId: "order-1", bagId: "bag-1", locationId: null,
  refunded: false, received: true, completed: false, current: null, round: 1, ...over,
});

test("take out works for a card refunded (or flagged not arrived) while it sat in a slot; other actions still refuse it", () => {
  const cards = [planCard("c01", { refunded: true, locationId: "loc-clamp-07" }), planCard("c02", { received: false, locationId: "loc-clamp-07" })];
  const out = planCards({ action: "release", target: null, cardIds: ["c01", "c02"], cards });
  assert.deepEqual(out.moves.map((m) => [m.cardId, m.toLocationId, m.action, m.stageEvent, m.complete]), [
    ["c01", null, "release", null, false], ["c02", null, "release", null, false],
  ]);
  assert.equal(out.message, "2 cards taken out.");
  for (const action of ["assign", "move", "done"] as const) {
    const refused = planCards({ action, target: CLAMP, cardIds: ["c01"], cards });
    assert.equal(refused.moves.length, 0, action);
  }
});

test("a place's name never takes a shelf slot's or a station slot's code", () => {
  assert.equal(isReservedPlaceCode("LOC-SHELF-20261207"), true);
  assert.equal(isReservedPlaceCode("LOC-CLAMP-07"), true);
  assert.equal(isReservedPlaceCode("LOC-HEAT-PRESS-103"), true);
  assert.equal(isReservedPlaceCode("LOC-DONE"), false);
  assert.equal(isReservedPlaceCode("LOC-BACK-TABLE"), false);
  assert.equal(isReservedPlaceCode("LOC-CLAMP-07-2"), false);
  assert.equal(locationCodeCandidates("Clamp 07")[0], "LOC-CLAMP-07-2");
  assert.equal(locationCodeCandidates("Shelf 2026 12 07")[0], "LOC-SHELF-2026-12-07");
  assert.equal(locationCodeCandidates("Shelf 20261207")[0], "LOC-SHELF-20261207-2");
  assert.equal(locationCodeCandidates("Back table")[0], "LOC-BACK-TABLE");
});

// ── Services ────────────────────────────────────────────────────────────────

test("the same assign sent twice at once: one step event, one history row, one email", async () => {
  const emails = sent.length;
  barrier = { n: 2, waiting: [] };
  const [a, b] = await Promise.all([
    svc.moves.assignCards(admin, { locationCode: "LOC-HUMIDOR-01", cardIds: [C(1)], by: "gavin" }),
    svc.moves.assignCards(admin, { locationCode: "LOC-HUMIDOR-01", cardIds: [C(1)], by: "gavin" }),
  ]);
  assert.equal(barrier, null, "both requests reached the write");
  assert.ok(a.ok && b.ok, "both answer 200");
  if (!a.ok || !b.ok) return;
  assert.deepEqual([a.changed, b.changed].sort(), [0, 1]);
  const loser = a.changed ? b : a;
  assert.deepEqual([loser.results[0].ok, loser.message, loser.emailedOrders], [false, "Someone moved it just now. Scan the slot again.", []]);
  assert.equal(stageEvents(C(1)).length, 1);
  assert.equal(movesOf(C(1)).length, 1);
  assert.equal(sent.length - emails, 1);
  assert.equal(cardRow(C(1)).location_id, SLOT(1));
});

test("two phones move the same card to different slots: one wins, its step and place agree", async () => {
  barrier = { n: 2, waiting: [] };
  const [a, b] = await Promise.all([
    svc.moves.moveSlot(admin, { fromCode: "LOC-HUMIDOR-01", toCode: "LOC-CLAMP-01", by: "phone-a" }),
    svc.moves.moveSlot(admin, { fromCode: "LOC-HUMIDOR-01", toCode: "LOC-HEAT-01", by: "phone-b" }),
  ]);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.changed + b.changed, 1);
  const winner = a.changed ? a : b;
  const where = cardRow(C(1)).location_id;
  assert.equal(where, winner === a ? SLOT(2) : SLOT(4));
  const events = stageEvents(C(1));
  assert.equal(events.length, 2, "Humidor, then the winner's step only");
  assert.equal((events.at(-1)!.metadata as Row).stage, winner === a ? "Clamp Work" : "Heat Press");
  assert.equal(movesOf(C(1)).length, 2);
});

test("a refunded card stuck in a slot can be taken out, and the slot frees up", async () => {
  const r = await svc.moves.releaseCards(admin, { cardIds: [C(4)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.changed, 1);
  assert.deepEqual(r.freed.map((l) => l.code), ["LOC-CLAMP-03"]);
  assert.equal(cardRow(C(4)).location_id, null);
  assert.equal(stageEvents(C(4)).length, 0);
  const refused = await svc.moves.assignCards(admin, { locationCode: "LOC-CLAMP-03", cardIds: [C(4)], by: "gavin" });
  assert.ok(refused.ok && refused.changed === 0 && /refunded/.test(refused.results[0].message));
});

test("round 2: a card back in the humidor gets Humidor for round 2, as the stage buttons would", async () => {
  const emails = sent.length;
  const r = await svc.moves.assignCards(admin, { locationCode: "LOC-HUMIDOR-02", cardIds: [C(5)], by: "gavin" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.results[0].message, "In HUMIDOR 02. Step: Humidor.");
  const last = stageEvents(C(5)).at(-1)!;
  assert.deepEqual([last.description, (last.metadata as Row).round, (last.metadata as Row).stage], [`Stage: Humidor [card:${C(5)}]`, 2, "Humidor"]);
  assert.equal(sent.length - emails, 1);
  assert.equal(sent.at(-1)!.subject, "Update on your card — Round 2 — humidity treatment (Order #CD-5001)");
  assert.deepEqual(movesOf(C(5)).map((m) => [m.stage_before, m.stage_after]), [[null, "Humidor"]]);
});

test("card summaries carry their slot's station, number and step", async () => {
  const b = await svc.resolve.resolveTrackCode(admin, "CD-5001-G");
  assert.ok(b.ok && b.response.kind === "bag");
  if (!b.ok || b.response.kind !== "bag") return;
  const c5 = b.response.bag.cards.find((c) => c.id === C(5))!;
  assert.deepEqual(c5.location, { id: SLOT(5), code: "LOC-HUMIDOR-02", name: "HUMIDOR 02", kind: "station", station: "humidor", serial: 2, stage: "Humidor" });
});
