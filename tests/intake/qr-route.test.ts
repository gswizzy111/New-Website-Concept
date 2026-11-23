/**
 * What a scanned QR resolves to and opens (resolveCode in lib/intake/data.ts
 * and codeTargetPath, used by app/q/[code]/route.ts): the bag QR on each tier
 * bag's label (CD-2549-P), an order code (CD-2549) and the card QRs on labels
 * printed before, against the in-memory Supabase stand-in
 * (tests/intake/harness/mock-supabase.mjs). No real database.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { codeTargetPath, qrUrl } from "@/lib/intake/codes";

type Row = Record<string, unknown>;
type Mock = { url: string; store: { table(name: string): Row[]; load(seed: { tables: Record<string, Row[]> }): void; requests: { path: string }[] }; close(): Promise<void> };

const ORDER = "00000000-0000-4000-8000-00000000a001";
const ORDER2 = "00000000-0000-4000-8000-00000000a002";
const ORDER3 = "00000000-0000-4000-8000-00000000a003";
const CARD = "00000000-0000-4000-8000-00000000c001";
const BAG = "00000000-0000-4000-8000-00000000b001";
const BAG2 = "00000000-0000-4000-8000-00000000b002";

let mock: Mock;
let admin: SupabaseClient;
let resolveCode: typeof import("@/lib/intake/data").resolveCode;

before(async () => {
  // Its own port (0 = any free one): services.test.ts runs its mock at the same time
  const harness = pathToFileURL(path.resolve("tests/intake/harness/mock-supabase.mjs")).href;
  const { startMock } = (await import(harness)) as { startMock: (o: { port: number; quiet: boolean }) => Promise<Mock> };
  mock = await startMock({ port: 0, quiet: true });
  mock.store.load({
    tables: {
      orders: [
        { id: ORDER, order_number: "CD-2549", customer_name: "Pat Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
        { id: ORDER2, order_number: "CD-25490", customer_name: "Sam Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
        // Every real order number is upper case ('CD-' || a sequence); a stray lower-case one still matches
        { id: ORDER3, order_number: "cd-3000", customer_name: "Lee Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
      ],
      cards: [{ id: CARD, order_id: ORDER, card_code: "CD-2549-03", card_seq: 3, bag_id: BAG }],
      tier_bags: [
        { id: BAG, order_id: ORDER, bag_code: "CD-2549-P", tier: "ultra_premium" },
        { id: BAG2, order_id: ORDER, bag_code: "CD-2549-P2", tier: "ultra_premium" },
      ],
    },
  });
  admin = createClient(mock.url, "service-role-test-key", { auth: { persistSession: false } });
  ({ resolveCode } = await import("@/lib/intake/data"));
});

after(async () => {
  await mock?.close();
});

test("an order code resolves to its order, exactly, in any letter case and from its QR link", async () => {
  const want = { kind: "order", id: ORDER, code: "CD-2549", orderId: ORDER };
  for (const raw of ["CD-2549", "cd-2549", "CD 2549", "cd2549", "#CD-2549", qrUrl("CD-2549"), "https://thecarddoc1.com/q/cd-2549"]) {
    assert.deepEqual(await resolveCode(admin, raw), want, raw);
  }
  assert.deepEqual(await resolveCode(admin, "CD-25490"), { kind: "order", id: ORDER2, code: "CD-25490", orderId: ORDER2 }, "no prefix matching");
  assert.equal(await resolveCode(admin, "CD-254"), null, "no prefix matching");
  assert.equal(await resolveCode(admin, "CD-9999"), null, "unknown order");
  assert.deepEqual(await resolveCode(admin, "CD-3000"), { kind: "order", id: ORDER3, code: "CD-3000", orderId: ORDER3 }, "stored in lower case");
  const found = (await resolveCode(admin, qrUrl("CD-2549")))!;
  assert.equal(codeTargetPath(found.kind, found.id, found.orderId), `/admin/receiving/${ORDER}/photos`);
});

test("a bag QR resolves to its bag and order, and opens that bag's photos", async () => {
  const bag = await resolveCode(admin, qrUrl("CD-2549-P"));
  assert.deepEqual(bag, { kind: "bag", id: BAG, code: "CD-2549-P", orderId: ORDER });
  assert.equal(codeTargetPath(bag!.kind, bag!.id, bag!.orderId), `/admin/receiving/${ORDER}/photos?bag=${BAG}`);
  // A later batch of the same tier is its own bag
  const bag2 = await resolveCode(admin, "https://thecarddoc1.com/q/cd-2549-p2");
  assert.deepEqual(bag2, { kind: "bag", id: BAG2, code: "CD-2549-P2", orderId: ORDER });
  assert.equal(codeTargetPath(bag2!.kind, bag2!.id, bag2!.orderId), `/admin/receiving/${ORDER}/photos?bag=${BAG2}`);
  assert.equal(await resolveCode(admin, "CD-2549-G"), null, "unknown bag of a known order");
});

test("card codes keep resolving to their card page, never to the order or a bag", async () => {
  const card = await resolveCode(admin, "cd-2549-03");
  assert.deepEqual(card, { kind: "card", id: CARD, code: "CD-2549-03" });
  assert.equal(codeTargetPath(card!.kind, card!.id, card!.orderId), `/admin/receiving/card/${CARD}`);
  assert.equal(await resolveCode(admin, "CD-2549-04"), null, "unknown card of a known order");
});

test("a bare number or anything else that isn't a code resolves to nothing, without a lookup", async () => {
  const before = mock.store.requests.length;
  for (const raw of ["2549", "#2549", "https://thecarddoc1.com/q/2549", "JOHN-SMITH", "CD-2549-3", "", "<script>"]) {
    assert.equal(await resolveCode(admin, raw), null, raw);
  }
  assert.equal(mock.store.requests.length, before, "no database reads");
});

test("a code with LIKE wildcards or URL tricks never reaches the database", async () => {
  const before = mock.store.requests.length;
  for (const raw of ["CD-25_9", "CD-254%", "CD-%", "CD-*", "CD-2549*", "CD%25", "CD-2549-P%0aX", "cd_2549", "CD-2549/../x", "//evil.example/q/x"]) {
    assert.equal(await resolveCode(admin, raw), null, raw);
  }
  assert.equal(mock.store.requests.length, before, "no database reads");
});

test("later batches (P2..P99) and order numbers past CD-9999 resolve", async () => {
  const order = "00000000-0000-4000-8000-00000000a005";
  const bag = "00000000-0000-4000-8000-00000000b005";
  mock.store.table("orders").push({ id: order, order_number: "CD-12345", customer_name: "Kim Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" });
  mock.store.table("tier_bags").push({ id: bag, order_id: order, bag_code: "CD-12345-G12", tier: "premium" });
  assert.deepEqual(await resolveCode(admin, "HTTPS://THECARDDOC1.COM/Q/CD-12345"), { kind: "order", id: order, code: "CD-12345", orderId: order });
  assert.deepEqual(await resolveCode(admin, "https://thecarddoc1.com/q/cd-12345-g12"), { kind: "bag", id: bag, code: "CD-12345-G12", orderId: order });
  assert.equal(await resolveCode(admin, "CD-1234"), null, "no prefix matching");
});

test("an order number on two orders opens neither (never another customer's cards)", async () => {
  const a = "00000000-0000-4000-8000-00000000a006";
  const b = "00000000-0000-4000-8000-00000000a007";
  mock.store.table("orders").push(
    { id: a, order_number: "CD-7777", customer_name: "A Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
    { id: b, order_number: "CD-7777", customer_name: "B Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
  );
  assert.equal(await resolveCode(admin, "CD-7777"), null);
  // The exact spelling still wins over a stray one in another letter case
  const c = "00000000-0000-4000-8000-00000000a008";
  const d = "00000000-0000-4000-8000-00000000a009";
  mock.store.table("orders").push(
    { id: c, order_number: "cd-8888", customer_name: "C Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
    { id: d, order_number: "CD-8888", customer_name: "D Collector", status: "received", created_at: "2026-11-23T19:00:00+00:00" },
  );
  assert.deepEqual(await resolveCode(admin, "cd-8888"), { kind: "order", id: d, code: "CD-8888", orderId: d });
});

test("a failed read throws (the /q route logs it and shows not found), for every kind", async () => {
  const failing = createClient(mock.url, "service-role-test-key", {
    auth: { persistSession: false },
    global: {
      fetch: async () => new Response(JSON.stringify({ code: "XX000", message: "database unavailable", details: null, hint: null }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    },
  });
  for (const raw of ["CD-2549", "CD-2549-03", "CD-2549-P"]) {
    await assert.rejects(resolveCode(failing, raw), /database unavailable/, raw);
  }
  assert.equal(await resolveCode(failing, "2549"), null, "not a code: no read, no error");
});
