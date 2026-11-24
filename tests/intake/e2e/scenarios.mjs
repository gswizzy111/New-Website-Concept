// End-to-end scenarios for the intake system (receiving, tier bags, QR codes,
// stages, completion, the one-per-order label, the order photos page, the
// "Print labels" step, Historical Order Setup), run in a real browser against
// the local harness (fake Supabase, fake data, no real emails).
//
//   node tests/intake/e2e/scenarios.mjs                 start harness, run all, stop
//   node tests/intake/e2e/scenarios.mjs --only qr,labels,photos-page,print-step
//   node tests/intake/e2e/scenarios.mjs --only 'track-*'  card tracking with serial-numbered slots
//   HARNESS_APP_URL=… HARNESS_MOCK_URL=… node tests/intake/e2e/scenarios.mjs   reuse a running harness
//   INTERCEPT_UPLOAD=1 …                                 answer /api/upload in the browser instead of the app
//
// Every scenario starts from a fresh seed (POST /__reset) and prints PASS /
// FAIL / SKIP per step. Screenshots (deviceScaleFactor 1) go to
// tests/intake/e2e/out/. The UI wording the scenarios rely on is in UI and
// ROUTES below: adjust it there once, if the real pages word things differently.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { startHarness, loadPlaywright, newAdminContext, dump, reset, emails, insertRows, RUN_DIR } from "../harness/start.mjs";
import { IDS, ORDER_NUMBERS, MAIL_CARD_TIERS, HOLIDAYS, BIG_CARD_TIERS, BIG_CUSTOMER_NAME, DEFAULT_PLACES } from "../harness/seed.mjs";
import { placeholderPng } from "../harness/mock-supabase.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");

// ─── Routes the brief plans (edit here if they move) ────────────────────────
export const ROUTES = {
  receiving: "/admin/receiving",
  receivingOrder: (orderId) => `/admin/receiving/${orderId}`,
  bag: (bagId) => `/admin/receiving/bag/${bagId}`,
  card: (cardId) => `/admin/receiving/card/${cardId}`,
  // Every card of an order with all its images (where the order code leads); ?bag=<bagId> = only
  // that bag's cards (where the bag QR leads)
  photos: (orderId, bagId) => `/admin/receiving/${orderId}/photos${bagId ? `?bag=${bagId}` : ""}`,
  // The "Bags" work board: every open bag as its own work order, by due date
  bags: "/admin/receiving/bags",
  completed: "/admin/receiving/completed",
  setup: "/admin/receiving/setup",
  settings: "/admin/receiving/settings",
  qr: (code) => `/q/${code}`,
  qrUpper: (code) => `/Q/${code}`,
  // APIs (used for setup steps and as a fallback when a UI step fails)
  receiveApi: (orderId) => `/api/admin/intake/orders/${orderId}/receive`,
  stagesApi: "/api/admin/intake/stages",
  oldStageApi: (orderId) => `/api/admin/orders/${orderId}/stage`,
  setupPreviewApi: "/api/admin/intake/setup/preview",
  setupRunApi: "/api/admin/intake/setup/run",
  // Labels: ONE label per tier bag (design "B · Name banner"), always one page per bag, and no
  // reusable tag any more (the owner: "I just need the 1 main label").
  // Order route: a PDF with one page per bag, bag after bag (?bags=<id>,<id> = only those);
  // ?format=json: { settings: { stock, contentWidthIn, widthIn, heightIn }, bags: [{ id, bagCode,
  // cardCount, labelPrintedAt, labels: [LabelPage] (exactly 1) }] } (no `tag`). Bag route: the
  // same for that one bag.
  orderLabel: (orderId, query = "") => `/api/admin/intake/labels/order/${orderId}${query}`,
  bagLabel: (bagId, query = "") => `/api/admin/intake/labels/bag/${bagId}${query}`,

  // ── Card tracking: serial-numbered slots (owner's model of Nov 24; lib/intake/tracking/types.ts) ──
  // Cards carry no sticker: every holder is a slot with a QR label (CLAMP 07 = LOC-CLAMP-07).
  // The Scan page (phone-first): ?loc=<LOC code> = that slot or place already scanned (where /q/<LOC> leads)
  scan: "/admin/scan",
  scanAt: (locCode) => `/admin/scan?loc=${encodeURIComponent(locCode)}`,
  // Places (slots: bulk add, print labels), Shelf view (bags by due date), ship check, forgotten cards
  places: "/admin/receiving/locations",
  shelf: "/admin/receiving/shelf",
  ship: (orderId) => `/admin/receiving/ship/${orderId}`,
  forgotten: "/admin/receiving/forgotten",
  // APIs (types: ResolveResponse, SearchResponse, TrackActionResponse, CapacityConflict (409),
  // HistoryResponse, LocationsResponse, CreateSlotsResponse, LocationResponse, ShipCheckResponse)
  trackResolve: (code) => `/api/admin/track/resolve?code=${encodeURIComponent(code)}`,
  trackSearch: (q) => `/api/admin/track/search?q=${encodeURIComponent(q)}`,
  trackAssign: "/api/admin/track/assign",     // { locationCode, cardIds, force? }
  trackMove: "/api/admin/track/move",         // { fromCode, toCode, cardIds?, force? }
  trackRelease: "/api/admin/track/release",   // { cardIds }
  trackDone: "/api/admin/track/done",         // { cardIds }
  trackHistory: (code) => `/api/admin/track/history?code=${encodeURIComponent(code)}`,
  // GET ?all=1 / ?station=clamp; POST { station, count, startAt? } (slots) or { name, kind, dueDate? }; PATCH { id, name?, active?, capacity? }
  trackLocations: (query = "") => `/api/admin/track/locations${query}`,
  shipCheck: (code) => `/api/admin/track/ship-check?code=${encodeURIComponent(code)}`,
  // Slot and place QR labels, one 50 x 80 mm page each: ?ids=a,b | ?station=clamp&from=1&to=5; &format=json
  slotLabels: (query) => `/api/admin/track/locations/labels${query}`,
};

// ─── UI wording (from the brief and the components built so far) ────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const UI = {
  searchBox: (page) => page.getByRole("searchbox", { name: /search orders/i }),
  searchResultLink: (page, orderNumber) => page.getByRole("link", { name: new RegExp(esc(orderNumber)) }).first(),
  arrived: (page, cardName) => page.getByRole("checkbox", { name: new RegExp(`^Arrived: .*${esc(cardName)}$`) }),
  receivedOn: (page) => page.getByLabel(/received on/i).last(),
  receiveButton: (page) => page.getByRole("button", { name: /^Receive selected cards/i }),
  // The innermost block holding the card's name and (optionally) a given control: card
  // names also appear in label previews and nested lists, which hold no such control.
  cardRow: (page, cardName, has) => page.locator("li, div, tr, article, section").filter({ hasText: cardName }).filter(has ? { has } : {}).last(),
  tierSelect: (page, cardName) => UI.cardRow(page, cardName, page.getByRole("combobox")).getByRole("combobox").first(),
  moveButton: (page) => page.getByRole("button", { name: /^Move\b/i }),
  alert: (page) => page.getByRole("alert").first(),
  choosePhoto: (page, cardName) => page.getByRole("button", { name: new RegExp(`^Choose photo of .*${esc(cardName)}`) }),
  receivingPhotos: (page, cardName) => page.getByRole("list", { name: new RegExp(`^Receiving photos of .*${esc(cardName)}`) }),
  addCardOpen: (page) => page.getByRole("button", { name: /add a card/i }),
  addCardName: (page) => page.getByLabel(/^card name/i).last(),
  addCardTier: (page) => page.locator("form").filter({ hasText: "Add a card" }).getByLabel(/tier/i),
  addCardChoosePhoto: (page) => page.locator("form").filter({ hasText: "Add a card" }).getByRole("button", { name: /^choose photo$/i }),
  addCardSubmit: (page) => page.getByRole("button", { name: /^add and receive card$/i }),
  // Stage moves: "Move to Humidor", "Move 3 cards to Ready for Slab Crack", …
  advanceTo: (scope, stage) => scope.getByRole("button", { name: new RegExp(`^Move\\b.*\\bto ${esc(stage)}$`, "i") }).first(),
  // "Mark done", "Mark card done" (card page), "Mark this card done" / "Mark these 3 cards done" (bag page)
  markDone: (scope) => scope.getByRole("button", { name: /^mark (this card |these \d+ cards |cards? |\d+ cards? |all )?done$/i }).first(),
  differentSteps: (page) => page.getByText(/cards at different steps/i).first(),
  newChip: (page, bagCode) => page.locator("li, tr, article, section div").filter({ hasText: bagCode }).getByText(/^New$/).first(),
  setupSelectAll: (page) => page.getByRole("checkbox", { name: /select all/i }).first(),
  setupPreview: (page) => page.getByRole("button", { name: /preview/i }).first(),
  setupRun: (page) => page.getByRole("button", { name: /^(confirm|run|set up|generate|start)\b/i }).first(),
  // The workspace's print step (components/intake/order-label-print.tsx): a section named by its
  // heading, "Print label(s)" while photos are missing, then "Ready to print" / "Label(s) printed".
  printStep: (page) => page.getByRole("region", { name: /^(print (the )?(order )?labels?|ready to print|(the )?(order )?labels? printed)\b/i })
    .or(page.locator('section[aria-labelledby="print-step-h"]')).first(),
  // A print-label button: "Print label", "Print labels", "Print 3 labels", "Print bag label",
  // "Reprint label(s)" (not "Print tag", not "Print all 3 labels")
  printButton: (scope) => scope.getByRole("button", { name: /^(re)?print (the )?(\d+ )?((order|bag) )?labels?\b/i }).first(),
  // How the step says how many received cards still need a receiving photo ("4 cards still need one",
  // "Print labels (4 photos missing)", …): the number and the word "photo" somewhere in the step
  saysNeedPhoto: (text, n) => new RegExp(`(^|[^0-9-])${n}([^0-9]|$)`).test(text) && /photo/i.test(text),
  // Once every card has its photo: "Ready to print: 3 labels (one per tier)"
  saysReady: (text, n) => new RegExp(`ready to print[^]{0,60}?(^|[^0-9-])${n} labels?\\b`, "i").test(text),
  // The bag label panel: one row per bag with "Print label"/"Reprint label", and "Print all N
  // labels" when the order has several bags. No "Print tag" anywhere any more (asserted absent).
  printAll: (page, n) => page.getByRole("button", { name: new RegExp(`^print all ${n} labels$`, "i") }),
  // Any tag-print button ("Print tag", "Print tags", "Reprint tag", "Print reusable tag"): must be gone
  printTag: (scope) => scope.getByRole("button", { name: /^(re)?print (the )?(\d+ )?(reusable )?(bag )?tags?\b/i }),
  // Label previews: <svg role="img" aria-label="…"> (components/intake/label-preview.tsx), named by
  // their Bag ID ("Label for bag CD-2549-G"); a tag preview (named "…tag…") must no longer appear
  previewSvgs: (page) => page.locator('svg[role="img"][viewBox]'),
  isTagPreview: (name) => /\btag\b/i.test(name ?? ""),
  // A collapsed preview opens with "Preview" / "Show preview" / "Label preview"
  previewToggles: (page) => page.getByRole("button", { name: /^(show )?(label )?preview$/i }),
  // Text printed on a bag's label (design "B · Name banner"), read from the label JSON
  labelAlsoInOrder: /also in this order/i,
  labelMore: /\+\s*(\d+)\s+more\b/i,
  // A photo on the photos page, by its file name (src, or srcset for next/image)
  photoImg: (page, fileStem) => page.locator(`img[src*="${fileStem}"], img[srcset*="${fileStem}"]`),
  // Photos page with ?bag: links to the bag page and to the whole order ("Whole order (10 cards in 4 bags)")
  bagPageLink: (page, bagId) => page.locator(`a[href*="/admin/receiving/bag/${bagId}"]`).first(),
  wholeOrderLink: (page) => page.getByRole("link", { name: /^whole order\b/i }).first(),
  // The Bags work board: one row per open bag (table row, list item or card), found by its own
  // "Open bag <Bag ID>" link (a row also names the order's other bags, so text alone can't tell)
  boardRow: (page, bagCode) => page.locator("tr, li, article, [role='row']").filter({ has: page.getByRole("link", { name: `Open bag ${bagCode}`, exact: true }) }),

  // ── Card tracking (from the brief; the pages were being built while these were written) ──
  // The Scan page's text box for a Bluetooth/USB handheld scanner (it types the code or link, then Enter)
  scanInput: (page) => page.getByRole("textbox", { name: /scan|code/i }).or(page.locator("input[data-scan-input], input[name='code']")).first(),
  // Scanning an EMPTY slot: "Put a card in CLAMP 01"
  putCardIn: (slotName) => new RegExp(`put a card in\\s+${esc(slotName)}(?!\\d)`, "i"),
  // A FULL slot shows its card(s) with these buttons
  slotMove: (page) => page.getByRole("button", { name: /^move\b/i }).first(),
  slotDone: (page) => page.getByRole("button", { name: /^(mark )?done\b/i }).first(),
  slotTakeOut: (page) => page.getByRole("button", { name: /^take (it |them )?out\b/i }).first(),
  // After a bag scan with a slot waiting, each card's row has "Put in CLAMP 01" (components/intake/scan/scan-app.tsx)
  pickCard: (page, cardCode) => {
    const row = page.locator("li").filter({ hasText: cardCode }).last();
    return row.getByRole("button", { name: /^put in\b/i }).or(row.getByRole("checkbox")).first();
  },
  // The menu item at the top of the intake group
  scanNavLink: (page) => page.getByRole("link", { name: /^scan$/i }).first(),
  // After Receive, the workspace says where the bags go: "Put in shelf: DUE MON DEC 7"
  putInShelf: /put in shelf/i,
  printShelfSign: (page) => page.getByRole("button", { name: /print (the )?shelf (sign|label)/i }).or(page.getByRole("link", { name: /print (the )?shelf (sign|label)/i })).first(),
  // Ship check page rows (components/intake/ship/ship-checklist.tsx): OK "Done · not in a slot"; flagged
  // "Not marked done · Step: …" (+ Mark done, then "Yes, mark done") or "Still in CLAMP 07 · marked done"
  shipRow: (page, cardCode) => page.locator("li, tr, article, [role='row']").filter({ hasText: cardCode }).last(),
  shipFlag: /⚠|not (marked )?done|still in/i,
  shipOk: /✅|\bdone\b.{0,4}not in a slot|^done\b|\bok\b/im,
  stillIn: (slotName) => new RegExp(`still in\\s+${esc(slotName)}(?!\\d)`, "i"),
  shipMarkDone: (scope) => scope.getByRole("button", { name: /^mark( as)? done\b/i }).first(),
  shipConfirmDone: (scope) => scope.getByRole("button", { name: /^yes,? mark( it)? done\b/i }).first(),
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const HOLIDAY_SET = new Set(HOLIDAYS.map(([d]) => d));
/** Independent check of the brief's rule: count starts the business day after `from`, skips weekends and holidays. */
export function addBusinessDays(from, n, holidays = HOLIDAY_SET) {
  const d = new Date(`${from}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(d.toISOString().slice(0, 10))) left--;
  }
  return d.toISOString().slice(0, 10);
}
const nyDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const TURNAROUND = { regular: 60, expedited: 45, premium: 20, ultra_premium: 15, elite: 10, fast_pass: 7 };
const STAGES = ["Ready for Slab Crack", "Humidor", "Humidity Press", "Book", "Heat Press", "Clamp Work", "Book with Weights", "Final Dry"];

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const mailCard = (i) => IDS.mailCards[i];
const MAIL_NAMES = ["Test Card Gold One", "Test Card Gold Two", "Test Card Gold Three", "Test Card Gold Four", "Test Card Silver One", "Test Card Silver Two", "Test Card Platinum One", "Test Card Platinum Two", "Test Card Platinum Three", "Test Card No Tier"];

const tables = async () => (await dump()).tables;
const bagsOf = (t, orderId) => t.tier_bags.filter((b) => b.order_id === orderId);
const cardsOf = (t, orderId) => t.cards.filter((c) => c.order_id === orderId);
/** Latest stage of a card from stage_update events (highest round, newest). */
function latestStage(t, cardId) {
  const evs = t.order_events.filter((e) => e.event_type === "stage_update" && e.metadata?.card_id === cardId);
  evs.sort((a, b) => (a.metadata.round ?? 1) - (b.metadata.round ?? 1) || Date.parse(a.created_at) - Date.parse(b.created_at));
  return evs.at(-1)?.metadata.stage ?? null;
}
/** stage_update rows for a card up to and including `upTo`, as the existing stage route writes them. */
function stageRows(orderId, cardId, upTo, startIso = "2026-11-16T14:00:00.000Z") {
  return STAGES.slice(0, STAGES.indexOf(upTo) + 1).map((stage, i) => ({
    id: crypto.randomUUID(), order_id: orderId, event_type: "stage_update", is_customer_visible: true,
    created_at: new Date(Date.parse(startIso) + i * 3600e3).toISOString(),
    description: `Stage: ${stage} [card:${cardId}]`, metadata: { card_id: cardId, stage, round: 1 },
  }));
}

async function api(ctx, method, url, data) {
  const res = await ctx.request.fetch(url, { method, data, failOnStatusCode: false, maxRedirects: 0 });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status(), body, headers: res.headers() };
}
async function receiveViaApi(ctx, orderId, cardIds, receivedOn) {
  const r = await api(ctx, "POST", ROUTES.receiveApi(orderId), { cardIds, receivedOn });
  assert(r.status < 300, `receive API ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}
const pngFile = (name, rgb) => ({ name, mimeType: "image/png", buffer: placeholderPng(rgb) });

// ─── Direct writes to the mock database (test setup) ────────────────────────
/**
 * fetch for supabase-js that trusts the harness's self-signed localhost certificate, the way
 * start.mjs's mock helpers do (Node's own fetch only reads extra CAs at process start).
 */
async function harnessFetch(input, init = {}) {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  const method = (init.method ?? req?.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? req?.headers ?? {});
  let body = init.body ?? null;
  if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) {
    // Blob, FormData, ArrayBuffer, URLSearchParams…: let the platform serialize it
    const r = new Request(url, { method, headers, body });
    if (!headers.has("content-type") && r.headers.get("content-type")) headers.set("content-type", r.headers.get("content-type"));
    body = Buffer.from(await r.arrayBuffer());
  }
  if (body != null) headers.set("content-length", String(Buffer.byteLength(body)));
  const certPath = path.join(RUN_DIR, "localhost-cert.pem");
  const ca = url.protocol === "https:" && fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;
  return new Promise((resolve, reject) => {
    const r = (url.protocol === "https:" ? https : http).request(url, { method, headers: Object.fromEntries(headers), ca }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v ?? [])) out.append(k, String(x));
        const empty = [204, 205, 304].includes(res.statusCode) || method === "HEAD";
        resolve(new Response(empty ? null : Buffer.concat(chunks), { status: res.statusCode, statusText: res.statusMessage, headers: out }));
      });
      res.on("error", reject);
    });
    r.on("error", reject);
    init.signal?.addEventListener?.("abort", () => r.destroy(new Error("aborted")));
    if (body != null) r.write(body);
    r.end();
  });
}
const mockDbs = new Map();
/** supabase-js (service role placeholder) against the harness's mock, for test setup writes. */
function mockDb(mockUrl = process.env.HARNESS_MOCK_URL) {
  if (!mockDbs.has(mockUrl)) {
    mockDbs.set(mockUrl, createClient(mockUrl, "placeholder-service", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: harnessFetch },
    }));
  }
  return mockDbs.get(mockUrl);
}
/** Receiving photos are stored as `${RECEIVING_PHOTO_STEM}<card id>.png` (so a page's <img> can be told apart). */
const RECEIVING_PHOTO_STEM = "harness-receiving-";
/**
 * One receiving photo per card, set directly in the mock (as if taken on the workspace): the PNG
 * goes into mock storage (card-photos), its public URL into cards.receiving_photo_urls.
 */
async function setReceivingPhotos(mockUrl, cardIds) {
  const db = mockDb(mockUrl);
  for (const [i, cid] of cardIds.entries()) {
    const name = `${RECEIVING_PHOTO_STEM}${cid}.png`;
    const up = await db.storage.from("card-photos").upload(name, placeholderPng([200 - ((i * 23) % 160), 80, 60 + ((i * 37) % 160)]), { contentType: "image/png", upsert: true });
    assert(!up.error, `photo upload for ${cid}: ${up.error?.message}`);
    const url = db.storage.from("card-photos").getPublicUrl(name).data.publicUrl;
    const { data, error } = await db.from("cards").update({ receiving_photo_urls: [url] }).eq("id", cid).select("id");
    assert(!error && data?.length === 1, `receiving_photo_urls on ${cid}: ${error?.message ?? "no such card"}`);
  }
}
/** Poll until a locator is enabled (a print button may wait for data), up to `timeout` ms. */
async function waitEnabled(locator, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await locator.isEnabled().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ─── Label checks (one label per tier bag) ──────────────────────────────────
const PT = 72;
/** GET a label route and parse its PDF (fails with the route's answer when it isn't one). */
async function labelPdf(ctx, url) {
  const res = await ctx.request.get(url, { failOnStatusCode: false });
  const type = res.headers()["content-type"] ?? "";
  if (!res.ok() || !type.includes("application/pdf")) throw new Error(`${url}: HTTP ${res.status()} ${type} ${(await res.text().catch(() => "")).slice(0, 160)}`);
  return PDFDocument.load(await res.body());
}
async function labelJson(ctx, url) {
  const r = await api(ctx, "GET", url);
  assert(r.status === 200 && r.body && typeof r.body === "object", `${url}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body;
}
function checkSettings(st) {
  assert(st && typeof st.stock === "string" && [st.contentWidthIn, st.widthIn, st.heightIn].every((v) => typeof v === "number" && v > 0), `settings: ${JSON.stringify(st)}`);
}
const isLabelPage = (p) => !!p && typeof p.width === "number" && typeof p.height === "number" && Array.isArray(p.elements) && Array.isArray(p.cardCodes);
const texts = (p) => p.elements.filter((e) => e.kind === "text" && String(e.text ?? "").trim());
const qrs = (p) => p.elements.filter((e) => e.kind === "qr");
const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
/** What a bag's QR must hold: qrUrl(<BAG CODE>), i.e. the site's /Q/<BAG CODE> in upper case (the harness's site is the local app). */
const bagQrData = (appUrl, bagCode) => [`${appUrl.replace(/\/+$/, "")}/q/${bagCode}`.toUpperCase(), `HTTPS://THECARDDOC1.COM/Q/${bagCode}`];
/** The order's bags and, per bag, its received cards (bag_id set, not refunded) in card-number order. */
function receivedByBag(t, orderId) {
  const bags = bagsOf(t, orderId);
  const cards = cardsOf(t, orderId).filter((c) => c.bag_id && c.status !== "refunded").sort((a, b) => a.card_seq - b.card_seq);
  return bags.map((b) => ({ bag: b, cards: cards.filter((c) => c.bag_id === b.id) }));
}

/**
 * The label checks for one order as it stands: the order route (JSON, PDF, ?bags=) and
 * every bag's own route. `title` prefixes the step names.
 */
async function labelSteps(s, ctx, { appUrl, orderId, customerName, title }) {
  const t = await tables();
  const want = receivedByBag(t, orderId);
  const orderNumber = t.orders.find((o) => o.id === orderId)?.order_number;
  let json = null;
  const entryOf = (bagId) => json?.bags?.find((b) => b.id === bagId);
  const needJson = () => assert(json, "no label JSON (see the step above)");

  await s.step(`${title}: ?format=json has one entry per bag, each with exactly ONE label page and no tag`, async () => {
    const body = await labelJson(ctx, ROUTES.orderLabel(orderId, "?format=json"));
    checkSettings(body.settings);
    assert(Array.isArray(body.bags), `bags is not an array: ${JSON.stringify(body).slice(0, 160)}`);
    eq(body.bags.map((b) => b.id).sort(), want.map((w) => w.bag.id).sort(), "bag ids (every bag of the order)");
    const w = body.settings.widthIn * PT, h = body.settings.heightIn * PT;
    for (const { bag, cards } of want) {
      const e = body.bags.find((b) => b.id === bag.id);
      eq(e.bagCode, bag.bag_code, "bagCode");
      eq(e.cardCount, cards.length, `${bag.bag_code} cardCount`);
      assert(Array.isArray(e.labels), `${bag.bag_code}: labels is not an array`);
      eq(e.labels.length, 1, `${bag.bag_code}: label pages`);
      assert(isLabelPage(e.labels[0]), `${bag.bag_code}: the label is not a LabelPage`);
      eq(e.tag, undefined, `${bag.bag_code}: tag (no reusable tag any more)`);
      assert(Math.abs(e.labels[0].width - w) < 1 && Math.abs(e.labels[0].height - h) < 1, `${bag.bag_code}: label ${e.labels[0].width}x${e.labels[0].height} pt, stock ${w}x${h} pt`);
    }
    json = body;
    return want.map((x) => `${x.bag.bag_code} ${x.cards.length}`).join(", ");
  }, { shot: false });

  await s.step(`${title}: each label has ONE QR, its bag's (…/Q/<BAG CODE>), at least 1 in`, async () => {
    needJson();
    const out = [];
    for (const { bag } of want) {
      const e = entryOf(bag.id);
      const ok = bagQrData(appUrl, bag.bag_code);
      const q = qrs(e.labels[0]);
      eq(q.length, 1, `${bag.bag_code}: QR codes on the label (no card QR codes)`);
      assert(ok.includes(q[0].data), `${bag.bag_code}: QR holds "${q[0].data}", expected ${ok.join(" or ")}`);
      const size = qrs(e.labels[0])[0].size;
      assert(size >= PT - 0.5, `${bag.bag_code}: QR ${(size / PT).toFixed(2)} in, want at least 1 in`);
      out.push(`${bag.bag_code} ${(size / PT).toFixed(2)} in`);
    }
    return `${qrs(entryOf(want[0].bag.id).labels[0])[0].data}; ${out.join(", ")}`;
  }, { shot: false });

  await s.step(`${title}: the customer name is the largest type on every label`, async () => {
    needJson();
    const full = norm(customerName);
    const isName = (e) => { const x = norm(String(e.text).replace(/…$/, "")); return x.includes(full) || (x.length >= 4 && full.includes(x)); };
    const out = [];
    for (const { bag } of want) {
      const all = texts(entryOf(bag.id).labels[0]);
      const name = all.filter(isName);
      assert(name.length, `${bag.bag_code}: customer name "${customerName}" not on the label`);
      const nameSize = Math.max(...name.map((e) => e.size));
      const top = all.filter((e) => !isName(e)).reduce((a, e) => (e.size > (a?.size ?? 0) ? e : a), null);
      assert(!top || nameSize >= top.size, `${bag.bag_code}: name ${nameSize} pt is smaller than "${top.text}" ${top.size} pt`);
      out.push(`${bag.bag_code} name ${nameSize.toFixed(1)} pt vs next "${top?.text ?? "-"}" ${top?.size?.toFixed(1) ?? "-"} pt`);
    }
    return out.join("; ");
  }, { shot: false });

  await s.step(`${title}: each label lists its bag's cards in card order (all, or what fits + "+N more: scan the QR"), Bag ID, order number, other bags`, async () => {
    needJson();
    const out = [];
    for (const { bag, cards } of want) {
      const p = entryOf(bag.id).labels[0];
      const codes = cards.map((c) => c.card_code);
      const listed = p.cardCodes;
      const strangers = listed.filter((c) => !codes.includes(c));
      assert(!strangers.length, `${bag.bag_code}: lists cards from outside the bag: ${strangers.join(", ")}`);
      eq(new Set(listed).size, listed.length, `${bag.bag_code}: a card listed twice`);
      eq(listed, codes.filter((c) => listed.includes(c)), `${bag.bag_code}: cards in card-number order`);
      const text = texts(p).map((e) => e.text).join(" | ");
      const more = UI.labelMore.exec(text);
      if (listed.length < codes.length) {
        assert(more, `${bag.bag_code}: lists ${listed.length} of ${codes.length} cards with no "+N more" line`);
        eq(Number(more[1]), codes.length - listed.length, `${bag.bag_code}: "+N more" count`);
        assert(/scan/i.test(text), `${bag.bag_code}: the "+N more" line doesn't point at the QR`);
      }
      if (codes.length <= 16) eq(listed.length, codes.length, `${bag.bag_code}: cards listed (every card fits up to 16)`);
      assert(text.includes(bag.bag_code), `${bag.bag_code}: Bag ID not on its label`);
      assert(text.includes(orderNumber), `${bag.bag_code}: order number ${orderNumber} not on its label`);
      const others = want.filter((x) => x.bag.id !== bag.id);
      if (others.length) {
        assert(UI.labelAlsoInOrder.test(text), `${bag.bag_code}: no "Also in this order" line for ${others.map((x) => x.bag.bag_code).join(", ")}`);
        assert(others.some((x) => text.includes(x.bag.bag_code)), `${bag.bag_code}: "Also in this order" names none of ${others.map((x) => x.bag.bag_code).join(", ")}`);
      } else {
        assert(!UI.labelAlsoInOrder.test(text), `${bag.bag_code}: "Also in this order" on a one-bag order`);
      }
      out.push(`${bag.bag_code} ${listed.length}/${codes.length}${more ? ` ${more[0]}` : ""}`);
    }
    return out.join(", ");
  }, { shot: false });

  await s.step(`${title}: order PDF = one page per bag at the label size; ?bags=<one> = 1 page`, async () => {
    needJson();
    const doc = await labelPdf(ctx, ROUTES.orderLabel(orderId));
    eq(doc.getPageCount(), want.length, "order PDF pages (one per bag)");
    for (const pg of doc.getPages()) {
      const { width, height } = pg.getSize();
      const l = json.bags[0].labels[0];
      assert(Math.abs(width - l.width) < 1 && Math.abs(height - l.height) < 1, `page ${width}x${height} pt, label ${l.width}x${l.height} pt`);
    }
    eq((await labelPdf(ctx, ROUTES.orderLabel(orderId, `?bags=${want[0].bag.id}`))).getPageCount(), 1, "?bags=<one bag> pages");
    const { width, height } = doc.getPage(0).getSize();
    return `${doc.getPageCount()} page(s) of ${Math.round(width)}x${Math.round(height)} pt`;
  }, { shot: false });

  await s.step(`${title}: each bag's own route: PDF 1 page, ?format=json = that bag with the same label and no tag`, async () => {
    needJson();
    for (const { bag } of want) {
      eq((await labelPdf(ctx, ROUTES.bagLabel(bag.id))).getPageCount(), 1, `${bag.bag_code} PDF pages`);
      const one = await labelJson(ctx, ROUTES.bagLabel(bag.id, "?format=json"));
      eq((one.bags ?? []).map((b) => b.id), [bag.id], `${bag.bag_code} JSON bags`);
      eq(one.bags[0].labels.length, 1, `${bag.bag_code} JSON label pages`);
      eq(one.bags[0].tag, undefined, `${bag.bag_code} JSON tag (no reusable tag any more)`);
      eq(one.bags[0].labels[0].cardCodes, entryOf(bag.id).labels[0].cardCodes, `${bag.bag_code} JSON cards (same as the order's)`);
      eq(qrs(one.bags[0].labels[0]).map((q) => q.data), qrs(entryOf(bag.id).labels[0]).map((q) => q.data), `${bag.bag_code} JSON QR (same as the order's)`);
    }
    return `${want.length} bag route(s)`;
  }, { shot: false });
}

/** Names (aria-label) of the label-size <svg role="img"> previews on the page; opens collapsed previews if fewer than `want` show. */
async function previewNames(page, settings, want) {
  const w = settings.widthIn * PT, h = settings.heightIn * PT;
  const read = () => UI.previewSvgs(page).evaluateAll((els, [w, h]) => els.filter((el) => {
    const v = (el.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    return v.length === 4 && Math.abs(v[2] - w) < 0.5 && Math.abs(v[3] - h) < 0.5;
  }).map((el) => el.getAttribute("aria-label") ?? ""), [w, h]);
  const labelsIn = (names) => names.filter((n) => !UI.isTagPreview(n));
  const settle = async (ms) => {
    const end = Date.now() + ms;
    let names = await read();
    while (labelsIn(names).length < want && Date.now() < end) { await page.waitForTimeout(500); names = await read(); }
    return names;
  };
  let names = await settle(15_000);
  if (labelsIn(names).length < want) {
    for (const b of await UI.previewToggles(page).all()) if (await b.isVisible() && (await b.getAttribute("aria-expanded")) !== "true") await b.click().catch(() => {});
    names = await settle(15_000);
  }
  await page.waitForTimeout(500);
  return read();
}

// ─── Card tracking helpers (serial-numbered slots) ──────────────────────────
const MM = PT / 25.4;
/** The Katasymbol label, portrait: 50 mm wide, 80 mm tall (141.7 x 226.8 pt). Slot labels print on it. */
const LABEL_50X80 = { w: 50 * MM, h: 80 * MM };
const STOCK_4X6 = { w: 4 * PT, h: 6 * PT };
/** store_config key and value of the bag-label stock setting (lib/intake/labels/stock.ts). */
const LABEL_STOCK_KEY = "intake_label_stock";
const STOCK_50X80 = "50x80mm";
const CUSTOMER_A = "test.customer.a@example.com";
const CUSTOMER_G = "test.customer.g@example.com";
/** Station types (lib/intake/tracking/stations.ts STATION_TYPES): key -> slot name prefix, step. */
const STATIONS = {
  "slab-crack": { name: "SLAB CRACK", stage: "Ready for Slab Crack" },
  humidor: { name: "HUMIDOR", stage: "Humidor" },
  "humidity-press": { name: "HUMIDITY PRESS", stage: "Humidity Press" },
  drying: { name: "DRYING", stage: "Book" },
  "heat-press": { name: "HEAT PRESS", stage: "Heat Press" },
  clamp: { name: "CLAMP", stage: "Clamp Work" },
  "book-weights": { name: "BOOK WEIGHTS", stage: "Book with Weights" },
  "final-dry": { name: "FINAL DRY", stage: "Final Dry" },
};
const nn = (n) => String(n).padStart(2, "0");
/** LOC-CLAMP-07 and "CLAMP 07" for a station type and number. */
const slotCode = (station, n) => `LOC-${station.toUpperCase()}-${nn(n)}`;
const slotName = (station, n) => `${STATIONS[station].name} ${nn(n)}`;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sameSize = (a, b) => Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
const pageSize = (p) => ({ w: p.width, h: p.height });
const ptText = (sz) => `${sz.w.toFixed(1)}x${sz.h.toFixed(1)} pt`;
/** What any code's QR holds (slot, place or bag): the site's /Q/<CODE> in upper case. */
const codeQrData = bagQrData;
const placeOf = (t, code) => t.locations.find((l) => l.code === code);
const cardByCode = (t, code) => t.cards.find((c) => c.card_code === code);
const bagByCode = (t, code) => t.tier_bags.find((b) => b.bag_code === code);
/** Card IDs of the cards in a slot now (cards.location_id), sorted. */
const cardsIn = (t, locCode) => { const l = placeOf(t, locCode); return l ? t.cards.filter((c) => c.location_id === l.id).map((c) => c.card_code).sort() : []; };
const movesOf = (t, cardId) => t.card_moves.filter((m) => m.card_id === cardId);
const stageEventCount = (t) => t.order_events.filter((e) => e.event_type === "stage_update").length;
const mailsTo = (list, email) => list.filter((m) => JSON.stringify(m.to ?? "").includes(email));
const todayNy = () => nyDay(new Date().toISOString());
/** Independent of the app: a shelf slot's code and name for a due date ("LOC-SHELF-20261207", "DUE MON DEC 7"). */
const shelfCode = (day) => `LOC-SHELF-${day.replaceAll("-", "")}`;
function shelfName(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return `DUE ${wd} ${mon} ${d.getUTCDate()}`;
}
/** A name as a regex that doesn't match a longer number ("DUE MON DEC 7" vs "... DEC 14", "CLAMP 01" vs "CLAMP 010"). */
const nameRe = (name, flags = "") => new RegExp(`${esc(name)}(?!\\d)`, flags);

/** The bag-label stock setting, written straight into the mock's store_config (as the Settings page saves it). */
async function setLabelStock(mockUrl, stock) {
  const { error } = await mockDb(mockUrl).from("store_config").upsert({ key: LABEL_STOCK_KEY, value: stock, updated_at: new Date().toISOString() });
  assert(!error, `label stock setting: ${error?.message}`);
}
/** Change cards or places directly in the mock (test setup: a refund, an old placement, a capacity). */
async function mockUpdate(mockUrl, table, patch, column, value) {
  const { data, error } = await mockDb(mockUrl).from(table).update(patch).eq(column, value).select("*");
  assert(!error && data?.length, `${table} ${column}=${value}: ${error?.message ?? "no such row"}`);
  return data;
}
/** POST { station, count, startAt? } to the locations API: numbered slots (CreateSlotsResponse). */
async function bulkSlots(ctx, station, count, startAt) {
  const r = await api(ctx, "POST", ROUTES.trackLocations(), { station, count, ...(startAt ? { startAt } : {}) });
  assert([200, 201].includes(r.status) && Array.isArray(r.body?.created), `make ${count} ${station} slots: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}
/** A tracking action (assign, move, release, done): the raw answer. */
const trackPost = (ctx, route, data) => api(ctx, "POST", route, data);
/** A tracking action that must succeed: 200 with results (TrackActionResponse). */
async function trackOk(ctx, route, data) {
  const r = await trackPost(ctx, route, data);
  assert(r.status === 200 && Array.isArray(r.body?.results), `${route} ${JSON.stringify(data).slice(0, 120)}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}
const assignOk = (ctx, locationCode, cardIds, force) => trackOk(ctx, ROUTES.trackAssign, { locationCode, cardIds, ...(force ? { force: true } : {}) });
const resultOf = (body, cardId) => body.results.find((r) => r.cardId === cardId) ?? null;
const freedCodes = (body) => (body.freed ?? []).map((l) => l.code).sort();
/** A refusal for being over capacity: 409 { overCapacity: true, capacity, occupants } (CapacityConflict). */
function checkCapacityConflict(r, capacity, occupantCodes) {
  eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
  eq(r.body?.overCapacity, true, "overCapacity");
  eq(r.body.capacity, capacity, "capacity");
  eq((r.body.occupants ?? []).map((c) => c.code).sort(), [...occupantCodes].sort(), "occupants");
  assert(typeof r.body.error === "string" && r.body.error, "no error message");
  return r.body.error;
}
/** GET /api/admin/track/resolve; fails unless 200 and the expected kind (ResolveResponse). */
async function resolveVia(ctx, code, kind) {
  const r = await api(ctx, "GET", ROUTES.trackResolve(code));
  assert(r.status === 200, `resolve "${code}": HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  eq(r.body?.kind, kind, `resolve "${code}" kind`);
  assert(r.body[kind] && typeof r.body[kind] === "object", `resolve "${code}": no "${kind}" object in ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body[kind];
}
async function searchVia(ctx, q) {
  const r = await api(ctx, "GET", ROUTES.trackSearch(q));
  assert(r.status === 200 && Array.isArray(r.body?.cards), `search "${q}": HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body;
}
async function shipCheckVia(ctx, code) {
  const r = await api(ctx, "GET", ROUTES.shipCheck(code));
  assert(r.status === 200 && Array.isArray(r.body?.cards), `ship check "${code}": HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body;
}
const statusOf = (body, code) => body.cards.find((c) => c.code === code)?.status ?? "(not listed)";
/** Every object in a JSON answer whose `code` is a shelf slot code (the receive answer's "put in shelf" slots). */
function shelvesIn(body) {
  const out = new Map();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    if (typeof v.code === "string" && /^LOC-SHELF-\d{8}$/.test(v.code) && !out.has(v.code)) out.set(v.code, v);
    Object.values(v).forEach(walk);
  };
  walk(body);
  return [...out.values()];
}
/** Every LabelPage-shaped object in a JSON answer (the slot label route), in order. */
function labelPagesIn(body) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    if (typeof v.width === "number" && typeof v.height === "number" && Array.isArray(v.elements)) { out.push(v); return; }
    Object.values(v).forEach(walk);
  };
  walk(body);
  return out;
}
/** PDF page sizes of a label route. */
async function pdfSizes(ctx, url) {
  const doc = await labelPdf(ctx, url);
  return doc.getPages().map((p) => { const { width, height } = p.getSize(); return { w: width, h: height }; });
}
/**
 * A slot or place QR label: one QR (its /Q/<LOC code>, at least 0.9 in), the code printed, and the
 * name ("CLAMP 07", "DUE MON DEC 7") the biggest type on it (a long name may wrap over lines).
 */
function checkPlaceLabel(p, appUrl, code, name) {
  const q = qrs(p);
  eq(q.length, 1, `${code}: QR codes on the label`);
  assert(codeQrData(appUrl, code).includes(q[0].data), `${code}: QR holds "${q[0].data}", expected ${codeQrData(appUrl, code).join(" or ")}`);
  assert(q[0].size >= 0.9 * PT - 0.5, `${code}: QR ${(q[0].size / PT).toFixed(2)} in, want at least 0.9 in`);
  const all = texts(p);
  const joined = norm(all.map((e) => e.text).join(" "));
  assert(joined.includes(norm(code)), `${code}: the code isn't printed on the label`);
  const full = norm(name);
  // the name, or a line of it ("CLAMP" / "07"); the printed code itself is not the name
  const isName = (e) => { const x = norm(e.text); return x !== norm(code) && (x === full || (x.length >= 2 && full.includes(x))); };
  const named = all.filter(isName);
  assert(named.length && joined.includes(full), `${code}: name "${name}" not on the label (texts: ${all.map((e) => e.text).join(" | ").slice(0, 160)})`);
  const nameSize = Math.max(...named.map((e) => e.size));
  const top = all.filter((e) => !isName(e)).reduce((a, e) => (e.size > (a?.size ?? 0) ? e : a), null);
  assert(!top || nameSize >= top.size, `${code}: name ${nameSize} pt is smaller than "${top.text}" ${top.size} pt`);
  return `name ${nameSize.toFixed(0)} pt, QR ${(q[0].size / PT).toFixed(2)} in`;
}
/** A phone (iPhone 13, 390 px) context that records browser errors. */
async function phoneContext(browser, appUrl) {
  const ctx = await newAdminContext(browser, { phone: true, appUrl });
  ctx.setDefaultTimeout(30_000);
  ctx.setDefaultNavigationTimeout(240_000);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept().catch(() => {}));
  return { ctx, page, errors };
}
const sidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Type a code (or a scanned link) into the Scan page's handheld-scanner box and press Enter, as a scanner does. */
async function scanType(page, text) {
  const box = UI.scanInput(page);
  await box.waitFor({ timeout: 30_000 });
  await box.fill(text);
  await box.press("Enter");
}
/**
 * The usual tracking setup: CD-2549 Gold 01-04 + Platinum 07-08 received on 2026-11-15 (bags
 * CD-2549-G, CD-2549-P) and CD-2600-01 on 2026-11-20 (bag CD-2600-G); then the slots asked for
 * ({ clamp: 5, "heat-press": 3 }) made through the bulk API. Returns the tables.
 */
async function trackSetup(ctx, slots = {}) {
  await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 2, 3, 6, 7].map(mailCard), "2026-11-15");
  await receiveViaApi(ctx, IDS.bigOrder, [IDS.bigCards[0]], "2026-11-20");
  for (const [station, count] of Object.entries(slots)) await bulkSlots(ctx, station, count);
  const t = await tables();
  eq(cardByCode(t, "CD-2549-01")?.id, mailCard(0), "CD-2549-01 is Gold One");
  eq(cardByCode(t, "CD-2549-07")?.id, mailCard(6), "CD-2549-07 is Platinum One");
  eq(cardByCode(t, "CD-2600-01")?.id, IDS.bigCards[0], "CD-2600-01");
  for (const [station, count] of Object.entries(slots)) {
    const missing = range(1, count).map((n) => slotCode(station, n)).filter((c) => !placeOf(t, c));
    assert(!missing.length, `slots not made: ${missing.join(", ")}`);
  }
  return t;
}
const cardIdOf = (t, code) => { const c = cardByCode(t, code); assert(c, `no card ${code}`); return c.id; };

// ─── Runner ─────────────────────────────────────────────────────────────────
class Scenario {
  constructor(name, page, results) {
    this.name = name; this.page = page; this.results = results; this.n = 0; this.stopped = null;
  }
  async step(title, fn, { critical = false, shot = true } = {}) {
    this.n++;
    const tag = `${this.name} #${this.n} ${title}`;
    if (this.stopped) {
      this.results.push({ scenario: this.name, step: title, status: "SKIP", note: `after failed: ${this.stopped}` });
      console.log(`  SKIP  ${tag}`);
      return undefined;
    }
    let out;
    try {
      out = await fn();
      this.results.push({ scenario: this.name, step: title, status: "PASS", note: typeof out === "string" ? out : "" });
      console.log(`  PASS  ${tag}${typeof out === "string" && out ? `  (${out})` : ""}`);
    } catch (e) {
      const msg = String(e?.message ?? e).split("\n")[0].slice(0, 400);
      this.results.push({ scenario: this.name, step: title, status: "FAIL", note: msg });
      console.log(`  FAIL  ${tag}\n        ${msg}`);
      if (critical) this.stopped = title;
    } finally {
      if (shot && this.page && !this.page.isClosed()) {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
        await this.page.screenshot({ path: path.join(OUT, `${this.name}-${String(this.n).padStart(2, "0")}-${slug}.png`), fullPage: true }).catch(() => {});
      }
    }
    return out;
  }
}

async function goto(page, url) {
  const res = await page.goto(url, { waitUntil: "load", timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const status = res?.status() ?? 0;
  assert(!new URL(page.url()).pathname.startsWith("/admin/login"), `${url}: sent to the sign-in page`);
  assert(status < 400, `${url}: HTTP ${status}`);
  return res;
}
/** Click and wait for the API call it makes (a POST/PATCH whose URL contains `part`). */
async function clickForApi(page, locator, part, timeout = 60_000) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(part) && r.request().method() !== "GET", { timeout }),
    locator.click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  return res;
}
async function phoneShot(browser, appUrl, url, name) {
  const ctx = await newAdminContext(browser, { phone: true, appUrl });
  const p = await ctx.newPage();
  try {
    await p.goto(url, { waitUntil: "load", timeout: 240_000 });
    await p.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await p.screenshot({ path: path.join(OUT, `${name}-phone.png`), fullPage: true });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    return overflow > 1 ? `phone page scrolls sideways by ${overflow}px` : "";
  } finally {
    await ctx.close();
  }
}

// ─── Scenarios ──────────────────────────────────────────────────────────────
const SCENARIOS = {
  // Search by order number and by customer name, open the receiving workspace
  async search({ page, s }) {
    await s.step("open /admin/receiving", () => goto(page, ROUTES.receiving), { critical: true });
    await s.step("search by order number finds the order", async () => {
      await UI.searchBox(page).fill(ORDER_NUMBERS.mailOrder);
      await UI.searchBox(page).press("Enter");
      await page.waitForLoadState("networkidle");
      await UI.searchResultLink(page, ORDER_NUMBERS.mailOrder).waitFor({ timeout: 15_000 });
    });
    await s.step("search by customer name finds the order", async () => {
      await goto(page, `${ROUTES.receiving}?q=${encodeURIComponent("Test Customer A")}`);
      await UI.searchResultLink(page, ORDER_NUMBERS.mailOrder).waitFor({ timeout: 15_000 });
    });
    await s.step("search by email finds the order", async () => {
      await goto(page, `${ROUTES.receiving}?q=${encodeURIComponent("test.customer.a@example.com")}`);
      await UI.searchResultLink(page, ORDER_NUMBERS.mailOrder).waitFor({ timeout: 15_000 });
    });
    await s.step("result opens the receiving workspace", async () => {
      await UI.searchResultLink(page, ORDER_NUMBERS.mailOrder).click();
      await page.waitForURL(new RegExp(`/admin/receiving/${IDS.mailOrder}`), { timeout: 60_000 });
      await page.getByText("Test Card Gold One").first().waitFor();
    });
  },

  // Receive 2 Gold + 1 Silver + 2 Platinum on Nov 15: three bags, Platinum due Dec 7
  async "receive-partial"({ page, ctx, s, browser, appUrl }) {
    const picked = [0, 1, 4, 6, 7];
    await s.step("open the receiving workspace", () => goto(page, ROUTES.receivingOrder(IDS.mailOrder)), { critical: true });
    await s.step("shows customer, order, expected cards, customer photos and instructions", async () => {
      const text = await page.locator("main").innerText();
      for (const want of ["Test Customer A", ORDER_NUMBERS.mailOrder, "Test Card Platinum Three", "4/102", "Test instruction: crease near the bottom edge."]) assert(text.includes(want), `"${want}" not shown`);
      assert(await page.locator('img[src*="seed-a-card01-front"]').count() > 0, "customer photo of card 1 not shown");
    });
    let viaUi = false;
    await s.step("tick 5 arrived cards, received on 2026-11-15, Receive", async () => {
      for (const i of picked) await UI.arrived(page, MAIL_NAMES[i]).check();
      await UI.receivedOn(page).fill("2026-11-15");
      const res = await clickForApi(page, UI.receiveButton(page), "/receive");
      assert(res.status() < 300, `receive answered ${res.status()}: ${await res.text()}`);
      viaUi = true;
    });
    if (!viaUi) await s.step("(fallback) receive through the API", () => receiveViaApi(ctx, IDS.mailOrder, picked.map(mailCard), "2026-11-15"), { critical: true });
    const t = await tables();
    await s.step("three bags CD-2549-G/-S/-P, batch 1, received 2026-11-15", async () => {
      const bags = bagsOf(t, IDS.mailOrder);
      eq(bags.map((b) => b.bag_code).sort(), ["CD-2549-G", "CD-2549-P", "CD-2549-S"], "bag codes");
      assert(bags.every((b) => b.batch === 1 && b.received_on === "2026-11-15"), "batch/received_on");
    }, { shot: false });
    await s.step("due dates: Platinum 2026-12-07, Gold and Silver by max turnaround in business days", async () => {
      const by = Object.fromEntries(bagsOf(t, IDS.mailOrder).map((b) => [b.tier, b]));
      eq(by.ultra_premium.due_date, "2026-12-07", "Platinum due");
      eq(by.ultra_premium.turnaround_days, 15, "Platinum turnaround snapshot");
      eq(by.premium.due_date, addBusinessDays("2026-11-15", TURNAROUND.premium), "Gold due");
      eq(by.expedited.due_date, addBusinessDays("2026-11-15", TURNAROUND.expedited), "Silver due");
      assert(Object.values(by).every((b) => b.due_status === "calculated"), "due_status should be calculated");
      return `G ${by.premium.due_date}, S ${by.expedited.due_date}, P ${by.ultra_premium.due_date}`;
    }, { shot: false });
    await s.step("received cards are in their tier's bag; the rest are awaiting arrival", async () => {
      const bagTier = Object.fromEntries(bagsOf(t, IDS.mailOrder).map((b) => [b.id, b.tier]));
      for (const [i, cid] of IDS.mailCards.entries()) {
        const c = t.cards.find((x) => x.id === cid);
        if (picked.includes(i)) {
          assert(c.received_at && c.bag_id && !c.awaiting_arrival, `${MAIL_NAMES[i]} not received properly`);
          eq(bagTier[c.bag_id], MAIL_CARD_TIERS[i], `${MAIL_NAMES[i]} bag tier`);
        } else {
          assert(!c.received_at && !c.bag_id && c.awaiting_arrival === true, `${MAIL_NAMES[i]} should be awaiting arrival`);
        }
      }
    }, { shot: false });
    await s.step("every card has a Card ID CD-2549-01..10 in (created_at, id) order, no duplicates", async () => {
      const cs = cardsOf(t, IDS.mailOrder).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      eq(cs.map((c) => c.card_code), cs.map((_, i) => `CD-2549-${String(i + 1).padStart(2, "0")}`), "card codes");
      eq(cs.map((c) => c.card_seq), cs.map((_, i) => i + 1), "card_seq");
    }, { shot: false });
    await s.step("order moved to received once, with one 'Cards Received' event and a cards_received event", async () => {
      eq(t.orders.find((o) => o.id === IDS.mailOrder).status, "received", "order status");
      const evs = t.order_events.filter((e) => e.order_id === IDS.mailOrder);
      eq(evs.filter((e) => e.description === "Status updated to: Cards Received").length, 1, "'Cards Received' events");
      const rec = evs.filter((e) => e.event_type === "cards_received");
      eq(rec.length, 1, "cards_received events");
      assert(/^Received 5 of 10 cards/.test(rec[0].description ?? ""), `cards_received text: ${rec[0].description}`);
      return rec[0].description;
    }, { shot: false });
    await s.step("backlog rule (backlog_now: unfinished, not awaiting) counts the 5 received cards, not the 5 awaiting", async () => {
      const d = await dump();
      const unfinished = d.tables.cards.filter((c) => {
        const o = d.tables.orders.find((x) => x.id === c.order_id);
        return ["received", "in_progress"].includes(o.status) && o.payment_status === "paid" && !c.completed && c.status !== "refunded" && !c.awaiting_arrival;
      });
      eq(unfinished.filter((c) => c.order_id === IDS.mailOrder).length, 5, "mail order cards in backlog");
    }, { shot: false });
    await s.step("page shows the three bags with their due dates", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      const text = await page.locator("main").innerText();
      for (const code of ["CD-2549-G", "CD-2549-S", "CD-2549-P"]) assert(text.includes(code), `${code} not shown`);
      assert(/Dec(ember)? 7, 2026|2026-12-07|12\/7\/2026/.test(text), "Platinum due date Dec 7, 2026 not shown");
    });
    await s.step("emails: customer told once (status change), nothing sent for real", async () => {
      const mails = await emails();
      const toCustomer = mails.filter((m) => JSON.stringify(m.to).includes("test.customer.a@example.com"));
      assert(toCustomer.length <= 1, `${toCustomer.length} emails to the customer for one receive`);
      return `${mails.length} captured (${toCustomer.length} to customer)`;
    }, { shot: false });
    await s.step("phone layout (390px) has no sideways scroll", () => phoneShot(browser, appUrl, ROUTES.receivingOrder(IDS.mailOrder), "receive-partial-workspace").then((w) => { assert(!w, w); }));
  },

  // The rest arrives on Nov 18: batch 2 bags; the no-tier card needs a tier first
  async "receive-rest"({ page, ctx, s }) {
    await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 4, 6, 7].map(mailCard), "2026-11-15");
    const rest = [2, 3, 5, 8];
    await s.step("open the workspace", () => goto(page, ROUTES.receivingOrder(IDS.mailOrder)), { critical: true });
    await s.step("tick the other 4 tiered cards, received 2026-11-18, Receive", async () => {
      for (const i of rest) await UI.arrived(page, MAIL_NAMES[i]).check();
      await UI.receivedOn(page).fill("2026-11-18");
      const res = await clickForApi(page, UI.receiveButton(page), "/receive");
      assert(res.status() < 300, `receive answered ${res.status()}`);
    });
    let t = await tables();
    if (!bagsOf(t, IDS.mailOrder).some((b) => b.batch === 2)) {
      await s.step("(fallback) receive through the API", () => receiveViaApi(ctx, IDS.mailOrder, rest.map(mailCard), "2026-11-18"));
      t = await tables();
    }
    await s.step("second batch: CD-2549-G2/-S2/-P2 received 2026-11-18, own due dates", async () => {
      const b2 = bagsOf(t, IDS.mailOrder).filter((b) => b.batch === 2);
      eq(b2.map((b) => b.bag_code).sort(), ["CD-2549-G2", "CD-2549-P2", "CD-2549-S2"], "batch 2 codes");
      for (const b of b2) {
        eq(b.received_on, "2026-11-18", `${b.bag_code} received_on`);
        eq(b.due_date, addBusinessDays("2026-11-18", TURNAROUND[b.tier]), `${b.bag_code} due`);
      }
      const b1 = bagsOf(t, IDS.mailOrder).filter((b) => b.batch === 1);
      eq(b1.find((b) => b.tier === "ultra_premium").due_date, "2026-12-07", "batch 1 Platinum due unchanged");
    }, { shot: false });
    await s.step("receiving the card with no tier is refused and names the card (page)", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      await UI.arrived(page, MAIL_NAMES[9]).check();
      // the page may refuse before calling the API, or show the API's refusal
      await UI.receiveButton(page).click();
      await UI.alert(page).waitFor({ timeout: 30_000 });
      const msg = await UI.alert(page).innerText();
      assert(/tier/i.test(msg) && /10|No Tier/.test(msg), `refusal should name card 10 and the tier: "${msg}"`);
      const c = (await tables()).cards.find((x) => x.id === mailCard(9));
      assert(!c.received_at, "card was received without a tier");
      return msg;
    });
    await s.step("the receive API refuses it too, naming the card", async () => {
      const r = await api(ctx, "POST", ROUTES.receiveApi(IDS.mailOrder), { cardIds: [mailCard(9)], receivedOn: "2026-11-18" });
      assert(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
      const msg = JSON.stringify(r.body);
      assert(/tier/i.test(msg) && /10|No Tier/.test(msg), `refusal should name card 10: ${msg}`);
      assert(!(await tables()).cards.find((x) => x.id === mailCard(9)).received_at, "received without a tier");
      return msg.slice(0, 120);
    }, { shot: false });
    await s.step("pick Bronze for it, then receive: CD-2549-B", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/tier") && r.request().method() !== "GET", { timeout: 30_000 }),
        UI.tierSelect(page, MAIL_NAMES[9]).selectOption("regular"),
      ]);
      // the page refreshes its data after the change; until then it still thinks the card has no tier
      await UI.cardRow(page, MAIL_NAMES[9], page.getByRole("combobox")).getByText(/^Missing tier$/).waitFor({ state: "detached", timeout: 30_000 });
      await UI.arrived(page, MAIL_NAMES[9]).check();
      const res = await clickForApi(page, UI.receiveButton(page), "/receive");
      assert(res.status() < 300, `receive answered ${res.status()}`);
      const tt = await tables();
      assert(bagsOf(tt, IDS.mailOrder).some((b) => b.bag_code === "CD-2549-B" && b.tier === "regular"), "no Bronze bag CD-2549-B");
    });
    await s.step("all cards received, none awaiting, still one 'Cards Received' event", async () => {
      const tt = await tables();
      assert(cardsOf(tt, IDS.mailOrder).every((c) => c.received_at && !c.awaiting_arrival), "a card is not received");
      eq(tt.order_events.filter((e) => e.order_id === IDS.mailOrder && e.description === "Status updated to: Cards Received").length, 1, "'Cards Received' events");
      eq(tt.orders.filter((o) => o.customer_email === "test.customer.a@example.com").length, 1, "orders for customer A (no duplicate order)");
    }, { shot: false });
    await s.step("a bagged card can't change tier through the order page's switch (409, tier unchanged)", async () => {
      const r = await api(ctx, "PATCH", `/api/admin/cards/${mailCard(0)}/tier`, { tier: "elite" });
      eq(r.status, 409, "status");
      assert(/CD-2549-G/.test(r.body?.error ?? ""), `message should name the bag: ${JSON.stringify(r.body)}`);
      eq((await tables()).cards.find((x) => x.id === mailCard(0)).tier, "premium", "tier");
      return r.body.error.slice(0, 90);
    }, { shot: false });
  },

  // In-person drop-off: add a card with a photo to the existing order and receive it
  async "dropoff-add-card"({ page, ctx, s, mockUrl }) {
    const before = await tables();
    if (process.env.INTERCEPT_UPLOAD === "1") {
      await page.route("**/api/upload", (route) => route.fulfill({ json: { url: `${mockUrl}/storage/v1/object/public/card-photos/intercepted-${Date.now()}.png` } }));
    }
    await s.step("open the drop-off order's workspace", () => goto(page, ROUTES.receivingOrder(IDS.dropoffOrder)), { critical: true });
    await s.step("open Add a card, fill name and tier", async () => {
      await UI.addCardOpen(page).click();
      await UI.addCardName(page).fill("Test Added Drop-off Card");
      await UI.addCardTier(page).selectOption("premium");
    }, { critical: true });
    await s.step("choose a photo (uploads through /api/upload)", async () => {
      const [fc] = await Promise.all([page.waitForEvent("filechooser"), UI.addCardChoosePhoto(page).click()]);
      await Promise.all([page.waitForResponse((r) => r.url().includes("/api/upload"), { timeout: 30_000 }), fc.setFiles(pngFile("dropoff.png", [30, 160, 120]))]);
      await page.getByRole("img", { name: /new card photo 1/i }).waitFor({ timeout: 15_000 });
    });
    await s.step("Add and receive card", async () => {
      const res = await clickForApi(page, UI.addCardSubmit(page), "/add-card");
      assert(res.status() < 300, `add-card answered ${res.status()}: ${await res.text()}`);
    }, { critical: true });
    await s.step("card joined the same order with the next Card ID, received, in a Gold bag, photo saved", async () => {
      const t = await tables();
      eq(t.orders.length, before.orders.length, "orders count (no new order)");
      const added = cardsOf(t, IDS.dropoffOrder).find((c) => c.card_name === "Test Added Drop-off Card");
      assert(added, "card not on the order");
      eq(cardsOf(t, IDS.dropoffOrder).length, 3, "cards on the order");
      eq(added.card_code, "CD-2550-03", "new card's Card ID");
      assert(added.received_at && added.bag_id, "not received / no bag");
      eq(t.tier_bags.find((b) => b.id === added.bag_id)?.tier, "premium", "bag tier");
      const urls = [...(added.receiving_photo_urls ?? []), ...(added.photo_urls ?? [])];
      assert(urls.length === 1, `expected 1 photo, got ${urls.length}`);
      if (process.env.INTERCEPT_UPLOAD !== "1") {
        const d = await dump();
        const key = urls[0].split("/storage/v1/object/public/")[1];
        assert(d.storage.some((f) => f.key === key), `photo ${key} not in storage`);
      }
      return `photo in ${added.receiving_photo_urls?.length ? "receiving_photo_urls" : "photo_urls"}`;
    });
    await s.step("the same add-card request sent twice adds the card once", async () => {
      const body = { card_name: "Test Twice Sent Card", tier: "premium", receive: true, receivedOn: "2026-11-21", requestId: crypto.randomUUID() };
      const first = await api(ctx, "POST", `/api/admin/intake/orders/${IDS.dropoffOrder}/add-card`, body);
      const again = await api(ctx, "POST", `/api/admin/intake/orders/${IDS.dropoffOrder}/add-card`, body);
      assert(first.status < 300 && again.status < 300, `answered ${first.status} / ${again.status}`);
      eq(again.body?.duplicate, true, "second answer is the duplicate");
      eq(again.body?.card_id, first.body?.card_id, "same card");
      eq(cardsOf(await tables(), IDS.dropoffOrder).filter((c) => c.card_name === "Test Twice Sent Card").length, 1, "cards added");
    }, { shot: false });
  },

  // A receiving photo per card, kept apart from the customer's photos
  async "card-photo"({ page, ctx, s }) {
    await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0)], "2026-11-15");
    await s.step("open the workspace", () => goto(page, ROUTES.receivingOrder(IDS.mailOrder)), { critical: true });
    await s.step("Choose photo for Gold One, saved to that card", async () => {
      const [fc] = await Promise.all([page.waitForEvent("filechooser"), UI.choosePhoto(page, MAIL_NAMES[0]).click()]);
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/admin/intake/cards/${mailCard(0)}/photos`), { timeout: 60_000 }),
        fc.setFiles(pngFile("receiving.png", [220, 60, 60])),
      ]);
      await page.waitForLoadState("networkidle").catch(() => {});
      await UI.receivingPhotos(page, MAIL_NAMES[0]).locator("img").first().waitFor({ timeout: 15_000 });
    });
    await s.step("receiving_photo_urls has it; the customer's 2 photos are untouched", async () => {
      const c = (await tables()).cards.find((x) => x.id === mailCard(0));
      eq(c.receiving_photo_urls.length, 1, "receiving photos");
      eq(c.photo_urls.length, 2, "customer photos");
      assert(c.photo_urls.every((u) => u.includes("seed-a-card01")), "customer photos changed");
    }, { shot: false });
  },

  // /q/<CODE> and /Q/<CODE>: a card code -> its card page, a bag code (the label's QR) -> that bag's
  // photos (/admin/receiving/<orderId>/photos?bag=<bagId>), the order code -> the whole order's
  // photos; unknown -> 404; signed out -> sign in, then back
  async qr({ page, ctx, s, browser, appUrl }) {
    await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0), mailCard(6)], "2026-11-15");
    const t = await tables();
    const card = t.cards.find((c) => c.id === mailCard(0));
    const bag = t.tier_bags.find((b) => b.bag_code === "CD-2549-P");
    await s.step("seeded codes exist", () => assert(card?.card_code && bag, "receive did not create codes/bags"), { critical: true, shot: false });
    await s.step(`/q/${card.card_code} -> card page`, async () => {
      const r = await api(ctx, "GET", ROUTES.qr(card.card_code));
      assert([301, 302, 303, 307, 308].includes(r.status), `status ${r.status}`);
      eq(new URL(r.headers.location, appUrl).pathname, ROUTES.card(card.id), "redirect");
    }, { shot: false });
    await s.step("/q/<card code in lower case> -> card page", async () => {
      const r = await api(ctx, "GET", ROUTES.qr(card.card_code.toLowerCase()));
      eq(new URL(r.headers.location ?? "/", appUrl).pathname, ROUTES.card(card.id), "redirect");
    }, { shot: false });
    // Where a scanned code goes, signed in (a middleware redirect from /Q to /q may come first)
    const scanTo = async (url) => {
      const r = await api(ctx, "GET", url);
      assert([301, 302, 303, 307, 308].includes(r.status), `${url}: status ${r.status}`);
      let loc = new URL(r.headers.location, appUrl);
      if (loc.pathname.startsWith("/q/")) loc = new URL((await api(ctx, "GET", loc.pathname)).headers.location ?? "/", appUrl);
      return loc;
    };
    const photosOf = (loc) => `${loc.pathname}${loc.searchParams.get("bag") ? `?bag=${loc.searchParams.get("bag")}` : ""}`;
    await s.step(`/Q/${bag.bag_code} (upper-case path, the label's QR) -> that bag's photos`, async () => {
      eq(photosOf(await scanTo(ROUTES.qrUpper(bag.bag_code))), ROUTES.photos(IDS.mailOrder, bag.id), "redirect");
    }, { shot: false });
    await s.step(`/q/${bag.bag_code.toLowerCase()} (bag code in lower case) -> that bag's photos`, async () => {
      eq(photosOf(await scanTo(ROUTES.qr(bag.bag_code.toLowerCase()))), ROUTES.photos(IDS.mailOrder, bag.id), "redirect");
    }, { shot: false });
    await s.step(`/q/${ORDER_NUMBERS.mailOrder} (order code) -> the whole order's photos`, async () => {
      eq(photosOf(await scanTo(ROUTES.qr(ORDER_NUMBERS.mailOrder))), ROUTES.photos(IDS.mailOrder), "redirect");
    }, { shot: false });
    await s.step(`/Q/${ORDER_NUMBERS.mailOrder} and /q/${ORDER_NUMBERS.mailOrder.toLowerCase()} -> the whole order's photos`, async () => {
      eq(photosOf(await scanTo(ROUTES.qrUpper(ORDER_NUMBERS.mailOrder))), ROUTES.photos(IDS.mailOrder), "redirect (/Q)");
      eq(photosOf(await scanTo(ROUTES.qr(ORDER_NUMBERS.mailOrder.toLowerCase()))), ROUTES.photos(IDS.mailOrder), "redirect (lower case)");
    }, { shot: false });
    await s.step("unknown code -> 404", async () => {
      const r = await api(ctx, "GET", ROUTES.qr("CD-0000-99"));
      eq(r.status, 404, "status");
    }, { shot: false });
    await s.step("signed out: /q and /Q go to sign-in with next=/q/<CODE> (no lookup); admin pages keep next=<page>", async () => {
      const anon = await browser.newContext({ baseURL: appUrl, ignoreHTTPSErrors: true });
      try {
        const signIn = async (url) => {
          const r = await anon.request.fetch(url, { maxRedirects: 0, failOnStatusCode: false });
          assert([301, 302, 303, 307, 308].includes(r.status()), `${url}: status ${r.status()}`);
          const loc = new URL(r.headers().location ?? "/", appUrl);
          eq(loc.pathname, "/admin/login", `${url} redirect`);
          return loc.searchParams.get("next");
        };
        eq(await signIn(ROUTES.qr(card.card_code.toLowerCase())), `/q/${card.card_code}`, "next (card, lower case scanned)");
        eq(await signIn(ROUTES.qrUpper(bag.bag_code)), `/q/${bag.bag_code}`, "next (bag, /Q)");
        // An unknown code isn't looked up either: nothing tells a stranger which codes exist
        eq(await signIn(ROUTES.qr("CD-0000-99")), "/q/CD-0000-99", "next (unknown code)");
        eq(await signIn(`${ROUTES.card(card.id)}?from=scan`), `${ROUTES.card(card.id)}?from=scan`, "next (admin page)");
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step("scanning in the signed-in browser lands on the card page", async () => {
      await goto(page, ROUTES.qr(card.card_code));
      eq(new URL(page.url()).pathname, ROUTES.card(card.id), "landed on");
    });
    await s.step("signed out: the order code and the bag's photos page go to sign-in, with next= (no lookup)", async () => {
      const anon = await browser.newContext({ baseURL: appUrl, ignoreHTTPSErrors: true });
      try {
        const signIn = async (url) => {
          let r = await anon.request.fetch(url, { maxRedirects: 0, failOnStatusCode: false });
          assert([301, 302, 303, 307, 308].includes(r.status()), `${url}: status ${r.status()}`);
          let loc = new URL(r.headers().location ?? "/", appUrl);
          if (loc.pathname.startsWith("/q/")) {
            r = await anon.request.fetch(loc.pathname, { maxRedirects: 0, failOnStatusCode: false });
            loc = new URL(r.headers().location ?? "/", appUrl);
          }
          eq(loc.pathname, "/admin/login", `${url} redirect`);
          return loc.searchParams.get("next");
        };
        eq(await signIn(ROUTES.qr(ORDER_NUMBERS.mailOrder.toLowerCase())), `/q/${ORDER_NUMBERS.mailOrder}`, "next (order code, lower case scanned)");
        eq(await signIn(ROUTES.qrUpper(ORDER_NUMBERS.mailOrder)), `/q/${ORDER_NUMBERS.mailOrder}`, "next (order code, /Q)");
        eq(await signIn(ROUTES.photos(IDS.mailOrder, bag.id)), ROUTES.photos(IDS.mailOrder, bag.id), "next (bag photos page)");
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step("scanning the bag's label QR in the signed-in browser lands on that bag's photos", async () => {
      await goto(page, ROUTES.qrUpper(bag.bag_code));
      const u = new URL(page.url());
      eq(`${u.pathname}?bag=${u.searchParams.get("bag")}`, ROUTES.photos(IDS.mailOrder, bag.id), "landed on");
    });
  },

  // The card page: customer image, receiving photos, customer, order, Card ID, tier, dates, stage, history
  async "card-page"({ page, ctx, s, browser, appUrl }) {
    await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0)], "2026-11-15");
    await s.step("open the card page", () => goto(page, ROUTES.card(mailCard(0))), { critical: true });
    await s.step("shows Card ID, customer, order, tier, received + due dates, stage, customer photo", async () => {
      const text = await page.locator("main").innerText();
      const due = addBusinessDays("2026-11-15", TURNAROUND.premium);
      const dueText = new Date(`${due}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
      for (const want of ["CD-2549-01", "Test Customer A", ORDER_NUMBERS.mailOrder, "Gold", "Test Card Gold One"]) assert(text.includes(want), `"${want}" not shown`);
      assert(text.includes(dueText) || text.includes(due), `due date ${dueText} not shown`);
      assert(/Nov(ember)? 15, 2026|2026-11-15/.test(text), "received date not shown");
      assert(/not started/i.test(text), "current stage (Not started) not shown");
      assert(await page.locator('img[src*="seed-a-card01-front"]').count() > 0, "customer photo not shown");
    });
    await s.step("phone layout", () => phoneShot(browser, appUrl, ROUTES.card(mailCard(0)), "card-page").then((w) => { assert(!w, w); }));
  },

  // Bag page bulk advance: a card already at another step is left alone
  async "bag-bulk-advance"({ page, ctx, s, browser, appUrl }) {
    const gold = [0, 1, 2, 3].map(mailCard);
    await receiveViaApi(ctx, IDS.mailOrder, gold, "2026-11-15");
    // Gold Two is already at Humidor (ahead of the others)
    await insertRows("order_events", stageRows(IDS.mailOrder, gold[1], "Humidor"));
    const bag = (await tables()).tier_bags.find((b) => b.bag_code === "CD-2549-G");
    await s.step("bag exists", () => assert(bag, "no CD-2549-G"), { critical: true, shot: false });
    await s.step("open the bag page: shows Bag ID, due date, 4 cards and 'cards at different steps'", async () => {
      await goto(page, ROUTES.bag(bag.id));
      const text = await page.locator("main").innerText();
      for (const want of ["CD-2549-G", "Test Customer A", ORDER_NUMBERS.mailOrder, ...MAIL_NAMES.slice(0, 4)]) assert(text.includes(want), `"${want}" not shown`);
      await UI.differentSteps(page).waitFor({ timeout: 5_000 });
    }, { critical: true });
    const mailsBefore = (await emails()).length;
    await s.step("bulk: move the 3 not-started cards to Ready for Slab Crack", async () => {
      const res = await clickForApi(page, UI.advanceTo(page, "Ready for Slab Crack"), "/api/admin/intake/stages");
      assert(res.status() < 300, `stages answered ${res.status()}: ${await res.text()}`);
    });
    await s.step("the 3 moved; Gold Two still at Humidor with no new event", async () => {
      const t = await tables();
      for (const id of [gold[0], gold[2], gold[3]]) eq(latestStage(t, id), "Ready for Slab Crack", `stage of ${id}`);
      eq(latestStage(t, gold[1]), "Humidor", "Gold Two stage");
      eq(t.order_events.filter((e) => e.metadata?.card_id === gold[1]).length, 2, "Gold Two stage events");
    }, { shot: false });
    await s.step("one customer email for the bulk move (not one per card)", async () => {
      const fresh = (await emails()).slice(mailsBefore).filter((m) => JSON.stringify(m.to).includes("test.customer.a@example.com"));
      eq(fresh.length, 1, "customer emails");
    }, { shot: false });
    await s.step("API guard: a stale bulk request (fromStage null) skips cards no longer at that step", async () => {
      const r = await api(ctx, "POST", ROUTES.stagesApi, { orderId: IDS.mailOrder, cardIds: gold, fromStage: null });
      const t = await tables();
      eq(latestStage(t, gold[1]), "Humidor", "Gold Two stage after stale request");
      for (const id of [gold[0], gold[2], gold[3]]) eq(latestStage(t, id), "Ready for Slab Crack", `stage of ${id} after stale request`);
      return `HTTP ${r.status}, skipped ${JSON.stringify(r.body?.skipped ?? null).slice(0, 120)}`;
    }, { shot: false });
    await s.step("one card alone: move Gold Two to Humidity Press from its card row", async () => {
      await goto(page, ROUTES.bag(bag.id));
      const row = UI.cardRow(page, MAIL_NAMES[1], UI.moveButton(page));
      const res = await clickForApi(page, UI.advanceTo(row, "Humidity Press"), "/api/admin/intake/stages");
      assert(res.status() < 300, `stages answered ${res.status()}`);
      const t = await tables();
      eq(latestStage(t, gold[1]), "Humidity Press", "Gold Two stage");
      eq(latestStage(t, gold[0]), "Ready for Slab Crack", "Gold One unchanged");
    });
    await s.step("phone layout", () => phoneShot(browser, appUrl, ROUTES.bag(bag.id), "bag-page").then((w) => { assert(!w, w); }));
  },

  // Final Dry -> done -> bag completed -> Completed section shows it as New; order not completed
  async "complete-bag"({ page, ctx, s }) {
    await receiveViaApi(ctx, IDS.mailOrder, [mailCard(4), mailCard(0)], "2026-11-15");
    await insertRows("order_events", stageRows(IDS.mailOrder, mailCard(4), "Book with Weights"));
    const bag = (await tables()).tier_bags.find((b) => b.bag_code === "CD-2549-S");
    await s.step("Silver bag with one card exists", () => assert(bag, "no CD-2549-S"), { critical: true, shot: false });
    await s.step("card page: Move to Final Dry", async () => {
      await goto(page, ROUTES.card(mailCard(4)));
      const res = await clickForApi(page, UI.advanceTo(page, "Final Dry"), "/api/admin/intake/stages");
      assert(res.status() < 300, `stages answered ${res.status()}`);
      eq(latestStage(await tables(), mailCard(4)), "Final Dry", "stage");
    });
    await s.step("from Final Dry: mark the card done", async () => {
      await goto(page, ROUTES.card(mailCard(4)));
      const res = await clickForApi(page, UI.markDone(page), "/api/admin/intake/stages");
      assert(res.status() < 300, `stages answered ${res.status()}`);
    });
    await s.step("card completed, bag completed_at set, order NOT completed", async () => {
      const t = await tables();
      const c = t.cards.find((x) => x.id === mailCard(4));
      assert(c.completed && c.completed_at, "card not completed");
      assert(t.tier_bags.find((b) => b.id === bag.id).completed_at, "bag not completed");
      assert(!t.tier_bags.find((b) => b.bag_code === "CD-2549-G").completed_at, "Gold bag must stay open");
      assert(!["completed", "shipped_back", "delivered"].includes(t.orders.find((o) => o.id === IDS.mailOrder).status), "order was completed");
    }, { shot: false });
    await s.step("Completed section lists CD-2549-S as New", async () => {
      await goto(page, ROUTES.completed);
      const text = await page.locator("main").innerText();
      assert(text.includes("CD-2549-S") && text.includes("Test Customer A"), "bag not listed");
      await UI.newChip(page, "CD-2549-S").waitFor({ timeout: 5_000 });
    });
    await s.step("order workspace shows Partially completed", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      await page.getByText(/partially completed/i).first().waitFor({ timeout: 5_000 });
    });
  },

  // Labels: ONE label per tier bag, always one page per bag whatever the card count (4, 16 and 32
  // cards in a bag here; 40 in labels-40); each label one QR (its bag's); the customer name biggest
  async labels({ ctx, s, appUrl }) {
    await s.step("nothing received yet: the order's ?format=json lists no bags", async () => {
      const body = await labelJson(ctx, ROUTES.orderLabel(IDS.mailOrder, "?format=json"));
      checkSettings(body.settings);
      eq(body.bags, [], "bags");
    }, { shot: false });
    await s.step("receive 4 Gold + 1 Platinum of CD-2549 on 2026-11-15 (two bags: 4 cards and 1)", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 2, 3, 6].map(mailCard), "2026-11-15");
      const by = receivedByBag(await tables(), IDS.mailOrder);
      eq(by.map((x) => x.cards.length).sort(), [1, 4], "cards per bag");
      return by.map((x) => `${x.bag.bag_code} ${x.cards.length}`).join(", ");
    }, { critical: true, shot: false });
    await labelSteps(s, ctx, { appUrl, orderId: IDS.mailOrder, customerName: "Test Customer A", title: "CD-2549 G4+P1" });

    const gold = IDS.bigCards.filter((_, i) => BIG_CARD_TIERS[i] === "premium");
    const plat = IDS.bigCards.filter((_, i) => BIG_CARD_TIERS[i] === "ultra_premium");
    await s.step("receive 16 Gold cards of CD-2600 on 2026-11-20 (one bag of 16)", async () => {
      await receiveViaApi(ctx, IDS.bigOrder, gold.slice(0, 16), "2026-11-20");
      const by = receivedByBag(await tables(), IDS.bigOrder);
      eq(by.map((x) => x.cards.length), [16], "cards per bag");
      return by[0].bag.bag_code;
    }, { critical: true, shot: false });
    await labelSteps(s, ctx, { appUrl, orderId: IDS.bigOrder, customerName: BIG_CUSTOMER_NAME, title: "CD-2600 G16" });
    await s.step("receive the other 16 Gold + 8 Platinum the same day: a Gold bag of 32 and a Platinum bag of 8", async () => {
      await receiveViaApi(ctx, IDS.bigOrder, [...gold.slice(16), ...plat], "2026-11-20");
      const by = receivedByBag(await tables(), IDS.bigOrder);
      const sizes = by.map((x) => `${x.bag.bag_code} ${x.cards.length}`).join(", ");
      assert(by.some((x) => x.cards.length >= 30), `no bag of 30+ cards (same-day cards should join the open bag): ${sizes}`);
      return sizes;
    }, { critical: true, shot: false });
    await labelSteps(s, ctx, { appUrl, orderId: IDS.bigOrder, customerName: BIG_CUSTOMER_NAME, title: "CD-2600 G32+P8" });
  },

  // 40 cards in ONE bag: still one page (shrink, two columns, then "+N more: scan the QR")
  async "labels-40"({ ctx, s, appUrl, mockUrl }) {
    await s.step("setup: every card of CD-2600 Gold (set in the mock), all 40 received at once: one bag of 40", async () => {
      const { error } = await mockDb(mockUrl).from("cards").update({ tier: "premium" }).eq("order_id", IDS.bigOrder);
      assert(!error, `set tiers: ${error?.message}`);
      await receiveViaApi(ctx, IDS.bigOrder, IDS.bigCards, "2026-11-20");
      const by = receivedByBag(await tables(), IDS.bigOrder);
      eq(by.map((x) => x.cards.length), [40], "cards per bag");
      return by[0].bag.bag_code;
    }, { critical: true, shot: false });
    await labelSteps(s, ctx, { appUrl, orderId: IDS.bigOrder, customerName: BIG_CUSTOMER_NAME, title: "CD-2600 G40" });
  },

  // The photos page (where the order code and each bag's QR lead): every card with all its images,
  // grouped by bag; with ?bag=<bagId> only that bag's cards
  async "photos-page"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step("setup: Bronze for the no-tier card (in the mock), receive all 10 on 2026-11-15, a receiving photo on each", async () => {
      const { error } = await mockDb(mockUrl).from("cards").update({ tier: "regular" }).eq("id", mailCard(9));
      assert(!error, `set tier: ${error?.message}`);
      await receiveViaApi(ctx, IDS.mailOrder, IDS.mailCards, "2026-11-15");
      await setReceivingPhotos(mockUrl, IDS.mailCards);
      t = await tables();
      assert(cardsOf(t, IDS.mailOrder).every((c) => c.card_code && c.bag_id && c.receiving_photo_urls.length === 1), "not every card received with a photo");
      return bagsOf(t, IDS.mailOrder).map((b) => b.bag_code).sort().join(", ");
    }, { critical: true, shot: false });
    const cards = () => cardsOf(t, IDS.mailOrder).sort((a, b) => a.card_seq - b.card_seq);
    const bags = () => bagsOf(t, IDS.mailOrder);
    const mainText = async () => page.locator("main").first().innerText();
    const dueDec7 = /Dec(ember)? 7\b|2026-12-07|12\/7\/2026/;

    await s.step("open the whole order's photos page", () => goto(page, ROUTES.photos(IDS.mailOrder)), { critical: true });
    await s.step("every card's Card ID (CD-2549-01..10) and name, and the customer, appear", async () => {
      const text = await mainText();
      const missing = [...cards().flatMap((c) => [c.card_code, c.card_name]), "Test Customer A"].filter((w) => !text.includes(w));
      assert(!missing.length, `not shown: ${missing.join(", ")}`);
    });
    await s.step("grouped by bag: each card under its own Bag ID; tiers, Platinum due Dec 7 and the stage shown", async () => {
      const text = await mainText();
      const missing = [...bags().map((b) => b.bag_code), "Gold", "Silver", "Platinum", "Bronze"].filter((w) => !text.includes(w));
      assert(!missing.length, `not shown: ${missing.join(", ")}`);
      assert(dueDec7.test(text), "Platinum due date Dec 7 not shown");
      assert(/not started/i.test(text), "stage (Not started) not shown");
      // the nearest Bag ID before each Card ID is that card's bag
      const heads = [...text.matchAll(new RegExp(`${esc(ORDER_NUMBERS.mailOrder)}-[A-Z]+\\d*(?![0-9A-Z])`, "g"))].map((m) => ({ code: m[0], at: m.index }));
      for (const c of cards()) {
        const at = text.indexOf(c.card_code);
        const head = heads.filter((h) => h.at < at).at(-1);
        const own = bags().find((b) => b.id === c.bag_id).bag_code;
        eq(head?.code ?? null, own, `bag heading above ${c.card_code}`);
      }
    }, { shot: false });
    await s.step("every image of every card is there (10 receiving + 3 customer photos); a receiving and a customer photo load", async () => {
      const srcs = await page.locator("img").evaluateAll((els) => els.map((el) => `${el.getAttribute("src") ?? ""} ${el.getAttribute("srcset") ?? ""}`).join("\n"));
      const files = cards().flatMap((c) => [...c.receiving_photo_urls, ...c.photo_urls]).map((u) => u.split("/").pop().replace(/\.png$/, ""));
      const missing = files.filter((f) => !srcs.includes(f));
      assert(!missing.length, `images not on the page: ${missing.join(", ")}`);
      for (const [what, loc] of [["receiving photo", UI.photoImg(page, RECEIVING_PHOTO_STEM)], ["customer photo", UI.photoImg(page, "seed-a-card01-front")]]) {
        const img = loc.first();
        await img.scrollIntoViewIfNeeded();
        const loaded = await img.evaluate((el) => new Promise((done) => {
          if (el.complete) return done(el.naturalWidth > 0);
          el.addEventListener("load", () => done(el.naturalWidth > 0), { once: true });
          el.addEventListener("error", () => done(false), { once: true });
          setTimeout(() => done(el.complete && el.naturalWidth > 0), 15_000);
        }));
        assert(loaded, `the ${what} <img> did not load`);
      }
      return `${files.length} images`;
    });
    await s.step("desktop (1440px) and phone (390px): no sideways scroll; screenshots", async () => {
      await page.screenshot({ path: path.join(OUT, "photos-page-order-desktop.png"), fullPage: true });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(wide <= 1, `desktop page scrolls sideways by ${wide}px`);
      const w = await phoneShot(browser, appUrl, ROUTES.photos(IDS.mailOrder), "photos-page-order");
      assert(!w, w);
    }, { shot: false });

    const P = t ? bags().find((b) => b.tier === "ultra_premium") : null; // (null: setup failed, the steps below skip)
    await s.step("?bag=<CD-2549-P>: open that bag's photos", () => goto(page, ROUTES.photos(IDS.mailOrder, P.id)), { critical: true });
    await s.step("?bag: only that bag's cards and Card IDs (Platinum 07-09), none of the other bags'", async () => {
      const text = await mainText();
      const mine = cards().filter((c) => c.bag_id === P.id);
      const others = cards().filter((c) => c.bag_id !== P.id);
      const missing = mine.flatMap((c) => [c.card_code, c.card_name]).filter((w) => !text.includes(w));
      assert(!missing.length, `not shown: ${missing.join(", ")}`);
      const leaked = others.flatMap((c) => [c.card_code, c.card_name]).filter((w) => text.includes(w));
      assert(!leaked.length, `other bags' cards shown: ${leaked.join(", ")}`);
      assert(await UI.photoImg(page, "seed-a-card07-front").count() > 0, "Platinum One's customer photo not shown");
      eq(await UI.photoImg(page, "seed-a-card01-front").count(), 0, "Gold One's customer photo (another bag) shown");
      return mine.map((c) => c.card_code).join(", ");
    });
    await s.step("?bag: customer, Bag ID, tier and due date; links to the bag page and to the whole order (10 cards in 4 bags)", async () => {
      const text = await mainText();
      for (const w of ["Test Customer A", P.bag_code, "Platinum"]) assert(text.includes(w), `"${w}" not shown`);
      assert(dueDec7.test(text), "due date Dec 7 not shown");
      assert(await UI.bagPageLink(page, P.id).count() > 0, `no link to the bag page ${ROUTES.bag(P.id)}`);
      const whole = UI.wholeOrderLink(page);
      const name = (await whole.innerText()).replace(/\s+/g, " ").trim();
      assert(/10 cards in 4 bags/i.test(name), `whole-order link reads "${name}"`);
      const href = new URL(await whole.getAttribute("href"), appUrl);
      eq(`${href.pathname}${href.searchParams.get("bag") ? "?bag" : ""}`, ROUTES.photos(IDS.mailOrder), "whole-order link");
      return name;
    });
    await s.step("?bag: phone (390px) has no sideways scroll", () => phoneShot(browser, appUrl, ROUTES.photos(IDS.mailOrder, P.id), "photos-page-bag").then((w) => { assert(!w, w); }));
  },

  // The "Print labels" step (photo gate) and the bag label panel: one label per bag
  async "print-step"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const picked = [0, 1, 4, 6].map(mailCard); // 2 Gold, 1 Silver, 1 Platinum: three bags
    let bags = [];
    await s.step("setup: receive 2 Gold + 1 Silver + 1 Platinum of CD-2549 (three bags)", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, picked, "2026-11-15");
      bags = bagsOf(await tables(), IDS.mailOrder);
      eq(bags.length, 3, "bags");
    }, { critical: true, shot: false });
    const openStep = async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      const step = UI.printStep(page);
      await step.waitFor({ timeout: 15_000 });
      return step;
    };
    const stepText = async (step) => (await step.innerText()).replace(/\s+/g, " ").trim();
    await s.step("no receiving photos yet: Print label(s) is disabled and says 4 cards need a photo", async () => {
      const step = await openStep();
      const btn = UI.printButton(step);
      await btn.waitFor();
      assert(await btn.isDisabled(), "the print button is enabled before every card has a receiving photo");
      const text = await stepText(step);
      assert(UI.saysNeedPhoto(text, picked.length), `the step doesn't say ${picked.length} cards need a photo: "${text.slice(0, 160)}"`);
      return text.slice(0, 120);
    });
    await s.step("photos on 3 of the 4 cards (set in the mock): still disabled, 1 card left", async () => {
      await setReceivingPhotos(mockUrl, picked.slice(0, 3));
      const step = await openStep();
      const btn = UI.printButton(step);
      await btn.waitFor();
      assert(await btn.isDisabled(), "enabled while a card still has no receiving photo");
      const text = await stepText(step);
      assert(UI.saysNeedPhoto(text, 1), `the step doesn't say 1 card needs a photo: "${text.slice(0, 160)}"`);
      return text.slice(0, 120);
    });
    await s.step("a receiving photo on every received card: enabled, \"Ready to print: 3 labels\"", async () => {
      await setReceivingPhotos(mockUrl, picked.slice(3));
      const step = await openStep();
      const btn = UI.printButton(step);
      await btn.waitFor();
      assert(await waitEnabled(btn), "the print button stays disabled");
      const text = await stepText(step);
      assert(UI.saysReady(text, bags.length), `the step doesn't say "Ready to print: ${bags.length} labels": "${text.slice(0, 160)}"`);
      return text.slice(0, 120);
    });
    await s.step("bag label panel: one label preview per bag, each named by its Bag ID; Print all 3 labels; no tag (no Print tag, no tag preview)", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      const { settings } = await labelJson(ctx, ROUTES.orderLabel(IDS.mailOrder, "?format=json"));
      const names = await previewNames(page, settings, bags.length);
      const labels = names.filter((n) => !UI.isTagPreview(n));
      eq(labels.length, bags.length, `label previews (${labels.join(" | ")})`);
      for (const b of bags) eq(labels.filter((n) => new RegExp(`${esc(b.bag_code)}(?![0-9A-Z])`).test(n)).length, 1, `label previews naming ${b.bag_code}`);
      eq(names.filter((n) => UI.isTagPreview(n)), [], "tag previews (no reusable tag any more)");
      eq(await UI.printTag(page).count(), 0, "Print tag buttons on the order page");
      assert(await UI.printAll(page, bags.length).count() > 0, `no "Print all ${bags.length} labels" button`);
      return labels.join(" | ");
    });
    await s.step("bag page: ONE label preview (its own), a print-label button, no Print tag", async () => {
      const P = bags.find((b) => b.tier === "ultra_premium");
      await goto(page, ROUTES.bag(P.id));
      const { settings } = await labelJson(ctx, ROUTES.bagLabel(P.id, "?format=json"));
      const names = await previewNames(page, settings, 1);
      const labels = names.filter((n) => !UI.isTagPreview(n));
      eq(labels.length, 1, `label previews (${labels.join(" | ")})`);
      assert(labels[0].includes(P.bag_code), `the preview is named "${labels[0]}", not after ${P.bag_code}`);
      eq(names.filter((n) => UI.isTagPreview(n)), [], "tag previews (no reusable tag any more)");
      assert(await UI.printButton(page).count() > 0, "no print-label button");
      eq(await UI.printTag(page).count(), 0, "Print tag buttons on the bag page");
    });
    await s.step("card page: a print-label button (prints its bag's label), no Print tag", async () => {
      await goto(page, ROUTES.card(picked[3]));
      assert(await UI.printButton(page).count() > 0, "no print-label button on the card page");
      eq(await UI.printTag(page).count(), 0, "Print tag buttons on the card page");
    });
    await s.step("phone layout of the workspace (390px) has no sideways scroll", () => phoneShot(browser, appUrl, ROUTES.receivingOrder(IDS.mailOrder), "print-step-workspace").then((w) => { assert(!w, w); }));
  },

  // The "Bags" work board: every open bag is its own work order (own row), by due date
  async "bags-board"({ page, ctx, s, browser, appUrl }) {
    let bags = [];
    await s.step("setup: receive Gold One + Platinum One of CD-2549 (11-15) and 16 Gold of CD-2600 (11-20)", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0), mailCard(6)], "2026-11-15");
      await receiveViaApi(ctx, IDS.bigOrder, IDS.bigCards.filter((_, i) => BIG_CARD_TIERS[i] === "premium").slice(0, 16), "2026-11-20");
      const t = await tables();
      bags = [...bagsOf(t, IDS.mailOrder), ...bagsOf(t, IDS.bigOrder)].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.bag_code.localeCompare(b.bag_code));
      eq(bags.map((b) => b.bag_code).sort(), ["CD-2549-G", "CD-2549-P", "CD-2600-G"], "bags");
      return bags.map((b) => `${b.bag_code} due ${b.due_date}`).join(", ");
    }, { critical: true, shot: false });
    await s.step("open the Bags board", () => goto(page, ROUTES.bags), { critical: true });
    await s.step("CD-2549-P and CD-2549-G are separate rows (each bag its own work order)", async () => {
      for (const [code, other] of [["CD-2549-P", "CD-2549-G"], ["CD-2549-G", "CD-2549-P"]]) {
        const rows = UI.boardRow(page, code);
        eq(await rows.count(), 1, `rows of their own for ${code}`);
        eq(await rows.getByRole("link", { name: `Open bag ${other}`, exact: true }).count(), 0, `${code}'s row also opens ${other}`);
      }
    });
    await s.step("rows in due-date order (earliest first)", async () => {
      const text = await page.locator("main").first().innerText();
      const at = bags.map((b) => ({ code: b.bag_code, at: text.search(new RegExp(`${esc(b.bag_code)}(?![0-9A-Z])`)) }));
      const missing = at.filter((x) => x.at < 0).map((x) => x.code);
      assert(!missing.length, `not listed: ${missing.join(", ")}`);
      eq([...at].sort((a, b) => a.at - b.at).map((x) => x.code), bags.map((b) => b.bag_code), "order on the board");
      return bags.map((b) => `${b.bag_code} ${b.due_date}`).join(" < ");
    }, { shot: false });
    await s.step("CD-2549-P's row shows the customer and its due date (Dec 7)", async () => {
      const row = UI.boardRow(page, "CD-2549-P").first();
      const text = await row.innerText();
      assert(text.includes("Test Customer A"), `customer not in the row: "${text.replace(/\s+/g, " ").slice(0, 160)}"`);
      assert(/Dec(ember)? 7\b|2026-12-07|12\/7\/2026/.test(text), `due date not in the row: "${text.replace(/\s+/g, " ").slice(0, 160)}"`);
    }, { shot: false });
    await s.step("phone layout (390px) has no sideways scroll", () => phoneShot(browser, appUrl, ROUTES.bags, "bags-board").then((w) => { assert(!w, w); }));
  },

  // Historical Order Setup: preview, run, run again: no duplicate codes or bags
  async setup({ page, ctx, s }) {
    const historical = [IDS.dropoffOrder, IDS.deliveredOrder, IDS.inProgressOrder, IDS.noDateOrder];
    const stageEventsBefore = (await tables()).order_events.filter((e) => e.event_type === "stage_update").length;
    await s.step("open Historical Order Setup", () => goto(page, ROUTES.setup), { critical: false });
    let ranInUi = false;
    await s.step("select all eligible orders and preview", async () => {
      await UI.setupSelectAll(page).check();
      const res = await clickForApi(page, UI.setupPreview(page), "/setup/preview");
      assert(res.status() < 300, `preview answered ${res.status()}`);
      const text = await page.locator("main").innerText();
      assert(/missing (receiving|received) date/i.test(text), "preview doesn't flag the missing receiving date");
    });
    await s.step("confirm: set the orders up", async () => {
      const res = await clickForApi(page, UI.setupRun(page), "/setup/run", 120_000);
      assert(res.status() < 300, `run answered ${res.status()}`);
      ranInUi = true;
    });
    if (!ranInUi) {
      await s.step("(fallback) preview + run through the API", async () => {
        const p = await api(ctx, "POST", ROUTES.setupPreviewApi, { orderIds: historical });
        assert(p.status < 300, `preview ${p.status}: ${JSON.stringify(p.body).slice(0, 200)}`);
        const r = await api(ctx, "POST", ROUTES.setupRunApi, { orderIds: historical });
        assert(r.status < 300, `run ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      }, { critical: true, shot: false });
    }
    const t1 = await tables();
    await s.step("every card of the historical orders has a unique Card ID", async () => {
      for (const o of historical) {
        const cs = cardsOf(t1, o);
        assert(cs.every((c) => c.card_code && c.card_seq), `${o}: card without ID`);
      }
      const codes = t1.cards.map((c) => c.card_code).filter(Boolean);
      eq(new Set(codes).size, codes.length, "unique card codes");
    }, { shot: false });
    await s.step("bags: received dates from history; missing one flagged; drop-off from created_at", async () => {
      const bag = (o) => bagsOf(t1, o)[0];
      eq(bag(IDS.inProgressOrder)?.received_on, "2026-11-02", "in-progress received_on");
      eq(bag(IDS.inProgressOrder)?.due_status, "needs_review", "in-progress due_status");
      eq(bag(IDS.deliveredOrder)?.received_on, "2026-10-01", "delivered received_on");
      eq(bag(IDS.noDateOrder)?.received_on ?? null, null, "no-date received_on");
      eq(bag(IDS.noDateOrder)?.due_status, "missing_received_date", "no-date due_status");
      eq(bag(IDS.dropoffOrder)?.received_on, nyDay("2026-11-21T19:00:00.000Z"), "drop-off received_on");
      assert(historical.every((o) => bagsOf(t1, o).every((b) => b.source === "migration")), "source should be migration");
    }, { shot: false });
    await s.step("completed order stays completed; progress kept; awaiting order untouched", async () => {
      eq(t1.orders.find((o) => o.id === IDS.deliveredOrder).status, "delivered", "delivered order status");
      assert(cardsOf(t1, IDS.deliveredOrder).every((c) => c.completed), "delivered cards reopened");
      assert(bagsOf(t1, IDS.deliveredOrder).every((b) => b.completed_at), "delivered order's bag not completed");
      eq(t1.order_events.filter((e) => e.event_type === "stage_update").length, stageEventsBefore, "stage events changed");
      eq(latestStage(t1, IDS.inProgressCards[0]), "Heat Press", "in-progress card 1 stage");
      eq(bagsOf(t1, IDS.mailOrder).length, 0, "awaiting-cards order got bags");
    }, { shot: false });
    await s.step("run again (same orders, through the API): no new cards, codes or bags", async () => {
      const p = await api(ctx, "POST", ROUTES.setupPreviewApi, { orderIds: historical });
      assert(p.status < 500, `second preview ${p.status}`);
      const r = await api(ctx, "POST", ROUTES.setupRunApi, { orderIds: historical });
      assert(r.status < 500, `second run ${r.status}`);
      const t2 = await tables();
      eq(t2.cards.length, t1.cards.length, "cards");
      eq(t2.tier_bags.length, t1.tier_bags.length, "bags");
      eq(t2.tier_bags.map((b) => b.bag_code).sort(), t1.tier_bags.map((b) => b.bag_code).sort(), "bag codes");
      eq(t2.cards.map((c) => `${c.id}:${c.card_code}`).sort(), t1.cards.map((c) => `${c.id}:${c.card_code}`).sort(), "card codes");
    });
  },

  // ═══ Card tracking with serial-numbered slots (owner's model, Nov 24) ══════════════════════
  // Cards carry no sticker. Every holder is a slot with a QR label (CLAMP 07 = LOC-CLAMP-07);
  // staff put cards in slots, move them on, mark them done or take them out. API first, then
  // light UI. Run them alone: --only 'track-*'

  // Places: LOC-DONE + LOC-SHIP seeded; staff make numbered slots in bulk; capacity, rename, switch off
  async "track-slots"({ page, ctx, s, browser, appUrl }) {
    await s.step("seeded: LOC-DONE and LOC-SHIP only (no slots); the list names the 8 station types", async () => {
      const r = await api(ctx, "GET", ROUTES.trackLocations());
      eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 120)})`);
      assert(Array.isArray(r.body?.locations), `locations: ${JSON.stringify(r.body).slice(0, 160)}`);
      eq(r.body.locations.map((l) => l.code).sort(), DEFAULT_PLACES.map((p) => p.code).sort(), "places");
      const types = r.body.stations ?? [];
      for (const [key, st] of Object.entries(STATIONS)) eq(types.find((x) => x.key === key)?.stage, st.stage, `station type ${key}: step`);
      return types.map((x) => `${x.key} (${x.defaultCapacity ?? "no limit"})`).join(", ");
    }, { critical: true, shot: false });
    await s.step("make 5 clamps: CLAMP 01..05 = LOC-CLAMP-01..05, numbered slots of step Clamp Work", async () => {
      const body = await bulkSlots(ctx, "clamp", 5);
      eq(body.created.map((l) => l.code), range(1, 5).map((n) => slotCode("clamp", n)), "codes");
      eq(body.created.map((l) => l.name), range(1, 5).map((n) => slotName("clamp", n)), "names");
      eq(body.skipped ?? [], [], "skipped");
      const t = await tables();
      for (const n of range(1, 5)) {
        const l = placeOf(t, slotCode("clamp", n));
        eq([l.kind, l.station, l.serial, l.stage, l.active], ["station", "clamp", n, "Clamp Work", true], `${l.code} kind, station, serial, stage, active`);
      }
      return `capacity ${placeOf(t, "LOC-CLAMP-01").capacity ?? "no limit"} each`;
    }, { critical: true, shot: false });
    await s.step("make 3 heat press spots: HEAT PRESS 01..03 = LOC-HEAT-PRESS-01..03, step Heat Press", async () => {
      const body = await bulkSlots(ctx, "heat-press", 3);
      eq(body.created.map((l) => l.code), range(1, 3).map((n) => slotCode("heat-press", n)), "codes");
      eq(body.created.map((l) => l.name), range(1, 3).map((n) => slotName("heat-press", n)), "names");
      const t = await tables();
      for (const n of range(1, 3)) eq([placeOf(t, slotCode("heat-press", n)).station, placeOf(t, slotCode("heat-press", n)).stage], ["heat-press", "Heat Press"], `HEAT PRESS ${nn(n)} station, stage`);
    }, { critical: true, shot: false });
    await s.step("2 more clamps with no start number: CLAMP 06 and 07 (after the highest number in use)", async () => {
      const body = await bulkSlots(ctx, "clamp", 2);
      eq(body.created.map((l) => l.code), [slotCode("clamp", 6), slotCode("clamp", 7)], "codes");
    }, { shot: false });
    await s.step("startAt 4, count 2: CLAMP 04 and 05 exist, so both are skipped and nothing is made", async () => {
      const before = (await tables()).locations.length;
      const body = await bulkSlots(ctx, "clamp", 2, 4);
      eq(body.created.map((l) => l.code), [], "created");
      eq([...(body.skipped ?? [])].sort(), [slotCode("clamp", 4), slotCode("clamp", 5)], "skipped");
      eq((await tables()).locations.length, before, "places");
    }, { shot: false });
    await s.step("refused, nothing made: an unknown station type; count 0", async () => {
      const before = (await tables()).locations.length;
      const bad = await api(ctx, "POST", ROUTES.trackLocations(), { station: "toaster", count: 2 });
      assert(bad.status >= 400 && bad.status < 500, `unknown station type: HTTP ${bad.status}`);
      const zero = await api(ctx, "POST", ROUTES.trackLocations(), { station: "clamp", count: 0 });
      assert(zero.status >= 400 && zero.status < 500, `count 0: HTTP ${zero.status}`);
      eq((await tables()).locations.length, before, "places");
      return `${bad.body?.error ?? bad.status} / ${zero.body?.error ?? zero.status}`;
    }, { shot: false });
    await s.step("GET ?station=clamp: the 7 clamps in number order, each empty and free, QR = /Q/<code>", async () => {
      const r = await api(ctx, "GET", ROUTES.trackLocations("?station=clamp"));
      eq(r.status, 200, "HTTP");
      const list = r.body?.locations ?? [];
      eq(list.map((l) => l.code), range(1, 7).map((n) => slotCode("clamp", n)), "codes");
      assert(list.every((l) => l.cardCount === 0 && l.free === true), `occupancy: ${JSON.stringify(list.map((l) => [l.code, l.cardCount, l.free]))}`);
      eq(list[0].stationName, "Clamp", "stationName");
      assert(codeQrData(appUrl, "LOC-CLAMP-01").includes(list[0].qrUrl), `qrUrl "${list[0].qrUrl}"`);
    }, { shot: false });
    await s.step("PATCH capacity: 3 on CLAMP 01, none (null) on CLAMP 02; 0 is refused", async () => {
      const t0 = await tables();
      const c1 = placeOf(t0, "LOC-CLAMP-01").id, c2 = placeOf(t0, "LOC-CLAMP-02").id;
      eq((await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c1, capacity: 3 })).status, 200, "capacity 3: HTTP");
      eq((await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c2, capacity: null })).status, 200, "capacity null: HTTP");
      const zero = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c1, capacity: 0 });
      assert(zero.status >= 400 && zero.status < 500, `capacity 0: HTTP ${zero.status}`);
      const t = await tables();
      eq([placeOf(t, "LOC-CLAMP-01").capacity, placeOf(t, "LOC-CLAMP-02").capacity], [3, null], "capacities");
    }, { shot: false });
    await s.step('rename CLAMP 07 "SPARE CLAMP" (code and number stay), switch it off: off the list, still in ?all=1', async () => {
      const slot = placeOf(await tables(), "LOC-CLAMP-07");
      assert(slot, "no CLAMP 07 (see above)");
      const ren = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: slot.id, name: "SPARE CLAMP" });
      eq(ren.status, 200, `rename: HTTP (${JSON.stringify(ren.body).slice(0, 120)})`);
      let row = placeOf(await tables(), "LOC-CLAMP-07");
      eq([row.name, row.code, row.serial], ["SPARE CLAMP", "LOC-CLAMP-07", 7], "name, code, serial");
      const off = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: slot.id, active: false });
      eq(off.status, 200, "switch off: HTTP");
      row = placeOf(await tables(), "LOC-CLAMP-07");
      eq(row.active, false, "active");
      const list = await api(ctx, "GET", ROUTES.trackLocations());
      assert(!list.body?.locations?.some((l) => l.id === slot.id), "a switched-off slot is still listed");
      const all = await api(ctx, "GET", ROUTES.trackLocations("?all=1"));
      assert(all.body?.locations?.some((l) => l.id === slot.id), "?all=1 doesn't list the switched-off slot");
    }, { shot: false });
    await s.step('one other place: "Bench 2" (kind other) -> LOC-BENCH-2; a "station" made by name is refused', async () => {
      const r = await api(ctx, "POST", ROUTES.trackLocations(), { name: "Bench 2", kind: "other" });
      assert([200, 201].includes(r.status), `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      eq([r.body?.location?.code, r.body?.location?.name, r.body?.location?.kind], ["LOC-BENCH-2", "Bench 2", "other"], "code, name, kind");
      const row = placeOf(await tables(), "LOC-BENCH-2");
      assert(row && row.kind === "other" && row.stage == null && row.station == null, `row: ${JSON.stringify(row)}`);
      const before = (await tables()).locations.length;
      const st = await api(ctx, "POST", ROUTES.trackLocations(), { name: "Mystery Station", kind: "station" });
      assert(st.status >= 400 && st.status < 500, `a station by name: HTTP ${st.status}`);
      eq((await tables()).locations.length, before, "places");
    }, { shot: false });
    await s.step("Places page lists the slots and places; no sideways scroll at 1440 and 390 px", async () => {
      await goto(page, ROUTES.places);
      const text = (await page.locator("main").first().innerText()).toUpperCase();
      const want = [...range(1, 6).map((n) => ["clamp", n]), ...range(1, 3).map((n) => ["heat-press", n])];
      const missing = want.filter(([st, n]) => !nameRe(slotName(st, n)).test(text) && !text.includes(slotCode(st, n))).map(([st, n]) => slotName(st, n));
      for (const p of DEFAULT_PLACES) if (!text.includes(p.name.toUpperCase()) && !text.includes(p.code)) missing.push(p.code);
      assert(!missing.length, `not shown: ${missing.join(", ")}`);
      const wide = await sidewaysScroll(page);
      assert(wide <= 1, `desktop page scrolls sideways by ${wide}px`);
      const w = await phoneShot(browser, appUrl, ROUTES.places, "track-slots-places");
      assert(!w, w);
    });
  },

  // ASSIGN: put cards in a slot (step = the slot's, one email per order), capacity warning + "add
  // anyway", a card leaves its old slot, refunded cards refused
  async "track-assign"({ ctx, s, mockUrl }) {
    let t0 = null;
    await s.step("setup: receive CD-2549 (01-04, 07-08) and CD-2600-01; make CLAMP 01..05, HEAT PRESS 01..03; CLAMP 01 no limit, CLAMP 02 holds 1", async () => {
      await trackSetup(ctx, { clamp: 5, "heat-press": 3 });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-CLAMP-01");
      await mockUpdate(mockUrl, "locations", { capacity: 1 }, "code", "LOC-CLAMP-02");
      t0 = await tables();
    }, { critical: true, shot: false });
    const three = ["CD-2549-07", "CD-2549-08", "CD-2600-01"];
    let body1 = null, mails0 = 0;
    await s.step("assign CD-2549-07 + CD-2549-08 + CD-2600-01 to CLAMP 01: all in, step Clamp Work", async () => {
      mails0 = (await emails()).length;
      body1 = await assignOk(ctx, "LOC-CLAMP-01", three.map((c) => cardIdOf(t0, c)));
      eq(body1.location?.code, "LOC-CLAMP-01", "location.code");
      for (const code of three) {
        const r = resultOf(body1, cardIdOf(t0, code));
        assert(r?.ok && r.changed, `${code}: ${r?.message ?? "no result"}`);
        eq(r.stage, "Clamp Work", `${code} stage`);
      }
      eq(body1.changed, 3, "changed");
      return body1.message;
    }, { critical: true, shot: false });
    await s.step("the 3 cards are in CLAMP 01 (location_id, located_at) at step Clamp Work; the others didn't move", async () => {
      const t = await tables();
      eq(cardsIn(t, "LOC-CLAMP-01"), [...three].sort(), "cards in CLAMP 01");
      for (const code of three) {
        assert(cardByCode(t, code).located_at, `${code} has no located_at`);
        eq(latestStage(t, cardIdOf(t, code)), "Clamp Work", `${code} step`);
      }
      for (const code of ["CD-2549-01", "CD-2549-02", "CD-2549-03", "CD-2549-04"]) {
        eq(cardByCode(t, code).location_id ?? null, cardByCode(t0, code).location_id ?? null, `${code} location_id`);
        eq(latestStage(t, cardIdOf(t, code)), null, `${code} step`);
      }
      eq(stageEventCount(t) - stageEventCount(t0), 3, "new stage_update events");
    }, { shot: false });
    await s.step("card_moves: one 'assign' row per card (to CLAMP 01, from where it was, step null -> Clamp Work, order and bag)", async () => {
      const t = await tables();
      const to = placeOf(t, "LOC-CLAMP-01").id;
      for (const code of three) {
        const c = cardByCode(t, code);
        const rows = movesOf(t, c.id).filter((m) => m.to_location_id === to);
        eq(rows.length, 1, `${code} rows to CLAMP 01`);
        eq([rows[0].action, rows[0].stage_before ?? null, rows[0].stage_after], ["assign", null, "Clamp Work"], `${code} action, stage_before, stage_after`);
        eq([rows[0].order_id, rows[0].bag_id, rows[0].from_location_id ?? null], [c.order_id, c.bag_id, cardByCode(t0, code).location_id ?? null], `${code} order_id, bag_id, from_location_id`);
      }
    }, { shot: false });
    await s.step("one customer email per order: one to Test Customer A (2 cards), one to Test Customer G", async () => {
      const fresh = (await emails()).slice(mails0);
      eq(mailsTo(fresh, CUSTOMER_A).length, 1, "emails to Test Customer A");
      eq(mailsTo(fresh, CUSTOMER_G).length, 1, "emails to Test Customer G");
      eq((body1?.emailedOrders ?? []).length, 2, `emailedOrders ${JSON.stringify(body1?.emailedOrders)}`);
      return fresh.map((m) => m.subject).join(" | ").slice(0, 160);
    }, { shot: false });
    await s.step("the same assign again: ok, nothing changed; no new step event, move row or email", async () => {
      const before = await dump();
      const body = await assignOk(ctx, "LOC-CLAMP-01", three.map((c) => cardIdOf(t0, c)));
      assert(body.results.every((r) => r.ok && !r.changed), body.results.map((r) => `${r.code}: ok ${r.ok}, changed ${r.changed}`).join(" | "));
      eq(body.changed, 0, "changed");
      const after = await dump();
      eq(after.tables.card_moves.length, before.tables.card_moves.length, "card_moves rows");
      eq(stageEventCount(after.tables), stageEventCount(before.tables), "stage_update events");
      eq(after.emails.length, before.emails.length, "emails");
    }, { shot: false });

    await s.step("CLAMP 02 (holds 1): CD-2549-01 goes in", async () => {
      const body = await assignOk(ctx, "LOC-CLAMP-02", [mailCard(0)]);
      assert(resultOf(body, mailCard(0))?.ok, body.message);
      eq(cardsIn(await tables(), "LOC-CLAMP-02"), ["CD-2549-01"], "cards in CLAMP 02");
    }, { critical: true, shot: false });
    await s.step("CD-2549-02 into the full CLAMP 02: 409 over capacity (capacity 1, holds CD-2549-01); nothing written", async () => {
      const before = await dump();
      const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-02", cardIds: [mailCard(1)] });
      const msg = checkCapacityConflict(r, 1, ["CD-2549-01"]);
      const after = await dump();
      eq(cardsIn(after.tables, "LOC-CLAMP-02"), ["CD-2549-01"], "cards in CLAMP 02");
      eq(after.tables.card_moves.length, before.tables.card_moves.length, "card_moves rows");
      eq(stageEventCount(after.tables), stageEventCount(before.tables), "stage_update events");
      eq(after.emails.length, before.emails.length, "emails");
      return msg;
    }, { shot: false });
    await s.step('"Add anyway" (force: true): CD-2549-02 goes in too; CLAMP 02 holds 2; step Clamp Work; one email', async () => {
      const n = (await emails()).length;
      const body = await assignOk(ctx, "LOC-CLAMP-02", [mailCard(1)], true);
      assert(resultOf(body, mailCard(1))?.ok, body.message);
      const t = await tables();
      eq(cardsIn(t, "LOC-CLAMP-02"), ["CD-2549-01", "CD-2549-02"], "cards in CLAMP 02");
      eq(latestStage(t, mailCard(1)), "Clamp Work", "CD-2549-02 step");
      eq(mailsTo((await emails()).slice(n), CUSTOMER_A).length, 1, "emails to Test Customer A");
    }, { shot: false });
    await s.step("a card put in another slot leaves its old one: CD-2549-03 in CLAMP 03, then CLAMP 04 -> CLAMP 03 freed, no new step", async () => {
      await assignOk(ctx, "LOC-CLAMP-03", [mailCard(2)]);
      const before = await dump();
      const body = await assignOk(ctx, "LOC-CLAMP-04", [mailCard(2)]);
      const t = (await dump()).tables;
      eq(cardsIn(t, "LOC-CLAMP-03"), [], "cards in CLAMP 03");
      eq(cardsIn(t, "LOC-CLAMP-04"), ["CD-2549-03"], "cards in CLAMP 04");
      assert(freedCodes(body).includes("LOC-CLAMP-03"), `freed ${JSON.stringify(freedCodes(body))}`);
      eq(latestStage(t, mailCard(2)), "Clamp Work", "step");
      eq(stageEventCount(t), stageEventCount(before.tables), "stage_update events (same step)");
      eq((await emails()).length, before.emails.length, "emails (same step)");
      const row = movesOf(t, mailCard(2)).find((m) => m.to_location_id === placeOf(t, "LOC-CLAMP-04").id);
      eq(row?.from_location_id, placeOf(t, "LOC-CLAMP-03").id, "the move row's from_location_id");
    }, { shot: false });
    await s.step("a scanned link names the slot (https://thecarddoc1.com/q/loc-heat-press-01): CD-2549-04 -> HEAT PRESS 01, step Heat Press", async () => {
      const body = await assignOk(ctx, "https://thecarddoc1.com/q/loc-heat-press-01", [mailCard(3)]);
      eq(body.location?.code, "LOC-HEAT-PRESS-01", "location.code");
      const t = await tables();
      eq(cardsIn(t, "LOC-HEAT-PRESS-01"), ["CD-2549-04"], "cards in HEAT PRESS 01");
      eq(latestStage(t, mailCard(3)), "Heat Press", "step");
    }, { shot: false });
    await s.step("a refunded card is refused (CD-2549-04 refunded, into CLAMP 05): it stays where it was, no move row", async () => {
      await mockUpdate(mockUrl, "cards", { status: "refunded" }, "id", mailCard(3));
      const before = await tables();
      const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-05", cardIds: [mailCard(3)] });
      const res = r.status === 200 ? resultOf(r.body, mailCard(3)) : null;
      const said = r.status === 200 ? res?.message ?? "" : r.body?.error ?? "";
      assert((r.status === 200 && res && !res.ok) || (r.status >= 400 && r.status < 500), `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      assert(/refund/i.test(said), `the answer should say it was refunded: "${said}"`);
      const t = await tables();
      eq(cardsIn(t, "LOC-CLAMP-05"), [], "cards in CLAMP 05");
      eq(movesOf(t, mailCard(3)).length, movesOf(before, mailCard(3)).length, "move rows");
      return said;
    }, { shot: false });
    await s.step("refused, nothing written: an unknown slot (LOC-CLAMP-99); no cards", async () => {
      const before = await tables();
      const unk = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-99", cardIds: [mailCard(0)] });
      assert(unk.status >= 400 && unk.status < 500, `unknown slot: HTTP ${unk.status}`);
      const none = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-05", cardIds: [] });
      assert(none.status >= 400 && none.status < 500, `no cards: HTTP ${none.status}`);
      eq((await tables()).card_moves.length, before.card_moves.length, "card_moves rows");
      return `${unk.status} ${unk.body?.error ?? ""}`;
    }, { shot: false });
  },

  // MOVE a slot's cards to another slot (capacity, the step never goes backwards), then Done and Take out
  async "track-move"({ ctx, s, mockUrl }) {
    const three = ["CD-2549-07", "CD-2549-08", "CD-2600-01"];
    let t0 = null;
    await s.step("setup: receive; make CLAMP 01..03, HEAT PRESS 01..03, FINAL DRY 01..02; CD-2549-07, -08 and CD-2600-01 in CLAMP 01", async () => {
      await trackSetup(ctx, { clamp: 3, "heat-press": 3, "final-dry": 2 });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-CLAMP-01");
      for (const code of ["LOC-HEAT-PRESS-02", "LOC-FINAL-DRY-01"]) await mockUpdate(mockUrl, "locations", { capacity: 1 }, "code", code);
      t0 = await tables();
      await assignOk(ctx, "LOC-CLAMP-01", three.map((c) => cardIdOf(t0, c)));
      eq(cardsIn(await tables(), "LOC-CLAMP-01"), [...three].sort(), "cards in CLAMP 01");
    }, { critical: true, shot: false });
    await s.step("move CLAMP 01 -> HEAT PRESS 02 (holds 1): 409 over capacity; nothing moved", async () => {
      const before = await tables();
      const r = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-01", toCode: "LOC-HEAT-PRESS-02" });
      const msg = checkCapacityConflict(r, 1, []);
      const t = await tables();
      eq(cardsIn(t, "LOC-CLAMP-01"), [...three].sort(), "still in CLAMP 01");
      eq(t.card_moves.length, before.card_moves.length, "card_moves rows");
      return msg;
    }, { shot: false });
    await s.step("again with force: all 3 in HEAT PRESS 02, CLAMP 01 empty (freed); step stays Clamp Work (Heat Press is earlier); no email", async () => {
      const before = await dump();
      const body = await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-01", toCode: "LOC-HEAT-PRESS-02", force: true });
      eq(body.location?.code, "LOC-HEAT-PRESS-02", "location.code");
      assert(body.results.length === 3 && body.results.every((r) => r.ok), body.results.map((r) => `${r.code}: ${r.message}`).join(" | "));
      const after = await dump();
      const t = after.tables;
      eq(cardsIn(t, "LOC-HEAT-PRESS-02"), [...three].sort(), "cards in HEAT PRESS 02");
      eq(cardsIn(t, "LOC-CLAMP-01"), [], "cards in CLAMP 01");
      assert(freedCodes(body).includes("LOC-CLAMP-01"), `freed ${JSON.stringify(freedCodes(body))}`);
      for (const code of three) eq(latestStage(t, cardIdOf(t, code)), "Clamp Work", `${code} step (never backwards)`);
      eq(stageEventCount(t), stageEventCount(before.tables), "stage_update events");
      eq(after.emails.length, before.emails.length, "emails");
      const from = placeOf(t, "LOC-CLAMP-01").id, to = placeOf(t, "LOC-HEAT-PRESS-02").id;
      for (const code of three) {
        const row = movesOf(t, cardIdOf(t, code)).find((m) => m.to_location_id === to);
        assert(row, `${code}: no move row to HEAT PRESS 02`);
        eq([row.action, row.from_location_id, row.stage_before, row.stage_after], ["move", from, "Clamp Work", "Clamp Work"], `${code} action, from, stage_before, stage_after`);
      }
      return body.message;
    }, { critical: true, shot: false });
    await s.step("move only CD-2549-07 + -08 on to FINAL DRY 01 (force): step Final Dry, one email to A; CD-2600-01 stays", async () => {
      const n = (await emails()).length;
      const body = await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-02", toCode: "LOC-FINAL-DRY-01", cardIds: [mailCard(6), mailCard(7)], force: true });
      const t = await tables();
      eq(cardsIn(t, "LOC-FINAL-DRY-01"), ["CD-2549-07", "CD-2549-08"], "cards in FINAL DRY 01");
      eq(cardsIn(t, "LOC-HEAT-PRESS-02"), ["CD-2600-01"], "left in HEAT PRESS 02");
      assert(!freedCodes(body).includes("LOC-HEAT-PRESS-02"), "HEAT PRESS 02 reported empty, but CD-2600-01 is still in it");
      for (const cid of [mailCard(6), mailCard(7)]) eq(latestStage(t, cid), "Final Dry", `${cid} step`);
      eq(latestStage(t, IDS.bigCards[0]), "Clamp Work", "CD-2600-01 step");
      const fresh = (await emails()).slice(n);
      eq([mailsTo(fresh, CUSTOMER_A).length, mailsTo(fresh, CUSTOMER_G).length], [1, 0], "emails to A, G");
      return body.message;
    }, { critical: true, shot: false });
    await s.step("refused, nothing moved: from an empty slot (CLAMP 01); a card that isn't in the from-slot", async () => {
      const before = await tables();
      const empty = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-01", toCode: "LOC-CLAMP-02" });
      assert(empty.status >= 400 && empty.status < 500, `from an empty slot: HTTP ${empty.status}`);
      const stranger = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-02", toCode: "LOC-CLAMP-02", cardIds: [mailCard(0)] });
      const refused = (stranger.status >= 400 && stranger.status < 500) || (stranger.status === 200 && (stranger.body?.results ?? []).every((r) => !r.ok || !r.changed));
      assert(refused, `a card not in the slot: HTTP ${stranger.status} ${JSON.stringify(stranger.body).slice(0, 160)}`);
      const t = await tables();
      eq(t.card_moves.length, before.card_moves.length, "card_moves rows");
      eq(cardsIn(t, "LOC-CLAMP-02"), [], "cards in CLAMP 02");
      eq(cardsIn(t, "LOC-HEAT-PRESS-02"), ["CD-2600-01"], "cards in HEAT PRESS 02");
    }, { shot: false });
    await s.step("Done (CD-2549-07 + -08): done, at LOC-DONE; FINAL DRY 01 freed; bag CD-2549-P complete; no customer email", async () => {
      const n = (await emails()).length;
      const body = await trackOk(ctx, ROUTES.trackDone, { cardIds: [mailCard(6), mailCard(7)] });
      eq(body.location?.code, "LOC-DONE", "location.code");
      const t = await tables();
      const doneId = placeOf(t, "LOC-DONE").id;
      for (const code of ["CD-2549-07", "CD-2549-08"]) {
        const c = cardByCode(t, code);
        assert(c.completed && c.completed_at, `${code} not done`);
        eq(c.location_id, doneId, `${code} location_id`);
        const row = movesOf(t, c.id).find((m) => m.to_location_id === doneId);
        assert(row, `${code}: no move row to LOC-DONE`);
        eq([row.action, row.from_location_id, row.stage_before, row.stage_after], ["done", placeOf(t, "LOC-FINAL-DRY-01").id, "Final Dry", "done"], `${code} action, from, stage_before, stage_after`);
      }
      eq(cardsIn(t, "LOC-FINAL-DRY-01"), [], "cards in FINAL DRY 01");
      assert(freedCodes(body).includes("LOC-FINAL-DRY-01"), `freed ${JSON.stringify(freedCodes(body))}`);
      const bag = bagByCode(t, "CD-2549-P");
      assert(bag.completed_at, "bag CD-2549-P not completed");
      assert((body.bagsCompleted ?? []).includes(bag.id), `bagsCompleted ${JSON.stringify(body.bagsCompleted)} doesn't name CD-2549-P`);
      assert(!bagByCode(t, "CD-2549-G").completed_at, "the Gold bag must stay open");
      assert(!["completed", "shipped_back", "delivered"].includes(t.orders.find((o) => o.id === IDS.mailOrder).status), "the order was completed");
      eq(mailsTo((await emails()).slice(n), CUSTOMER_A).length, 0, "customer emails for done (none, as before)");
      return body.message;
    }, { shot: false });
    await s.step("Take out (release) CD-2600-01: in no place, HEAT PRESS 02 freed, step still Clamp Work, a 'release' row", async () => {
      const before = await dump();
      const body = await trackOk(ctx, ROUTES.trackRelease, { cardIds: [IDS.bigCards[0]] });
      eq(body.location ?? null, null, "location");
      const t = (await dump()).tables;
      eq(cardByCode(t, "CD-2600-01").location_id ?? null, null, "location_id");
      eq(cardsIn(t, "LOC-HEAT-PRESS-02"), [], "cards in HEAT PRESS 02");
      assert(freedCodes(body).includes("LOC-HEAT-PRESS-02"), `freed ${JSON.stringify(freedCodes(body))}`);
      eq(latestStage(t, IDS.bigCards[0]), "Clamp Work", "step");
      const rows = movesOf(t, IDS.bigCards[0]).filter((m) => m.action === "release");
      eq(rows.length, 1, "release rows");
      eq([rows[0].from_location_id, rows[0].to_location_id ?? null], [placeOf(t, "LOC-HEAT-PRESS-02").id, null], "from, to");
      eq((await emails()).length, before.emails.length, "emails");
    }, { shot: false });
    await s.step("take it out again: ok, nothing changed, no new row", async () => {
      const before = await tables();
      const body = await trackOk(ctx, ROUTES.trackRelease, { cardIds: [IDS.bigCards[0]] });
      assert(body.results.every((r) => r.ok && !r.changed), body.results.map((r) => `${r.code}: ok ${r.ok}, changed ${r.changed}`).join(" | "));
      eq((await tables()).card_moves.length, before.card_moves.length, "card_moves rows");
    }, { shot: false });
  },

  // FIND: a slot -> its cards; a bag/order -> its cards with their slots; a typed Card ID; search; history
  async "track-find"({ ctx, s, appUrl, mockUrl }) {
    await s.step("setup: receive; make CLAMP 01..03; CD-2549-07 + -08 in CLAMP 01, CD-2549-01 in CLAMP 02", async () => {
      await trackSetup(ctx, { clamp: 3 });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-CLAMP-01");
      await assignOk(ctx, "LOC-CLAMP-01", [mailCard(6), mailCard(7)]);
      await assignOk(ctx, "LOC-CLAMP-02", [mailCard(0)]);
    }, { critical: true, shot: false });
    const platDue = "2026-12-07";
    await s.step("slot LOC-CLAMP-01: CLAMP 01, Clamp, number 1, step Clamp Work, 2 cards (Card ID, name, customer, due)", async () => {
      const l = await resolveVia(ctx, "LOC-CLAMP-01", "location");
      eq([l.code, l.name, l.kind, l.station, l.stationName, l.serial, l.stage], ["LOC-CLAMP-01", "CLAMP 01", "station", "clamp", "Clamp", 1, "Clamp Work"], "slot");
      eq([l.cardCount, l.free, l.overCapacity], [2, true, false], "cardCount, free, overCapacity");
      eq((l.cards ?? []).map((c) => c.code).sort(), ["CD-2549-07", "CD-2549-08"], "cards");
      const c = l.cards.find((x) => x.code === "CD-2549-07");
      eq([c.name, c.customer, c.dueDate, c.stage], ["Test Card Platinum One", "Test Customer A", platDue, "Clamp Work"], "CD-2549-07 name, customer, due, step");
      return l.cards.map((x) => `${x.code} ${x.stageLabel}`).join(", ");
    }, { shot: false });
    await s.step("empty slot LOC-CLAMP-03: no cards, free", async () => {
      const l = await resolveVia(ctx, "LOC-CLAMP-03", "location");
      eq([l.name, l.cardCount, (l.cards ?? []).length, l.free], ["CLAMP 03", 0, 0, true], "name, cardCount, cards, free");
    }, { shot: false });
    await s.step("scanned links (any host, any case) find the slot; LOC-DONE is a place", async () => {
      eq((await resolveVia(ctx, "https://thecarddoc1.com/q/loc-clamp-01", "location")).code, "LOC-CLAMP-01", "lower-case link");
      eq((await resolveVia(ctx, `${appUrl}/Q/LOC-CLAMP-02`, "location")).code, "LOC-CLAMP-02", "this site's link");
      eq((await resolveVia(ctx, "HTTPS://THECARDDOC1.COM/Q/LOC-DONE", "location")).kind, "done", "LOC-DONE kind");
    }, { shot: false });
    await s.step("bag CD-2549-P: both cards, each in CLAMP 01 at Clamp Work", async () => {
      const b = await resolveVia(ctx, "CD-2549-P", "bag");
      eq([b.code, b.cardCount, b.doneCount, b.dueDate], ["CD-2549-P", 2, 0, platDue], "bag");
      eq(b.cards.map((c) => [c.code, c.location?.name ?? null, c.stage]), [["CD-2549-07", "CLAMP 01", "Clamp Work"], ["CD-2549-08", "CLAMP 01", "Clamp Work"]], "cards, slots, steps");
    }, { shot: false });
    await s.step("bag CD-2549-G: CD-2549-01 in CLAMP 02; 02-04 in no slot", async () => {
      const b = await resolveVia(ctx, "CD-2549-G", "bag");
      const slotOf = (code) => b.cards.find((c) => c.code === code)?.location;
      eq(slotOf("CD-2549-01")?.name, "CLAMP 02", "CD-2549-01 slot");
      for (const code of ["CD-2549-02", "CD-2549-03", "CD-2549-04"]) assert(!slotOf(code) || slotOf(code).kind !== "station", `${code} is in a slot: ${JSON.stringify(slotOf(code))}`);
    }, { shot: false });
    await s.step("order CD-2549: bags G and P with their cards' slots, and the 4 cards in no bag", async () => {
      const o = await resolveVia(ctx, "CD-2549", "order");
      eq([o.id, o.orderNumber, o.customer], [IDS.mailOrder, ORDER_NUMBERS.mailOrder, "Test Customer A"], "order");
      eq((o.bags ?? []).map((b) => b.code).sort(), ["CD-2549-G", "CD-2549-P"], "bags");
      const card7 = o.bags.flatMap((b) => b.cards).find((c) => c.code === "CD-2549-07");
      eq(card7?.location?.code, "LOC-CLAMP-01", "CD-2549-07 slot");
      eq((o.looseCards ?? []).length, 4, "cards in no bag");
    }, { shot: false });
    await s.step("a typed Card ID (cd-2549-07): the card, in CLAMP 01, due Dec 7", async () => {
      const c = await resolveVia(ctx, "cd-2549-07", "card");
      eq([c.id, c.code, c.location?.code, c.dueDate, c.customer, c.orderNumber], [mailCard(6), "CD-2549-07", "LOC-CLAMP-01", platDue, "Test Customer A", ORDER_NUMBERS.mailOrder], "card");
      assert(c.locatedAt, "locatedAt");
      eq(c.cardUrl, ROUTES.card(mailCard(6)), "cardUrl");
    }, { shot: false });
    await s.step("unknown codes -> 404 (LOC-CLAMP-99, CD-2549-99, CD-9999); not a code -> 400", async () => {
      for (const code of ["LOC-CLAMP-99", "CD-2549-99", "CD-9999"]) eq((await api(ctx, "GET", ROUTES.trackResolve(code))).status, 404, `"${code}" HTTP`);
      eq((await api(ctx, "GET", ROUTES.trackResolve("hello"))).status, 400, `"hello" HTTP`);
    }, { shot: false });
    await s.step("search by Card ID, card name, customer and order number (each card with its slot)", async () => {
      const byCode = await searchVia(ctx, "CD-2549-07");
      eq(byCode.cards.find((c) => c.code === "CD-2549-07")?.location?.code, "LOC-CLAMP-01", "Card ID: CD-2549-07 in CLAMP 01");
      assert((await searchVia(ctx, "Platinum One")).cards.some((c) => c.code === "CD-2549-07"), "card name: CD-2549-07 not found");
      const byCustomer = await searchVia(ctx, "Test Customer A");
      assert(byCustomer.cards.some((c) => c.code === "CD-2549-01"), "customer: CD-2549-01 not found");
      assert(byCustomer.cards.every((c) => c.orderNumber === ORDER_NUMBERS.mailOrder), `customer: other orders' cards: ${byCustomer.cards.filter((c) => c.orderNumber !== ORDER_NUMBERS.mailOrder).map((c) => c.code).join(", ")}`);
      const byOrder = await searchVia(ctx, ORDER_NUMBERS.bigOrder);
      assert(byOrder.cards.length && byOrder.cards.every((c) => c.orderNumber === ORDER_NUMBERS.bigOrder), `order number: ${byOrder.cards.map((c) => c.code).slice(0, 5).join(", ")}`);
      const short = await api(ctx, "GET", ROUTES.trackSearch("x"));
      assert(short.status === 400 || (short.status === 200 && (short.body?.cards ?? []).length === 0), `one character: HTTP ${short.status}, ${(short.body?.cards ?? []).length} cards`);
      return `${byCustomer.cards.length} for the customer, ${byOrder.cards.length} for ${ORDER_NUMBERS.bigOrder}${byOrder.truncated ? " (truncated)" : ""}`;
    }, { shot: false });
    await s.step("history: the slot's moves, the card's (newest first) and the bag's; unknown -> 404", async () => {
      const sh = await api(ctx, "GET", ROUTES.trackHistory("LOC-CLAMP-01"));
      eq(sh.status, 200, "slot history HTTP");
      eq([...new Set((sh.body?.moves ?? []).filter((m) => m.to?.code === "LOC-CLAMP-01").map((m) => m.cardCode))].sort(), ["CD-2549-07", "CD-2549-08"], "slot history: cards put in");
      const ch = await api(ctx, "GET", ROUTES.trackHistory("CD-2549-07"));
      eq(ch.status, 200, "card history HTTP");
      const m = ch.body?.moves ?? [];
      eq([m[0]?.action, m[0]?.to?.code, m[0]?.stageAfter, m[0]?.cardCode], ["assign", "LOC-CLAMP-01", "Clamp Work", "CD-2549-07"], "latest move");
      eq(m.map((x) => x.id), [...m].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((x) => x.id), "newest first");
      const bh = await api(ctx, "GET", ROUTES.trackHistory("CD-2549-P"));
      eq(bh.status, 200, "bag history HTTP");
      eq([...new Set((bh.body?.moves ?? []).map((x) => x.cardCode))].sort(), ["CD-2549-07", "CD-2549-08"], "bag history cards");
      eq((await api(ctx, "GET", ROUTES.trackHistory("CD-2549-99"))).status, 404, "unknown code HTTP");
    }, { shot: false });
  },

  // SHIP CHECK: done + out of the slots = OK; ⚠ "still in CLAMP 02"; ⚠ not done (Mark done)
  async "track-ship"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const G = ["CD-2549-01", "CD-2549-02", "CD-2549-03"];
    await s.step("setup: receive CD-2549 Gold 01-03 (bag CD-2549-G); make CLAMP 01..02; 01 in CLAMP 01, 02 in CLAMP 02", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 2].map(mailCard), "2026-11-15");
      await bulkSlots(ctx, "clamp", 2);
      await assignOk(ctx, "LOC-CLAMP-01", [mailCard(0)]);
      await assignOk(ctx, "LOC-CLAMP-02", [mailCard(1)]);
      eq(cardsIn(await tables(), "LOC-CLAMP-02"), ["CD-2549-02"], "cards in CLAMP 02");
    }, { critical: true, shot: false });
    await s.step("ship check CD-2549-G: the bag's 3 cards, all not done; not ready", async () => {
      const b = await shipCheckVia(ctx, "CD-2549-G");
      eq([b.scope, b.order?.orderNumber], ["bag", ORDER_NUMBERS.mailOrder], "scope, order");
      eq(b.cards.map((c) => c.code).sort(), G, "cards");
      eq(G.map((c) => statusOf(b, c)), ["not_done", "not_done", "not_done"], "statuses");
      eq([b.ready, b.counts?.notDone], [false, 3], "ready, counts.notDone");
    }, { shot: false });
    await s.step("Done on CD-2549-01: ok (done, out of its slot)", async () => {
      await trackOk(ctx, ROUTES.trackDone, { cardIds: [mailCard(0)] });
      eq(statusOf(await shipCheckVia(ctx, "CD-2549-G"), "CD-2549-01"), "ok", "CD-2549-01 status");
    }, { shot: false });
    await s.step('CD-2549-02 ticked done elsewhere but still in CLAMP 02: in_slot, "CLAMP 02"', async () => {
      await mockUpdate(mockUrl, "cards", { completed: true }, "id", mailCard(1));
      const b = await shipCheckVia(ctx, "CD-2549-G");
      const c = b.cards.find((x) => x.code === "CD-2549-02");
      eq([c?.status, c?.done, c?.location?.name], ["in_slot", true, "CLAMP 02"], "status, done, slot");
      eq([b.counts?.inSlot, b.ready], [1, false], "counts.inSlot, ready");
    }, { shot: false });
    await s.step('ship page: 01 ✅; 02 ⚠ "still in CLAMP 02"; 03 ⚠ not done with a Mark done button; 390 px', async () => {
      await goto(page, ROUTES.ship(IDS.mailOrder));
      const row = async (code) => (await UI.shipRow(page, code).innerText()).replace(/\s+/g, " ");
      const r1 = await row("CD-2549-01"), r2 = await row("CD-2549-02"), r3 = await row("CD-2549-03");
      assert(UI.shipOk.test(r1) && !UI.shipFlag.test(r1), `CD-2549-01 row: "${r1.slice(0, 120)}"`);
      assert(UI.shipFlag.test(r2), `CD-2549-02 row not flagged: "${r2.slice(0, 120)}"`);
      assert(UI.stillIn("CLAMP 02").test(r2), `CD-2549-02 row doesn't say "still in CLAMP 02": "${r2.slice(0, 120)}"`);
      assert(UI.shipFlag.test(r3) && !/✅/.test(r3), `CD-2549-03 row: "${r3.slice(0, 120)}"`);
      eq(await UI.shipMarkDone(UI.shipRow(page, "CD-2549-03")).count(), 1, "Mark done button on CD-2549-03's row");
      const w = await phoneShot(browser, appUrl, ROUTES.ship(IDS.mailOrder), "track-ship");
      assert(!w, w);
      return `01 "${r1.slice(0, 50)}" | 02 "${r2.slice(0, 50)}"`;
    });
    let markedInUi = false;
    await s.step("Mark done (then Yes) on CD-2549-03's row: done (POST done), then ok", async () => {
      const row = UI.shipRow(page, "CD-2549-03");
      const done = page.waitForResponse((r) => r.url().includes(ROUTES.trackDone) && r.request().method() === "POST", { timeout: 60_000 });
      await UI.shipMarkDone(row).click();
      // the row asks "Is CD-2549-03 finished?" first
      await UI.shipConfirmDone(row).click({ timeout: 5_000 }).catch(() => {});
      const res = await done;
      assert(res.status() < 300, `done answered ${res.status()}: ${await res.text()}`);
      markedInUi = true;
      assert(cardByCode(await tables(), "CD-2549-03").completed, "CD-2549-03 not done");
      eq(statusOf(await shipCheckVia(ctx, "CD-2549-G"), "CD-2549-03"), "ok", "CD-2549-03 status");
    });
    if (!markedInUi) await s.step("(fallback) Done on CD-2549-03 through the API", () => trackOk(ctx, ROUTES.trackDone, { cardIds: [mailCard(2)] }), { shot: false });
    await s.step("take CD-2549-02 out of CLAMP 02: every card ok, ready", async () => {
      await trackOk(ctx, ROUTES.trackRelease, { cardIds: [mailCard(1)] });
      const b = await shipCheckVia(ctx, "CD-2549-G");
      eq(G.map((c) => statusOf(b, c)), ["ok", "ok", "ok"], "statuses");
      eq([b.ready, b.counts?.ok], [true, 3], "ready, counts.ok");
    }, { shot: false });
    await s.step("a refunded card (CD-2549-01) reads refunded; the bag is still ready", async () => {
      await mockUpdate(mockUrl, "cards", { status: "refunded" }, "id", mailCard(0));
      const b = await shipCheckVia(ctx, "CD-2549-G");
      eq([statusOf(b, "CD-2549-01"), b.ready], ["refunded", true], "CD-2549-01 status, ready");
    }, { shot: false });
    await s.step("by order code (scope order) and by Card ID (checks its bag)", async () => {
      const o = await shipCheckVia(ctx, ORDER_NUMBERS.mailOrder);
      eq(o.scope, "order", "order code scope");
      eq(G.map((c) => statusOf(o, c)), ["refunded", "ok", "ok"], "order code statuses");
      const c = await shipCheckVia(ctx, "CD-2549-02");
      eq([c.scope, c.bags?.map((b) => b.code)], ["bag", ["CD-2549-G"]], "Card ID scope, bag");
    }, { shot: false });
  },

  // FORGOTTEN: a card in the same slot for more than 3 days; a finished order's card not done
  async "track-forgotten"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const today = todayNy();
    await s.step(`setup: receive CD-2549 Gold 01-02 and CD-2600-01 today (${today}); make CLAMP 01..02; CD-2549-02 in CLAMP 02 now`, async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0), mailCard(1)], today);
      await receiveViaApi(ctx, IDS.bigOrder, [IDS.bigCards[0]], today);
      await bulkSlots(ctx, "clamp", 2);
      await assignOk(ctx, "LOC-CLAMP-02", [mailCard(1)]);
    }, { critical: true, shot: false });
    await s.step("CD-2549-01 put in CLAMP 01 9 days ago, untouched since (its placement, move row and step written as then)", async () => {
      const t = await tables();
      const slot = placeOf(t, "LOC-CLAMP-01");
      const card = cardByCode(t, "CD-2549-01");
      // past SLOT_DAYS (7, components/intake/ship/rules.ts) and short of STALE_DAYS (14)
      const then = new Date(Date.now() - 9 * 86400e3).toISOString();
      // nothing newer may say it moved: drop this card's move rows from receiving today (deletes are allowed)
      const { error } = await mockDb(mockUrl).from("card_moves").delete().eq("card_id", card.id);
      assert(!error, `card_moves: ${error?.message}`);
      await insertRows("card_moves", [{ id: crypto.randomUUID(), card_id: card.id, order_id: card.order_id, bag_id: card.bag_id, from_location_id: null, to_location_id: slot.id, stage_before: null, stage_after: "Clamp Work", action: "assign", by: "harness", session_id: null, created_at: then }]);
      await insertRows("order_events", [{ id: crypto.randomUUID(), order_id: card.order_id, event_type: "stage_update", is_customer_visible: true, created_at: then, description: `Stage: Clamp Work [card:${card.id}]`, metadata: { card_id: card.id, stage: "Clamp Work", round: 1 } }]);
      await mockUpdate(mockUrl, "cards", { location_id: slot.id, located_at: then }, "id", card.id);
      return then;
    }, { critical: true, shot: false });
    await s.step("CD-2600 marked Completed with CD-2600-01 not done (a finished order's card)", async () => {
      await mockUpdate(mockUrl, "orders", { status: "completed" }, "id", IDS.bigOrder);
    }, { shot: false });
    await s.step("Forgotten cards lists CD-2549-01 (in CLAMP 01 for days) and CD-2600-01; not CD-2549-02 (just put in) or CD-2400", async () => {
      await goto(page, ROUTES.forgotten);
      const text = await page.locator("main").first().innerText();
      const shows = (code, name) => text.includes(code) || text.includes(name);
      assert(shows("CD-2549-01", "Test Card Gold One"), "CD-2549-01 (9 days in CLAMP 01) not listed");
      assert(nameRe("CLAMP 01", "i").test(text), "its slot CLAMP 01 isn't named");
      assert(shows("CD-2600-01", "Test Big Order Card 01"), "CD-2600-01 (Completed order, not done) not listed");
      assert(!shows("CD-2549-02", "Test Card Gold Two"), "CD-2549-02 is listed, but it went into CLAMP 02 minutes ago");
      assert(!text.includes(ORDER_NUMBERS.deliveredOrder), `${ORDER_NUMBERS.deliveredOrder} (delivered, all done) is listed`);
    });
    await s.step("phone layout (390px) has no sideways scroll", () => phoneShot(browser, appUrl, ROUTES.forgotten, "track-forgotten").then((w) => { assert(!w, w); }));
  },

  // Slot QR labels: a batch PDF, one 50 x 80 mm page per slot (huge "CLAMP 01", step, QR, code);
  // the due-date shelf sign; the bag label still prints on 50 x 80 mm
  async "track-labels"({ ctx, s, appUrl, mockUrl }) {
    await s.step("setup: make CLAMP 01..05 and HEAT PRESS 01..03; receive CD-2549 Gold One + Platinum One (11-15)", async () => {
      await bulkSlots(ctx, "clamp", 5);
      await bulkSlots(ctx, "heat-press", 3);
      await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0), mailCard(6)], "2026-11-15");
    }, { critical: true, shot: false });
    const clamps = `?station=clamp&from=1&to=5`;
    await s.step("clamps 01-05 (?station=clamp&from=1&to=5): a PDF of 5 pages, each 50 x 80 mm portrait", async () => {
      const sizes = await pdfSizes(ctx, ROUTES.slotLabels(clamps));
      eq(sizes.length, 5, "PDF pages");
      const off = sizes.filter((sz) => !sameSize(sz, LABEL_50X80));
      assert(!off.length, `pages ${off.map(ptText).join(", ")}, want ${ptText(LABEL_50X80)}`);
    }, { shot: false });
    await s.step("each clamp label: huge CLAMP 0n (the biggest type), the step, one QR of /Q/LOC-CLAMP-0n, the code", async () => {
      const pages = labelPagesIn(await labelJson(ctx, ROUTES.slotLabels(`${clamps}&format=json`)));
      eq(pages.length, 5, "label pages in the JSON");
      const out = [];
      for (const [i, n] of range(1, 5).entries()) {
        assert(sameSize(pageSize(pages[i]), LABEL_50X80), `page ${i + 1}: ${ptText(pageSize(pages[i]))}`);
        out.push(checkPlaceLabel(pages[i], appUrl, slotCode("clamp", n), slotName("clamp", n)));
        assert(/clamp work/i.test(texts(pages[i]).map((e) => e.text).join(" ")), `CLAMP ${nn(n)}: the step (Clamp Work) isn't printed`);
      }
      return out[0];
    }, { shot: false });
    await s.step("?ids=<HEAT PRESS 01>,<HEAT PRESS 03>: 2 pages, those two slots", async () => {
      const t = await tables();
      const ids = [placeOf(t, "LOC-HEAT-PRESS-01").id, placeOf(t, "LOC-HEAT-PRESS-03").id].join(",");
      eq((await pdfSizes(ctx, ROUTES.slotLabels(`?ids=${ids}`))).length, 2, "PDF pages");
      const pages = labelPagesIn(await labelJson(ctx, ROUTES.slotLabels(`?ids=${ids}&format=json`)));
      eq(pages.map((p) => qrs(p)[0]?.data.split("/").pop()).sort(), ["LOC-HEAT-PRESS-01", "LOC-HEAT-PRESS-03"], "QR codes");
    }, { shot: false });
    await s.step("the bag-label stock setting (4x6) doesn't change slot labels: still 50 x 80 mm", async () => {
      await setLabelStock(mockUrl, "4x6");
      const sizes = await pdfSizes(ctx, ROUTES.slotLabels(clamps));
      assert(sizes.every((sz) => sameSize(sz, LABEL_50X80)), `pages ${sizes.map(ptText).join(", ")}`);
    }, { shot: false });
    await s.step("(route guess: &stock=4x6) the same labels on 4 x 6 in", async () => {
      const sizes = await pdfSizes(ctx, ROUTES.slotLabels(`${clamps}&stock=4x6`));
      eq(sizes.length, 5, "PDF pages");
      assert(sizes.every((sz) => sameSize(sz, STOCK_4X6)), `pages ${sizes.map(ptText).join(", ")}, want ${ptText(STOCK_4X6)}`);
    }, { shot: false });
    await s.step("the due-date shelf sign (LOC-SHELF-20261207): 1 page of 50 x 80 mm, big DUE MON DEC 7, its QR", async () => {
      const shelf = placeOf(await tables(), shelfCode("2026-12-07"));
      assert(shelf, `no shelf slot ${shelfCode("2026-12-07")} after receiving a Platinum card due Dec 7`);
      eq((await pdfSizes(ctx, ROUTES.slotLabels(`?ids=${shelf.id}`))).length, 1, "PDF pages");
      const pages = labelPagesIn(await labelJson(ctx, ROUTES.slotLabels(`?ids=${shelf.id}&format=json`)));
      eq(pages.length, 1, "label pages");
      assert(sameSize(pageSize(pages[0]), LABEL_50X80), `page ${ptText(pageSize(pages[0]))}`);
      return checkPlaceLabel(pages[0], appUrl, shelf.code, "DUE MON DEC 7");
    }, { shot: false });
    await s.step("the bag label still prints on 50 x 80 mm (stock 50x80mm): one page per bag, one QR (the bag's)", async () => {
      await setLabelStock(mockUrl, STOCK_50X80);
      const body = await labelJson(ctx, ROUTES.orderLabel(IDS.mailOrder, "?format=json"));
      eq(body.settings?.stock, STOCK_50X80, "settings.stock");
      eq((body.bags ?? []).length, 2, "bags");
      for (const b of body.bags) {
        eq(b.labels.length, 1, `${b.bagCode} label pages`);
        assert(sameSize(pageSize(b.labels[0]), LABEL_50X80), `${b.bagCode}: ${ptText(pageSize(b.labels[0]))}`);
        eq(qrs(b.labels[0]).length, 1, `${b.bagCode} QR codes`);
        assert(bagQrData(appUrl, b.bagCode).includes(qrs(b.labels[0])[0].data), `${b.bagCode}: QR "${qrs(b.labels[0])[0].data}"`);
      }
      const sizes = await pdfSizes(ctx, ROUTES.orderLabel(IDS.mailOrder));
      eq(sizes.length, 2, "order PDF pages");
      assert(sizes.every((sz) => sameSize(sz, LABEL_50X80)), `pages ${sizes.map(ptText).join(", ")}`);
    }, { shot: false });
  },

  // /q/<LOC code>: a slot's QR label opens the Scan page with that slot scanned; signed out: sign in first
  async "track-q"({ page, ctx, s, browser, appUrl }) {
    // Where a scanned code goes, signed in (a middleware redirect from /Q to /q may come first)
    const scanTo = async (url) => {
      const r = await api(ctx, "GET", url);
      assert([301, 302, 303, 307, 308].includes(r.status), `${url}: HTTP ${r.status}`);
      let loc = new URL(r.headers.location, appUrl);
      if (loc.pathname.startsWith("/q/")) loc = new URL((await api(ctx, "GET", loc.pathname)).headers.location ?? "/", appUrl);
      return loc;
    };
    await s.step("setup: make CLAMP 01..03", () => bulkSlots(ctx, "clamp", 3), { critical: true, shot: false });
    for (const url of [ROUTES.qr("LOC-CLAMP-01"), ROUTES.qrUpper("LOC-CLAMP-01"), ROUTES.qr("loc-clamp-01")]) {
      await s.step(`${url} -> /admin/scan?loc=LOC-CLAMP-01`, async () => {
        const loc = await scanTo(url);
        eq([loc.pathname, loc.searchParams.get("loc")], [ROUTES.scan, "LOC-CLAMP-01"], "redirect");
        return `${loc.pathname}${loc.search}`;
      }, { shot: false });
    }
    await s.step("/q/LOC-DONE and /q/LOC-SHIP -> the Scan page with that place", async () => {
      for (const code of ["LOC-DONE", "LOC-SHIP"]) {
        const loc = await scanTo(ROUTES.qr(code));
        eq([loc.pathname, loc.searchParams.get("loc")], [ROUTES.scan, code], `${code} redirect`);
      }
    }, { shot: false });
    await s.step("bag and order codes still open their photos; a Card ID its card page", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [mailCard(6)], "2026-11-15");
      const bag = bagByCode(await tables(), "CD-2549-P");
      const b = await scanTo(ROUTES.qrUpper("CD-2549-P"));
      eq(`${b.pathname}?bag=${b.searchParams.get("bag")}`, ROUTES.photos(IDS.mailOrder, bag.id), "bag redirect");
      eq((await scanTo(ROUTES.qr(ORDER_NUMBERS.mailOrder))).pathname, ROUTES.photos(IDS.mailOrder), "order redirect");
      eq((await scanTo(ROUTES.qr("CD-2549-07"))).pathname, ROUTES.card(mailCard(6)), "card redirect");
    }, { shot: false });
    await s.step("signed out: /q/loc-clamp-01 and /Q/LOC-CLAMP-01 -> sign in with next=/q/LOC-CLAMP-01", async () => {
      const anon = await browser.newContext({ baseURL: appUrl, ignoreHTTPSErrors: true });
      try {
        for (const url of [ROUTES.qr("loc-clamp-01"), ROUTES.qrUpper("LOC-CLAMP-01")]) {
          let r = await anon.request.fetch(url, { maxRedirects: 0, failOnStatusCode: false });
          assert([301, 302, 303, 307, 308].includes(r.status()), `${url}: HTTP ${r.status()}`);
          let loc = new URL(r.headers().location ?? "/", appUrl);
          if (loc.pathname.startsWith("/q/")) {
            r = await anon.request.fetch(loc.pathname, { maxRedirects: 0, failOnStatusCode: false });
            loc = new URL(r.headers().location ?? "/", appUrl);
          }
          eq([loc.pathname, loc.searchParams.get("next")], ["/admin/login", "/q/LOC-CLAMP-01"], `${url} redirect`);
        }
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step("scanning CLAMP 01's label in the signed-in browser lands on the Scan page, showing CLAMP 01", async () => {
      await goto(page, ROUTES.qrUpper("LOC-CLAMP-01"));
      const u = new URL(page.url());
      eq([u.pathname, u.searchParams.get("loc")], [ROUTES.scan, "LOC-CLAMP-01"], "landed on");
      await page.getByText(nameRe("CLAMP 01", "i")).first().waitFor({ timeout: 15_000 });
    });
  },

  // Due-date shelf slots: after Receive "Put in shelf: DUE MON DEC 7"; one slot per due date; Shelf view
  async "track-shelf"({ page, ctx, s, browser, appUrl }) {
    const platDue = "2026-12-07";
    const goldDue = addBusinessDays("2026-11-15", TURNAROUND.premium);
    const bigGoldDue = addBusinessDays("2026-11-20", TURNAROUND.premium);
    await s.step("workspace: receive Platinum Three on 2026-11-15 -> \"Put in shelf: DUE MON DEC 7\"", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      await UI.arrived(page, MAIL_NAMES[8]).check();
      await UI.receivedOn(page).fill("2026-11-15");
      const res = await clickForApi(page, UI.receiveButton(page), "/receive");
      assert(res.status() < 300, `receive answered ${res.status()}: ${await res.text()}`);
      const slots = shelvesIn(await res.json().catch(() => null));
      await page.getByText(UI.putInShelf).first().waitFor({ timeout: 15_000 });
      const text = await page.locator("main").first().innerText();
      assert(nameRe(shelfName(platDue), "i").test(text), `"${shelfName(platDue)}" not shown`);
      return `answer names ${slots.map((x) => x.code).join(", ") || "no shelf slot"}`;
    });
    if (!cardByCode(await tables(), "CD-2549-09")?.received_at) {
      await s.step("(fallback) receive Platinum Three through the API", () => receiveViaApi(ctx, IDS.mailOrder, [mailCard(8)], "2026-11-15"), { critical: true, shot: false });
    }
    await s.step("workspace: a Print shelf sign button", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      assert(await UI.printShelfSign(page).count() > 0, "no Print shelf sign button or link");
    });
    let decSeven = null;
    await s.step(`the slot exists once: ${shelfCode(platDue)}, kind shelf, due ${platDue}, named "${shelfName(platDue)}"`, async () => {
      const rows = (await tables()).locations.filter((l) => l.code === shelfCode(platDue));
      eq(rows.length, 1, "rows");
      decSeven = rows[0];
      eq([decSeven.kind, decSeven.due_date, decSeven.name, decSeven.active, decSeven.station ?? null, decSeven.stage ?? null], ["shelf", platDue, shelfName(platDue), true, null, null], "kind, due_date, name, active, station, stage");
    }, { critical: true, shot: false });
    await s.step(`receive Gold One + Platinum One (11-15) through the API: the answer names both shelves (Dec 7 reused, ${shelfName(goldDue)})`, async () => {
      const body = await receiveViaApi(ctx, IDS.mailOrder, [mailCard(0), mailCard(6)], "2026-11-15");
      const slots = shelvesIn(body);
      const byCode = Object.fromEntries(slots.map((x) => [x.code, x]));
      assert(byCode[shelfCode(platDue)] && byCode[shelfCode(goldDue)], `shelves in the answer: ${slots.map((x) => x.code).join(", ") || "none"}`);
      eq(byCode[shelfCode(platDue)].name, shelfName(platDue), "Dec 7 name");
      eq(byCode[shelfCode(goldDue)].name, shelfName(goldDue), "Gold name");
      if (byCode[shelfCode(platDue)].id) eq(byCode[shelfCode(platDue)].id, decSeven.id, "Dec 7 slot id (reused)");
      eq((await tables()).locations.filter((l) => l.code === shelfCode(platDue)).length, 1, "Dec 7 rows");
      return slots.map((x) => `${x.code} "${x.name}"`).join(", ");
    }, { shot: false });
    await s.step("another order due the same day (CD-2600 Platinum, 11-15) shares the Dec 7 slot; its Gold (11-20) gets its own", async () => {
      await receiveViaApi(ctx, IDS.bigOrder, [IDS.bigCards[4]], "2026-11-15");
      await receiveViaApi(ctx, IDS.bigOrder, [IDS.bigCards[0]], "2026-11-20");
      const t = await tables();
      eq(t.locations.filter((l) => l.code === shelfCode(platDue)).length, 1, "Dec 7 rows");
      assert(placeOf(t, shelfCode(bigGoldDue)), `no ${shelfCode(bigGoldDue)}`);
      const placed = t.tier_bags.filter((b) => b.location_id).map((b) => `${b.bag_code}@${t.locations.find((l) => l.id === b.location_id)?.code}`);
      return `bags placed at receive: ${placed.join(", ") || "none (location_id not set)"}`;
    }, { shot: false });
    await s.step("Shelf view: slots in due-date order, each bag under its own slot", async () => {
      await goto(page, ROUTES.shelf);
      const text = (await page.locator("main").first().innerText()).toUpperCase();
      const slots = [platDue, goldDue, bigGoldDue].sort().map((d) => ({ name: shelfName(d), at: text.search(nameRe(shelfName(d))) }));
      const missing = slots.filter((x) => x.at < 0).map((x) => x.name);
      assert(!missing.length, `slots not shown: ${missing.join(", ")}`);
      eq([...slots].sort((a, b) => a.at - b.at).map((x) => x.name), slots.map((x) => x.name), "slot order");
      const want = { "CD-2549-P": platDue, "CD-2600-P": platDue, "CD-2549-G": goldDue, "CD-2600-G": bigGoldDue };
      for (const [bag, due] of Object.entries(want)) {
        const at = text.search(new RegExp(`${esc(bag)}(?![0-9A-Z])`));
        assert(at >= 0, `${bag} not shown`);
        const under = slots.filter((x) => x.at < at).at(-1);
        eq(under?.name ?? null, shelfName(due), `slot above ${bag}`);
      }
      return slots.map((x) => x.name).join(" < ");
    });
    await s.step(`/q/${shelfCode(platDue)} -> the Scan page with that shelf`, async () => {
      const r = await api(ctx, "GET", ROUTES.qr(shelfCode(platDue)));
      const loc = new URL(r.headers.location ?? "/", appUrl);
      eq([loc.pathname, loc.searchParams.get("loc")], [ROUTES.scan, shelfCode(platDue)], "redirect");
    }, { shot: false });
    await s.step("Shelf view at 390 px has no sideways scroll", () => phoneShot(browser, appUrl, ROUTES.shelf, "track-shelf").then((w) => { assert(!w, w); }));
  },

  // The Scan page on a phone (390 px): handheld-scanner box, an empty slot asks for a card, a full slot shows it
  async "track-scan-page"({ page, ctx, s, browser, appUrl }) {
    await s.step("setup: receive; make CLAMP 01..03; CD-2549-01 in CLAMP 02", async () => {
      await trackSetup(ctx, { clamp: 3 });
      await assignOk(ctx, "LOC-CLAMP-02", [mailCard(0)]);
    }, { critical: true, shot: false });
    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const shot = (name) => p.screenshot({ path: path.join(OUT, `track-scan-page-${name}.png`), fullPage: true }).catch(() => {});
    try {
      await s.step("/admin/scan at 390 px: loads signed in, a scanner box, no sideways scroll", async () => {
        await goto(p, ROUTES.scan);
        await UI.scanInput(p).waitFor({ timeout: 30_000 });
        const w = await sidewaysScroll(p);
        await shot("01-open");
        assert(w <= 1, `scrolls sideways by ${w}px`);
      }, { critical: true, shot: false });
      await s.step('the handheld scanner types CLAMP 01\'s link + Enter: "Put a card in CLAMP 01" (no navigation, no sideways scroll)', async () => {
        await Promise.all([
          p.waitForResponse((r) => r.url().includes("/api/admin/track/resolve"), { timeout: 60_000 }),
          scanType(p, "HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-01"),
        ]);
        await p.getByText(UI.putCardIn("CLAMP 01")).first().waitFor({ timeout: 15_000 });
        eq(new URL(p.url()).pathname, ROUTES.scan, "still on the Scan page");
        await shot("02-empty-slot");
        const w = await sidewaysScroll(p);
        assert(w <= 1, `scrolls sideways by ${w}px`);
      }, { shot: false });
      await s.step("then the bag's QR (CD-2549-P) lists its cards; tap CD-2549-07: it goes into CLAMP 01 (step Clamp Work)", async () => {
        await scanType(p, "HTTPS://THECARDDOC1.COM/Q/CD-2549-P");
        const pick = UI.pickCard(p, "CD-2549-07");
        await pick.waitFor({ timeout: 15_000 });
        await shot("03-bag-cards");
        const assigned = p.waitForResponse((r) => r.url().includes(ROUTES.trackAssign) && r.request().method() === "POST", { timeout: 30_000 });
        await pick.click();
        const res = await assigned;
        assert(res.status() < 300, `assign answered ${res.status()}: ${await res.text()}`);
        const t = await tables();
        eq(cardsIn(t, "LOC-CLAMP-01"), ["CD-2549-07"], "cards in CLAMP 01");
        eq(latestStage(t, mailCard(6)), "Clamp Work", "CD-2549-07 step");
        await shot("04-assigned");
      }, { shot: false });
      await s.step("scanning the full CLAMP 02 shows its card (Card ID, name, customer) with Move, Done and Take out", async () => {
        await Promise.all([
          p.waitForResponse((r) => r.url().includes("/api/admin/track/resolve"), { timeout: 60_000 }),
          scanType(p, "LOC-CLAMP-02"),
        ]);
        await p.getByText("CD-2549-01").first().waitFor({ timeout: 15_000 });
        const text = await p.locator("main").first().innerText();
        for (const want of ["Test Card Gold One", "Test Customer A"]) assert(text.includes(want), `"${want}" not shown`);
        for (const [what, loc] of [["Move", UI.slotMove(p)], ["Done", UI.slotDone(p)], ["Take out", UI.slotTakeOut(p)]]) assert(await loc.count() > 0, `no ${what} button`);
        await shot("05-full-slot");
        const w = await sidewaysScroll(p);
        assert(w <= 1, `scrolls sideways by ${w}px`);
      }, { shot: false });
      await s.step('opened from a label (/admin/scan?loc=LOC-CLAMP-03): "Put a card in CLAMP 03" right away', async () => {
        await goto(p, ROUTES.scanAt("LOC-CLAMP-03"));
        await p.getByText(UI.putCardIn("CLAMP 03")).first().waitFor({ timeout: 30_000 });
        await shot("06-from-label");
      }, { shot: false });
      await s.step("no browser errors on the phone (headless: no camera)", async () => {
        assert(!phone.errors.length, phone.errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    } finally {
      await phone.ctx.close();
    }
    await s.step('desktop: the menu has "Scan" (top of the intake group)', async () => {
      await goto(page, ROUTES.receiving);
      eq(new URL(await UI.scanNavLink(page).getAttribute("href"), appUrl).pathname, ROUTES.scan, "Scan link");
    });
  },
};

// ─── Main ───────────────────────────────────────────────────────────────────
export async function runScenarios({ only = null } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await startHarness();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      // --only a,b or a prefix with a star: --only 'track-*'
      if (only && !only.some((o) => o === name || (o.endsWith("*") && name.startsWith(o.slice(0, -1))))) continue;
      console.log(`\n▶ ${name}`);
      await reset();
      const ctx = await newAdminContext(browser, { appUrl: h.appUrl });
      // a missing button fails the step after 30 s instead of waiting forever
      ctx.setDefaultTimeout(30_000);
      ctx.setDefaultNavigationTimeout(240_000);
      const page = await ctx.newPage();
      // confirm() prompts ("Switch … to …?", "Mark … as not received?") are answered yes, as staff would
      page.on("dialog", (d) => d.accept().catch(() => {}));
      const s = new Scenario(name, page, results);
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      try {
        await fn({ page, ctx, s, browser, appUrl: h.appUrl, mockUrl: h.mockUrl });
      } catch (e) {
        results.push({ scenario: name, step: "(setup)", status: "FAIL", note: String(e?.message ?? e).split("\n")[0].slice(0, 400) });
        console.log(`  FAIL  ${name} setup: ${String(e?.message ?? e).split("\n")[0]}`);
      }
      if (pageErrors.length) {
        results.push({ scenario: name, step: "no browser errors", status: "FAIL", note: pageErrors.slice(0, 3).join(" | ").slice(0, 300) });
        console.log(`  FAIL  ${name}: browser errors: ${pageErrors.slice(0, 3).join(" | ").slice(0, 300)}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    const d = await dump().catch(() => null);
    if (d && (d.unknown.tables.length || d.unknown.rpcs.length)) {
      console.log(`\nnote: tables/relations the mock doesn't model: ${d.unknown.tables.join(", ") || "none"}; unknown RPCs: ${d.unknown.rpcs.join(", ") || "none"}`);
    }
    await h.stop();
  }
  const count = (st) => results.filter((r) => r.status === st).length;
  console.log(`\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIP")} skipped. Screenshots: ${path.relative(process.cwd(), OUT)}/`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf("--only");
  const only = i > 0 ? process.argv[i + 1].split(",") : null;
  const results = await runScenarios({ only });
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}
