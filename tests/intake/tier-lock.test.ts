/**
 * A bagged card keeps its tier (lib/intake/tier-lock.ts, used by
 * PATCH /api/admin/cards/[id]/tier and /api/admin/orders/[id]/tier).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { baggedCards, cardTierChanges, cardsMovedByOrderTier, tierLockMessage, type BaggedCard } from "@/lib/intake/tier-lock";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { load(seed: { tables: Record<string, Row[]> }): void }; close(): Promise<void> };

const bagged = (id: string, tier: string | null, bagCode = "CD-1-G"): BaggedCard => ({ id, card_name: `Card ${id}`, tier, bagCode });

test("card switch: blocked only when the effective tier changes", () => {
  assert.equal(cardTierChanges({ tier: "premium" }, null, "expedited"), true);
  assert.equal(cardTierChanges({ tier: null }, "premium", "premium"), false, "same tier through the order");
  assert.equal(cardTierChanges({ tier: null }, "premium", "elite"), true);
  assert.equal(cardTierChanges({ tier: "prep_standard" }, null, "prep"), false, "prep_standard reads as prep");
  assert.equal(cardTierChanges({ tier: " " }, "premium", "premium"), false, "a blank tier follows the order");
});

test("order switch: only bagged cards that follow the order and change tier", () => {
  const cards = [
    bagged("a", null, "CD-1-G"), // follows the order
    bagged("b", "premium", "CD-1-G"), // carries the old order tier: follows
    bagged("c", "ultra_premium", "CD-1-P"), // its own tier: stays
    bagged("d", "prep", "CD-1-R"), // prep follows the order
  ];
  assert.deepEqual(cardsMovedByOrderTier(cards, "premium", "elite").map((c) => c.id), ["a", "b", "d"]);
  assert.deepEqual(cardsMovedByOrderTier(cards.slice(2, 3), "premium", "elite"), [], "a card with its own tier is untouched");
  assert.deepEqual(cardsMovedByOrderTier([bagged("e", "prep_standard")], "prep", "prep"), [], "no effective change");
  assert.deepEqual(cardsMovedByOrderTier([bagged("f", null)], null, "premium").map((c) => c.id), ["f"], "no order tier before");
});

test("messages name the bags and the way out", () => {
  const one = tierLockMessage([bagged("a", null, "CD-2549-P")]);
  assert.match(one, /bag CD-2549-P/);
  assert.match(one, /Mark not received/);
  const many = tierLockMessage([bagged("a", null, "CD-2549-P"), bagged("b", null, "CD-2549-P"), bagged("c", null, "CD-2549-G")]);
  assert.match(many, /^3 cards are already in tier bags \(CD-2549-P, CD-2549-G\)/);
});

let mock: Mock;
let admin: SupabaseClient;
const ORDER = "00000000-0000-4000-8000-0000000000a1";
const BAG = "00000000-0000-4000-8000-0000000000b1";
const CARD_IN = "00000000-0000-4000-8000-0000000000c1";
const CARD_OUT = "00000000-0000-4000-8000-0000000000c2";

before(async () => {
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  const card = (id: string, bagId: string | null): Row => ({
    id, order_id: ORDER, card_name: `Card ${id.slice(-2)}`, tier: null, status: "active", completed: false, bag_id: bagId,
    created_at: "2026-11-10T15:00:00+00:00",
  });
  mock.store.load({
    tables: {
      orders: [{ id: ORDER, order_number: "CD-9001", status: "received", restoration_tier: "premium", created_at: "2026-11-10T15:00:00+00:00" }],
      tier_bags: [{ id: BAG, order_id: ORDER, tier: "premium", batch: 1, bag_code: "CD-9001-G", due_status: "calculated", source: "receiving", created_at: "2026-11-10T15:00:00+00:00" }],
      cards: [card(CARD_IN, BAG), card(CARD_OUT, null)],
    },
  });
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
});
after(async () => { await mock?.close(); });

test("baggedCards reads a card's or an order's bagged cards with their Bag IDs", async () => {
  const one = await baggedCards(admin, { cardId: CARD_IN });
  assert.ok(one.ok);
  assert.deepEqual(one.cards.map((c) => [c.id, c.bagCode]), [[CARD_IN, "CD-9001-G"]]);
  const none = await baggedCards(admin, { cardId: CARD_OUT });
  assert.ok(none.ok);
  assert.equal(none.cards.length, 0, "a card not in a bag is free to change tier");
  const order = await baggedCards(admin, { orderId: ORDER });
  assert.ok(order.ok);
  assert.deepEqual(order.cards.map((c) => c.id), [CARD_IN]);
});
