// End-to-end scenarios for the intake system (receiving, tier bags, QR codes,
// stages, completion, the one-per-order label, the order photos page, the
// "Print labels" step, Historical Order Setup), run in a real browser against
// the local harness (fake Supabase, fake data, no real emails).
//
//   node tests/intake/e2e/scenarios.mjs                 start harness, run all, stop
//   node tests/intake/e2e/scenarios.mjs --only qr,labels,photos-page,print-step
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
import { IDS, ORDER_NUMBERS, MAIL_CARD_TIERS, HOLIDAYS, BIG_CARD_TIERS, BIG_CUSTOMER_NAME } from "../harness/seed.mjs";
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

  // ── Card tracking (scan-anywhere, brief of Nov 24; types in lib/intake/tracking/types.ts) ──
  // The Scan page (phone-first): ?loc=<LOC code> = MOVE with that place picked (where /q/<LOC> leads)
  scan: "/admin/scan",
  scanAt: (locCode) => `/admin/scan?loc=${encodeURIComponent(locCode)}`,
  // Shelf view (slots by due date), Places (+ print signs), the ship check page
  shelf: "/admin/receiving/shelf",
  places: "/admin/receiving/locations",
  ship: (orderId) => `/admin/receiving/ship/${orderId}`,
  // The forgotten-cards report (completed orders with a card not done). NOT in the brief: a guess,
  // fix here once the ship-check agent's page and route exist
  forgotten: "/admin/receiving/forgotten",
  forgottenApi: "/api/admin/track/forgotten",
  // APIs: ResolveResponse, MoveResponse, HistoryResponse, LocationsResponse, ShipCheckResponse
  trackResolve: (code) => `/api/admin/track/resolve?code=${encodeURIComponent(code)}`,
  trackMove: "/api/admin/track/move",
  trackHistory: (code) => `/api/admin/track/history?code=${encodeURIComponent(code)}`,
  trackLocations: (query = "") => `/api/admin/track/locations${query}`,
  placeSign: (locationId, query = "") => `/api/admin/track/locations/${locationId}/sign${query}`,
  shipCheck: (code) => `/api/admin/track/ship-check?code=${encodeURIComponent(code)}`,
  // Card stickers (50 x 80 mm, one page per received card): ?order= | ?bag= | ?ids=a,b; &format=json
  // -> { settings, pages: [{ cardId, code, page: LabelPage }] }
  cardStickers: (query) => `/api/admin/intake/labels/cards${query}`,
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

  // ── Card tracking (guesses from the brief; the pages were being built while these were written) ──
  // The Scan page's text box for a Bluetooth/USB handheld scanner (it types the code or URL, then Enter)
  scanInput: (page) => page.getByRole("textbox", { name: /scan|code/i }).or(page.locator("input[data-scan-input], input[name='code']")).first(),
  // The three big mode buttons (tabs, radios or buttons): "Move", "Find", "Ship check"
  scanMode: (page, mode) => {
    const name = new RegExp(`^\\s*${esc(mode)}( mode| cards?)?\\s*$`, "i");
    return page.getByRole("tab", { name }).or(page.getByRole("radio", { name })).or(page.getByRole("button", { name })).first();
  },
  // The menu item at the top of the intake group
  scanNavLink: (page) => page.getByRole("link", { name: /^scan$/i }).first(),
  // After Receive, the workspace says where the bags go: "Put in shelf: DUE MON DEC 7"
  putInShelf: /put in shelf/i,
  printStickers: (page) => page.getByRole("button", { name: /print (\d+ )?card stickers?/i }).or(page.getByRole("link", { name: /print (\d+ )?card stickers?/i })).first(),
  printShelfSign: (page) => page.getByRole("button", { name: /print (the )?shelf sign/i }).or(page.getByRole("link", { name: /print (the )?shelf sign/i })).first(),
  // Ship check page rows: a flagged card (not done / not at Shipping) and a card that's ready
  shipRow: (page, cardCode) => page.locator("li, tr, article, [role='row']").filter({ hasText: cardCode }).last(),
  shipFlag: /⚠|not done|not here|not at shipping/i,
  shipOk: /✅|\bready\b|\bok\b/i,
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

// ─── Card tracking helpers (scan-anywhere) ──────────────────────────────────
const MM = PT / 25.4;
/** The Katasymbol sticker, portrait: 50 mm wide, 80 mm tall (141.7 x 226.8 pt). */
const STICKER = { w: 50 * MM, h: 80 * MM };
const STOCK_4X6 = { w: 4 * PT, h: 6 * PT };
/** store_config key and values of the label stock setting (lib/intake/labels/stock.ts). */
const LABEL_STOCK_KEY = "intake_label_stock";
const STOCK_50X80 = "50x80mm";
const CUSTOMER_A = "test.customer.a@example.com";
const CUSTOMER_G = "test.customer.g@example.com";
const sameSize = (a, b) => Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
const pageSize = (p) => ({ w: p.width, h: p.height });
const ptText = (s) => `${s.w.toFixed(1)}x${s.h.toFixed(1)} pt`;
/** What any code's QR holds (place, card or bag): the site's /Q/<CODE> in upper case. */
const codeQrData = bagQrData;
const placeOf = (t, code) => t.locations.find((l) => l.code === code);
const placeId = (code) => IDS.places[DEFAULT_PLACES.findIndex((p) => p.code === code)];
const cardByCode = (t, code) => t.cards.find((c) => c.card_code === code);
const bagByCode = (t, code) => t.tier_bags.find((b) => b.bag_code === code);
const movesOf = (t, cardId) => t.card_moves.filter((m) => m.card_id === cardId);
const stageEventCount = (t) => t.order_events.filter((e) => e.event_type === "stage_update").length;
const mailsTo = (list, email) => list.filter((m) => JSON.stringify(m.to ?? "").includes(email));
/** Independent of the app: a shelf slot's code and name for a due date ("LOC-SHELF-20261207", "DUE MON DEC 7"). */
const shelfCode = (day) => `LOC-SHELF-${day.replaceAll("-", "")}`;
function shelfName(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return `DUE ${wd} ${mon} ${d.getUTCDate()}`;
}
/** A slot name as a regex that doesn't match a longer date ("DUE MON DEC 7" vs "... DEC 14"). */
const slotRe = (name, flags = "") => new RegExp(`${esc(name)}(?!\\d)`, flags);

/** The label stock setting, written straight into the mock's store_config (as the Settings page saves it). */
async function setLabelStock(mockUrl, stock) {
  const { error } = await mockDb(mockUrl).from("store_config").upsert({ key: LABEL_STOCK_KEY, value: stock, updated_at: new Date().toISOString() });
  assert(!error, `label stock setting: ${error?.message}`);
}
/** POST /api/admin/track/move; fails unless 200 with a results array (MoveResponse). */
async function moveVia(ctx, locationCode, codes) {
  const r = await api(ctx, "POST", ROUTES.trackMove, { locationCode, codes });
  assert(r.status === 200 && Array.isArray(r.body?.results), `move to ${locationCode} (${codes.join(", ")}): HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}
const resultFor = (body, code) => body.results.find((r) => r.code === code) ?? null;
/** GET /api/admin/track/resolve; fails unless 200 and the expected kind (ResolveResponse). */
async function resolveVia(ctx, code, kind) {
  const r = await api(ctx, "GET", ROUTES.trackResolve(code));
  assert(r.status === 200, `resolve "${code}": HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  eq(r.body?.kind, kind, `resolve "${code}" kind`);
  assert(r.body[kind] && typeof r.body[kind] === "object", `resolve "${code}": no "${kind}" object in ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body[kind];
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
/** Every LabelPage-shaped object in a JSON answer (sign or sticker routes). */
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
/** stage_update events up to `upTo` for each card, in the past (so a move made now is newer). */
async function putAtStage(orderId, cardIds, upTo) {
  const start = new Date(Date.now() - 10 * 3600e3).toISOString();
  await insertRows("order_events", cardIds.flatMap((cid) => stageRows(orderId, cid, upTo, start)));
}
/**
 * A place sign: one QR (the place's /Q/<LOC code>, at least 0.9 in), the code printed, and the
 * name in big type (the biggest on the sign; a long name may wrap).
 */
function checkSign(p, appUrl, code, name) {
  const q = qrs(p);
  eq(q.length, 1, `${code}: QR codes on the sign`);
  assert(codeQrData(appUrl, code).includes(q[0].data), `${code}: QR holds "${q[0].data}", expected ${codeQrData(appUrl, code).join(" or ")}`);
  assert(q[0].size >= 0.9 * PT - 0.5, `${code}: QR ${(q[0].size / PT).toFixed(2)} in, want at least 0.9 in`);
  const all = texts(p);
  const joined = norm(all.map((e) => e.text).join(" "));
  assert(joined.includes(norm(code)), `${code}: the code isn't printed on the sign`);
  const full = norm(name);
  const isName = (e) => { const x = norm(e.text); return x === full || (x.length >= 3 && full.includes(x) && !norm(code).includes(x)); };
  const named = all.filter(isName);
  assert(named.length && joined.includes(full), `${code}: name "${name}" not on the sign (texts: ${all.map((e) => e.text).join(" | ").slice(0, 160)})`);
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
      if (only && !only.includes(name)) continue;
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
