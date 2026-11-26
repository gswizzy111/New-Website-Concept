// Checks the mock against the real supabase-js client (no Next.js, no browser).
//   node tests/intake/harness/selftest.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { startMock } from "./mock-supabase.mjs";
import { buildSeed, ADMIN_TOKEN, IDS, ORDER_NUMBERS, WORKSHOP_TOKEN, WORKSHOP_OFF_TOKEN, WORKSHOP_USERNAME } from "./seed.mjs";

const mock = await startMock({ port: 0, seedFn: (base) => buildSeed({ baseUrl: base }), quiet: true });
const db = createClient(mock.url, "placeholder-service", { auth: { persistSession: false } });
let passed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

await check("admin session lookup with embeds + maybeSingle", async () => {
  const hash = crypto.createHash("sha256").update(ADMIN_TOKEN).digest("hex");
  const { data, error } = await db.from("admin_sessions")
    .select("role, admin_user_id, support_id, expires_at, admin_users(username, active), accountant_access(email, password_hash), support_access(name, email, password_hash)")
    .eq("token_hash", hash).gt("expires_at", new Date().toISOString()).maybeSingle();
  assert.equal(error, null);
  assert.equal(data.role, "admin");
  assert.equal(data.admin_users.username, "harness-admin");
  assert.equal(data.accountant_access, null);
});

await check("single() on one row and 406 on none", async () => {
  const { data } = await db.from("orders").select("*").eq("id", IDS.mailOrder).single();
  assert.equal(data.order_number, ORDER_NUMBERS.mailOrder);
  const { error } = await db.from("orders").select("*").eq("id", crypto.randomUUID()).single();
  assert.equal(error.code, "PGRST116");
});

await check("head count with !inner filters on the embed", async () => {
  const { count, error } = await db.from("cards").select("id, orders!inner(status, payment_status)", { count: "exact", head: true })
    .in("orders.status", ["received", "in_progress"]).eq("orders.payment_status", "paid");
  assert.equal(error, null);
  assert.equal(count, 2 + 3 + 2);
});

await check("one-to-many embed with referencedTable order, not.in, or()", async () => {
  const { data, error } = await db.from("orders").select("id, order_number, cards(card_name, photo_urls)")
    .neq("status", "awaiting_payment").not("status", "in", "(delivered,cancelled)")
    .or("admin_notes.is.null,admin_notes.eq.x")
    .order("created_at", { ascending: false }).order("card_name", { referencedTable: "cards", ascending: false });
  assert.equal(error, null);
  assert.equal(data.length, 4);
  const mail = data.find((o) => o.id === IDS.mailOrder);
  assert.equal(mail.cards.length, 10);
  assert.equal(mail.cards[0].card_name, "Test Card Silver Two");
});

await check("ilike / like / regex / range / count", async () => {
  const a = await db.from("orders").select("id").ilike("customer_name", "%customer a%");
  assert.equal(a.data.length, 1);
  const b = await db.from("order_events").select("id", { count: "exact" }).like("description", "%Cards Received%").range(0, 0);
  assert.equal(b.data.length, 1);
  assert.equal(b.count, 2);
  const c = await db.from("orders").select("id").regexIMatch("customer_email", "^test\\.customer\\.[ab]@");
  assert.equal(c.data.length, 2);
});

await check("json path filter on metadata", async () => {
  const { data } = await db.from("order_events").select("id, stage:metadata->>stage").eq("metadata->>card_id", IDS.inProgressCards[0]).order("created_at", { ascending: false }).limit(1);
  assert.equal(data[0].stage, "Heat Press");
});

await check("insert with defaults, unique 23505, upsert ignore/merge", async () => {
  const { data: bag, error } = await db.from("tier_bags").insert({ order_id: IDS.mailOrder, tier: "premium", bag_code: "CD-2549-G", received_on: "2026-11-15" }).select().single();
  assert.equal(error, null);
  assert.equal(bag.batch, 1);
  assert.equal(bag.due_status, "pending");
  assert.ok(bag.id && bag.created_at);
  const dup = await db.from("tier_bags").insert({ order_id: IDS.mailOrder, tier: "premium", bag_code: "CD-2549-G2" });
  assert.equal(dup.error?.code, "23505");
  const dup2 = await db.from("tier_bags").insert({ order_id: IDS.mailOrder, tier: "premium", batch: 2, bag_code: "CD-2549-G" });
  assert.equal(dup2.error?.code, "23505");
  const ign = await db.from("tier_bags").upsert({ order_id: IDS.mailOrder, tier: "premium", batch: 1, bag_code: "CD-2549-G" }, { onConflict: "order_id,tier,batch", ignoreDuplicates: true }).select();
  assert.equal(ign.error, null);
  assert.equal(ign.data.length, 0);
  const merge = await db.from("store_config").upsert({ key: "restorations_open", value: "false" }).select().single();
  assert.equal(merge.data.value, "false");
});

await check("check + not-null + FK constraints", async () => {
  const a = await db.from("tier_bags").insert({ order_id: IDS.mailOrder, tier: "premium", batch: 0, bag_code: "X-1" });
  assert.equal(a.error?.code, "23514");
  const b = await db.from("tier_bag_due_changes").insert({ bag_id: crypto.randomUUID(), reason: "x" });
  assert.equal(b.error?.code, "23503");
  const c = await db.from("cards").insert([{ order_id: IDS.mailOrder, card_name: "a", awaiting_arrival: true }, { order_id: IDS.mailOrder, card_name: "b" }]);
  assert.equal(c.error?.code, "23502", "bulk insert: a column named in one row is NULL in the others");
});

await check("card codes unique, partial (null allowed many times)", async () => {
  const one = await db.from("cards").update({ card_seq: 1, card_code: "CD-2549-01" }).eq("id", IDS.mailCards[0]).select();
  assert.equal(one.data.length, 1);
  const two = await db.from("cards").update({ card_seq: 1, card_code: "CD-2549-02" }).eq("id", IDS.mailCards[1]);
  assert.equal(two.error?.code, "23505");
});

await check("array column eq filter with a PostgreSQL array literal (optimistic update)", async () => {
  const empty = await db.from("cards").update({ receiving_photo_urls: ["https://x/a.png"] }).eq("id", IDS.mailCards[2]).filter("receiving_photo_urls", "eq", "{}").select("receiving_photo_urls");
  assert.equal(empty.data.length, 1);
  const stale = await db.from("cards").update({ receiving_photo_urls: [] }).eq("id", IDS.mailCards[2]).filter("receiving_photo_urls", "eq", "{}").select("id");
  assert.equal(stale.data.length, 0);
  const same = await db.from("cards").update({ receiving_photo_urls: [] }).eq("id", IDS.mailCards[2]).filter("receiving_photo_urls", "eq", '{"https://x/a.png"}').select("id");
  assert.equal(same.data.length, 1);
});

await check("completed_at trigger and cards done on ship", async () => {
  const { data } = await db.from("cards").update({ completed: true }).eq("id", IDS.dropoffCards[0]).select("completed_at").single();
  assert.ok(data.completed_at);
  await db.from("orders").update({ status: "shipped_back" }).eq("id", IDS.dropoffOrder);
  const { data: cs } = await db.from("cards").select("completed").eq("order_id", IDS.dropoffOrder);
  assert.ok(cs.every((c) => c.completed));
});

await check("a bag holding cards can't be deleted (cards.bag_id NO ACTION); an empty one can", async () => {
  const { data: bag } = await db.from("tier_bags").select("id").eq("bag_code", "CD-2549-G").single();
  await db.from("cards").update({ bag_id: bag.id }).eq("id", IDS.mailCards[0]);
  const refused = await db.from("tier_bags").delete().eq("id", bag.id);
  assert.equal(refused.error?.code, "23503");
  const { data: c } = await db.from("cards").select("bag_id").eq("id", IDS.mailCards[0]).single();
  assert.equal(c.bag_id, bag.id);
  await db.from("cards").update({ bag_id: null }).eq("id", IDS.mailCards[0]);
  const ok = await db.from("tier_bags").delete().eq("id", bag.id);
  assert.equal(ok.error, null);
});

await check("deleting an order takes its bagged cards and bags together", async () => {
  const { data: bag, error } = await db.from("tier_bags").insert({ order_id: IDS.deliveredOrder, tier: "ultra_premium", bag_code: "CD-2400-P" }).select("id").single();
  assert.equal(error, null);
  await db.from("cards").update({ bag_id: bag.id }).eq("order_id", IDS.deliveredOrder);
  const del = await db.from("orders").delete().eq("id", IDS.deliveredOrder);
  assert.equal(del.error, null);
  assert.equal((await db.from("cards").select("id").eq("order_id", IDS.deliveredOrder)).data.length, 0);
  assert.equal((await db.from("tier_bags").select("id").eq("id", bag.id)).data.length, 0);
});

await check("rpc backlog_now counts cards (awaiting_arrival excluded)", async () => {
  const before = (await db.rpc("backlog_now")).data.total;
  await db.from("cards").update({ awaiting_arrival: true }).eq("id", IDS.noDateCards[0]);
  const after = (await db.rpc("backlog_now")).data.total;
  assert.equal(after, before - 1);
});

await check("storage upload + public url + signed upload", async () => {
  const up = await db.storage.from("card-photos").upload("t1.png", Buffer.from([0x89, 0x50]), { contentType: "image/png" });
  assert.equal(up.error, null);
  const url = db.storage.from("card-photos").getPublicUrl("t1.png").data.publicUrl;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const signed = await db.storage.from("card-photos").createSignedUploadUrl("t2.png");
  assert.equal(signed.error, null);
  const put = await db.storage.from("card-photos").uploadToSignedUrl("t2.png", signed.data.token, Buffer.from([1, 2, 3]), { contentType: "image/png" });
  assert.equal(put.error, null);
});

await check("/__reset restores the seed", async () => {
  await fetch(`${mock.url}/__reset`, { method: "POST" });
  const dump = await (await fetch(`${mock.url}/__dump`)).json();
  assert.equal(dump.tables.tier_bags.length, 0);
  assert.equal(dump.tables.cards.find((c) => c.id === IDS.mailCards[0]).card_code, null);
});

// ─── Workshop logins (team-*): the session lookup lib/admin-session.ts makes for role 'workshop' ───
await check("workshop session lookup: admin_sessions.workshop_id embeds workshop_users; the turned-off worker's row says active false", async () => {
  const look = (token) => db.from("admin_sessions")
    .select("workshop_id, workshop_users(id, username, name, active, password_hash)")
    .eq("token_hash", crypto.createHash("sha256").update(token).digest("hex")).eq("role", "workshop")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  const on = await look(WORKSHOP_TOKEN);
  assert.equal(on.error, null);
  assert.equal(on.data.workshop_users.username, WORKSHOP_USERNAME);
  assert.equal(on.data.workshop_users.active, true);
  assert.ok(on.data.workshop_users.password_hash.includes(":"));
  const off = await look(WORKSHOP_OFF_TOKEN);
  assert.equal(off.data.workshop_users.active, false);
  // the admin's own session has no worker
  const admin = await db.from("admin_sessions").select("role, workshop_id, workshop_users(username)").eq("role", "admin").single();
  assert.equal(admin.data.workshop_users, null);
});

await check("workshop_users: an admin's username (any case) is refused like the trigger does; usernames are unique and lower case; card_photo_events are insert-only", async () => {
  const taken = await db.from("workshop_users").insert({ username: "harness-admin" }).select("id");
  assert.equal(taken.error?.code, "23505");
  assert.match(taken.error.message, /admin username/);
  const dup = await db.from("workshop_users").insert({ username: WORKSHOP_USERNAME }).select("id");
  assert.equal(dup.error?.code, "23505");
  const upper = await db.from("workshop_users").insert({ username: "Sam" }).select("id");
  assert.equal(upper.error?.code, "23514");
  const ok = await db.from("workshop_users").insert({ username: "sam" }).select("id, active, password_hash").single();
  assert.equal(ok.error, null);
  assert.deepEqual([ok.data.active, ok.data.password_hash ?? null], [true, null]);
  const ev = await db.from("card_photo_events").insert({ card_id: IDS.mailCards[0], action: "add", photo_url: "x", by: "sam" }).select("id").single();
  assert.equal(ev.error, null);
  const change = await db.from("card_photo_events").update({ by: "someone" }).eq("id", ev.data.id);
  assert.equal(change.error?.code, "P0001");
  await fetch(`${mock.url}/__reset`, { method: "POST" });
});

console.log(`${passed} checks passed${process.exitCode ? ", some FAILED" : ""}`);
await mock.close();
