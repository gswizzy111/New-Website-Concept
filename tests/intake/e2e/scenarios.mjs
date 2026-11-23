// End-to-end scenarios for the intake system (receiving, tier bags, QR codes,
// stages, completion, labels, Historical Order Setup), run in a real browser
// against the local harness (fake Supabase, fake data, no real emails).
//
//   node tests/intake/e2e/scenarios.mjs                 start harness, run all, stop
//   node tests/intake/e2e/scenarios.mjs --only qr,labels
//   HARNESS_APP_URL=… HARNESS_MOCK_URL=… node tests/intake/e2e/scenarios.mjs   reuse a running harness
//   INTERCEPT_UPLOAD=1 …                                 answer /api/upload in the browser instead of the app
//
// Every scenario starts from a fresh seed (POST /__reset) and prints PASS /
// FAIL / SKIP per step. Screenshots (deviceScaleFactor 1) go to
// tests/intake/e2e/out/. The UI wording the scenarios rely on is in UI and
// ROUTES below: adjust it there once, if the real pages word things differently.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { startHarness, loadPlaywright, newAdminContext, dump, reset, emails, insertRows } from "../harness/start.mjs";
import { IDS, ORDER_NUMBERS, MAIL_CARD_TIERS, HOLIDAYS } from "../harness/seed.mjs";
import { placeholderPng } from "../harness/mock-supabase.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");

// ─── Routes the brief plans (edit here if they move) ────────────────────────
export const ROUTES = {
  receiving: "/admin/receiving",
  receivingOrder: (orderId) => `/admin/receiving/${orderId}`,
  bag: (bagId) => `/admin/receiving/bag/${bagId}`,
  card: (cardId) => `/admin/receiving/card/${cardId}`,
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
  // The label PDF route isn't fixed in the brief: the first candidate that answers with a PDF wins
  labelPdfCandidates: (bagIds, orderId) => [
    `/api/admin/intake/labels?bags=${bagIds.join(",")}`,
    `/api/admin/intake/labels?bagIds=${bagIds.join(",")}`,
    ...(bagIds.length === 1 ? [`/api/admin/intake/bags/${bagIds[0]}/label`, `/api/admin/intake/bags/${bagIds[0]}/labels`, `/api/admin/intake/labels/${bagIds[0]}`] : []),
    `/api/admin/intake/orders/${orderId}/labels`,
  ],
};

// ─── UI wording (from the brief and the components built so far) ────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const UI = {
  searchBox: (page) => page.getByRole("searchbox", { name: /search orders/i }),
  searchResultLink: (page, orderNumber) => page.getByRole("link", { name: new RegExp(esc(orderNumber)) }).first(),
  arrived: (page, cardName) => page.getByRole("checkbox", { name: new RegExp(`^Arrived: .*${esc(cardName)}$`) }),
  receivedOn: (page) => page.getByLabel(/received on/i).last(),
  receiveButton: (page) => page.getByRole("button", { name: /^Receive selected cards/i }),
  cardRow: (page, cardName) => page.locator("li").filter({ hasText: cardName }).first(),
  tierSelect: (page, cardName) => UI.cardRow(page, cardName).getByLabel(/tier/i),
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
  markDone: (scope) => scope.getByRole("button", { name: /^(mark (card|cards|\d+ cards?|all) done|mark done)/i }).first(),
  differentSteps: (page) => page.getByText(/cards at different steps/i).first(),
  newChip: (page, bagCode) => page.locator("li, tr, article, section div").filter({ hasText: bagCode }).getByText(/^New$/).first(),
  setupSelectAll: (page) => page.getByRole("checkbox", { name: /select all/i }).first(),
  setupPreview: (page) => page.getByRole("button", { name: /preview/i }).first(),
  setupRun: (page) => page.getByRole("button", { name: /^(confirm|run|set up|generate|start)\b/i }).first(),
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
    await s.step("receiving the card with no tier is refused and names the card", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      await UI.arrived(page, MAIL_NAMES[9]).check();
      const res = await clickForApi(page, UI.receiveButton(page), "/receive");
      assert(res.status() >= 400, `expected a refusal, got ${res.status()}`);
      const msg = await UI.alert(page).innerText();
      assert(/tier/i.test(msg) && /10|No Tier/.test(msg), `refusal should name card 10 and the tier: "${msg}"`);
      const c = (await tables()).cards.find((x) => x.id === mailCard(9));
      assert(!c.received_at, "card was received without a tier");
      return msg;
    });
    await s.step("pick Bronze for it, then receive: CD-2549-B", async () => {
      await goto(page, ROUTES.receivingOrder(IDS.mailOrder));
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/tier") && r.request().method() === "POST", { timeout: 30_000 }),
        UI.tierSelect(page, MAIL_NAMES[9]).selectOption("regular"),
      ]);
      await page.waitForLoadState("networkidle").catch(() => {});
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
  },

  // In-person drop-off: add a card with a photo to the existing order and receive it
  async "dropoff-add-card"({ page, s, mockUrl }) {
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

  // /q/<CODE> and /Q/<CODE> redirect to the admin card/bag pages; unknown -> 404; signed out -> sign in, then back
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
    await s.step(`/Q/${bag.bag_code} (upper-case path) -> bag page`, async () => {
      const r = await api(ctx, "GET", ROUTES.qrUpper(bag.bag_code));
      assert([301, 302, 303, 307, 308].includes(r.status), `status ${r.status}`);
      let loc = new URL(r.headers.location, appUrl);
      // a middleware rewrite/redirect from /Q to /q may come first
      if (loc.pathname.startsWith("/q/")) loc = new URL((await api(ctx, "GET", loc.pathname)).headers.location ?? "/", appUrl);
      eq(loc.pathname, ROUTES.bag(bag.id), "redirect");
    }, { shot: false });
    await s.step("unknown code -> 404", async () => {
      const r = await api(ctx, "GET", ROUTES.qr("CD-0000-99"));
      eq(r.status, 404, "status");
    }, { shot: false });
    await s.step("signed out: sign-in page with next=<card page>", async () => {
      const anon = await browser.newContext({ baseURL: appUrl, ignoreHTTPSErrors: true });
      try {
        const r = await anon.request.fetch(ROUTES.qr(card.card_code), { maxRedirects: 0, failOnStatusCode: false });
        const loc = new URL(r.headers().location ?? "/", appUrl);
        eq(loc.pathname, "/admin/login", "redirect");
        eq(loc.searchParams.get("next"), ROUTES.card(card.id), "next");
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step("scanning in the signed-in browser lands on the card page", async () => {
      await goto(page, ROUTES.qr(card.card_code));
      eq(new URL(page.url()).pathname, ROUTES.card(card.id), "landed on");
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
      const row = UI.cardRow(page, MAIL_NAMES[1]);
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

  // Label PDFs: one 4x6 page per label; a big bag continues on more labels
  async labels({ ctx, s }) {
    const tiered = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(mailCard);
    await receiveViaApi(ctx, IDS.mailOrder, tiered, "2026-11-15");
    // A big Gold bag: 14 more Gold cards on the drop-off order
    const extra = Array.from({ length: 14 }, (_, i) => ({
      id: crypto.randomUUID(), order_id: IDS.dropoffOrder, created_at: "2026-11-21T19:00:00.000Z", card_name: `Test Bulk Card ${i + 1}`,
      card_set: "Base Set", card_number: `${60 + i}/102`, tier: "premium", photo_urls: [], service_ids: [], completed: false, status: "active",
      current_round: 1, refunded_cents: 0, slab_removal_selected: false, pregrade_selected: false, awaiting_arrival: false, receiving_photo_urls: [],
    }));
    await insertRows("cards", extra);
    await receiveViaApi(ctx, IDS.dropoffOrder, [...IDS.dropoffCards, ...extra.map((c) => c.id)], "2026-11-21");
    const t = await tables();
    const mailBags = bagsOf(t, IDS.mailOrder);
    const bigBag = bagsOf(t, IDS.dropoffOrder)[0];
    let route = null;
    const fetchPdf = async (bagIds, orderId) => {
      const tried = [];
      for (const url of route ? [route(bagIds, orderId)] : ROUTES.labelPdfCandidates(bagIds, orderId)) {
        const res = await ctx.request.get(url, { failOnStatusCode: false });
        tried.push(`${url} ${res.status()}`);
        if (res.ok() && (res.headers()["content-type"] ?? "").includes("application/pdf")) {
          if (!route) {
            const idx = ROUTES.labelPdfCandidates(bagIds, orderId).indexOf(url);
            route = (b, o) => ROUTES.labelPdfCandidates(b, o)[idx];
          }
          return { url, doc: await PDFDocument.load(await res.body()) };
        }
      }
      throw new Error(`no label PDF route answered with a PDF: ${tried.join("; ")}`);
    };
    let one;
    await s.step("one bag's label: a PDF with 1 page of 4x6 in (288x432 pt)", async () => {
      one = await fetchPdf([mailBags.find((b) => b.tier === "ultra_premium").id], IDS.mailOrder);
      eq(one.doc.getPageCount(), 1, "pages");
      const { width, height } = one.doc.getPage(0).getSize();
      assert(Math.abs(width - 288) < 1 && Math.abs(height - 432) < 1, `page size ${width}x${height}`);
      return one.url;
    }, { critical: true, shot: false });
    await s.step("all of the order's bag labels at once: one page per label", async () => {
      const each = [];
      for (const b of mailBags) each.push((await fetchPdf([b.id], IDS.mailOrder)).doc.getPageCount());
      const all = await fetchPdf(mailBags.map((b) => b.id), IDS.mailOrder);
      eq(all.doc.getPageCount(), each.reduce((a, b) => a + b, 0), "pages (sum of each bag's labels)");
      return `${mailBags.length} bags -> ${all.doc.getPageCount()} pages`;
    }, { shot: false });
    await s.step("a 16-card bag continues on more than one label (same Bag ID)", async () => {
      const big = await fetchPdf([bigBag.id], IDS.dropoffOrder);
      assert(big.doc.getPageCount() >= 2, `16 cards on ${big.doc.getPageCount()} page(s)`);
      return `${big.doc.getPageCount()} labels`;
    }, { shot: false });
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
    await s.step("run again (UI or API): no new cards, codes or bags", async () => {
      if (ranInUi) {
        await goto(page, ROUTES.setup);
        await UI.setupSelectAll(page).check().catch(() => {});
        await clickForApi(page, UI.setupPreview(page), "/setup/preview").catch(() => {});
        await clickForApi(page, UI.setupRun(page), "/setup/run", 120_000).catch(() => {});
      }
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
      const page = await ctx.newPage();
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
