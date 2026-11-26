// End-to-end scenarios for the intake system (receiving, tier bags, QR codes,
// stages, completion, the one-per-order label, the order photos page, the
// "Print labels" step, Historical Order Setup), run in a real browser against
// the local harness (fake Supabase, fake data, no real emails).
//
//   node tests/intake/e2e/scenarios.mjs                 start harness, run all, stop
//   node tests/intake/e2e/scenarios.mjs --only qr,labels,photos-page,print-step
//   node tests/intake/e2e/scenarios.mjs --only 'track-*'  card tracking with serial-numbered slots
//   node tests/intake/e2e/scenarios.mjs --only 'scan-*'   the Scan page: the handheld scanner only (no camera), photos under each card
//   node tests/intake/e2e/scenarios.mjs --only 'desk-*'   the Desk: a heat press stack to the desk, the Desk page
//   node tests/intake/e2e/scenarios.mjs --only 'bag-open-*'   what a bag / order QR opens: the person, "Move all N cards to my desk"
//   node tests/intake/e2e/scenarios.mjs --only 'labels-any-*'   "Print labels" for any order (prepare-labels)
//   node tests/intake/e2e/scenarios.mjs --only 'done-*'   a finished card: back in its bag, Open bags box A-Z, Ready to ship, order auto-complete
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
import {
  LABELS_ANY_IDS, LABELS_ANY_ORDER_NUMBERS, LABELS_ANY_CUSTOMERS, buildLabelsAnySeed,
  IN_SHOP_ORDER_TIER, IN_SHOP_CARD_TIERS, IN_SHOP_RECEIVED_ON, SIGNED_CARD_TIERS, SIGNED_RECEIVED_ON,
  UNKNOWN_TIER_RECEIVED_ON, AWAITING_ORDER_TIER, AWAITING_CARD_TIERS,
} from "../harness/seed.mjs";
import { DONE_IDS, DONE_ORDER_NUMBER, DONE_CUSTOMER, DONE_CARD_NAMES, buildDoneSeed } from "../harness/seed.mjs";
import { placeholderPng } from "../harness/mock-supabase.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");

// ─── Routes the brief plans (edit here if they move) ────────────────────────
export const ROUTES = {
  receiving: "/admin/receiving",
  receivingOrder: (orderId) => `/admin/receiving/${orderId}`,
  bag: (bagId) => `/admin/receiving/bag/${bagId}`,
  card: (cardId) => `/admin/receiving/card/${cardId}`,
  // Every card of an order with all its images; ?bag=<bagId> = only that bag's cards (the scan
  // landing's "All photos"; a bag or order QR opens the scan landing, ROUTES.open, since Nov 25)
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

  // ── Desk (owner, Nov 24): a desk is a place (kind 'other') LOC-DESK, or LOC-DESK-<NAME> ("DESK
  // GAVIN"); cards moved there keep their step. The Desk page (menu "Desk") shows every card on one
  // desk, a panel per card; ?desk=<code> picks the desk when there are several.
  desk: "/admin/receiving/desk",
  deskAt: (code) => `/admin/receiving/desk?desk=${encodeURIComponent(code)}`,
  // Where a desk panel's "Open order" goes: the full order page
  order: (orderId) => `/admin/orders/${orderId}`,

  // ── The scan landing (owner, Nov 25): what a bag or order QR opens now (codeTargetPath ->
  // openCodePath): the customer, the order, "Move all N cards to my desk", a panel per card.
  // <code> is a Bag ID (CD-2549-P) or an order number (CD-2549), any case.
  open: (code) => `/admin/receiving/open/${code}`,

  // ── Print labels for any order (owner, Nov 24; contract: lib/intake/prepare-labels.ts) ──
  // GET -> PreparePlan { mode: ready | bag_in_shop | receive_first | not_allowed, toBag,
  // tierQuestions, needsAnswers, receivedOn, receivedOnSource, bags, skipped, reason? };
  // POST { tiers?, confirmReceive?, allowUnpaid? } -> 200 PrepareResponse { ok, bags: [{ id, code,
  // tier, tierName, cardCount }], newlyBagged, emailed, orderStatusChanged, message }, 409
  // PrepareConflict (the plan + error, needsConfirmReceive, unanswered) or { error }.
  prepareLabelsApi: (orderId) => `/api/admin/intake/orders/${orderId}/prepare-labels`,
  cardTierApi: (cardId) => `/api/admin/cards/${cardId}/tier`,

  // ── Finished cards (done-*, owner Nov 25; lib/intake/tracking/types.ts BagReadyResponse) ──
  // POST { bagId }: the finished bag is in the Ready to ship bin (LOC-SHIP) -> { bag, changed, message }
  trackBagReady: "/api/admin/track/bag-ready",
  // The order page's Done toggle (no body): { completed, orderCompletion? }
  cardComplete: (cardId) => `/api/admin/cards/${cardId}/complete`,
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
  // Step picker (StepPicker in components/intake/tracking-actions.tsx; any step in any order, the owner,
  // Nov 25): a group named "Step for …" of 9 buttons named by the step ("Ready for Slab Crack" …
  // "Drying" … "Final Dry", then "Done"; several cards: "…, 2 cards here"), the current one pressed.
  // Open on the card page and for the whole bag on the bag page ("Step for every card in bag …");
  // behind a summary for a card row ("Change step"), a group ("Move these 3 cards") and a Bags board
  // row ("Set the step"): openSteps first. Done for several cards asks "Yes, mark done".
  stepPicker: (scope) => scope.getByRole("group", { name: /^step for\b/i }).first(),
  advanceTo: (scope, stage) => UI.stepPicker(scope).getByRole("button", { name: new RegExp(`^${esc(stage)}\\b`, "i") }),
  markDone: (scope) => UI.stepPicker(scope).getByRole("button", { name: /^done\b/i }),
  openSteps: async (scope, summary) => {
    const s = scope.locator("summary").filter({ hasText: summary }).first();
    if (!(await s.evaluate((el) => el.parentElement.open))) await s.click();
  },
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
  // The Scan page's code box, behind "Type a code instead" (owner, Nov 26: the scanner only, no
  // camera; some days a code is typed)
  scanInput: (page) => page.getByRole("textbox", { name: /scan|code/i }).or(page.locator("input[data-scan-input], input[name='code']")).first(),
  typeCodeLink: (page) => page.getByRole("button", { name: /^type a code instead$/i }).first(),
  // The top panel once the page listens for the handheld scanner ("Ready to scan"; data-scanner="ready")
  scanReady: (page) => page.locator('[data-scanner="ready"]').first(),
  readyToScan: /\bready to scan\b/i,
  readyToScanSub: "Point your scanner at a bag, order, holder or desk label and press the button.",
  // Flashed over the top panel on each scan: "Got it: CD-2549-P"
  gotIt: (code) => new RegExp(`got it:\\s*${esc(code)}(?![A-Z0-9-])`, "i"),
  // A card's photos under it on the Scan page: a list named "Photos of CD-2549-01 Test Card Gold One"
  scanCardPhotos: (page, code) => page.getByRole("list", { name: new RegExp(`^photos of ${esc(code)}(?![0-9A-Z-])`, "i") }),
  // (no \b: Playwright's hasText reads textContent, where "Not in a slot" and "No photo yet" touch)
  scanNoPhoto: /no photo yet/i,
  scanReference: /reference photo/i,
  // Scanning an EMPTY slot: "Put a card in CLAMP 01"
  putCardIn: (slotName) => new RegExp(`put a card in\\s+${esc(slotName)}(?!\\d)`, "i"),
  // A FULL slot shows its card(s) with these buttons (the holder view since Nov 26: "Move to my desk",
  // "Move to another holder" (one card) / "Move selected" (a stack), "Done" / "Done for selected",
  // "Take out" / "Take out selected"). slotMove is the one that waits for the next holder's scan.
  slotMove: (page) => page.getByRole("button", { name: /^move (to another holder|selected)\b|^move$/i }).first(),
  slotDone: (page) => page.getByRole("button", { name: /^(mark )?done\b/i }).first(),
  slotTakeOut: (page) => page.getByRole("button", { name: /^take (it |them )?out\b/i }).first(),

  // ── The holder view (components/intake/scan/holder-view.tsx; the HOLDER agent's holder-text.md) ──
  // Header (h2): "CLAMP 07 · has 1 card" (a holder with a limit), "HEAT PRESS 02 · 3 cards" (no limit), "CLAMP 07 · empty"
  holderHas: (name, n) => new RegExp(`${esc(name)}\\s*·\\s*(has )?${n} cards?(?![a-z])`, "i"),
  holderHasExact: (name, n) => new RegExp(`${esc(name)}\\s*·\\s*has ${n} cards?(?![a-z])`, "i"),
  holderEmptyHead: (name) => new RegExp(`${esc(name)}\\s*·\\s*empty\\b`, "i"),
  holderEmptyLine: /empty\. scan a bag or card to put one here/i,
  // "In CLAMP 07 for 2 hours" (time in the holder; "Put in CLAMP 07 just now")
  holderSince: (name, hours) => new RegExp(`\\bin ${esc(name)} for ${hours} (hours?|h|hr)\\b`, "i"),
  // No desk at all: "Move to my desk" greyed and this line
  holderNoDesk: /no desk yet\. open the desk page once to make one\./i,
  // One card: primary "Move to my desk", then "Move to another holder", "Done", "Take out"
  holderToDesk: (scope) => scope.getByRole("button", { name: /^move to my desk\b/i }).first(),
  holderToHolder: (scope) => scope.getByRole("button", { name: /^move to another holder\b/i }).first(),
  holderDone: (scope) => scope.getByRole("button", { name: /^done$/i }).first(),
  holderTakeOut: (scope) => scope.getByRole("button", { name: /^take out$/i }).first(),
  // A stack: "Move all 3 to my desk"
  holderAllToDesk: (scope, n) => scope.getByRole("button", { name: new RegExp(`^move all ${n}( cards)? to my desk\\b`, "i") }).first(),
  // Done asks first: "Mark it done? Then put it back in its bag." [Mark done] [Cancel]
  holderConfirm: (scope) => scope.getByRole("button", { name: /^(mark (it |\d+ cards )?done|tap again|yes\b)/i }).first(),
  // "Move to another holder": the Desk page's picker ("Put CD-2549-07 … in…") and the top bar "Scan the next slot for CD-2549-07"
  holderPicker: (page) => page.getByRole("dialog", { name: /^put\b/i }).first(),
  holderNext: /\bscan the next (slot|holder)\b/i,
  // Result lines: "CD-2549-07 is on your desk.", "All 3 cards are on your desk.", "In HEAT PRESS 01. Step: Heat Press.",
  // "CD-2549-07 taken out of CLAMP 07, not done."
  holderOnDesk: (code) => new RegExp(`${esc(code)} is on your desk`, "i"),
  holderAllOnDesk: (n) => new RegExp(`(all )?${n} cards are on your desk`, "i"),
  holderMovedTo: (name) => new RegExp(`\\bin ${esc(name)}(?!\\d)\\.`, "i"),
  holderTakenOut: (code, name) => new RegExp(`${esc(code)} taken out of ${esc(name)}(?!\\d)`, "i"),
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

  // ── Desk (/admin/receiving/desk; being built while these were written: wording from the brief) ──
  // The menu item "Desk" (the menu's emoji icon is part of the link's name)
  deskNavLink: (page) => page.getByRole("link", { name: /^[^\p{L}\p{N}]*desk$/iu }),
  /**
   * One card's panel: the OUTERMOST block in <main> holding its Card ID and a link to an order
   * (/admin/orders/...) and no other Card ID of `codes` (so not the grid around all panels, and
   * not a message that names the card). `codes`: every Card ID the test may see on the page.
   */
  deskPanel: (page, code, codes) => {
    const others = codes.filter((c) => c !== code);
    let loc = page.locator("main").first()
      .locator("article, li, section, div, [role='group'], [role='listitem']")
      .filter({ hasText: code })
      .filter({ has: page.locator('a[href*="/admin/orders/"]') });
    if (others.length) loc = loc.filter({ hasNotText: new RegExp(others.map(esc).join("|")) });
    return loc.first();
  },
  // "Open order" (named so; it goes to /admin/orders/<id>)
  deskOpenOrder: (scope) => scope.getByRole("link", { name: /\bopen\b.*\border\b|\bfull order\b/i }),
  // The empty desk: says there are no cards, and how to get them here (scan a holder, Move, scan the desk)
  deskEmpty: /no cards|nothing (is )?(on|at|here)|is empty|desk is clear|0 cards/i,
  deskEmptyHow: /scan|move/i,
  // A card's buttons, in its panel: "Put in holder", "Done", "Take out"
  deskPutIn: (scope) => scope.getByRole("button", { name: /^put\b(?!.*\bselected\b)/i }).first(),
  deskDone: (scope) => scope.getByRole("button", { name: /^(mark( it| as)? )?done\b(?!.*\bselected\b)/i }).first(),
  deskTakeOut: (scope) => scope.getByRole("button", { name: /^take (it |this card )?out\b/i }).first(),
  // What a button asks before it saves, if it does: "Tap again", "Yes, mark done", "Confirm"
  deskConfirm: (scope) => scope.getByRole("button", { name: /^(yes\b|tap again\b|confirm\b|mark (it |as )?done\b|done\b|take (it )?out\b)/i }).first(),
  // Ticking a card for the multi-select actions: a checkbox in its panel, or a "Select" toggle
  deskSelect: (scope) => scope.getByRole("checkbox").or(scope.getByRole("button", { name: /^(select|pick)\b/i })).first(),
  // "Put selected in…", "Put 2 selected in…", "Put 2 cards in…"
  deskPutSelected: (page) => page.getByRole("button", { name: /^put\b.*\bselected\b|^put (these |the )?\d+ (selected )?cards? in\b/i }).first(),
  // The holder picker's text box ("clamp 7", or a scanned holder label): in a dialog, in the panel, or named so
  holderBoxes: (page, scope) => [
    page.getByRole("dialog").getByRole("textbox"),
    page.getByRole("dialog").getByRole("combobox"),
    scope?.getByRole("textbox"),
    scope?.getByRole("combobox"),
    page.getByRole("textbox", { name: /holder|slot|clamp|scan|type/i }),
    page.getByPlaceholder(/clamp|holder|slot/i),
    page.locator("main").first().getByRole("textbox"),
  ].filter(Boolean),
  // A holder offered by the picker ("CLAMP 01", "Put in CLAMP 01")
  holderOption: (page, name) => {
    const re = new RegExp(`${esc(name)}(?!\\d)`, "i");
    return page.getByRole("option", { name: re }).or(page.getByRole("radio", { name: re })).or(page.getByRole("button", { name: re })).first();
  },
  // A photo opens the full-screen viewer (the photos page's: a <dialog> with the photo and Close)
  deskPhotoButton: (panel) => panel.locator("button:has(img), [role='button']:has(img)").first(),
  photoViewer: (page) => page.getByRole("dialog").filter({ has: page.locator("img") }).first(),
  viewerClose: (scope) => scope.getByRole("button", { name: /^close\b/i }).first(),
  // The Scan page on a desk: "Open desk page"; after a move to a desk: "Open the desk page"
  openDeskPage: (page) => page.getByRole("link", { name: /^open (the )?desk( page)?\b/i }).first(),
  // Where the pages say what a save did: status / alert / live regions and toasts
  liveRegions: (page) => page.locator('[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"], [data-sonner-toast]'),

  // ── The scan landing (/admin/receiving/open/<code>): wording from the builder's ui-text.md ──
  // The one big button: "Move all 3 cards to my desk" (N >= 2) / "Move 1 card to my desk"
  openMoveAllRe: /^move\s+(all\s+\d+\s+cards|\d+\s+cards?)\s+to\b/i,
  openMoveAll: (page) => page.getByRole("button", { name: UI.openMoveAllRe }).first(),
  // A card's own button: shown "Move to my desk", named "Move to my desk: CD-2549-08" (aria-label, the visible words first)
  openMoveOne: (scope) => scope.getByRole("button", { name: /^move\b(?!\s+all\b)(?!\s+\d+\s+cards?\b).*\bdesk\b/i }).first(),
  // After it works (role=status): "3 cards are on your desk" / "1 card is on your desk" + "Open my desk"
  openMoved: (n) => new RegExp(`(^|[^0-9])${n} cards? (are|is) on your desk`, "i"),
  // Nothing left to move, some on the chosen desk
  openAllThere: /\ball on your desk\b/i,
  // Under the button: "2 already on your desk"
  openAlready: (n) => new RegExp(`(^|[^0-9])${n} already on your desk`, "i"),
  openMyDesk: (page) => page.getByRole("link", { name: /^open my desk\b/i }).first(),
  openFullOrder: (page) => page.getByRole("link", { name: /^open full order\b/i }).first(),
  openAllPhotos: (page) => page.getByRole("link", { name: /^all photos\b/i }).first(),
  // The desk picker: a <select> inside a <label> "Desk", only when 2+ desks are switched on (a select
  // inside its label is named "Desk" + the chosen option, e.g. "Desk DESK GAVIN")
  openDeskPicker: (page) => page.getByRole("combobox", { name: /^desk\b/i }),
  // The customer's notes box title
  openNotesTitle: /customer.s notes/i,
  // Order code: the "Bags" list (one row per bag: tier, Bag ID, due, count)
  openBagsList: (page) => page.getByRole("list", { name: /^bags$/i }).first(),
  // Group headings over the cards: "Platinum · CD-2549-P", "Cards in this bag", "Not here yet", "Not in a bag"
  openGroupHeading: /\bCD-\d+-[A-Z]\d*(?![A-Z0-9-])|\bnot here yet\b|\bnot in a bag\b|\bcards in this bag\b/i,
  /**
   * One card's panel: the OUTERMOST <li>/<article> in <main> holding its Card ID and a heading (h3:
   * the card's name), no other Card ID of `codes` and no group heading (so not a bag's group).
   */
  openPanel: (page, code, codes) => {
    const others = codes.filter((c) => c !== code);
    let loc = page.locator("main").first().locator("li, article, [role='listitem']")
      .filter({ hasText: code })
      .filter({ has: page.locator("h2, h3, h4, [role='heading']") })
      .filter({ hasNot: page.getByRole("heading", { name: UI.openGroupHeading }) });
    if (others.length) loc = loc.filter({ hasNotText: new RegExp(others.map(esc).join("|")) });
    return loc.first();
  },
  // "Where it is now" and the greyed panels' pills
  openWhere: {
    bag: /\bin the bag\b/i,
    desk: /\bon your desk\b/i,
    holder: (name) => new RegExp(`\\bin ${esc(name)}(?!\\d)`, "i"),
    otherDesk: (name) => new RegExp(`\\bon ${esc(name)}(?![A-Z0-9])`, "i"),
    done: /\bdone\b/i,
    refunded: /\brefunded\b/i,
    away: /\bnot here yet\b/i,
  },
  // The segment's not-found page (h1 "Code not found"), or Next.js's plain 404
  openNotFound: /code not found|could not be found/i,

  // ── Print labels for any order (components/intake/print-order-labels.tsx: the order page,
  // Receiving rows, the workspace; being built while these were written: wording from the contract) ──
  // The one action: "Print labels" (modes ready / bag_in_shop); also "Print 3 labels"
  prepareLabels: (scope) => scope.getByRole("button", { name: /^print (\d+ )?labels\b/i }),
  // Counted on the workspace (exactly ONE): "Print labels" / "Print 3 labels"; not the bag panel's
  // "Print all 3 labels", not a bag's "Print label"
  prepareLabelsExact: /^print (\d+ )?labels$/i,
  // Awaiting Cards (mode receive_first): "Cards arrived? Receive all and print"
  receiveAllAndPrint: (scope) => scope.getByRole("button", { name: /cards arrived|receive all/i }),
  // Whatever the component shows, in any mode (the not-allowed check: disabled, or absent)
  anyPrepare: (scope) => scope.getByRole("button", { name: /^print (\d+ )?labels\b|cards arrived|receive all/i }),
  // A confirm the receive_first tap may ask in the page first: "Yes, receive all and print", "Confirm", "Receive all"
  confirmReceiveAll: (scope) => scope.getByRole("button", { name: /^(yes\b|confirm\b|receive all\b|receive and print\b)/i }),
  // The second tap (the same button renamed, or one the first tap showed): "Print 2 labels",
  // "Print labels", "Print all 2 labels", "Reprint labels"; never a tag
  printPrepared: (scope) => scope.getByRole("button", { name: /^(re)?print (all )?(the )?(\d+ )?((order|bag) )?labels?\b/i }),
  // Preferred for the second tap: the one naming how many ("Print 2 labels", "Print 1 label", "Print all 2 labels")
  printCounted: (scope) => scope.getByRole("button", { name: /^(re)?print (all )?(the )?\d+ labels?\b/i }),
  // The tier question ("Tier for these 3 cards: [Gold v]"): a dialog, or the block that asks it
  tierQuestion: /tier for (these|this|the)?\s*(\d+ )?cards?|which tier|(pick|choose) (a|the) tier/i,
  tierScope: (page) => page.getByRole("dialog").or(page.getByRole("alertdialog"))
    .or(page.locator("form, section, [role='region'], [role='group']").filter({ hasText: UI.tierQuestion })).first(),
  // One tier control per question (or per card): a <select>, a combobox (shadcn Select) or a radio group
  // (the label printer choice is a radiogroup too, named "Printer…": not a tier)
  tierControls: (scope) => scope.locator("select, [role='combobox'], [role='radiogroup']:not([aria-label*='rinter' i])"),
  // The question's confirm: "Print labels", "Confirm and print", "Save tiers", "Use these tiers"… (not Cancel / Close / Back)
  tierConfirm: (scope) => scope.getByRole("button", { name: /^(?!.*\b(cancel|close|back|not now)\b).*\b(print|confirm|save|continue|use|bag|ok|done|yes)\b/i }).last(),
  // The disabled button's reason on an unpaid order (PreparePlan.reason, shown as is, or words like these)
  notAllowedReason: /not (been |yet )?paid|unpaid|awaiting payment|hasn'?t (been )?paid|no payment|payment (is )?pending/i,
  // A Receiving search row (li / tr) of an order that carries the action
  receivingRow: (page, orderNumber) => page.locator("li, tr, [role='row'], article").filter({ hasText: orderNumber })
    .filter({ has: page.getByRole("button", { name: /print (\d+ )?labels|cards arrived|receive all/i }) }).last(),

  // ── Finished cards (done-*): the DONE-FLOW agent's ui-text.md (lib/intake/tracking/bag-home.ts words it) ──
  // A card's Done on the scan landing: shown "Done", named "Done: CD-2549-03" (the Desk's is UI.deskDone)
  doneCard: (scope) => scope.getByRole("button", { name: /^done\b/i }).first(),
  // The bag's "Mark all N done" ("Mark 1 card done"); it asks "Mark all N cards done?": "Yes, mark N done" / "Cancel"
  doneAllRe: /^mark (all \d+|1 card) done$/i,
  doneAll: (page) => page.getByRole("button", { name: UI.doneAllRe }).first(),
  // A confirm's yes ("Yes, mark 2 done"), never Cancel
  doneConfirmRe: /^(yes\b|confirm\b|tap again\b)/i,
  // Header count: "3 cards" while none is done, then "1 of 3 done" (also "CD-2549-P · 3 of 3 done")
  doneCount: (done, total) => new RegExp(`(^|[^0-9])${done} of ${total} done\\b`, "i"),
  // "Done. Put it back in REYES's bag: Open bags box, under R." ("2 cards done. Put them back in …";
  // the step picker's "Marked done. Put it back in …"); `place` a donePlaceIn pattern, "" for none
  doneSentence: (lastName, place = "", lead = "done") =>
    new RegExp(`\\b${lead}\\. put (it|them) back in ${esc(lastName.toUpperCase())}['’]s bag${place ? `: ${place}` : ""}`, "i"),
  // Where the bag is, in a sentence
  donePlaceIn: {
    openBags: (letter) => `open bags box, under ${letter}(?![A-Za-z])`,
    shelf: (day) => `on shelf ${shelfName(day)}(?!\\d)`,
    ship: "in the ready to ship bin",
  },
  // Where the bag is, short ("Bag: Open bags box · R"; the Bags board "Open bags · R"): regexes
  donePlace: {
    openBags: (letter) => new RegExp(`open bags( box)?\\s*·\\s*${letter}(?![A-Za-z])`, "i"),
    shelf: (day) => new RegExp(`shelf ${shelfName(day)}(?!\\d)`, "i"),
    ship: /\bready to ship\b/i,
  },
  // The scan landing's / Scan page's line in front: "Bag: <place>"
  doneBagLine: (placeRe) => new RegExp(`\\bbag:\\s*${placeRe.source}`, "i"),
  // A card left its bag: "Put the bag in the Open bags box, under R."
  putBagInOpenBags: (letter) => new RegExp(`put the bag in the open bags box, under ${letter}(?![A-Za-z])`, "i"),
  // The bag's last card: "Bag finished: put it in the Ready to ship bin" (order code: "Bag CD-2549-P finished: …")
  bagFinished: /\bbag( CD-\d+-[A-Z]\d*)? finished: put it in the ready to ship bin/i,
  // Its button, then "In the Ready to ship bin" (not the prompt's "put it in the …")
  readyToShipRe: /^it['’]s in the ready to ship bin$/i,
  inShipBin: /(?<!\bput (it|them) )\bin the ready to ship bin\b/i,
  // The order auto-complete line (lib/intake/order-autocomplete.ts): "Order completed. Test Customer Reyes emailed."
  orderCompletedLine: (name) => new RegExp(`order completed\\. ${esc(name)} emailed\\.`, "i"),
  // The Bags board's "Ready to ship" section (finished bags not shipped yet) and a bag's row in it
  readySection: (page) => page.getByRole("region", { name: /^ready to ship\b/i }),
  readyRow: (page, bagCode) => UI.readySection(page).locator("li").filter({ has: page.getByRole("link", { name: `Open bag ${bagCode}`, exact: true }) }),
  notInBin: /\bnot in the bin yet\b/i,
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
/**
 * The filing tab's letter (the Open bags box's A-Z letter, top right of the banner: a white
 * square with a black letter in it), as tests/intake/labels.test.ts finds it; null without one.
 * It is big on purpose and never counts against "the name is the largest type".
 */
function filingTabLetter(p) {
  const tile = p.elements.find((e) => e.kind === "rect" && e.fill === "paper");
  if (!tile) return null;
  return texts(p).find((t) => t.color === "ink" && t.x >= tile.x - 0.01 && t.x + t.width <= tile.x + tile.w + 0.01 && t.y >= tile.y && t.y <= tile.y + tile.h) ?? null;
}
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

  await s.step(`${title}: the customer name is the largest type on every label (the filing tab's letter aside)`, async () => {
    needJson();
    const full = norm(customerName);
    const isName = (e) => { const x = norm(String(e.text).replace(/…$/, "")); return x.includes(full) || (x.length >= 4 && full.includes(x)); };
    const out = [];
    for (const { bag } of want) {
      const label = entryOf(bag.id).labels[0];
      const tab = filingTabLetter(label);
      const all = texts(label).filter((e) => e !== tab);
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
export async function mockUpdate(mockUrl, table, patch, column, value) {
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
/**
 * A one-card holder's refusal (owner, Nov 26 2026: one card per holder but the desk): 409 { holderFull:
 * true, holder, occupants, error } (HolderFull); never overCapacity, so no "Add anyway".
 */
function checkHolderFull(r, holderCode, occupantCodes) {
  eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
  eq(r.body?.holderFull, true, "holderFull");
  eq(r.body?.overCapacity ?? null, null, "overCapacity (no Add anyway)");
  eq(r.body.holder?.code, holderCode, "holder");
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
/**
 * The handheld scanner on the Scan page (a Bluetooth keyboard): it types the label's text fast and
 * presses Enter, with nothing focused (the page catches it anywhere: the keyboard wedge). Waits
 * until the page listens ("Ready to scan"). `blur: false` leaves the focus where it is (a scan
 * with a button or a photo focused must not press it). `delay`: ms between keys (the Eyoyo types
 * a key every few ms; the page takes keys under 100 ms apart as a scanner).
 */
async function scanType(page, text, { blur = true, delay = 10 } = {}) {
  await UI.scanReady(page).waitFor({ timeout: 60_000 });
  if (blur) await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === "function") a.blur(); });
  await page.keyboard.type(text, { delay });
  await page.keyboard.press("Enter");
}
/** Typing on the Scan page: "Type a code instead" opens the code box; the text + Enter (a code, "clamp 7", "desk", a name). */
async function typeCode(page, text) {
  await UI.scanReady(page).waitFor({ timeout: 60_000 });
  const box = UI.scanInput(page);
  if (!(await box.isVisible().catch(() => false))) await UI.typeCodeLink(page).click();
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

// ─── Desk helpers (a desk = a place of kind 'other', LOC-DESK or LOC-DESK-<NAME>) ─────
const DESK = "LOC-DESK";
/** The heat press stack that comes out and goes to the desk: CD-2549 Gold 01-04 + Platinum 07-08, CD-2600-01 and -02. */
const DESK_CARDS = ["CD-2549-01", "CD-2549-02", "CD-2549-03", "CD-2549-04", "CD-2549-07", "CD-2549-08", "CD-2600-01", "CD-2600-02"];
/** Received with them but never put on the desk (it waits in a clamp): "exactly the 8" means it isn't listed. */
const DESK_DECOY = "CD-2600-03";
const DESK_ALL = [...DESK_CARDS, DESK_DECOY];
const sorted = (list) => [...list].sort();
/**
 * Notes the desk tests add (the seed already has CD-2549's order note "…soft corners…" and
 * CD-2549-04's card note "…crease near the bottom edge."): CD-2600's customer note, and card
 * notes / known defects on CD-2549-07 and CD-2600-02.
 */
const DESK_NOTES = {
  orders: { [IDS.bigOrder]: "Test note: keep the big order cards in their sleeves." },
  cards: {
    "CD-2549-07": { known_defects: "Test defect: light scratch on the holo." },
    "CD-2600-02": { notes: "Test instruction: keep this one flat.", known_defects: "Test defect: whitening on the back corner." },
  },
};
const TIER_NAMES = { regular: "Bronze", expedited: "Silver", premium: "Gold", ultra_premium: "Platinum", elite: "Diamond", fast_pass: "Fast Pass" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll `fn` until it returns something truthy (returned), or `ms` pass (the last value is returned). */
async function until(fn, ms = 15_000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() >= end) return v;
    await sleep(every);
  }
}
/**
 * Desk setup, part 1: receive CD-2549 Gold 01-04 + Platinum 07-08 (2026-11-15) and CD-2600-01..03
 * (2026-11-20); add DESK_NOTES; one receiving photo per desk card (CD-2549-01 and -07 also have
 * customer photos from the seed). Returns the tables.
 */
async function deskReceive(ctx, mockUrl) {
  await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 2, 3, 6, 7].map(mailCard), "2026-11-15");
  await receiveViaApi(ctx, IDS.bigOrder, IDS.bigCards.slice(0, 3), "2026-11-20");
  const t = await tables();
  eq(cardByCode(t, "CD-2549-01")?.id, mailCard(0), "CD-2549-01 is Gold One");
  eq(cardByCode(t, "CD-2549-07")?.id, mailCard(6), "CD-2549-07 is Platinum One");
  for (const code of DESK_ALL) assert(cardByCode(t, code)?.bag_id, `${code} not received (no card or no bag)`);
  for (const [orderId, note] of Object.entries(DESK_NOTES.orders)) await mockUpdate(mockUrl, "orders", { customer_notes: note }, "id", orderId);
  for (const [code, patch] of Object.entries(DESK_NOTES.cards)) await mockUpdate(mockUrl, "cards", patch, "card_code", code);
  await setReceivingPhotos(mockUrl, DESK_CARDS.map((c) => cardIdOf(t, c)));
  return tables();
}
/**
 * LOC-DESK as the Desk page makes it when first opened (ensureDesk); if the page doesn't, it is
 * added as a place through the API ({ name: "Desk", kind: "other" } -> LOC-DESK, as Places would).
 */
export async function ensureDesk(ctx) {
  let desk = placeOf(await tables(), DESK);
  if (desk) return { desk, how: "already there" };
  const res = await ctx.request.get(ROUTES.desk, { failOnStatusCode: false, timeout: 240_000, maxRedirects: 0 });
  desk = placeOf(await tables(), DESK);
  if (desk) return { desk, how: `made by the Desk page (HTTP ${res.status()})` };
  const r = await api(ctx, "POST", ROUTES.trackLocations(), { name: "Desk", kind: "other" });
  desk = placeOf(await tables(), DESK);
  assert(desk, `no ${DESK}: the Desk page answered ${res.status()} without making it; POST locations { name: "Desk", kind: "other" } answered ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return { desk, how: `added through the API (the Desk page answered ${res.status()} without making it)` };
}
/** The heat press each desk card comes out of: one card per holder (owner, Nov 26 2026), CD-2549-01 in HEAT PRESS 01 ... CD-2600-02 in HEAT PRESS 08. */
const deskPress = (code) => {
  const n = DESK_CARDS.indexOf(code) + 1;
  assert(n > 0, `${code} isn't a desk card`);
  return { code: `LOC-HEAT-PRESS-0${n}`, name: `HEAT PRESS 0${n}` };
};
/**
 * Desk setup: deskReceive, HEAT PRESS 01..08 plus the slots asked for ({ clamp: 2 }), each of the
 * 8 in its own heat press (one card per holder: deskPress), LOC-DESK, and (unless toDesk is false)
 * the 8 put on the desk in one request through the API (each leaves its heat press). Returns the
 * tables.
 */
async function deskStack(ctx, mockUrl, slots = {}, { toDesk = true } = {}) {
  let t = await deskReceive(ctx, mockUrl);
  for (const [station, count] of Object.entries({ "heat-press": DESK_CARDS.length, ...slots })) await bulkSlots(ctx, station, count);
  const ids = DESK_CARDS.map((c) => cardIdOf(t, c));
  for (const code of DESK_CARDS) await assignOk(ctx, deskPress(code).code, [cardIdOf(t, code)]);
  await ensureDesk(ctx);
  if (toDesk) await assignOk(ctx, DESK, ids);
  t = await tables();
  if (toDesk) eq(cardsIn(t, DESK), sorted(DESK_CARDS), "cards on the desk");
  else for (const code of DESK_CARDS) eq(cardsIn(t, deskPress(code).code), [code], `cards in ${deskPress(code).name}`);
  return t;
}
/** What a card's desk panel must show, from the database. */
function deskInfo(t, code) {
  const c = cardByCode(t, code);
  assert(c, `no card ${code}`);
  const o = t.orders.find((x) => x.id === c.order_id);
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  return {
    code, id: c.id, name: c.card_name, customer: o.customer_name, orderId: o.id, orderNumber: o.order_number,
    tierName: TIER_NAMES[c.tier ?? o.restoration_tier] ?? "",
    orderNotes: [o.customer_notes].map(clean).filter(Boolean),
    own: [c.notes, c.known_defects].map(clean).filter(Boolean),
  };
}
/**
 * A card's panel's text: what it shows (innerText, lines kept apart) and then its textContent (a
 * note folded behind "Show more" still counts; adjacent elements run together there), whitespace
 * collapsed.
 */
async function panelText(page, code, codes = DESK_ALL) {
  const panel = UI.deskPanel(page, code, codes);
  const [shown, all] = await Promise.all([panel.innerText({ timeout: 10_000 }), panel.textContent({ timeout: 10_000 })]);
  return `${shown}\n${all ?? ""}`.replace(/\s+/g, " ");
}
/** An order number on its own, not inside a Card ID (CD-2549-01) or Bag ID (CD-2549-G). */
const orderNumberRe = (orderNumber) => new RegExp(`${esc(orderNumber)}(?!\\d|-[A-Z0-9])`);
/** A tier name as a word ("Gold"), also when run into its neighbours in textContent ("01GoldTest"). */
const tierShown = (txt, tier) => new RegExp(`\\b${esc(tier)}\\b`, "i").test(txt) || new RegExp(`(?<![A-Za-z])${esc(tier)}(?![a-z])`).test(txt);
/** The Card IDs (of `codes`) that have a panel on the page now, sorted. */
async function deskPanelsShown(page, codes = DESK_ALL) {
  const out = [];
  for (const code of codes) if (await UI.deskPanel(page, code, codes).count()) out.push(code);
  return out.sort();
}
/** Wait (20 s) until exactly `want` have panels; returns what is shown then. */
async function waitPanels(page, want, codes = DESK_ALL, ms = 20_000) {
  const goal = JSON.stringify(sorted(want));
  let last = [];
  await until(async () => { last = await deskPanelsShown(page, codes); return JSON.stringify(last) === goal; }, ms);
  return last;
}
/**
 * Watches for the save a tap makes (the first POST to /api/admin/...): `sent()` once it has gone
 * out (a first compile can hold the answer for a minute, not the request), `response()` its answer.
 */
function watchSave(page) {
  let sent = null;
  const onRequest = (r) => { if (!sent && r.method() === "POST" && r.url().includes("/api/admin/")) sent = r; };
  page.on("request", onRequest);
  return {
    sent: () => sent,
    async response(ms = 120_000) {
      await until(() => sent, ms, 100);
      page.off("request", onRequest);
      assert(sent, "the tap sent no save (no POST to /api/admin/…)");
      const res = await sent.response();
      assert(res, `${new URL(sent.url()).pathname}: no answer`);
      assert(res.status() < 300, `${new URL(sent.url()).pathname} answered ${res.status()}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return res;
    },
  };
}
/** Tap a button that saves; if nothing is sent within 4 s it is asking first ("Tap again", "Yes"): answer yes. */
async function tapToSave(page, locator, scope) {
  const save = watchSave(page);
  await locator.click();
  if (!(await until(() => save.sent(), 4_000))) {
    const inDialog = UI.deskConfirm(page.getByRole("dialog"));
    const yes = (await inDialog.count()) ? inDialog : UI.deskConfirm(scope);
    if (await yes.count()) await yes.click({ timeout: 5_000 }).catch(() => {});
  }
  return save.response();
}
/** The holder picker's text box once it is open (null if none shows within 10 s). */
async function holderBox(page, scope) {
  return until(async () => {
    for (const cand of UI.holderBoxes(page, scope)) {
      const box = cand.first();
      if (!(await box.isVisible().catch(() => false))) continue;
      if (["INPUT", "TEXTAREA"].includes(await box.evaluate((e) => e.tagName).catch(() => ""))) return box;
    }
    return null;
  }, 10_000);
}
/**
 * Choices the open picker (a dialog, else `scope`) shows: enabled and on screen (a full holder
 * folded away under a closed "Full" <details> is not offered), their names.
 */
async function pickerChoices(page, scope) {
  const dlg = page.getByRole("dialog").first();
  const where = (await dlg.isVisible().catch(() => false)) ? dlg : scope;
  return where.locator("button, option, [role='option'], [role='radio'], [role='menuitem']").evaluateAll((els) => els
    // inside a closed <details> Chrome still lays the content out (content-visibility: hidden), so
    // getClientRects() alone counts it: checkVisibility() and the closed <details> rule don't
    .filter((e) => !e.disabled && e.getAttribute("aria-disabled") !== "true" && e.getClientRects().length > 0
      && (typeof e.checkVisibility !== "function" || e.checkVisibility())
      && !e.closest("details:not([open]) > :not(summary)"))
    .map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean));
}
/** The picker's choices once its holders have loaded (it may fetch them when it opens), or what it shows after 10 s. */
async function holderChoices(page, scope) {
  const listed = (c) => (c && c.some((x) => /\b(CLAMP|HUMIDOR|HEAT PRESS)\b/i.test(x)) ? c : null);
  return (await until(async () => listed(await pickerChoices(page, scope).catch(() => null)), 10_000)) ?? pickerChoices(page, scope).catch(() => null);
}
/**
 * In the open holder picker: type `typed` ("clamp 1") + Enter, as staff would (or a scanner);
 * if nothing is saved within 15 s, tap the holder `name` ("CLAMP 01") in the list instead (the
 * step then says so). Returns { how, res, typedSaved } (res: the save's answer, 2xx).
 */
async function pickHolder(page, box, typed, name) {
  const save = watchSave(page);
  let how = "";
  if (box) {
    await box.fill(typed);
    await box.press("Enter");
    how = `typed "${typed}" + Enter`;
    await until(() => save.sent(), 15_000);
  }
  const typedSaved = !!save.sent();
  if (!save.sent()) {
    await UI.holderOption(page, name).click({ timeout: 10_000 }).catch(() => {});
    how += `${how ? ", then " : ""}tapped ${name}`;
    await until(() => save.sent(), 5_000);
  }
  if (!save.sent()) {
    // one more question ("Put CD-2549-01 in CLAMP 01?")
    const yes = UI.deskConfirm(page.getByRole("dialog"));
    if (await yes.count()) await yes.click({ timeout: 5_000 }).catch(() => {});
  }
  const res = await save.response();
  return { how, res, typedSaved };
}
/** A message on the page (status, alert, toast; not inside a dialog such as the picker) matching `re` within `ms`; its text, or null. */
async function messageSeen(page, re, ms = 10_000) {
  return until(async () => {
    const all = await UI.liveRegions(page).evaluateAll((els) => els.filter((e) => !e.closest("dialog")).map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)).catch(() => []);
    return all.find((x) => re.test(x)) ?? null;
  }, ms);
}
/** Tap a panel's photo: the full-screen viewer opens with the photo (90%+ of the screen); Close (or Esc) closes it. */
async function photoViewerCheck(page, panel, shotName) {
  const btn = UI.deskPhotoButton(panel);
  const tap = (await btn.count()) ? btn : panel.locator("img").first();
  await tap.scrollIntoViewIfNeeded();
  await tap.click();
  const viewer = UI.photoViewer(page);
  await viewer.waitFor({ state: "visible", timeout: 10_000 });
  const box = await viewer.boundingBox();
  const vp = page.viewportSize();
  assert(box && box.width >= vp.width * 0.9 && box.height >= vp.height * 0.9, `the viewer is ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "not on screen"}, the screen ${vp.width}x${vp.height}`);
  await page.screenshot({ path: path.join(OUT, `${shotName}.png`) }).catch(() => {});
  const close = UI.viewerClose(viewer);
  if (await close.count()) await close.click();
  else await page.keyboard.press("Escape");
  await UI.photoViewer(page).waitFor({ state: "hidden", timeout: 10_000 });
  return `viewer ${Math.round(box.width)}x${Math.round(box.height)} on ${vp.width}x${vp.height}`;
}
/** Tick a card's panel for the multi-select actions (a checkbox, or a Select toggle). */
async function tickPanel(panel) {
  const sel = UI.deskSelect(panel);
  await sel.waitFor({ state: "attached", timeout: 10_000 });
  const isBox = await sel.evaluate((e) => e.getAttribute("role") === "checkbox" || (e.tagName === "INPUT" && e.type === "checkbox"));
  if (!isBox) return sel.click();
  // a checkbox hidden inside its label is ticked without the visibility wait
  await sel.check({ timeout: 5_000 }).catch(() => sel.check({ force: true, timeout: 5_000 }));
}

// ─── Scan landing helpers (bag-open-*): what a bag or order QR opens ────────
// The setup (bagOpenSetup): CD-2549 Gold 01-04 (bag CD-2549-G) and Platinum 07-09 (bag CD-2549-P)
// received on 2026-11-15; Silver 05-06 and the no-tier 10 are then "not here yet" (awaiting_arrival,
// no bag). Platinum is due Mon Dec 7, Gold Mon Dec 14.
const BO_ORDER = ORDER_NUMBERS.mailOrder;
const BO_BAG = "CD-2549-P";
const BO_GOLD = ["CD-2549-01", "CD-2549-02", "CD-2549-03", "CD-2549-04"];
const BO_PLAT = ["CD-2549-07", "CD-2549-08", "CD-2549-09"];
const BO_AWAY = ["CD-2549-05", "CD-2549-06", "CD-2549-10"];
const BO_ALL = sorted([...BO_GOLD, ...BO_PLAT, ...BO_AWAY]);
const BO_CUSTOMER = "Test Customer A";
/** CD-2549's customer_notes (seed). */
const BO_NOTE = "Test note: the Gold cards have soft corners, please handle gently.";
/** CD-2549-04's own note (seed), in the Gold bag: never on the Platinum bag's page. */
const BO_CARD_NOTE = { code: "CD-2549-04", text: "Test instruction: crease near the bottom edge." };
/** Added by the setup on CD-2549-07: a known defect and a declared value ($2,500.00). */
const BO_DEFECT = { code: "CD-2549-07", text: "Test defect: light scratch on the holo." };
const BO_VALUE = { code: "CD-2549-07", cents: 250000, re: /\$2,500(?:\.00)?(?!\d)/ };
/** The setup puts CD-2549-07 at Humidor (stage events), so "the step stays" is checked on a real step. */
const BO_STEP = { code: "CD-2549-07", stage: "Humidor" };
const BO_GAVIN = { code: "LOC-DESK-GAVIN", name: "DESK GAVIN" };

/** Card codes of a bag (by Bag ID), sorted. */
const bagCardCodes = (t, code) => { const b = bagByCode(t, code); return b ? sorted(t.cards.filter((c) => c.bag_id === b.id).map((c) => c.card_code)) : []; };
/**
 * The scan landing setup (see BO_*): receive, check the codes and bags, CD-2549-07 at Humidor with
 * a known defect and a $2,500 declared value, a receiving photo per received card. Returns the tables.
 */
export async function bagOpenSetup(ctx, mockUrl) {
  await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 2, 3, 6, 7, 8].map(mailCard), "2026-11-15");
  const t = await tables();
  for (const code of BO_ALL) eq(cardByCode(t, code)?.id, mailCard(Number(code.slice(-2)) - 1), `${code} (the seed's card ${code.slice(-2)})`);
  eq(bagCardCodes(t, "CD-2549-G"), BO_GOLD, "bag CD-2549-G");
  eq(bagCardCodes(t, BO_BAG), BO_PLAT, `bag ${BO_BAG}`);
  for (const code of BO_AWAY) { const c = cardByCode(t, code); assert(c.awaiting_arrival && !c.bag_id, `${code} should be not here yet (awaiting_arrival, no bag)`); }
  await mockUpdate(mockUrl, "cards", { known_defects: BO_DEFECT.text, estimated_value_cents: BO_VALUE.cents }, "card_code", BO_DEFECT.code);
  await insertRows("order_events", stageRows(IDS.mailOrder, cardIdOf(t, BO_STEP.code), BO_STEP.stage));
  await setReceivingPhotos(mockUrl, [...BO_GOLD, ...BO_PLAT].map((c) => cardIdOf(t, c)));
  const out = await tables();
  eq(latestStage(out, cardIdOf(out, BO_STEP.code)), BO_STEP.stage, `${BO_STEP.code} step`);
  return out;
}
/** Where a signed-in scan of `url` lands (following a /Q -> /q hop first). */
async function scanTarget(ctx, appUrl, url) {
  const r = await api(ctx, "GET", url);
  assert([301, 302, 303, 307, 308].includes(r.status), `${url}: HTTP ${r.status}`);
  let loc = new URL(r.headers.location ?? "/", appUrl);
  if (loc.pathname.startsWith("/q/")) loc = new URL((await api(ctx, "GET", loc.pathname)).headers.location ?? "/", appUrl);
  return loc;
}
/** A signed-out visit to `url`: must go to /admin/login; returns its ?next= (following a /Q -> /q hop first). */
async function signInNext(anon, appUrl, url) {
  let r = await anon.request.fetch(url, { maxRedirects: 0, failOnStatusCode: false });
  assert([301, 302, 303, 307, 308].includes(r.status()), `${url}: HTTP ${r.status()}`);
  let loc = new URL(r.headers().location ?? "/", appUrl);
  if (loc.pathname.startsWith("/q/")) {
    r = await anon.request.fetch(loc.pathname, { maxRedirects: 0, failOnStatusCode: false });
    loc = new URL(r.headers().location ?? "/", appUrl);
  }
  eq(loc.pathname, "/admin/login", `${url} redirect`);
  return loc.searchParams.get("next");
}
const mainText = async (page) => (await page.locator("main").first().innerText()).replace(/[ \t]+/g, " ");
/** The scan landing has rendered: its h1 (the customer's name) is there. */
const openReady = (page) => page.getByRole("heading", { name: BO_CUSTOMER }).first().waitFor({ timeout: 30_000 });
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
/** A button's accessible name as written (aria-label, else its text). */
const nameOf = async (loc) => flat((await loc.getAttribute("aria-label")) || (await loc.innerText()));
/** "Due Mon Dec 7" for a YYYY-MM-DD day, and a regex for it (", 2027" may follow; no commas needed). */
function dueParts(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return { wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()], mon: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()], d: d.getUTCDate() };
}
const dueText = (day) => { const p = dueParts(day); return `Due ${p.wd} ${p.mon} ${p.d}`; };
const dueRe = (day) => { const p = dueParts(day); return new RegExp(`\\bdue:?\\s+${p.wd}[a-z]*\\.?,?\\s+${p.mon}[a-z]*\\.?\\s+${p.d}(?!\\d)`, "i"); };
/** A count line ("3 cards", "Due Mon Dec 7 · 3 cards"), not the big button nor a desk message. */
const countShown = (text, n) => text.split("\n").some((l) => !/^\s*move\b|on your desk/i.test(l) && new RegExp(`(^|[^0-9])${n} cards?\\b`, "i").test(l));
/** A card panel's text: what it shows, then its textContent (adjacent elements run together there). */
async function openPanelText(page, code, codes = BO_ALL) {
  const panel = UI.openPanel(page, code, codes);
  const [shown, all] = await Promise.all([panel.innerText({ timeout: 10_000 }), panel.textContent({ timeout: 10_000 })]);
  return `${shown}\n${all ?? ""}`.replace(/\s+/g, " ");
}
/** The Card IDs (of `codes`) with a panel on the page now, sorted. */
async function openPanelsShown(page, codes = BO_ALL) {
  const out = [];
  for (const code of codes) if (await UI.openPanel(page, code, codes).count()) out.push(code);
  return out.sort();
}
/** The big button's N (NaN when there is no such button). */
async function moveAllN(page) {
  const btn = UI.openMoveAll(page);
  if (!(await btn.count())) return NaN;
  return Number(/(\d+)\s+cards?/i.exec(await nameOf(btn))?.[1] ?? NaN);
}
/** Wait until main's text matches `re` (the page refreshes itself after a move); the match, or null. */
async function textSeen(page, re, ms = 20_000) {
  return until(async () => {
    const txt = flat(await page.locator("main").first().innerText().catch(() => ""));
    return re.exec(txt)?.[0] ?? null;
  }, ms);
}
/** The h1's font size against the largest other text in <main> (svg, dialogs and sr-only text left out). */
async function biggestText(page, name) {
  return page.locator("main").first().evaluate((main, name) => {
    const out = { name: 0, other: 0, otherText: "" };
    for (const el of main.querySelectorAll("*")) {
      if (el.closest("svg, dialog, [role='dialog'], .sr-only")) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
      if (!own || !el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (own.includes(name)) out.name = Math.max(out.name, fs);
      else if (fs > out.other) { out.other = fs; out.otherText = own.slice(0, 40); }
    }
    return out;
  }, name);
}
/**
 * Which group heading each card sits under (order code): for each Card ID, the last heading before
 * it in the page that matches UI.openGroupHeading ("Platinum · CD-2549-P", "Not in a bag"); "" none.
 */
async function groupsOf(page, codes) {
  return page.locator("main").first().evaluate((main, { codes, src }) => {
    const re = new RegExp(src, "i");
    const all = [...main.querySelectorAll("*")];
    const isHeading = (el) => /^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading";
    const out = {};
    for (const code of codes) {
      const at = all.findIndex((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(code)));
      if (at < 0) { out[code] = null; continue; }
      let h = "";
      for (let i = at - 1; i >= 0; i--) {
        if (isHeading(all[i]) && re.test(all[i].textContent ?? "") && !all[i].contains(all[at])) { h = all[i].textContent.replace(/\s+/g, " ").trim(); break; }
      }
      out[code] = h;
    }
    return out;
  }, { codes, src: UI.openGroupHeading.source });
}
/**
 * Tap a move button on the scan landing and wait (up to 2 min: a first compile) until `landed()`, a
 * database check, is true (a confirm dialog, if one shows, is answered yes). Returns what the page
 * sent: the /api/admin/track/* POST's path, JSON body and status, and every POST path.
 */
async function openTapMove(page, button, landed, ms = 120_000) {
  const posts = [];
  const onRequest = (r) => { if (r.method() === "POST") posts.push(r); };
  page.on("request", onRequest);
  try {
    await button.click();
    let ok = await until(landed, 6_000);
    if (!ok) {
      const yes = UI.deskConfirm(page.getByRole("dialog"));
      if (await yes.count()) await yes.click({ timeout: 5_000 }).catch(() => {});
      ok = await until(landed, ms, 500);
    }
    const track = posts.find((r) => r.url().includes("/api/admin/track/"));
    let body = null;
    try { body = track ? JSON.parse(track.postData() ?? "null") : null; } catch { /* not JSON */ }
    const res = track ? await track.response().catch(() => null) : null;
    const pathOf = (r) => new URL(r.url()).pathname;
    return { ok: !!ok, path: track ? pathOf(track) : null, body, status: res?.status() ?? null, posts: posts.map(pathOf) };
  } finally {
    page.off("request", onRequest);
  }
}
/** A database check for openTapMove: every card of `codes` is at `deskCode`. */
const allAt = (codes, deskCode) => async () => {
  const t = await tables();
  const d = placeOf(t, deskCode);
  return !!d && codes.every((c) => cardByCode(t, c)?.location_id === d.id);
};
/**
 * What a move to a desk must have done (`before`/`after`: dump() around the tap): `codes` at
 * `deskCode` (an active place of kind other); one new card_moves row each (assign or move) from
 * where the card was to the desk, step before = after, with its order and bag; steps, done flags
 * and every other card's place unchanged; no new step events; no email. Returns a summary.
 */
function checkDeskMove(before, after, codes, deskCode) {
  const t0 = before.tables, t = after.tables;
  const desk = placeOf(t, deskCode);
  assert(desk, `no ${deskCode}`);
  eq([desk.kind, desk.active], ["other", true], `${deskCode} kind, active`);
  const oldIds = new Set(t0.card_moves.map((m) => m.id));
  const fresh = t.card_moves.filter((m) => !oldIds.has(m.id));
  const problems = [];
  for (const c of t.cards) {
    const was = t0.cards.find((x) => x.id === c.id);
    if (!was) continue;
    if (!codes.includes(c.card_code)) {
      if ((c.location_id ?? null) !== (was.location_id ?? null)) problems.push(`${c.card_code ?? c.id} moved too`);
      continue;
    }
    if (c.location_id !== desk.id) problems.push(`${c.card_code} not at ${deskCode}`);
    if (latestStage(t, c.id) !== latestStage(t0, c.id)) problems.push(`${c.card_code} step ${latestStage(t0, c.id)} -> ${latestStage(t, c.id)}`);
    if (!!c.completed !== !!was.completed) problems.push(`${c.card_code} done ${was.completed} -> ${c.completed}`);
    const rows = fresh.filter((m) => m.card_id === c.id);
    if (rows.length !== 1) { problems.push(`${c.card_code}: ${rows.length} new card_moves rows`); continue; }
    const m = rows[0];
    if (m.to_location_id !== desk.id) problems.push(`${c.card_code}: row to ${m.to_location_id}`);
    if ((m.from_location_id ?? null) !== (was.location_id ?? null)) problems.push(`${c.card_code}: row from ${m.from_location_id}, was at ${was.location_id}`);
    if (!["assign", "move"].includes(m.action)) problems.push(`${c.card_code}: action ${m.action}`);
    if ((m.stage_before ?? null) !== (m.stage_after ?? null)) problems.push(`${c.card_code}: row stage ${m.stage_before} -> ${m.stage_after}`);
    if (m.order_id !== c.order_id || (m.bag_id ?? null) !== (c.bag_id ?? null)) problems.push(`${c.card_code}: row order/bag ${m.order_id}/${m.bag_id}`);
  }
  if (fresh.length !== codes.length) problems.push(`${fresh.length} new card_moves rows for ${codes.length} cards`);
  if (stageEventCount(t) !== stageEventCount(t0)) problems.push(`${stageEventCount(t) - stageEventCount(t0)} new step events`);
  const mails = after.emails.slice(before.emails.length);
  if (mails.length) problems.push(`emails: ${mails.map((x) => `${JSON.stringify(x.to)} ${x.subject}`).join("; ").slice(0, 160)}`);
  assert(!problems.length, problems.slice(0, 5).join(" | "));
  return `${codes.length} at ${deskCode}, ${fresh.length} ${[...new Set(fresh.map((m) => m.action))].join("/")} rows, no step change, no email`;
}
/** The "Open my desk" link's target, checked: /admin/receiving/desk?desk=<deskCode>. */
async function checkOpenMyDesk(page, appUrl, deskCode) {
  const link = UI.openMyDesk(page);
  await link.waitFor({ timeout: 20_000 });
  const href = new URL(await link.getAttribute("href"), appUrl);
  eq([href.pathname, href.searchParams.get("desk")], [ROUTES.desk, deskCode], '"Open my desk" link');
  return `${href.pathname}${href.search}`;
}
/** Pick a desk in the "Desk" picker by its name; returns the options it offered. */
async function chooseDesk(page, name) {
  const sel = UI.openDeskPicker(page).first();
  await sel.waitFor({ timeout: 15_000 });
  const options = await sel.locator("option").evaluateAll((els) => els.map((o) => ({ value: o.value, label: (o.textContent ?? "").replace(/\s+/g, " ").trim() })));
  const hit = options.find((o) => o.label.toUpperCase() === name.toUpperCase()) ?? options.find((o) => nameRe(name, "i").test(o.label));
  assert(hit, `no "${name}" in the Desk picker (${options.map((o) => o.label).join(", ")})`);
  await sel.selectOption(hit.value);
  return options.map((o) => o.label);
}
const pickedDesk = (page) => UI.openDeskPicker(page).first().evaluate((el) => (el.selectedOptions?.[0]?.textContent ?? "").replace(/\s+/g, " ").trim());
/** A locator on screen at the top of the page, unscrolled, and not under anything (a sticky bar). */
async function onScreenUnscrolled(page, locator) {
  await locator.waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height),
      vh: window.innerHeight, vw: window.innerWidth, scrollY: window.scrollY, covered: !(hit && (hit === el || el.contains(hit))),
    };
  });
}
/** A page that must be "not found": the not-found text, none of the order. Returns its HTTP status. */
async function checkNotFoundPage(page, url) {
  const res = await page.goto(url, { waitUntil: "load", timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  assert(!new URL(page.url()).pathname.startsWith("/admin/login"), `${url}: sent to the sign-in page`);
  const text = flat(await page.locator("body").innerText());
  assert(UI.openNotFound.test(text), `${url}: HTTP ${res?.status()}, no "Code not found": "${text.slice(0, 160)}"`);
  assert(!text.includes(BO_CUSTOMER), `${url}: shows the customer`);
  eq(await UI.openMoveAll(page).count(), 0, `${url}: move buttons`);
  return res?.status() ?? 0;
}

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

  // /q/<CODE> and /Q/<CODE>: a card code -> its card page, a bag code (the label's QR) and the order
  // code -> the scan landing (/admin/receiving/open/<CODE>, upper case; the photos pages are one tap
  // away from it, "All photos"); unknown -> 404; signed out -> sign in, then back
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
    const openOf = (loc) => `${loc.pathname}${loc.search}`;
    await s.step(`/Q/${bag.bag_code} (upper-case path, the label's QR) -> the scan landing ${ROUTES.open(bag.bag_code)}`, async () => {
      eq(openOf(await scanTo(ROUTES.qrUpper(bag.bag_code))), ROUTES.open(bag.bag_code), "redirect");
    }, { shot: false });
    await s.step(`/q/${bag.bag_code.toLowerCase()} (bag code in lower case) -> the scan landing ${ROUTES.open(bag.bag_code)}`, async () => {
      eq(openOf(await scanTo(ROUTES.qr(bag.bag_code.toLowerCase()))), ROUTES.open(bag.bag_code), "redirect");
    }, { shot: false });
    await s.step(`/q/${ORDER_NUMBERS.mailOrder} (order code) -> the scan landing ${ROUTES.open(ORDER_NUMBERS.mailOrder)}`, async () => {
      eq(openOf(await scanTo(ROUTES.qr(ORDER_NUMBERS.mailOrder))), ROUTES.open(ORDER_NUMBERS.mailOrder), "redirect");
    }, { shot: false });
    await s.step(`/Q/${ORDER_NUMBERS.mailOrder} and /q/${ORDER_NUMBERS.mailOrder.toLowerCase()} -> the scan landing`, async () => {
      eq(openOf(await scanTo(ROUTES.qrUpper(ORDER_NUMBERS.mailOrder))), ROUTES.open(ORDER_NUMBERS.mailOrder), "redirect (/Q)");
      eq(openOf(await scanTo(ROUTES.qr(ORDER_NUMBERS.mailOrder.toLowerCase()))), ROUTES.open(ORDER_NUMBERS.mailOrder), "redirect (lower case)");
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
    await s.step("signed out: the order code, the bag's scan landing and its photos page go to sign-in, with next= (no lookup)", async () => {
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
        eq(await signIn(ROUTES.open(bag.bag_code)), ROUTES.open(bag.bag_code), "next (bag scan landing)");
        eq(await signIn(ROUTES.photos(IDS.mailOrder, bag.id)), ROUTES.photos(IDS.mailOrder, bag.id), "next (bag photos page)");
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step("scanning the bag's label QR in the signed-in browser lands on the scan landing for that bag", async () => {
      await goto(page, ROUTES.qrUpper(bag.bag_code));
      const u = new URL(page.url());
      eq(`${u.pathname}${u.search}`, ROUTES.open(bag.bag_code), "landed on");
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
    await s.step("bulk: the Not started group's \"Move these 3 cards\" picker, Ready for Slab Crack", async () => {
      const group = page.locator("div").filter({ has: page.getByRole("heading", { name: /^Not started\b/ }) })
        .filter({ has: page.locator("summary", { hasText: "Move these 3 cards" }) }).last();
      await UI.openSteps(group, "Move these 3 cards");
      const res = await clickForApi(page, UI.advanceTo(group, "Ready for Slab Crack"), "/api/admin/intake/stages");
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
    await s.step("one card alone: move Gold Two to Humidity Press from its card row (\"Change step\")", async () => {
      await goto(page, ROUTES.bag(bag.id));
      const row = UI.cardRow(page, MAIL_NAMES[1], page.locator("summary", { hasText: "Change step" }));
      await UI.openSteps(row, "Change step");
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

  // Steps in ANY order (the owner, Nov 25: "I can randomly skip around them all"): Clamp Work ->
  // Humidor -> Final Dry, once with the card page's step picker and once by slot scans (assign, then
  // move: what the Scan page sends). Every jump is a stage event; only the steps past the furthest
  // one reached this round email the customer (Clamp Work, Final Dry), going back is staff only.
  async "steps-any-order"({ page, ctx, s, browser, appUrl }) {
    const ONE = mailCard(0), SEVEN = mailCard(6);
    const stagesOf = (t, id) => t.order_events.filter((e) => e.event_type === "stage_update" && e.metadata?.card_id === id)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const pressed = (stage) => until(async () => (await UI.advanceTo(page, stage).getAttribute("aria-pressed").catch(() => null)) === "true", 15_000);
    await s.step("setup: receive CD-2549 (01-04, 07-08); make CLAMP 01, HUMIDOR 01, FINAL DRY 01", async () => {
      await trackSetup(ctx, { clamp: 1, humidor: 1, "final-dry": 1 });
    }, { critical: true, shot: false });

    await s.step("card page of CD-2549-01: a picker with all 8 steps and Done, nothing pressed (not started)", async () => {
      await goto(page, ROUTES.card(ONE));
      const names = await UI.stepPicker(page).getByRole("button").evaluateAll((els) => els.map((el) => [el.textContent.replace(/\s+/g, " ").trim(), el.getAttribute("aria-pressed")]));
      eq(names.map(([n]) => n.replace(/^\d\s*|^✓\s*/, "")), ["Ready for Slab Crack", "Humidor", "Humidity Press", "Drying", "Heat Press", "Clamp Work", "Book with Weights", "Final Dry", "Done"], "picker buttons");
      eq(names.filter(([, p]) => p === "true").length, 0, "pressed buttons");
    }, { critical: true });
    const picks = [
      ["Clamp Work", 1, true],   // skips 5 steps: new for the customer
      ["Humidor", 0, false],     // back: staff only, no email
      ["Final Dry", 1, true],    // past Clamp Work: new again
    ];
    for (const [stage, mails, visible] of picks) {
      await s.step(`card page: tap ${stage}: step ${stage}, ${mails ? "one email to A" : "no email"}${visible ? "" : ", staff-only event"}`, async () => {
        const n = (await emails()).length;
        const before = stagesOf(await tables(), ONE).length;
        const res = await clickForApi(page, UI.advanceTo(page, stage), "/api/admin/intake/stages");
        assert(res.status() < 300, `stages answered ${res.status()}: ${await res.text()}`);
        const t = await tables();
        eq(latestStage(t, ONE), stage, "step");
        const evs = stagesOf(t, ONE);
        eq(evs.length - before, 1, "new stage events");
        eq(evs.at(-1).is_customer_visible, visible, "customer visible");
        const fresh = mailsTo((await emails()).slice(n), CUSTOMER_A);
        eq(fresh.length, mails, "emails to Test Customer A");
        assert(await pressed(stage), `${stage} isn't shown as the current step after the page refreshed`);
        if (!mails) await page.getByText(/no customer email/i).first().waitFor({ timeout: 10_000 });
        return fresh.map((m) => m.subject).join(" | ");
      });
    }
    await s.step("CD-2549-01's history: Clamp Work, Humidor, Final Dry; the customer heard about Clamp work and Final drying only", async () => {
      const t = await tables();
      eq(stagesOf(t, ONE).map((e) => e.metadata.stage), ["Clamp Work", "Humidor", "Final Dry"], "stage events");
      const subjects = mailsTo((await emails()), CUSTOMER_A).map((m) => m.subject).filter((x) => /Update on your card/.test(x));
      assert(subjects.some((x) => /Clamp work/.test(x)) && subjects.some((x) => /Final drying/.test(x)), `subjects: ${subjects.join(" | ")}`);
      assert(!subjects.some((x) => /Humidity treatment/.test(x)), `a "Humidity treatment" email went out: ${subjects.join(" | ")}`);
    }, { shot: false });

    const scans = [
      ["assign CD-2549-07 to CLAMP 01", ROUTES.trackAssign, { locationCode: "LOC-CLAMP-01", cardIds: [SEVEN] }, "Clamp Work", 1],
      ["move CLAMP 01 -> HUMIDOR 01 (back)", ROUTES.trackMove, { fromCode: "LOC-CLAMP-01", toCode: "LOC-HUMIDOR-01" }, "Humidor", 0],
      ["move HUMIDOR 01 -> FINAL DRY 01", ROUTES.trackMove, { fromCode: "LOC-HUMIDOR-01", toCode: "LOC-FINAL-DRY-01" }, "Final Dry", 1],
    ];
    for (const [what, route, body, stage, mails] of scans) {
      await s.step(`slot scan: ${what}: step ${stage}, ${mails ? "one email to A" : "no email"}`, async () => {
        const n = (await emails()).length;
        const r = await trackOk(ctx, route, body);
        const t = await tables();
        eq(latestStage(t, SEVEN), stage, "step");
        eq(resultOf(r, SEVEN)?.stage, stage, "result stage");
        eq(mailsTo((await emails()).slice(n), CUSTOMER_A).length, mails, "emails to Test Customer A");
        eq((r.emailedOrders ?? []).length, mails, "emailedOrders");
        eq(stagesOf(t, SEVEN).at(-1).is_customer_visible, mails === 1, "customer visible");
        return r.message;
      }, { shot: false });
    }
    await s.step("CD-2549-07's card page: Final Dry pressed, Clamp Work and Humidor checked as done this round; 390 px no sideways scroll", async () => {
      eq(stagesOf(await tables(), SEVEN).map((e) => e.metadata.stage), ["Clamp Work", "Humidor", "Final Dry"], "stage events");
      await goto(page, ROUTES.card(SEVEN));
      assert(await pressed("Final Dry"), "Final Dry not pressed");
      for (const st of ["Clamp Work", "Humidor"]) {
        eq(await UI.stepPicker(page).getByRole("button", { name: `${st} (done this round)` }).count(), 1, `${st} checked`);
      }
      const w = await phoneShot(browser, appUrl, ROUTES.card(SEVEN), "steps-any-order-card");
      assert(!w, w);
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

  // The photos page (the scan landing's "All photos"; until Nov 25 where the order code and each
  // bag's QR led): every card with all its images, grouped by bag; with ?bag=<bagId> only that bag's cards
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
    // Labels print without waiting for photos (main #70, "Printing needs no photos"): no photo
    // ever disables the button or adds a "needs a photo" line
    await s.step("no receiving photos yet: Print labels is enabled, \"Ready to print: 3 labels\", no photo asked for", async () => {
      const step = await openStep();
      const btn = UI.printButton(step);
      await btn.waitFor();
      assert(await waitEnabled(btn), "the print button is disabled before the cards have receiving photos (photos never block printing)");
      const text = await stepText(step);
      assert(UI.saysReady(text, bags.length), `the step doesn't say "Ready to print: ${bags.length} labels": "${text.slice(0, 160)}"`);
      assert(!/take a photo|still needs? one|needs? a photo/i.test(text), `the step asks for photos: "${text.slice(0, 160)}"`);
      return text.slice(0, 120);
    });
    await s.step("photos on 3 of the 4 cards (set in the mock): still enabled, no photo asked for", async () => {
      await setReceivingPhotos(mockUrl, picked.slice(0, 3));
      const step = await openStep();
      const btn = UI.printButton(step);
      await btn.waitFor();
      assert(await waitEnabled(btn), "disabled while a card has no receiving photo (photos never block printing)");
      const text = await stepText(step);
      assert(!/take a photo|still needs? one|needs? a photo/i.test(text), `the step asks for photos: "${text.slice(0, 160)}"`);
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
    await s.step("PATCH capacity: a slot holds one card (owner, Nov 26 2026): 3 and none (null) are refused (400), 1 is fine; 0 is refused", async () => {
      const t0 = await tables();
      const c1 = placeOf(t0, "LOC-CLAMP-01").id, c2 = placeOf(t0, "LOC-CLAMP-02").id;
      const three = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c1, capacity: 3 });
      eq([three.status, three.body?.error], [400, "CLAMP 01 holds one card (the owner's rule), so its limit can't change."], "capacity 3: HTTP, error");
      eq((await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c2, capacity: null })).status, 400, "capacity null: HTTP");
      eq((await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c2, capacity: 1 })).status, 200, "capacity 1: HTTP");
      const zero = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: c1, capacity: 0 });
      assert(zero.status >= 400 && zero.status < 500, `capacity 0: HTTP ${zero.status}`);
      const t = await tables();
      eq([placeOf(t, "LOC-CLAMP-01").capacity, placeOf(t, "LOC-CLAMP-02").capacity], [1, 1], "capacities");
      return three.body?.error;
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

  // ASSIGN: put a card in a slot (step = the slot's, its customer emailed), one card per holder (owner,
  // Nov 26 2026: a second card or several at once are refused, force or not), a card leaves its old
  // slot, refunded cards refused
  async "track-assign"({ ctx, s, mockUrl }) {
    let t0 = null;
    await s.step("setup: receive CD-2549 (01-04, 07-08) and CD-2600-01; make CLAMP 01..07, HEAT PRESS 01..03; CLAMP 01 stored no limit (made before the rule), CLAMP 02 holds 1", async () => {
      await trackSetup(ctx, { clamp: 7, "heat-press": 3 });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-CLAMP-01");
      await mockUpdate(mockUrl, "locations", { capacity: 1 }, "code", "LOC-CLAMP-02");
      t0 = await tables();
    }, { critical: true, shot: false });
    const three = ["CD-2549-07", "CD-2549-08", "CD-2600-01"];
    const clampOf = { "CD-2549-07": "LOC-CLAMP-01", "CD-2549-08": "LOC-CLAMP-06", "CD-2600-01": "LOC-CLAMP-07" };
    await s.step('CD-2549-07 + CD-2549-08 + CD-2600-01 at once into CLAMP 01 (stored no limit): 409 "CLAMP 01 holds one card. Pick one card to put here.", force too; nothing written', async () => {
      const before = await dump();
      let msg = "";
      for (const force of [false, true]) {
        const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-01", cardIds: three.map((c) => cardIdOf(t0, c)), ...(force ? { force } : {}) });
        msg = checkHolderFull(r, "LOC-CLAMP-01", []);
        eq(msg, "CLAMP 01 holds one card. Pick one card to put here.", `error${force ? " (force)" : ""}`);
      }
      const after = await dump();
      eq(cardsIn(after.tables, "LOC-CLAMP-01"), [], "cards in CLAMP 01");
      eq(after.tables.card_moves.length, before.tables.card_moves.length, "card_moves rows");
      eq(after.emails.length, before.emails.length, "emails");
      return msg;
    }, { critical: true, shot: false });
    const bodies = {};
    let mails0 = 0;
    await s.step("one card per clamp: CD-2549-07 -> CLAMP 01, CD-2549-08 -> CLAMP 06, CD-2600-01 -> CLAMP 07: each in, step Clamp Work", async () => {
      mails0 = (await emails()).length;
      for (const code of three) {
        const body = await assignOk(ctx, clampOf[code], [cardIdOf(t0, code)]);
        bodies[code] = body;
        eq(body.location?.code, clampOf[code], `${code} location.code`);
        const r = resultOf(body, cardIdOf(t0, code));
        assert(r?.ok && r.changed, `${code}: ${r?.message ?? "no result"}`);
        eq(r.stage, "Clamp Work", `${code} stage`);
        eq(body.changed, 1, `${code} changed`);
      }
      return Object.values(bodies).map((b) => b.message).join(" | ");
    }, { critical: true, shot: false });
    await s.step("the 3 cards are in their clamps (location_id, located_at) at step Clamp Work; the others didn't move", async () => {
      const t = await tables();
      for (const code of three) {
        eq(cardsIn(t, clampOf[code]), [code], `cards in ${clampOf[code]}`);
        assert(cardByCode(t, code).located_at, `${code} has no located_at`);
        eq(latestStage(t, cardIdOf(t, code)), "Clamp Work", `${code} step`);
      }
      for (const code of ["CD-2549-01", "CD-2549-02", "CD-2549-03", "CD-2549-04"]) {
        eq(cardByCode(t, code).location_id ?? null, cardByCode(t0, code).location_id ?? null, `${code} location_id`);
        eq(latestStage(t, cardIdOf(t, code)), null, `${code} step`);
      }
      eq(stageEventCount(t) - stageEventCount(t0), 3, "new stage_update events");
    }, { shot: false });
    await s.step("card_moves: one 'assign' row per card (to its clamp, from where it was, step null -> Clamp Work, order and bag)", async () => {
      const t = await tables();
      for (const code of three) {
        const to = placeOf(t, clampOf[code]).id;
        const c = cardByCode(t, code);
        const rows = movesOf(t, c.id).filter((m) => m.to_location_id === to);
        eq(rows.length, 1, `${code} rows to ${clampOf[code]}`);
        eq([rows[0].action, rows[0].stage_before ?? null, rows[0].stage_after], ["assign", null, "Clamp Work"], `${code} action, stage_before, stage_after`);
        eq([rows[0].order_id, rows[0].bag_id, rows[0].from_location_id ?? null], [c.order_id, c.bag_id, cardByCode(t0, code).location_id ?? null], `${code} order_id, bag_id, from_location_id`);
      }
    }, { shot: false });
    await s.step("each card's customer is emailed about its step: 2 to Test Customer A (one per card), 1 to Test Customer G", async () => {
      const fresh = (await emails()).slice(mails0);
      eq(mailsTo(fresh, CUSTOMER_A).length, 2, "emails to Test Customer A");
      eq(mailsTo(fresh, CUSTOMER_G).length, 1, "emails to Test Customer G");
      eq(three.map((c) => (bodies[c]?.emailedOrders ?? []).length), [1, 1, 1], "emailedOrders per request");
      return fresh.map((m) => m.subject).join(" | ").slice(0, 160);
    }, { shot: false });
    await s.step("the same assigns again: ok, nothing changed; no new step event, move row or email", async () => {
      const before = await dump();
      for (const code of three) {
        const body = await assignOk(ctx, clampOf[code], [cardIdOf(t0, code)]);
        assert(body.results.every((r) => r.ok && !r.changed), body.results.map((r) => `${r.code}: ok ${r.ok}, changed ${r.changed}`).join(" | "));
        eq(body.changed, 0, `${code} changed`);
      }
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
    await s.step('CD-2549-02 into CLAMP 02, which has CD-2549-01: 409 "CLAMP 02 already has a card (CD-2549-01 · …). Take it out first, or pick another holder."; nothing written', async () => {
      const before = await dump();
      const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-02", cardIds: [mailCard(1)] });
      const msg = checkHolderFull(r, "LOC-CLAMP-02", ["CD-2549-01"]);
      assert(/^CLAMP 02 already has a card \(CD-2549-01 · .+\)\. Take it out first, or pick another holder\.$/.test(msg), `error "${msg}"`);
      const after = await dump();
      eq(cardsIn(after.tables, "LOC-CLAMP-02"), ["CD-2549-01"], "cards in CLAMP 02");
      eq(after.tables.card_moves.length, before.tables.card_moves.length, "card_moves rows");
      eq(stageEventCount(after.tables), stageEventCount(before.tables), "stage_update events");
      eq(after.emails.length, before.emails.length, "emails");
      return msg;
    }, { shot: false });
    await s.step("force (the old \"Add anyway\") can't bypass it: still 409, CLAMP 02 holds only CD-2549-01; nothing written", async () => {
      const before = await dump();
      const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-02", cardIds: [mailCard(1)], force: true });
      const msg = checkHolderFull(r, "LOC-CLAMP-02", ["CD-2549-01"]);
      const after = await dump();
      eq(cardsIn(after.tables, "LOC-CLAMP-02"), ["CD-2549-01"], "cards in CLAMP 02");
      eq(cardByCode(after.tables, "CD-2549-02").location_id ?? null, null, "CD-2549-02 location_id");
      eq(after.tables.card_moves.length, before.tables.card_moves.length, "card_moves rows");
      eq(after.emails.length, before.emails.length, "emails");
      return msg;
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

  // MOVE a slot's card to another slot (one card per holder; the step follows the slot, back too, with no email), then Done and Take out
  async "track-move"({ ctx, s, mockUrl }) {
    const three = ["CD-2549-07", "CD-2549-08", "CD-2600-01"];
    let t0 = null;
    await s.step("setup: receive; make CLAMP 01..03, HEAT PRESS 01..03, FINAL DRY 01..02 (HEAT PRESS 02 stored no limit: made before the rule); CD-2549-07, -08 and CD-2600-01 in CLAMP 01, 02, 03", async () => {
      await trackSetup(ctx, { clamp: 3, "heat-press": 3, "final-dry": 2 });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-HEAT-PRESS-02");
      t0 = await tables();
      for (const [n, code] of three.entries()) await assignOk(ctx, `LOC-CLAMP-0${n + 1}`, [cardIdOf(t0, code)]);
      const t = await tables();
      eq(three.map((_, n) => cardsIn(t, `LOC-CLAMP-0${n + 1}`)), three.map((c) => [c]), "cards in CLAMP 01, 02, 03");
    }, { critical: true, shot: false });
    await s.step("move CLAMP 01 -> HEAT PRESS 02: CD-2549-07 in, CLAMP 01 empty (freed); step back to Heat Press (a staff-only event); no email", async () => {
      const before = await dump();
      const body = await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-01", toCode: "LOC-HEAT-PRESS-02" });
      eq(body.location?.code, "LOC-HEAT-PRESS-02", "location.code");
      assert(body.results.length === 1 && body.results[0].ok, body.results.map((r) => `${r.code}: ${r.message}`).join(" | "));
      const after = await dump();
      const t = after.tables;
      eq(cardsIn(t, "LOC-HEAT-PRESS-02"), ["CD-2549-07"], "cards in HEAT PRESS 02");
      eq(cardsIn(t, "LOC-CLAMP-01"), [], "cards in CLAMP 01");
      assert(freedCodes(body).includes("LOC-CLAMP-01"), `freed ${JSON.stringify(freedCodes(body))}`);
      eq(latestStage(t, mailCard(6)), "Heat Press", "CD-2549-07 step (back to Heat Press)");
      const backEvents = t.order_events.filter((e) => e.event_type === "stage_update" && !before.tables.order_events.some((b) => b.id === e.id));
      eq(backEvents.map((e) => e.is_customer_visible), [false], "customer visible (going back: staff only)");
      eq(after.emails.length, before.emails.length, "emails");
      const row = movesOf(t, mailCard(6)).find((m) => m.to_location_id === placeOf(t, "LOC-HEAT-PRESS-02").id);
      assert(row, "no move row to HEAT PRESS 02");
      eq([row.action, row.from_location_id, row.stage_before, row.stage_after], ["move", placeOf(t, "LOC-CLAMP-01").id, "Clamp Work", "Heat Press"], "action, from, stage_before, stage_after");
      return body.message;
    }, { critical: true, shot: false });
    await s.step("move CLAMP 02 -> HEAT PRESS 02 (has CD-2549-07; stored no limit): 409 \"already has a card\", force too; nothing moved", async () => {
      const before = await tables();
      let msg = "";
      for (const force of [false, true]) {
        const r = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-02", toCode: "LOC-HEAT-PRESS-02", ...(force ? { force } : {}) });
        msg = checkHolderFull(r, "LOC-HEAT-PRESS-02", ["CD-2549-07"]);
      }
      assert(/^HEAT PRESS 02 already has a card \(CD-2549-07 · .+\)\. Take it out first, or pick another holder\.$/.test(msg), `error "${msg}"`);
      const t = await tables();
      eq([cardsIn(t, "LOC-CLAMP-02"), cardsIn(t, "LOC-HEAT-PRESS-02")], [["CD-2549-08"], ["CD-2549-07"]], "CLAMP 02, HEAT PRESS 02");
      eq(t.card_moves.length, before.card_moves.length, "card_moves rows");
      return msg;
    }, { shot: false });
    await s.step("CLAMP 02 -> HEAT PRESS 01 and CLAMP 03 -> HEAT PRESS 03: each back to Heat Press (staff only), no email", async () => {
      const before = await dump();
      await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-02", toCode: "LOC-HEAT-PRESS-01" });
      await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-03", toCode: "LOC-HEAT-PRESS-03" });
      const after = await dump();
      const t = after.tables;
      eq([cardsIn(t, "LOC-HEAT-PRESS-01"), cardsIn(t, "LOC-HEAT-PRESS-03")], [["CD-2549-08"], ["CD-2600-01"]], "HEAT PRESS 01, 03");
      for (const code of three) eq(latestStage(t, cardIdOf(t, code)), "Heat Press", `${code} step`);
      eq(after.emails.length, before.emails.length, "emails");
    }, { critical: true, shot: false });
    await s.step("CD-2549-07 on to FINAL DRY 01, CD-2549-08 to FINAL DRY 02: step Final Dry, Test Customer A emailed for each; CD-2600-01 stays", async () => {
      const n = (await emails()).length;
      const a = await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-02", toCode: "LOC-FINAL-DRY-01", cardIds: [mailCard(6)] });
      const b = await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-01", toCode: "LOC-FINAL-DRY-02", cardIds: [mailCard(7)] });
      const t = await tables();
      eq([cardsIn(t, "LOC-FINAL-DRY-01"), cardsIn(t, "LOC-FINAL-DRY-02")], [["CD-2549-07"], ["CD-2549-08"]], "cards in FINAL DRY 01, 02");
      eq(cardsIn(t, "LOC-HEAT-PRESS-03"), ["CD-2600-01"], "left in HEAT PRESS 03");
      for (const cid of [mailCard(6), mailCard(7)]) eq(latestStage(t, cid), "Final Dry", `${cid} step`);
      eq(latestStage(t, IDS.bigCards[0]), "Heat Press", "CD-2600-01 step");
      const fresh = (await emails()).slice(n);
      eq([mailsTo(fresh, CUSTOMER_A).length, mailsTo(fresh, CUSTOMER_G).length], [2, 0], "emails to A, G");
      return `${a.message} | ${b.message}`;
    }, { critical: true, shot: false });
    await s.step("refused, nothing moved: from an empty slot (CLAMP 01); a card that isn't in the from-slot", async () => {
      const before = await tables();
      const empty = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-01", toCode: "LOC-CLAMP-02" });
      assert(empty.status >= 400 && empty.status < 500, `from an empty slot: HTTP ${empty.status}`);
      const stranger = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-03", toCode: "LOC-CLAMP-02", cardIds: [mailCard(0)] });
      const refused = (stranger.status >= 400 && stranger.status < 500) || (stranger.status === 200 && (stranger.body?.results ?? []).every((r) => !r.ok || !r.changed));
      assert(refused, `a card not in the slot: HTTP ${stranger.status} ${JSON.stringify(stranger.body).slice(0, 160)}`);
      const t = await tables();
      eq(t.card_moves.length, before.card_moves.length, "card_moves rows");
      eq(cardsIn(t, "LOC-CLAMP-02"), [], "cards in CLAMP 02");
      eq(cardsIn(t, "LOC-HEAT-PRESS-03"), ["CD-2600-01"], "cards in HEAT PRESS 03");
    }, { shot: false });
    // Done puts a card back in its own bag (owner, Nov 25 2026): no place, never LOC-DONE
    await s.step("Done (CD-2549-07 + -08): done, back in the bag (no place, not LOC-DONE); FINAL DRY 01 and 02 freed; bag CD-2549-P complete; no customer email", async () => {
      const n = (await emails()).length;
      const body = await trackOk(ctx, ROUTES.trackDone, { cardIds: [mailCard(6), mailCard(7)] });
      eq(body.location ?? null, null, "location (in the bag)");
      const t = await tables();
      for (const code of ["CD-2549-07", "CD-2549-08"]) {
        const c = cardByCode(t, code);
        assert(c.completed && c.completed_at, `${code} not done`);
        eq(c.location_id ?? null, null, `${code} location_id (in the bag)`);
        const row = movesOf(t, c.id).find((m) => m.action === "done");
        assert(row, `${code}: no 'done' move row`);
        const fromDry = placeOf(t, code === "CD-2549-07" ? "LOC-FINAL-DRY-01" : "LOC-FINAL-DRY-02").id;
        eq([row.action, row.from_location_id, row.to_location_id ?? null, row.stage_before, row.stage_after], ["done", fromDry, null, "Final Dry", "done"], `${code} action, from, to, stage_before, stage_after`);
      }
      eq(cardsIn(t, "LOC-DONE"), [], "cards at LOC-DONE");
      eq([cardsIn(t, "LOC-FINAL-DRY-01"), cardsIn(t, "LOC-FINAL-DRY-02")], [[], []], "cards in FINAL DRY 01, 02");
      for (const code of ["LOC-FINAL-DRY-01", "LOC-FINAL-DRY-02"]) assert(freedCodes(body).includes(code), `freed ${JSON.stringify(freedCodes(body))}`);
      const bag = bagByCode(t, "CD-2549-P");
      assert(bag.completed_at, "bag CD-2549-P not completed");
      assert((body.bagsCompleted ?? []).includes(bag.id), `bagsCompleted ${JSON.stringify(body.bagsCompleted)} doesn't name CD-2549-P`);
      assert(!bagByCode(t, "CD-2549-G").completed_at, "the Gold bag must stay open");
      assert(!["completed", "shipped_back", "delivered"].includes(t.orders.find((o) => o.id === IDS.mailOrder).status), "the order was completed");
      eq(mailsTo((await emails()).slice(n), CUSTOMER_A).length, 0, "customer emails for done (none, as before)");
      return body.message;
    }, { shot: false });
    await s.step("Take out (release) CD-2600-01: in no place, HEAT PRESS 03 freed, step still Heat Press, a 'release' row", async () => {
      const before = await dump();
      const body = await trackOk(ctx, ROUTES.trackRelease, { cardIds: [IDS.bigCards[0]] });
      eq(body.location ?? null, null, "location");
      const t = (await dump()).tables;
      eq(cardByCode(t, "CD-2600-01").location_id ?? null, null, "location_id");
      eq(cardsIn(t, "LOC-HEAT-PRESS-03"), [], "cards in HEAT PRESS 03");
      assert(freedCodes(body).includes("LOC-HEAT-PRESS-03"), `freed ${JSON.stringify(freedCodes(body))}`);
      eq(latestStage(t, IDS.bigCards[0]), "Heat Press", "step");
      const rows = movesOf(t, IDS.bigCards[0]).filter((m) => m.action === "release");
      eq(rows.length, 1, "release rows");
      eq([rows[0].from_location_id, rows[0].to_location_id ?? null], [placeOf(t, "LOC-HEAT-PRESS-03").id, null], "from, to");
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
    await s.step("setup: receive; make CLAMP 01..04; CD-2549-07 in CLAMP 01, CD-2549-08 in CLAMP 04, CD-2549-01 in CLAMP 02", async () => {
      await trackSetup(ctx, { clamp: 4 });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-CLAMP-01");
      await assignOk(ctx, "LOC-CLAMP-01", [mailCard(6)]);
      await assignOk(ctx, "LOC-CLAMP-04", [mailCard(7)]);
      await assignOk(ctx, "LOC-CLAMP-02", [mailCard(0)]);
    }, { critical: true, shot: false });
    const platDue = "2026-12-07";
    await s.step("slot LOC-CLAMP-01 (stored no limit): CLAMP 01, Clamp, number 1, step Clamp Work, holds 1 and has 1 card (Card ID, name, customer, due)", async () => {
      const l = await resolveVia(ctx, "LOC-CLAMP-01", "location");
      eq([l.code, l.name, l.kind, l.station, l.stationName, l.serial, l.stage], ["LOC-CLAMP-01", "CLAMP 01", "station", "clamp", "Clamp", 1, "Clamp Work"], "slot");
      eq([l.capacity, l.cardCount, l.free, l.overCapacity], [1, 1, false, false], "capacity, cardCount, free, overCapacity");
      eq((l.cards ?? []).map((c) => c.code).sort(), ["CD-2549-07"], "cards");
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
    await s.step("bag CD-2549-P: both cards, in CLAMP 01 and CLAMP 04 at Clamp Work", async () => {
      const b = await resolveVia(ctx, "CD-2549-P", "bag");
      eq([b.code, b.cardCount, b.doneCount, b.dueDate], ["CD-2549-P", 2, 0, platDue], "bag");
      eq(b.cards.map((c) => [c.code, c.location?.name ?? null, c.stage]), [["CD-2549-07", "CLAMP 01", "Clamp Work"], ["CD-2549-08", "CLAMP 04", "Clamp Work"]], "cards, slots, steps");
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
      eq([...new Set((sh.body?.moves ?? []).filter((m) => m.to?.code === "LOC-CLAMP-01").map((m) => m.cardCode))].sort(), ["CD-2549-07"], "slot history: cards put in");
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
    await s.step("bag and order codes open the scan landing; a Card ID its card page", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [mailCard(6)], "2026-11-15");
      assert(bagByCode(await tables(), "CD-2549-P"), "receive did not make bag CD-2549-P");
      const b = await scanTo(ROUTES.qrUpper("CD-2549-P"));
      eq(`${b.pathname}${b.search}`, ROUTES.open("CD-2549-P"), "bag redirect");
      const o = await scanTo(ROUTES.qr(ORDER_NUMBERS.mailOrder));
      eq(`${o.pathname}${o.search}`, ROUTES.open(ORDER_NUMBERS.mailOrder), "order redirect");
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

  // The Scan page on a phone (390 px): the handheld scanner, an empty slot asks for a card, a full slot shows it
  async "track-scan-page"({ page, ctx, s, browser, appUrl }) {
    await s.step("setup: receive; make CLAMP 01..03; CD-2549-01 in CLAMP 02", async () => {
      await trackSetup(ctx, { clamp: 3 });
      await assignOk(ctx, "LOC-CLAMP-02", [mailCard(0)]);
    }, { critical: true, shot: false });
    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const shot = (name) => p.screenshot({ path: path.join(OUT, `track-scan-page-${name}.png`), fullPage: true }).catch(() => {});
    try {
      await s.step('/admin/scan at 390 px: loads signed in, "Ready to scan", "Type a code instead" (the box closed), no sideways scroll', async () => {
        await goto(p, ROUTES.scan);
        await UI.scanReady(p).waitFor({ timeout: 30_000 });
        await p.getByText(UI.readyToScan).first().waitFor({ timeout: 15_000 });
        await UI.typeCodeLink(p).waitFor({ timeout: 15_000 });
        eq(await UI.scanInput(p).count(), 0, "code boxes shown before Type a code instead");
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
      await s.step("no browser errors on the phone", async () => {
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

  // ── Desk (owner, Nov 24): "if I have a heatpress stack of 8 cards and they come out I can scan
  // them all and put them all back to the desk and then ... see on a page all of the 8 cards" ──

  // 8 heat press cards (one per heat press: one card per holder, owner Nov 26 2026) onto the desk in one request: location only
  async "desk-stack"({ page, ctx, s, mockUrl }) {
    let t0 = null;
    const ids = () => DESK_CARDS.map((c) => cardIdOf(t0, c));
    await s.step("setup: receive CD-2549 (01-04, 07-08) and CD-2600-01..03 (notes, defects, receiving photos)", async () => {
      t0 = await deskReceive(ctx, mockUrl);
    }, { critical: true, shot: false });
    await s.step("bulk-create HEAT PRESS 01..08 (LOC-HEAT-PRESS-01..08)", async () => {
      const body = await bulkSlots(ctx, "heat-press", DESK_CARDS.length);
      eq(body.created.map((l) => l.code), DESK_CARDS.map((c) => deskPress(c).code), "codes");
    }, { critical: true, shot: false });
    await s.step("a heat press holds one card (owner, Nov 26 2026): HEAT PRESS 01 stores 1, the heat press type's default is 1", async () => {
      eq(placeOf(await tables(), "LOC-HEAT-PRESS-01").capacity ?? null, 1, "HEAT PRESS 01 capacity");
      const r = await api(ctx, "GET", ROUTES.trackLocations());
      const type = (r.body?.stations ?? []).find((x) => x.key === "heat-press");
      assert(type, `no heat-press station type in ${JSON.stringify(r.body?.stations).slice(0, 160)}`);
      eq(type.defaultCapacity, 1, "heat-press defaultCapacity");
    }, { shot: false });
    await s.step('the 8 into HEAT PRESS 01 in ONE request: 409 "HEAT PRESS 01 holds one card. Pick one card to put here.", force too; nothing written', async () => {
      const before = await dump();
      let msg = "";
      for (const force of [false, true]) {
        const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-HEAT-PRESS-01", cardIds: ids(), ...(force ? { force } : {}) });
        msg = checkHolderFull(r, "LOC-HEAT-PRESS-01", []);
      }
      eq(msg, "HEAT PRESS 01 holds one card. Pick one card to put here.", "error");
      const after = await dump();
      eq(cardsIn(after.tables, "LOC-HEAT-PRESS-01"), [], "cards in HEAT PRESS 01");
      eq([after.tables.card_moves.length, after.emails.length], [before.tables.card_moves.length, before.emails.length], "card_moves rows, emails");
      return msg;
    }, { shot: false });
    await s.step("one card per heat press (CD-2549-01 in HEAT PRESS 01 ... CD-2600-02 in HEAT PRESS 08): each in, step Heat Press; each card's customer emailed", async () => {
      const mails0 = (await emails()).length;
      for (const code of DESK_CARDS) {
        const body = await assignOk(ctx, deskPress(code).code, [cardIdOf(t0, code)]);
        assert(body.results.length === 1 && body.results[0].ok && body.results[0].changed, `${code}: ${body.message}`);
      }
      const t = await tables();
      for (const code of DESK_CARDS) {
        eq(cardsIn(t, deskPress(code).code), [code], `cards in ${deskPress(code).name}`);
        eq(latestStage(t, cardIdOf(t, code)), "Heat Press", `${code} step`);
      }
      const fresh = (await emails()).slice(mails0);
      eq([mailsTo(fresh, CUSTOMER_A).length, mailsTo(fresh, CUSTOMER_G).length], [6, 2], "emails to Test Customer A, G (one per request)");
    }, { critical: true, shot: false });
    await s.step("the Desk page with nothing on it says so, and how to get cards there", async () => {
      await goto(page, ROUTES.desk);
      const text = await page.locator("main").first().innerText();
      // the first visit makes LOC-DESK and shows it at once (a re-read in the same render is memoized by Next.js)
      assert(!/couldn.t (make|load) the desk/i.test(text), `the first visit didn't show the desk it made: "${text.replace(/\s+/g, " ").slice(0, 300)}"`);
      assert(UI.deskEmpty.test(text), `no empty-desk message: "${text.replace(/\s+/g, " ").slice(0, 200)}"`);
      assert(UI.deskEmptyHow.test(text), `doesn't say how to get cards here (scan / move): "${text.replace(/\s+/g, " ").slice(0, 200)}"`);
      const listed = DESK_ALL.filter((c) => text.includes(c));
      assert(!listed.length, `lists ${listed.join(", ")}, but nothing is on the desk`);
    });
    await s.step(`${DESK} exists: a place of kind other (the Desk page makes it, else it is added as a place)`, async () => {
      const { desk, how } = await ensureDesk(ctx);
      eq([desk.kind, desk.active, desk.station ?? null, desk.stage ?? null], ["other", true, null, null], "kind, active, station, stage");
      return `${desk.name}: ${how}`;
    }, { critical: true, shot: false });
    let before = null;
    await s.step(`the 8 onto the desk in one request (a desk takes any number): POST assign { locationCode: ${DESK}, cardIds: the 8 } -> 200, all 8 moved, HEAT PRESS 01..08 freed, no email sent`, async () => {
      before = await dump();
      const body = await assignOk(ctx, DESK, ids());
      eq(body.location?.code, DESK, "location.code");
      assert(body.results.length === 8 && body.results.every((r) => r.ok && r.changed), body.results.map((r) => `${r.code}: ok ${r.ok}, changed ${r.changed}, ${r.message}`).join(" | ").slice(0, 300));
      eq(body.changed, 8, "changed");
      eq(freedCodes(body), DESK_CARDS.map((c) => deskPress(c).code).sort(), "freed");
      eq(body.emailedOrders ?? [], [], "emailedOrders");
      return body.message;
    }, { critical: true, shot: false });
    await s.step("HEAT PRESS 01..08 are empty; the 8 are at the desk (location_id, located_at); steps unchanged (Heat Press), no step events", async () => {
      const t = await tables();
      for (const code of DESK_CARDS) eq(cardsIn(t, deskPress(code).code), [], `cards in ${deskPress(code).name}`);
      eq(cardsIn(t, DESK), sorted(DESK_CARDS), "cards at the desk");
      for (const code of DESK_CARDS) {
        const c = cardByCode(t, code), was = cardByCode(before.tables, code);
        assert(c.located_at && (!was.located_at || Date.parse(c.located_at) >= Date.parse(was.located_at)), `${code} located_at ${c.located_at} (was ${was.located_at})`);
        eq([latestStage(t, c.id), c.completed], ["Heat Press", false], `${code} step, done`);
      }
      eq(stageEventCount(t), stageEventCount(before.tables), "stage_update events");
    }, { shot: false });
    await s.step("card_moves: one 'assign' row per card, its HEAT PRESS -> DESK, Heat Press -> Heat Press (with order and bag)", async () => {
      const t = await tables();
      const to = placeOf(t, DESK).id;
      for (const code of DESK_CARDS) {
        const c = cardByCode(t, code);
        const from = placeOf(t, deskPress(code).code).id;
        const rows = movesOf(t, c.id).filter((m) => m.to_location_id === to);
        eq(rows.length, 1, `${code} rows to the desk`);
        eq([rows[0].action, rows[0].from_location_id, rows[0].stage_before, rows[0].stage_after], ["assign", from, "Heat Press", "Heat Press"], `${code} action, from, stage_before, stage_after`);
        eq([rows[0].order_id, rows[0].bag_id], [c.order_id, c.bag_id], `${code} order_id, bag_id`);
      }
      eq(t.card_moves.length - before.tables.card_moves.length, 8, "new card_moves rows");
    }, { shot: false });
    await s.step("no customer email for the desk move", async () => {
      const fresh = (await emails()).slice(before.emails.length);
      eq(fresh.length, 0, `emails (${fresh.map((m) => `${JSON.stringify(m.to)} ${m.subject}`).join(" | ").slice(0, 160)})`);
    }, { shot: false });
    await s.step(`resolve ${DESK} (what the Scan page shows): kind other, the 8 cards, each at Heat Press`, async () => {
      const loc = await resolveVia(ctx, DESK, "location");
      eq([loc.code, loc.kind, loc.cardCount], [DESK, "other", 8], "code, kind, cardCount");
      eq(loc.cards.map((c) => c.code).sort(), sorted(DESK_CARDS), "cards");
      const off = loc.cards.filter((c) => c.stage !== "Heat Press").map((c) => `${c.code} ${c.stage}`);
      assert(!off.length, `not at Heat Press: ${off.join(", ")}`);
    }, { shot: false });
  },

  // The Desk page: a panel per card with what the order page shows for it (photos, name, notes)
  async "desk-page"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step(`setup: the 8 (notes, defects, photos) out of HEAT PRESS 01..08 (one each) onto ${DESK}; ${DESK_DECOY} in CLAMP 01`, async () => {
      t = await deskStack(ctx, mockUrl, { clamp: 1 });
      await assignOk(ctx, "LOC-CLAMP-01", [cardIdOf(t, DESK_DECOY)]);
      t = await tables();
    }, { critical: true, shot: false });
    const info = () => DESK_CARDS.map((code) => deskInfo(t, code));
    await s.step(`/admin/receiving/desk lists exactly the 8 cards on the desk, one panel each (not ${DESK_DECOY}, in CLAMP 01)`, async () => {
      await goto(page, ROUTES.desk);
      eq(await waitPanels(page, DESK_CARDS), sorted(DESK_CARDS), "cards with a panel");
      const text = await page.locator("main").first().innerText();
      eq([...new Set(text.match(/CD-\d+-\d{2,}(?!\d)/g) ?? [])].sort(), sorted(DESK_CARDS), "Card IDs on the page");
    }, { critical: true });
    await s.step("each panel: Card ID, card name, customer, order number, the order's customer notes, the card's own notes and known defects", async () => {
      const problems = [];
      const all = info();
      for (const x of all) {
        const txt = await panelText(page, x.code);
        for (const [what, want] of [["card name", x.name], ["customer", x.customer], ...x.orderNotes.map((n) => ["order's customer note", n]), ...x.own.map((n) => ["card note/defect", n])]) {
          if (!txt.includes(want)) problems.push(`${x.code}: no ${what} "${want}"`);
        }
        if (!orderNumberRe(x.orderNumber).test(txt)) problems.push(`${x.code}: no order number ${x.orderNumber}`);
        for (const y of all) for (const n of y.code === x.code ? [] : y.own) if (txt.includes(n)) problems.push(`${x.code}: shows ${y.code}'s note "${n}"`);
      }
      assert(!problems.length, problems.slice(0, 4).join(" | "));
      return `notes on ${all.filter((x) => x.own.length).map((x) => x.code).join(", ")}`;
    }, { shot: false });
    await s.step("each panel has at least one photo (<img>)", async () => {
      const counts = [];
      for (const code of DESK_CARDS) {
        const n = await UI.deskPanel(page, code, DESK_ALL).locator("img").count();
        counts.push(`${code.slice(3)} ${n}`);
        assert(n >= 1, `${code}: no photo`);
      }
      return counts.join(", ");
    }, { shot: false });
    await s.step("CD-2549-01's panel shows its receiving photo and its customer photos; its first photo loads", async () => {
      const p1 = UI.deskPanel(page, "CD-2549-01", DESK_ALL);
      assert(await p1.locator(`img[src*="${RECEIVING_PHOTO_STEM}"], img[srcset*="${RECEIVING_PHOTO_STEM}"]`).count() >= 1, "no receiving photo");
      assert(await p1.locator('img[src*="seed-a-card01-"], img[srcset*="seed-a-card01-"]').count() >= 1, "no customer photo");
      const img = p1.locator("img").first();
      await img.scrollIntoViewIfNeeded();
      assert(await until(() => img.evaluate((e) => e.complete && e.naturalWidth > 0).catch(() => false), 15_000), "the first photo didn't load");
    }, { shot: false });
    await s.step('each panel\'s "Open order" links to /admin/orders/<id> (the full order)', async () => {
      const out = [];
      for (const x of info()) {
        const link = UI.deskOpenOrder(UI.deskPanel(page, x.code, DESK_ALL));
        assert(await link.count() >= 1, `${x.code}: no "Open order" link`);
        const href = await link.first().getAttribute("href");
        eq(new URL(href, appUrl).pathname, ROUTES.order(x.orderId), `${x.code} "Open order"`);
        out.push(href);
      }
      return [...new Set(out)].join(", ");
    }, { shot: false });
    await s.step("each panel also shows the tier, the step (Heat Press) and where the card came from (its heat press, HEAT PRESS 01..08)", async () => {
      const problems = [];
      for (const x of info()) {
        const txt = await panelText(page, x.code);
        const from = deskPress(x.code).name;
        if (!tierShown(txt, x.tierName)) problems.push(`${x.code}: no tier ${x.tierName}`);
        if (!/heat press/i.test(txt.replace(new RegExp(esc(from), "gi"), ""))) problems.push(`${x.code}: no step Heat Press`);
        if (!nameRe(from, "i").test(txt)) problems.push(`${x.code}: doesn't say it came from ${from}`);
      }
      assert(!problems.length, problems.slice(0, 4).join(" | "));
    }, { shot: false });
    await s.step("tapping a photo (CD-2549-01) opens it full screen; Close closes it", () => photoViewerCheck(page, UI.deskPanel(page, "CD-2549-01", DESK_ALL), "desk-page-viewer-1440"), { shot: false });
    await s.step("1440 px: no sideways scroll, panels in a grid (side by side); screenshot desk-page-1440.png", async () => {
      await page.screenshot({ path: path.join(OUT, "desk-page-1440.png"), fullPage: true });
      const wide = await sidewaysScroll(page);
      assert(wide <= 1, `scrolls sideways by ${wide}px`);
      const boxes = [];
      for (const code of DESK_CARDS.slice(0, 4)) boxes.push(await UI.deskPanel(page, code, DESK_ALL).boundingBox());
      const side = boxes.some((a, i) => boxes.some((b, j) => i !== j && a && b && Math.abs(a.y - b.y) < 8 && Math.abs(a.x - b.x) > 100));
      assert(side, `the panels are one column at 1440 px: ${boxes.map((b) => (b ? `${Math.round(b.x)},${Math.round(b.y)}` : "-")).join(" ")}`);
    }, { shot: false });
    await s.step("390 px: the 8 panels, no sideways scroll, a photo opens full screen; screenshot desk-page-390.png", async () => {
      const phone = await phoneContext(browser, appUrl);
      try {
        await goto(phone.page, ROUTES.desk);
        eq(await waitPanels(phone.page, DESK_CARDS), sorted(DESK_CARDS), "cards with a panel");
        await phone.page.screenshot({ path: path.join(OUT, "desk-page-390.png"), fullPage: true });
        const w = await sidewaysScroll(phone.page);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        const r = await photoViewerCheck(phone.page, UI.deskPanel(phone.page, "CD-2549-07", DESK_ALL), "desk-page-viewer-390");
        assert(!phone.errors.length, `browser errors: ${phone.errors.slice(0, 3).join(" | ").slice(0, 300)}`);
        return r;
      } finally {
        await phone.ctx.close();
      }
    }, { shot: false });
    await s.step('the menu has "Desk" (/admin/receiving/desk)', async () => {
      const hrefs = await UI.deskNavLink(page).evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      assert(hrefs.some((h) => h && new URL(h, appUrl).pathname === ROUTES.desk), `"Desk" links: ${JSON.stringify(hrefs)}`);
    }, { shot: false });
    await s.step("a second desk, DESK GAVIN (LOC-DESK-GAVIN), holding CD-2600-03: ?desk=LOC-DESK-GAVIN lists only it; ?desk=LOC-DESK the 8 and a picker naming DESK GAVIN", async () => {
      const r = await api(ctx, "POST", ROUTES.trackLocations(), { name: "DESK GAVIN", kind: "other" });
      assert([200, 201].includes(r.status), `add DESK GAVIN: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      eq(r.body?.location?.code, "LOC-DESK-GAVIN", "code");
      await assignOk(ctx, "LOC-DESK-GAVIN", [cardIdOf(t, DESK_DECOY)]);
      await goto(page, ROUTES.deskAt("LOC-DESK-GAVIN"));
      eq(await waitPanels(page, [DESK_DECOY]), [DESK_DECOY], "cards on DESK GAVIN");
      await goto(page, ROUTES.deskAt(DESK));
      eq(await waitPanels(page, DESK_CARDS), sorted(DESK_CARDS), `cards on ${DESK}`);
      const text = await page.locator("main").first().innerText();
      const picker = /desk gavin/i.test(text) || (await page.locator('main a[href*="LOC-DESK-GAVIN"], main option[value="LOC-DESK-GAVIN"]').count()) > 0;
      assert(picker, "no desk picker naming DESK GAVIN");
    });
  },

  // From the Desk page: put one in a clamp (typing "clamp 1"), Done one, take one out, then two at once into a humidor
  async "desk-actions"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    const id = (code) => cardIdOf(t, code);
    await s.step(`setup: the 8 on ${DESK}; CLAMP 01..02 (hold 1), HUMIDOR 01 (no limit); ${DESK_DECOY} fills CLAMP 02`, async () => {
      t = await deskStack(ctx, mockUrl, { clamp: 2, humidor: 1 });
      for (const code of ["LOC-CLAMP-01", "LOC-CLAMP-02"]) await mockUpdate(mockUrl, "locations", { capacity: 1 }, "code", code);
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-HUMIDOR-01");
      await assignOk(ctx, "LOC-CLAMP-02", [cardIdOf(t, DESK_DECOY)]);
      t = await tables();
    }, { critical: true, shot: false });
    await s.step("open the Desk page: 8 panels", async () => {
      await goto(page, ROUTES.desk);
      eq(await waitPanels(page, DESK_CARDS), sorted(DESK_CARDS), "cards with a panel");
    }, { critical: true });

    const msgs = {};
    let choices = null;
    await s.step('CD-2549-01: "Put in holder", type "clamp 1" + Enter: in CLAMP 01, step Clamp Work', async () => {
      const panel = UI.deskPanel(page, "CD-2549-01", DESK_ALL);
      await UI.deskPutIn(panel).click();
      const box = await holderBox(page, panel);
      choices = await holderChoices(page, panel);
      const { how, typedSaved } = await pickHolder(page, box, "clamp 1", "CLAMP 01");
      await until(async () => cardsIn(await tables(), "LOC-CLAMP-01").length > 0, 10_000);
      const t2 = await tables();
      eq(cardsIn(t2, "LOC-CLAMP-01"), ["CD-2549-01"], "cards in CLAMP 01");
      eq(latestStage(t2, id("CD-2549-01")), "Clamp Work", "step");
      msgs.put = await messageSeen(page, nameRe("CLAMP 01", "i"));
      assert(box, `no box to type the holder in (${how})`);
      assert(typedSaved, `typing "clamp 1" + Enter saved nothing (${how})`);
      return how;
    });
    if (!cardsIn(await tables(), "LOC-CLAMP-01").includes("CD-2549-01")) {
      await s.step("(fallback) CD-2549-01 into CLAMP 01 through the API", () => assignOk(ctx, "LOC-CLAMP-01", [id("CD-2549-01")]), { shot: false });
    }
    await s.step("the picker offered holders with room (CLAMP 01, HUMIDOR 01), not the full CLAMP 02", async () => {
      assert(choices, "the picker's choices weren't read (see the step above)");
      const has = (name) => choices.some((c) => nameRe(name, "i").test(c));
      const problems = [];
      if (!has("CLAMP 01")) problems.push("no CLAMP 01");
      if (!has("HUMIDOR 01")) problems.push("no HUMIDOR 01");
      if (has("CLAMP 02")) problems.push("offers the full CLAMP 02");
      assert(!problems.length, `${problems.join(", ")} (choices: ${choices.join(" | ").slice(0, 200)})`);
    }, { shot: false });

    // Done puts a card back in its own bag (owner, Nov 25 2026): off the desk, no place, never LOC-DONE
    await s.step("CD-2549-02: Done (answering a second tap or Yes if asked): done, back in its bag (no place, not LOC-DONE); no customer email", async () => {
      const n = (await emails()).length;
      const panel = UI.deskPanel(page, "CD-2549-02", DESK_ALL);
      await tapToSave(page, UI.deskDone(panel), panel);
      await until(async () => cardByCode(await tables(), "CD-2549-02").completed, 10_000);
      const t2 = await tables();
      const c = cardByCode(t2, "CD-2549-02");
      assert(c.completed, "not done");
      eq(c.location_id ?? null, null, "location (in the bag)");
      eq(movesOf(t2, c.id).filter((m) => m.action === "done").map((m) => [m.from_location_id, m.to_location_id ?? null]), [[placeOf(t2, DESK).id, null]], "'done' rows (desk -> no place)");
      eq(mailsTo((await emails()).slice(n), CUSTOMER_A).length, 0, "emails to Test Customer A");
      msgs.done = await messageSeen(page, /\bdone\b/i);
    });
    if (!cardByCode(await tables(), "CD-2549-02").completed) {
      await s.step("(fallback) Done on CD-2549-02 through the API", () => trackOk(ctx, ROUTES.trackDone, { cardIds: [id("CD-2549-02")] }), { shot: false });
    }

    await s.step("CD-2549-03: Take out: in no place, step still Heat Press, a 'release' row from the desk", async () => {
      const panel = UI.deskPanel(page, "CD-2549-03", DESK_ALL);
      await tapToSave(page, UI.deskTakeOut(panel), panel);
      await until(async () => !cardByCode(await tables(), "CD-2549-03").location_id, 10_000);
      const t2 = await tables();
      const c = cardByCode(t2, "CD-2549-03");
      eq(c.location_id ?? null, null, "location_id");
      eq(latestStage(t2, c.id), "Heat Press", "step");
      const rows = movesOf(t2, c.id).filter((m) => m.action === "release");
      eq(rows.map((m) => m.from_location_id), [placeOf(t2, DESK).id], "release rows (from the desk)");
      msgs.out = await messageSeen(page, /\bout\b|taken|removed|\boff\b/i);
    });
    if (cardByCode(await tables(), "CD-2549-03").location_id) {
      await s.step("(fallback) take CD-2549-03 out through the API", () => trackOk(ctx, ROUTES.trackRelease, { cardIds: [id("CD-2549-03")] }), { shot: false });
    }

    const five = ["CD-2549-04", "CD-2549-07", "CD-2549-08", "CD-2600-01", "CD-2600-02"];
    await s.step("without a reload the page shows the 5 left, and a message after each action", async () => {
      eq(await waitPanels(page, five), sorted(five), "cards with a panel");
      const missing = ["put", "done", "out"].filter((k) => !msgs[k]);
      assert(!missing.length, `no message after: ${missing.join(", ")}`);
      return ["put", "done", "out"].map((k) => msgs[k]).join(" | ").slice(0, 200);
    });

    // One card per holder (owner, Nov 26 2026): two picked cards can't go in one holder; one at a time can
    /** Type a holder into the open picker + Enter; the save's answer (a refusal is expected: 409). */
    const refusedPick = async (box, typed) => {
      const answered = page.waitForResponse((r) => /\/api\/admin\/track\/assign$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60_000 });
      await box.fill(typed);
      await box.press("Enter");
      return answered;
    };
    await s.step('tick CD-2600-01 and CD-2600-02, "Put selected in…": the picker says each holder takes one card and lists no holder; typed "humidor 1" is refused ("HUMIDOR 01 holds one card. Pick one card to put here."); nothing moves', async () => {
      for (const code of ["CD-2600-01", "CD-2600-02"]) await tickPanel(UI.deskPanel(page, code, DESK_ALL));
      await UI.deskPutSelected(page).click();
      const box = await holderBox(page, null);
      assert(box, "no box to type the holder in");
      const dlg = page.getByRole("dialog").first();
      await until(async () => /Each holder takes one card: put these 2 cards in one at a time, or on another desk\./.test(await dlg.innerText().catch(() => "")), 15_000);
      const listed = await pickerChoices(page, dlg);
      const holders = (listed ?? []).filter((x) => /\b(CLAMP|HUMIDOR|HEAT PRESS)\b/i.test(x));
      assert(!holders.length, `holders offered for 2 cards: ${holders.join(" | ")}`);
      eq((await refusedPick(box, "humidor 1")).status(), 409, "the save's answer");
      const said = await until(async () => { const x = await dlg.innerText().catch(() => ""); return /HUMIDOR 01 holds one card\. Pick one card to put here\./.test(x) ? x : null; }, 10_000);
      assert(said, `the picker doesn't show the refusal: "${(await dlg.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}"`);
      eq(cardsIn(await tables(), "LOC-HUMIDOR-01"), [], "cards in HUMIDOR 01");
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
      return "HUMIDOR 01 holds one card. Pick one card to put here.";
    });
    let single = false;
    await s.step('CD-2600-01 alone: "Put in holder", type "humidor 1": in HUMIDOR 01, step back to Humidor (any order), no email', async () => {
      const n = (await emails()).length;
      const panel = UI.deskPanel(page, "CD-2600-01", DESK_ALL);
      await UI.deskPutIn(panel).click();
      const box = await holderBox(page, panel);
      const { how } = await pickHolder(page, box, "humidor 1", "HUMIDOR 01");
      single = true;
      await until(async () => cardsIn(await tables(), "LOC-HUMIDOR-01").length >= 1, 10_000);
      const t2 = await tables();
      eq(cardsIn(t2, "LOC-HUMIDOR-01"), ["CD-2600-01"], "cards in HUMIDOR 01");
      eq(latestStage(t2, id("CD-2600-01")), "Humidor", "CD-2600-01 step (back to Humidor, any order)");
      eq(mailsTo((await emails()).slice(n), CUSTOMER_G).length, 0, "emails to Test Customer G");
      msgs.multi = await messageSeen(page, nameRe("HUMIDOR 01", "i"));
      assert(box, `no box to type the holder in (${how})`);
      return how;
    });
    if (!single || !cardsIn(await tables(), "LOC-HUMIDOR-01").length) {
      await s.step("(fallback) CD-2600-01 into HUMIDOR 01 through the API", () => assignOk(ctx, "LOC-HUMIDOR-01", [id("CD-2600-01")]), { shot: false });
    }
    await s.step('CD-2600-02: "Put in holder": HUMIDOR 01 is listed as full, greyed with "Has CD-2600-01" (not a choice); typed "humidor 1" is refused with what\'s in it; nothing moves', async () => {
      const panel = UI.deskPanel(page, "CD-2600-02", DESK_ALL);
      await UI.deskPutIn(panel).click();
      const box = await holderBox(page, panel);
      const dlg = page.getByRole("dialog").first();
      const choices2 = await holderChoices(page, dlg);
      assert(!(choices2 ?? []).some((c) => nameRe("HUMIDOR 01", "i").test(c)), `HUMIDOR 01 is offered: ${(choices2 ?? []).join(" | ").slice(0, 200)}`);
      const full = dlg.getByText("Has CD-2600-01", { exact: true });
      if (!(await full.isVisible().catch(() => false))) await dlg.getByText(/^Full \(\d+\)$/).first().click().catch(() => {});
      await full.waitFor({ state: "visible", timeout: 5_000 });
      eq((await refusedPick(box, "humidor 1")).status(), 409, "the save's answer");
      const said = await until(async () => { const x = (await dlg.innerText().catch(() => "")).replace(/\s+/g, " "); return /HUMIDOR 01 already has a card \(CD-2600-01 · [^)]+\)\. Take it out first, or pick another holder\./.test(x) ? x : null; }, 10_000);
      assert(said, `the picker doesn't show the refusal: "${(await dlg.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}"`);
      eq(cardsIn(await tables(), "LOC-HUMIDOR-01"), ["CD-2600-01"], "cards in HUMIDOR 01");
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
    });
    const four = ["CD-2549-04", "CD-2549-07", "CD-2549-08", "CD-2600-02"];
    await s.step("the page shows the 4 left, with a message naming HUMIDOR 01", async () => {
      eq(await waitPanels(page, four), sorted(four), "cards with a panel");
      assert(msgs.multi, "no message naming HUMIDOR 01");
      return msgs.multi;
    });
    await s.step("reloaded, the desk lists exactly those 4; 390 px no sideways scroll (screenshot)", async () => {
      await goto(page, ROUTES.desk);
      eq(await waitPanels(page, four), sorted(four), "cards with a panel");
      eq(cardsIn(await tables(), DESK), sorted(four), `cards at ${DESK} (database)`);
      const w = await phoneShot(browser, appUrl, ROUTES.desk, "desk-actions-after");
      assert(!w, w);
    });
  },

  // The Scan page (handheld scanner, 390 px): HEAT PRESS 01 -> Move -> the desk; "desk" shows the desk
  async "desk-scan"({ ctx, s, browser, appUrl, mockUrl }) {
    await s.step(`setup: the 8 (received), one in each of HEAT PRESS 01..08; ${DESK} exists`, () => deskStack(ctx, mockUrl, {}, { toDesk: false }), { critical: true, shot: false });
    await s.step("/q/LOC-DESK, /Q/LOC-DESK and /q/loc-desk -> /admin/scan?loc=LOC-DESK", async () => {
      for (const url of [ROUTES.qr(DESK), ROUTES.qrUpper(DESK), ROUTES.qr(DESK.toLowerCase())]) {
        let r = await api(ctx, "GET", url);
        assert([301, 302, 303, 307, 308].includes(r.status), `${url}: HTTP ${r.status}`);
        let loc = new URL(r.headers.location ?? "/", appUrl);
        if (loc.pathname.startsWith("/q/")) {
          r = await api(ctx, "GET", loc.pathname);
          loc = new URL(r.headers.location ?? "/", appUrl);
        }
        eq([loc.pathname, loc.searchParams.get("loc")], [ROUTES.scan, DESK], `${url} redirect`);
      }
    }, { shot: false });

    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const shot = (name) => p.screenshot({ path: path.join(OUT, `desk-scan-${name}.png`), fullPage: true }).catch(() => {});
    const mainText = () => p.locator("main").first().innerText();
    // The desk on the Scan page: its 8 cards and "Open desk page" (-> /admin/receiving/desk[?desk=LOC-DESK])
    const showsDesk = async () => {
      const text = (await until(async () => { const x = await mainText(); return DESK_CARDS.every((c) => x.includes(c)) ? x : null; }, 20_000)) ?? await mainText();
      const missing = DESK_CARDS.filter((c) => !text.includes(c));
      assert(!missing.length, `desk cards not shown: ${missing.join(", ")}`);
      const link = UI.openDeskPage(p);
      await link.waitFor({ timeout: 15_000 });
      const href = new URL(await link.getAttribute("href"), appUrl);
      eq(href.pathname, ROUTES.desk, '"Open desk page" link');
      if (href.searchParams.has("desk")) eq(href.searchParams.get("desk"), DESK, '"Open desk page" ?desk=');
      const w = await sidewaysScroll(p);
      assert(w <= 1, `scrolls sideways by ${w}px`);
      return `${href.pathname}${href.search}`;
    };
    try {
      await s.step("phone /admin/scan: the scanner reads HEAT PRESS 01's label: its one card (CD-2549-01), with Move", async () => {
        await goto(p, ROUTES.scan);
        await Promise.all([
          p.waitForResponse((r) => r.url().includes("/api/admin/track/resolve"), { timeout: 60_000 }),
          scanType(p, "HTTPS://THECARDDOC1.COM/Q/LOC-HEAT-PRESS-01"),
        ]);
        const text = (await until(async () => { const x = await mainText(); return x.includes("CD-2549-01") ? x : null; }, 15_000)) ?? await mainText();
        assert(text.includes("CD-2549-01"), "CD-2549-01 not shown");
        const others = DESK_CARDS.filter((c) => c !== "CD-2549-01" && text.includes(c));
        assert(!others.length, `cards of other heat presses shown: ${others.join(", ")}`);
        assert(await UI.slotMove(p).count() > 0, "no Move button");
        await shot("01-heat-press");
      }, { shot: false });
      let moved = false;
      await s.step("Move, then the scanner reads the desk's label: POST move to LOC-DESK; CD-2549-01 at the desk, HEAT PRESS 01 empty, step kept; a desk page link shows", async () => {
        // The holder view (Nov 26): a stack's tick boxes; "Move selected" acts on the ticked cards
        const pickAll = p.getByRole("button", { name: /^pick all$/i }).first();
        if (await pickAll.isVisible().catch(() => false)) await pickAll.click();
        await UI.slotMove(p).click();
        const res = p.waitForResponse((r) => r.url().includes(ROUTES.trackMove) && r.request().method() === "POST", { timeout: 60_000 });
        await scanType(p, "HTTPS://THECARDDOC1.COM/Q/LOC-DESK");
        const r = await res;
        assert(r.status() < 300, `move answered ${r.status()}: ${await r.text()}`);
        moved = true;
        const sent = JSON.parse(r.request().postData() ?? "{}");
        eq([sent.fromCode, sent.toCode, (sent.cardIds ?? []).length], ["LOC-HEAT-PRESS-01", DESK, 1], "fromCode, toCode, cards sent");
        const t = await tables();
        eq(cardsIn(t, DESK), ["CD-2549-01"], "cards at the desk");
        eq(cardsIn(t, "LOC-HEAT-PRESS-01"), [], "cards in HEAT PRESS 01");
        eq(latestStage(t, cardIdOf(t, "CD-2549-01")), "Heat Press", "CD-2549-01 step");
        await UI.openDeskPage(p).waitFor({ timeout: 15_000 });
        // on the phone the link is on screen as the move lands, not under the Move/Done/Take out bar
        const onScreen = await until(() => p.getByRole("link", { name: /^open (the )?desk( page)?\b/i }).evaluateAll((els) => els.some((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && !!hit && (hit === el || el.contains(hit));
        })), 10_000);
        assert(onScreen, 'the "Open desk page" link needs a scroll (off screen, or under the action bar)');
        await shot("02-moved-to-desk");
        return (await UI.openDeskPage(p).getAttribute("href")) ?? "";
      }, { shot: false });
      if (!moved) {
        await s.step("(fallback) move CD-2549-01 to the desk through the API", async () => {
          const t = await tables();
          await trackOk(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-01", toCode: DESK, cardIds: [cardIdOf(t, "CD-2549-01")] });
        }, { critical: true, shot: false });
      }
      await s.step("the other 7 (one per heat press) onto the desk through the API: the desk holds the 8, steps kept", async () => {
        const t = await tables();
        await assignOk(ctx, DESK, DESK_CARDS.filter((c) => c !== "CD-2549-01").map((c) => cardIdOf(t, c)));
        const t2 = await tables();
        eq(cardsIn(t2, DESK), sorted(DESK_CARDS), "cards at the desk");
        for (const code of DESK_CARDS) eq(latestStage(t2, cardIdOf(t2, code)), "Heat Press", `${code} step`);
      }, { critical: true, shot: false });
      await s.step('a fresh Scan page, "Type a code instead", typing "desk" + Enter: the desk\'s 8 cards and "Open desk page"', async () => {
        await goto(p, ROUTES.scan);
        await typeCode(p, "desk");
        const r = await showsDesk();
        await shot("03-typed-desk");
        return r;
      }, { shot: false });
      await s.step("a fresh Scan page, the scanner reads the desk's label (…/Q/LOC-DESK): the same", async () => {
        await goto(p, ROUTES.scan);
        await scanType(p, "HTTPS://THECARDDOC1.COM/Q/LOC-DESK");
        const r = await showsDesk();
        await shot("04-desk-label");
        return r;
      }, { shot: false });
      await s.step("opened from the desk's QR (/admin/scan?loc=LOC-DESK): the same", async () => {
        await goto(p, ROUTES.scanAt(DESK));
        return showsDesk();
      }, { shot: false });
      await s.step('"Open desk page" opens /admin/receiving/desk with the 8 cards', async () => {
        await Promise.all([
          p.waitForURL((u) => u.pathname === ROUTES.desk, { timeout: 240_000 }),
          UI.openDeskPage(p).click(),
        ]);
        eq(await waitPanels(p, DESK_CARDS), sorted(DESK_CARDS), "cards with a panel");
        await shot("05-desk-page");
      }, { shot: false });
      await s.step("no browser errors on the phone", async () => {
        assert(!phone.errors.length, phone.errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    } finally {
      await phone.ctx.close();
    }
  },

  // One card per holder (owner, Nov 26 2026: "every single sticker station thingy ... only ... one
  // card other than my desk"): every slot holds 1, whatever it stores; force can't add a second; a desk
  // takes any number
  async "desk-capacity"({ ctx, s, mockUrl }) {
    await s.step("station types: every type holds 1 card (clamp, slab crack, humidor, humidity press, drying, heat press, book weights, final dry)", async () => {
      const r = await api(ctx, "GET", ROUTES.trackLocations());
      eq(r.status, 200, "HTTP");
      const got = Object.fromEntries((r.body?.stations ?? []).map((x) => [x.key, x.defaultCapacity]));
      eq(Object.keys(STATIONS).map((k) => [k, k in got ? got[k] : "(missing)"]), Object.keys(STATIONS).map((k) => [k, 1]), "default capacities");
    }, { shot: false });
    let t0 = null;
    const id = (code) => cardIdOf(t0, code);
    await s.step("setup: receive CD-2549 (01-04, 07-08) and CD-2600-01..03; make CLAMP 01..02, SLAB CRACK 01, HEAT PRESS 01..02, HUMIDOR 01", async () => {
      await receiveViaApi(ctx, IDS.mailOrder, [0, 1, 2, 3, 6, 7].map(mailCard), "2026-11-15");
      await receiveViaApi(ctx, IDS.bigOrder, IDS.bigCards.slice(0, 3), "2026-11-20");
      for (const [station, count] of [["clamp", 2], ["slab-crack", 1], ["heat-press", 2], ["humidor", 1]]) await bulkSlots(ctx, station, count);
      t0 = await tables();
      for (const code of DESK_ALL) cardIdOf(t0, code);
    }, { critical: true, shot: false });
    await s.step("new slots store 1: CLAMP 01, 02, SLAB CRACK 01, HEAT PRESS 01, 02 and HUMIDOR 01", async () => {
      const codes = ["LOC-CLAMP-01", "LOC-CLAMP-02", "LOC-SLAB-CRACK-01", "LOC-HEAT-PRESS-01", "LOC-HEAT-PRESS-02", "LOC-HUMIDOR-01"];
      eq(codes.map((c) => placeOf(t0, c)?.capacity ?? null), [1, 1, 1, 1, 1, 1], "capacities");
    }, { shot: false });
    await s.step("CLAMP 01: CD-2549-01 goes in; CD-2549-02 -> 409 \"already has a card\" (HolderFull: no Add anyway), force too; nothing written", async () => {
      await assignOk(ctx, "LOC-CLAMP-01", [id("CD-2549-01")]);
      const before = await dump();
      let msg = "";
      for (const force of [false, true]) {
        const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-CLAMP-01", cardIds: [id("CD-2549-02")], ...(force ? { force } : {}) });
        msg = checkHolderFull(r, "LOC-CLAMP-01", ["CD-2549-01"]);
      }
      const after = await dump();
      eq(cardsIn(after.tables, "LOC-CLAMP-01"), ["CD-2549-01"], "cards in CLAMP 01");
      eq(after.tables.card_moves.length, before.tables.card_moves.length, "card_moves rows");
      eq(after.emails.length, before.emails.length, "emails");
      return msg;
    }, { shot: false });
    await s.step("SLAB CRACK 01: CD-2600-01 goes in; CD-2600-02 -> 409 \"already has a card\"", async () => {
      await assignOk(ctx, "LOC-SLAB-CRACK-01", [id("CD-2600-01")]);
      const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-SLAB-CRACK-01", cardIds: [id("CD-2600-02")] });
      const msg = checkHolderFull(r, "LOC-SLAB-CRACK-01", ["CD-2600-01"]);
      eq(cardsIn(await tables(), "LOC-SLAB-CRACK-01"), ["CD-2600-01"], "cards in SLAB CRACK 01");
      return msg;
    }, { shot: false });
    await s.step('HEAT PRESS 01: 3 cards in one request -> 409 "HEAT PRESS 01 holds one card. Pick one card to put here."; one card -> 200; it holds 1', async () => {
      const three = ["CD-2549-02", "CD-2549-03", "CD-2549-04"];
      const r = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-HEAT-PRESS-01", cardIds: three.map(id) });
      const msg = checkHolderFull(r, "LOC-HEAT-PRESS-01", []);
      eq(msg, "HEAT PRESS 01 holds one card. Pick one card to put here.", "error");
      await assignOk(ctx, "LOC-HEAT-PRESS-01", [id("CD-2549-02")]);
      eq(cardsIn(await tables(), "LOC-HEAT-PRESS-01"), ["CD-2549-02"], "cards in HEAT PRESS 01");
      return msg;
    }, { shot: false });
    await s.step("a slot made before the change with no limit (HUMIDOR 01 set to null in the mock) holds one card all the same: 2 cards -> 409; HEAT PRESS 01's card moved in -> 200; then CLAMP 02's -> 409", async () => {
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-HUMIDOR-01");
      const before = await tables();
      const two = await trackPost(ctx, ROUTES.trackAssign, { locationCode: "LOC-HUMIDOR-01", cardIds: ["CD-2549-07", "CD-2549-08"].map(id) });
      checkHolderFull(two, "LOC-HUMIDOR-01", []);
      eq((await tables()).card_moves.length, before.card_moves.length, "card_moves rows");
      const m = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-HEAT-PRESS-01", toCode: "LOC-HUMIDOR-01" });
      eq(m.status, 200, `move: HTTP (${JSON.stringify(m.body).slice(0, 160)})`);
      await assignOk(ctx, "LOC-CLAMP-02", [id("CD-2549-03")]);
      const again = await trackPost(ctx, ROUTES.trackMove, { fromCode: "LOC-CLAMP-02", toCode: "LOC-HUMIDOR-01", force: true });
      const msg = checkHolderFull(again, "LOC-HUMIDOR-01", ["CD-2549-02"]);
      const t = await tables();
      eq([cardsIn(t, "LOC-HUMIDOR-01"), cardsIn(t, "LOC-CLAMP-02"), cardsIn(t, "LOC-HEAT-PRESS-01")], [["CD-2549-02"], ["CD-2549-03"], []], "HUMIDOR 01, CLAMP 02, HEAT PRESS 01");
      const l = await resolveVia(ctx, "LOC-HUMIDOR-01", "location");
      eq([l.capacity, l.cardCount, l.free], [1, 1, false], "HUMIDOR 01 capacity, cardCount, free (as scanned)");
      return msg;
    }, { shot: false });
    await s.step(`a desk takes any number: CD-2549-04, -07, -08 and CD-2600-02, -03 onto ${DESK} in one request: 200`, async () => {
      await ensureDesk(ctx);
      const five = ["CD-2549-04", "CD-2549-07", "CD-2549-08", "CD-2600-02", "CD-2600-03"];
      const body = await assignOk(ctx, DESK, five.map(id));
      eq(body.changed, 5, "changed");
      eq(cardsIn(await tables(), DESK), sorted(five), "cards at the desk");
    }, { shot: false });
  },

  // ── The scan landing (owner, Nov 25): a bag or order QR opens one simple page: the person, their
  // order, "Move all N cards to my desk", a panel per card (/admin/receiving/open/<code>) ──

  // A bag QR: /q/CD-2549-P -> the page; who it is, the bag's cards, nothing else
  async "bag-open-qr"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step("setup: CD-2549 Gold 01-04 + Platinum 07-09 received 2026-11-15 (05, 06, 10 not here yet); CD-2549-07 at Humidor, a known defect, $2,500 declared; receiving photos", async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      return `${BO_BAG}: ${bagCardCodes(t, BO_BAG).join(", ")}, due ${bagByCode(t, BO_BAG).due_date}`;
    }, { critical: true, shot: false });
    for (const url of [ROUTES.qr(BO_BAG), ROUTES.qrUpper(BO_BAG), ROUTES.qr(BO_BAG.toLowerCase())]) {
      await s.step(`signed in: ${url} -> ${ROUTES.open(BO_BAG)}`, async () => {
        const loc = await scanTarget(ctx, appUrl, url);
        eq(decodeURIComponent(loc.pathname), ROUTES.open(BO_BAG), "redirect");
        return `${loc.pathname}${loc.search}`;
      }, { shot: false });
    }
    await s.step(`signed out: /q/${BO_BAG.toLowerCase()} and /Q/${BO_BAG} -> sign in with next=/q/${BO_BAG}; the page itself -> sign in with next=<the page>`, async () => {
      const anon = await browser.newContext({ baseURL: appUrl, ignoreHTTPSErrors: true });
      try {
        eq(await signInNext(anon, appUrl, ROUTES.qr(BO_BAG.toLowerCase())), `/q/${BO_BAG}`, "next (/q, lower case)");
        eq(await signInNext(anon, appUrl, ROUTES.qrUpper(BO_BAG)), `/q/${BO_BAG}`, "next (/Q)");
        eq(await signInNext(anon, appUrl, ROUTES.open(BO_BAG)), ROUTES.open(BO_BAG), "next (the page)");
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step(`the bag label's QR (…/Q/${BO_BAG}) in the signed-in browser lands on the page`, async () => {
      await goto(page, ROUTES.qrUpper(BO_BAG));
      eq(decodeURIComponent(new URL(page.url()).pathname), ROUTES.open(BO_BAG), "landed on");
      await openReady(page);
    }, { critical: true });
    await s.step(`the person: ${BO_CUSTOMER} as the h1 in the largest type, order ${BO_ORDER}, Platinum, ${BO_BAG}, Due Mon Dec 7, 3 cards`, async () => {
      const bag = bagByCode(t, BO_BAG);
      const top = (await mainText(page)).split(/cards in this bag/i)[0];
      const problems = [];
      const h1 = flat(await page.locator("main h1").first().innerText().catch(() => ""));
      if (!h1.includes(BO_CUSTOMER)) problems.push(`the h1 reads "${h1}"`);
      const size = await biggestText(page, BO_CUSTOMER);
      if (!(size.name >= 24 && size.name >= size.other)) problems.push(`the name is ${size.name}px, "${size.otherText}" ${size.other}px`);
      if (!orderNumberRe(BO_ORDER).test(top)) problems.push(`no order number ${BO_ORDER}`);
      if (!tierShown(top, "Platinum")) problems.push("no tier Platinum");
      if (!top.includes(BO_BAG)) problems.push(`no Bag ID ${BO_BAG}`);
      if (!dueRe(bag.due_date).test(flat(top))) problems.push(`no "${dueText(bag.due_date)}" (due_date ${bag.due_date})`);
      if (!countShown(top, 3)) problems.push('no "3 cards"');
      assert(!problems.length, problems.join(" | "));
      return `name ${size.name}px (next biggest "${size.otherText}" ${size.other}px), ${dueText(bag.due_date)}`;
    });
    await s.step(`the customer's notes in a "Customer's notes" box; "Open full order" -> /admin/orders/<id>; "All photos" -> this bag's photos`, async () => {
      const bag = bagByCode(t, BO_BAG);
      const box = page.locator("main").first().locator("section, div, aside, figure, blockquote, dl")
        .filter({ hasText: UI.openNotesTitle }).filter({ hasText: BO_NOTE })
        .filter({ hasNot: page.locator("h1") }).filter({ hasNotText: /CD-\d+-\d{2}/ });
      assert(await box.count(), `no box titled "Customer's notes" holding "${BO_NOTE}" (apart from the name and the cards)`);
      const full = new URL(await UI.openFullOrder(page).getAttribute("href"), appUrl);
      eq(full.pathname, ROUTES.order(IDS.mailOrder), '"Open full order"');
      const photos = new URL(await UI.openAllPhotos(page).getAttribute("href"), appUrl);
      eq(photos.pathname, ROUTES.photos(IDS.mailOrder), '"All photos"');
      eq(photos.searchParams.get("bag"), bag.id, '"All photos" ?bag=');
      return `${full.pathname} · ${photos.pathname}${photos.search}`;
    }, { shot: false });
    await s.step('ONE big button "Move all 3 cards to my desk", 44+ px tall; no desk picker (one desk)', async () => {
      const btns = page.getByRole("button", { name: UI.openMoveAllRe });
      eq(await btns.count(), 1, "big move buttons");
      const name = await nameOf(btns.first());
      eq(await moveAllN(page), 3, `N in "${name}"`);
      const box = await btns.first().boundingBox();
      assert(box && box.height >= 44, `the button is ${box ? Math.round(box.height) : "not"} px tall`);
      eq(await UI.openDeskPicker(page).count(), 0, '"Desk" pickers with one desk');
      return `"${name}" ${Math.round(box.width)}x${Math.round(box.height)}`;
    }, { shot: false });
    await s.step(`the bag's cards only: ${BO_PLAT.join(", ")}, one panel each (no Gold card, none of those not here yet)`, async () => {
      eq(await openPanelsShown(page), BO_PLAT, "cards with a panel");
      eq([...new Set((await mainText(page)).match(/CD-\d+-\d{2,}(?!\d)/g) ?? [])].sort(), BO_PLAT, "Card IDs on the page");
    }, { critical: true });
    await s.step('each panel: a photo, the card name, year · set · #number, its Card ID, "In the bag", one "Move to my desk" button', async () => {
      const problems = [];
      for (const code of BO_PLAT) {
        const c = cardByCode(t, code);
        const panel = UI.openPanel(page, code, BO_ALL);
        const txt = await openPanelText(page, code);
        for (const [what, want] of [["card name", c.card_name], ["year", c.card_year], ["set", c.card_set], ["number", c.card_number]]) {
          if (!txt.includes(want)) problems.push(`${code}: no ${what} "${want}"`);
        }
        if (!UI.openWhere.bag.test(txt)) problems.push(`${code}: not "In the bag"`);
        if ((await panel.locator("img").count()) < 1) problems.push(`${code}: no photo`);
        const n = await panel.getByRole("button", { name: /^move\b/i }).count();
        if (n !== 1 || !(await UI.openMoveOne(panel).count())) problems.push(`${code}: ${n} move buttons`);
      }
      assert(!problems.length, problems.slice(0, 5).join(" | "));
    }, { shot: false });
    await s.step(`${BO_VALUE.code}: declared value $2,500.00, its known defect, step ${BO_STEP.stage}, its receiving and customer photos; no other card's notes`, async () => {
      const panel = UI.openPanel(page, BO_VALUE.code, BO_ALL);
      const txt = await openPanelText(page, BO_VALUE.code);
      const problems = [];
      if (!BO_VALUE.re.test(txt)) problems.push("no declared value $2,500.00");
      if (!txt.includes(BO_DEFECT.text)) problems.push(`no known defect "${BO_DEFECT.text}"`);
      if (!new RegExp(`\\b${BO_STEP.stage}\\b`, "i").test(txt)) problems.push(`no step ${BO_STEP.stage}`);
      if (!(await panel.locator(`img[src*="${RECEIVING_PHOTO_STEM}"], img[srcset*="${RECEIVING_PHOTO_STEM}"]`).count())) problems.push("no receiving photo");
      if (!(await panel.locator('img[src*="seed-a-card07-"], img[srcset*="seed-a-card07-"]').count())) problems.push("no customer photo");
      for (const code of ["CD-2549-08", "CD-2549-09"]) if ((await openPanelText(page, code)).includes(BO_DEFECT.text)) problems.push(`${code} shows ${BO_DEFECT.code}'s defect`);
      if ((await mainText(page)).includes(BO_CARD_NOTE.text)) problems.push(`shows ${BO_CARD_NOTE.code}'s note (a Gold card)`);
      assert(!problems.length, problems.join(" | "));
    }, { shot: false });
    await s.step(`tapping ${BO_VALUE.code}'s photo opens it full screen; Close closes it`, () => photoViewerCheck(page, UI.openPanel(page, BO_VALUE.code, BO_ALL), "bag-open-viewer-1440"), { shot: false });
    await s.step("plain words: no stage track, no due-date editor, no label printing", async () => {
      const main = page.locator("main").first();
      const text = await mainText(page);
      const steps = STAGES.filter((st) => new RegExp(`\\b${esc(st)}\\b`, "i").test(text));
      assert(steps.length < 3, `a stage track? (${steps.join(", ")})`);
      eq(await main.locator('input[type="date"]').count(), 0, "date inputs");
      eq(await UI.printButton(main).count(), 0, "print-label buttons");
    }, { shot: false });
    await s.step(`typed in lower case (${ROUTES.open(BO_BAG.toLowerCase())}): the same bag`, async () => {
      await goto(page, ROUTES.open(BO_BAG.toLowerCase()));
      await openReady(page);
      eq(await openPanelsShown(page), BO_PLAT, "cards with a panel");
    });
  },

  // An order QR: /q/CD-2549 -> the same page for the whole order, cards grouped per bag
  async "bag-open-order"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step("setup: as bag-open-qr (bags CD-2549-G: 01-04, CD-2549-P: 07-09; 05, 06, 10 not here yet)", async () => {
      t = await bagOpenSetup(ctx, mockUrl);
    }, { critical: true, shot: false });
    for (const url of [ROUTES.qr(BO_ORDER), ROUTES.qrUpper(BO_ORDER), ROUTES.qr(BO_ORDER.toLowerCase())]) {
      await s.step(`signed in: ${url} -> ${ROUTES.open(BO_ORDER)}`, async () => {
        const loc = await scanTarget(ctx, appUrl, url);
        eq(decodeURIComponent(loc.pathname), ROUTES.open(BO_ORDER), "redirect");
        return `${loc.pathname}${loc.search}`;
      }, { shot: false });
    }
    await s.step(`signed out: /q/${BO_ORDER.toLowerCase()} and /Q/${BO_ORDER} -> sign in with next=/q/${BO_ORDER}`, async () => {
      const anon = await browser.newContext({ baseURL: appUrl, ignoreHTTPSErrors: true });
      try {
        eq(await signInNext(anon, appUrl, ROUTES.qr(BO_ORDER.toLowerCase())), `/q/${BO_ORDER}`, "next (/q, lower case)");
        eq(await signInNext(anon, appUrl, ROUTES.qrUpper(BO_ORDER)), `/q/${BO_ORDER}`, "next (/Q)");
      } finally { await anon.close(); }
    }, { shot: false });
    await s.step(`the order code's QR (…/Q/${BO_ORDER}) in the signed-in browser lands on the page`, async () => {
      await goto(page, ROUTES.qrUpper(BO_ORDER));
      eq(decodeURIComponent(new URL(page.url()).pathname), ROUTES.open(BO_ORDER), "landed on");
      await openReady(page);
    }, { critical: true });
    await s.step(`the person: ${BO_CUSTOMER} (h1), ${BO_ORDER}, a card count, and a "Bags" list: Platinum ${BO_BAG} Due Mon Dec 7 3 cards, Gold CD-2549-G Due Mon Dec 14 4 cards`, async () => {
      const text = await mainText(page);
      const problems = [];
      const h1 = flat(await page.locator("main h1").first().innerText().catch(() => ""));
      if (!h1.includes(BO_CUSTOMER)) problems.push(`the h1 reads "${h1}"`);
      if (!orderNumberRe(BO_ORDER).test(text)) problems.push(`no order number ${BO_ORDER}`);
      const total = [10, 7].find((n) => countShown(text, n));
      if (!total) problems.push('no card count ("10 cards" or "7 cards")');
      const list = UI.openBagsList(page);
      const hasList = (await list.count()) > 0;
      if (!hasList) problems.push('no list labelled "Bags"');
      for (const [code, tier, n] of [[BO_BAG, "Platinum", 3], ["CD-2549-G", "Gold", 4]]) {
        const bag = bagByCode(t, code);
        const row = hasList ? flat(await list.locator("li").filter({ hasText: code }).first().innerText().catch(() => "")) : flat(text);
        if (!row.includes(code)) { problems.push(`no row for ${code}`); continue; }
        if (!tierShown(row, tier)) problems.push(`${code}: no tier ${tier}`);
        if (!dueRe(bag.due_date).test(row)) problems.push(`${code}: no "${dueText(bag.due_date)}"`);
        if (!new RegExp(`(^|[^0-9])${n} cards?\\b`).test(row)) problems.push(`${code}: no "${n} cards"`);
      }
      assert(!problems.length, problems.join(" | "));
      return `count "${total} cards"`;
    });
    await s.step(`the customer's notes box; "Open full order" -> /admin/orders/<id>; "All photos" -> the whole order's photos`, async () => {
      const box = page.locator("main").first().locator("section, div, aside, figure, blockquote, dl")
        .filter({ hasText: UI.openNotesTitle }).filter({ hasText: BO_NOTE })
        .filter({ hasNot: page.locator("h1") }).filter({ hasNotText: /CD-\d+-\d{2}/ });
      assert(await box.count(), `no box titled "Customer's notes" holding "${BO_NOTE}"`);
      eq(new URL(await UI.openFullOrder(page).getAttribute("href"), appUrl).pathname, ROUTES.order(IDS.mailOrder), '"Open full order"');
      const photos = new URL(await UI.openAllPhotos(page).getAttribute("href"), appUrl);
      eq([photos.pathname, photos.searchParams.get("bag")], [ROUTES.photos(IDS.mailOrder), null], '"All photos" (no ?bag=)');
    }, { shot: false });
    await s.step('"Move all 7 cards to my desk" (the cards that are here: not the 3 not here yet)', async () => {
      eq(await page.getByRole("button", { name: UI.openMoveAllRe }).count(), 1, "big move buttons");
      eq(await moveAllN(page), 7, "N");
    }, { shot: false });
    await s.step(`every card has a panel, grouped: 07-09 under "Platinum · ${BO_BAG}", 01-04 under "Gold · CD-2549-G", 05, 06, 10 under "Not in a bag" / "Not here yet"`, async () => {
      eq(await openPanelsShown(page), BO_ALL, "cards with a panel");
      const g = await groupsOf(page, BO_ALL);
      const problems = [];
      for (const code of BO_PLAT) if (!(g[code] ?? "").includes(BO_BAG) || !/platinum/i.test(g[code])) problems.push(`${code} under "${g[code]}"`);
      for (const code of BO_GOLD) if (!(g[code] ?? "").includes("CD-2549-G") || !/gold/i.test(g[code])) problems.push(`${code} under "${g[code]}"`);
      for (const code of BO_AWAY) if (!/not here yet|not in a bag/i.test(g[code] ?? "")) problems.push(`${code} under "${g[code]}"`);
      assert(!problems.length, problems.slice(0, 5).join(" | "));
      return [...new Set(Object.values(g))].join(" | ");
    });
    await s.step('05, 06, 10 read "Not here yet" with no move button; the 7 others "In the bag" with one each', async () => {
      const problems = [];
      for (const code of BO_ALL) {
        const panel = UI.openPanel(page, code, BO_ALL);
        const txt = await openPanelText(page, code);
        const moves = await panel.getByRole("button", { name: /^move\b/i }).count();
        if (BO_AWAY.includes(code)) {
          if (!UI.openWhere.away.test(txt)) problems.push(`${code}: not "Not here yet"`);
          if (moves) problems.push(`${code}: has a move button`);
        } else {
          if (!UI.openWhere.bag.test(txt)) problems.push(`${code}: not "In the bag"`);
          if (moves !== 1) problems.push(`${code}: ${moves} move buttons`);
        }
      }
      assert(!problems.length, problems.slice(0, 5).join(" | "));
    }, { shot: false });
  },

  // "Move all N cards to my desk": location only, LOC-DESK made on first use, no email; again: nothing
  async "bag-open-move-all"({ page, ctx, s, appUrl, mockUrl }) {
    await s.step(`setup: as bag-open-qr; no desk yet (${DESK} is made on first use)`, async () => {
      const t = await bagOpenSetup(ctx, mockUrl);
      assert(!placeOf(t, DESK), `${DESK} exists before anything used it`);
    }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: the 3 panels, "Move all 3 cards to my desk"`, async () => {
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      eq(await openPanelsShown(page), BO_PLAT, "cards with a panel");
      eq(await moveAllN(page), 3, "N");
    }, { critical: true });
    let before = null, tap = null;
    await s.step(`tap "Move all 3 cards to my desk": the 3 are at ${DESK} (kind other, made if missing)`, async () => {
      before = await dump();
      tap = await openTapMove(page, UI.openMoveAll(page), allAt(BO_PLAT, DESK));
      assert(tap.ok, `the 3 aren't at ${DESK} after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"}; ${tap.path ?? ""} ${tap.status ?? ""})`);
      const desk = placeOf(await tables(), DESK);
      eq([desk.kind, desk.active], ["other", true], `${DESK} kind, active`);
      return `${tap.path ?? tap.posts.join(", ")} ${tap.status ?? ""} ${JSON.stringify(tap.body ?? {}).slice(0, 160)}`;
    }, { critical: true });
    await s.step(`location only: one card_moves row each (bag -> desk, step before = after), ${BO_STEP.code} still at ${BO_STEP.stage}, no step events, the other cards untouched, no customer email`, async () => {
      return checkDeskMove(before, await dump(), BO_PLAT, DESK);
    }, { shot: false });
    await s.step(`the page says "3 cards are on your desk" with "Open my desk" -> ${ROUTES.deskAt(DESK)}`, async () => {
      const msg = (await messageSeen(page, UI.openMoved(3), 20_000)) ?? (await textSeen(page, UI.openMoved(3), 1_000));
      assert(msg, `no "3 cards are on your desk" (the page says: "${flat(await mainText(page)).slice(0, 240)}")`);
      return `"${msg.slice(0, 80)}" · ${await checkOpenMyDesk(page, appUrl, DESK)}`;
    });
    await s.step("pressing again moves nothing more: no move-all button left (or pressing it changes nothing), and the same request sent again changes nothing", async () => {
      const t0 = await dump();
      const notes = [];
      const btn = UI.openMoveAll(page);
      // the page refreshes itself after the answer (router.refresh): give the button a moment to go
      await until(async () => !(await btn.isVisible().catch(() => false)) || !(await btn.isEnabled().catch(() => true)), 15_000);
      if ((await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false))) {
        notes.push(`pressed "${await nameOf(btn)}" again`);
        await btn.click();
        await sleep(5_000);
      } else notes.push("no move-all button left");
      if (tap?.path && tap.body) {
        const r = await api(ctx, "POST", tap.path, tap.body);
        eq(r.status, 200, `the same request again: HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
        notes.push(`same request again: "${r.body?.message ?? `changed ${r.body?.changed}`}"`);
      }
      const t1 = await dump();
      eq(t1.tables.card_moves.length, t0.tables.card_moves.length, "card_moves rows");
      eq(cardsIn(t1.tables, DESK), BO_PLAT, `cards at ${DESK}`);
      eq(t1.emails.length, t0.emails.length, "emails");
      return notes.join("; ");
    }, { shot: false });
    await s.step(`reloaded: "All on your desk" + "Open my desk", no move buttons; each card "On your desk", ${BO_STEP.code} still ${BO_STEP.stage}`, async () => {
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      assert(await textSeen(page, UI.openAllThere, 15_000), `no "All on your desk": "${flat(await mainText(page)).slice(0, 240)}"`);
      await checkOpenMyDesk(page, appUrl, DESK);
      eq(await page.locator("main").first().getByRole("button", { name: /^move\b/i }).count(), 0, "move buttons");
      const problems = [];
      for (const code of BO_PLAT) if (!UI.openWhere.desk.test(await openPanelText(page, code))) problems.push(`${code}: not "On your desk"`);
      if (!new RegExp(`\\b${BO_STEP.stage}\\b`, "i").test(await openPanelText(page, BO_STEP.code))) problems.push(`${BO_STEP.code}: step not ${BO_STEP.stage}`);
      assert(!problems.length, problems.join(" | "));
    });
    await s.step(`"Open my desk" opens the Desk page (?desk=${DESK}), which lists the 3`, async () => {
      await Promise.all([page.waitForURL((u) => u.pathname === ROUTES.desk, { timeout: 240_000 }), UI.openMyDesk(page).click()]);
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      eq(new URL(page.url()).searchParams.get("desk"), DESK, "?desk=");
      eq(await waitPanels(page, BO_PLAT, BO_ALL), BO_PLAT, "cards on the Desk page");
    });
  },

  // A card's own "Move to my desk": only that card; the big button then counts the rest
  async "bag-open-move-one"({ page, ctx, s, mockUrl }) {
    const ONE = "CD-2549-08";
    const REST = BO_PLAT.filter((c) => c !== ONE);
    let t = null;
    await s.step("setup: as bag-open-qr", async () => { t = await bagOpenSetup(ctx, mockUrl); }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: the 3 panels, "Move all 3 cards to my desk"`, async () => {
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      eq(await openPanelsShown(page), BO_PLAT, "cards with a panel");
      eq(await moveAllN(page), 3, "N");
    }, { critical: true });
    await s.step(`${ONE}'s "Move to my desk": only ${ONE} goes to ${DESK} (location only, no email)`, async () => {
      const before = await dump();
      const tap = await openTapMove(page, UI.openMoveOne(UI.openPanel(page, ONE, BO_ALL)), allAt([ONE], DESK));
      assert(tap.ok, `${ONE} isn't at ${DESK} after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"})`);
      if (Array.isArray(tap.body?.cardIds)) eq(tap.body.cardIds, [cardIdOf(t, ONE)], "cardIds sent");
      return checkDeskMove(before, await dump(), [ONE], DESK);
    }, { critical: true });
    await s.step(`${ONE}'s panel says "On your desk" with no move button; ${REST.join(", ")} still "In the bag" with theirs`, async () => {
      const ok = await until(async () => UI.openWhere.desk.test(await openPanelText(page, ONE).catch(() => "")), 20_000);
      assert(ok, `${ONE} doesn't say "On your desk": "${(await openPanelText(page, ONE).catch(() => "")).slice(0, 200)}"`);
      eq(await UI.openPanel(page, ONE, BO_ALL).getByRole("button", { name: /^move\b/i }).count(), 0, `${ONE} move buttons`);
      const problems = [];
      for (const code of REST) {
        if (!UI.openWhere.bag.test(await openPanelText(page, code))) problems.push(`${code}: not "In the bag"`);
        if (!(await UI.openMoveOne(UI.openPanel(page, code, BO_ALL)).count())) problems.push(`${code}: no move button`);
      }
      assert(!problems.length, problems.join(" | "));
    });
    await s.step('the big button counts 2 ("Move all 2 cards to my desk") with "1 already on your desk"; the same after a reload', async () => {
      assert(await until(async () => (await moveAllN(page)) === 2, 20_000), `N is ${await moveAllN(page)}`);
      assert(await textSeen(page, UI.openAlready(1), 5_000), 'no "1 already on your desk"');
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      eq(await moveAllN(page), 2, "N after a reload");
      assert(await textSeen(page, UI.openAlready(1), 10_000), 'no "1 already on your desk" after a reload');
    });
  },

  // A card in a holder (CLAMP 07) goes to the desk from there: the holder is freed, the step stays
  async "bag-open-from-holder"({ page, ctx, s, mockUrl }) {
    const C = BO_STEP.code;
    let t = null;
    await s.step(`setup: as bag-open-qr; CLAMP 01..07 made; ${C} put in CLAMP 07 (step Clamp Work)`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await bulkSlots(ctx, "clamp", 7);
      await assignOk(ctx, "LOC-CLAMP-07", [cardIdOf(t, C)]);
      t = await tables();
      eq(cardsIn(t, "LOC-CLAMP-07"), [C], "cards in CLAMP 07");
      eq(latestStage(t, cardIdOf(t, C)), "Clamp Work", `${C} step`);
    }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: ${C} reads "In CLAMP 07" (step Clamp Work) with its "Move to my desk"; the big button counts it ("Move all 3 cards")`, async () => {
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      eq(await openPanelsShown(page), BO_PLAT, "cards with a panel");
      const txt = await openPanelText(page, C);
      assert(UI.openWhere.holder("CLAMP 07").test(txt), `${C} doesn't say "In CLAMP 07": "${txt.slice(0, 200)}"`);
      assert(/\bclamp work\b/i.test(txt), `${C}: no step Clamp Work`);
      assert(await UI.openMoveOne(UI.openPanel(page, C, BO_ALL)).count(), `${C}: no move button`);
      eq(await moveAllN(page), 3, "N");
    }, { critical: true });
    await s.step(`${C}'s "Move to my desk": at ${DESK}, CLAMP 07 freed, step still Clamp Work, one row CLAMP 07 -> desk; no email`, async () => {
      const before = await dump();
      const tap = await openTapMove(page, UI.openMoveOne(UI.openPanel(page, C, BO_ALL)), allAt([C], DESK));
      assert(tap.ok, `${C} isn't at ${DESK} after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"})`);
      const after = await dump();
      const r = checkDeskMove(before, after, [C], DESK);
      eq(cardsIn(after.tables, "LOC-CLAMP-07"), [], "cards in CLAMP 07");
      eq(latestStage(after.tables, cardIdOf(after.tables, C)), "Clamp Work", `${C} step`);
      const row = after.tables.card_moves.filter((m) => m.card_id === cardIdOf(after.tables, C)).at(-1);
      eq(row?.from_location_id, placeOf(after.tables, "LOC-CLAMP-07").id, "the row's from (CLAMP 07)");
      return `${tap.path ?? ""} ${r}`;
    }, { critical: true });
    await s.step(`${C}'s panel says "On your desk", no longer "In CLAMP 07"`, async () => {
      const ok = await until(async () => UI.openWhere.desk.test(await openPanelText(page, C).catch(() => "")), 20_000);
      const txt = await openPanelText(page, C);
      assert(ok, `doesn't say "On your desk": "${txt.slice(0, 200)}"`);
      assert(!UI.openWhere.holder("CLAMP 07").test(txt), 'still says "In CLAMP 07"');
    });
  },

  // Done, refunded and not-arrived cards: shown, no move button, not counted
  async "bag-open-states"({ page, ctx, s, mockUrl }) {
    const DONE = "CD-2549-02", REFUNDED = "CD-2549-03";
    const FIVE = ["CD-2549-01", "CD-2549-04", ...BO_PLAT];
    let t = null;
    await s.step(`setup: as bag-open-qr; ${DONE} marked done (POST done: back in its bag, no place), ${REFUNDED} refunded (in the mock); 05, 06, 10 not here yet`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, DONE)] });
      await mockUpdate(mockUrl, "cards", { status: "refunded" }, "card_code", REFUNDED);
      t = await tables();
      eq([cardByCode(t, DONE).completed, cardByCode(t, DONE).location_id ?? null], [true, null], `${DONE} done, in its bag (no place)`);
    }, { critical: true, shot: false });
    // The count reads "N of M done" once a card is done (done flow, Nov 25 2026): "1 of 3 done" here, the refunded card not counted
    await s.step(`bag CD-2549-G: 4 panels; ${DONE} "Done" and ${REFUNDED} "Refunded" without a move button; 01, 04 "In the bag" with one; "Move all 2 cards to my desk"; "1 of 3 done" (refunded not counted)`, async () => {
      await goto(page, ROUTES.open("CD-2549-G"));
      await openReady(page);
      eq(await openPanelsShown(page), BO_GOLD, "cards with a panel");
      const problems = [];
      const state = { [DONE]: ["Done", UI.openWhere.done], [REFUNDED]: ["Refunded", UI.openWhere.refunded] };
      for (const code of BO_GOLD) {
        const panel = UI.openPanel(page, code, BO_ALL);
        const txt = await openPanelText(page, code);
        const moves = await panel.getByRole("button", { name: /^move\b/i }).count();
        if (state[code]) {
          if (!state[code][1].test(txt)) problems.push(`${code}: not "${state[code][0]}"`);
          if (moves) problems.push(`${code}: has a move button`);
        } else {
          if (!UI.openWhere.bag.test(txt)) problems.push(`${code}: not "In the bag"`);
          if (moves !== 1) problems.push(`${code}: ${moves} move buttons`);
        }
      }
      if ((await moveAllN(page)) !== 2) problems.push(`N is ${await moveAllN(page)}`);
      if (!UI.doneCount(1, 3).test((await mainText(page)).split(/cards in this bag/i)[0])) problems.push('no "1 of 3 done" (the refunded card not counted)');
      assert(!problems.length, problems.slice(0, 5).join(" | "));
      // "shown greyed": reported, not asserted (how a panel is greyed is the page's choice)
      const look = async (code) => UI.openPanel(page, code, BO_ALL).evaluate((el) => { const st = getComputedStyle(el); return `opacity ${st.opacity}, filter ${st.filter}, bg ${st.backgroundColor}`; }).catch(() => "?");
      return `${DONE}: ${await look(DONE)}; CD-2549-01: ${await look("CD-2549-01")}`;
    });
    await s.step(`order ${BO_ORDER}: 05, 06, 10 "Not here yet" and ${DONE}, ${REFUNDED} without a move button; "Move all 5 cards to my desk"`, async () => {
      await goto(page, ROUTES.open(BO_ORDER));
      await openReady(page);
      eq(await openPanelsShown(page), BO_ALL, "cards with a panel");
      const problems = [];
      for (const code of [...BO_AWAY, DONE, REFUNDED]) {
        if (await UI.openPanel(page, code, BO_ALL).getByRole("button", { name: /^move\b/i }).count()) problems.push(`${code}: has a move button`);
        if (BO_AWAY.includes(code) && !UI.openWhere.away.test(await openPanelText(page, code))) problems.push(`${code}: not "Not here yet"`);
      }
      if ((await moveAllN(page)) !== 5) problems.push(`N is ${await moveAllN(page)}`);
      assert(!problems.length, problems.slice(0, 5).join(" | "));
    }, { critical: true });
    await s.step(`tap "Move all 5 cards to my desk": only ${FIVE.join(", ")} go to ${DESK}; ${DONE} stays done in its bag, ${REFUNDED} and the 3 not here stay put; no email`, async () => {
      const before = await dump();
      const tap = await openTapMove(page, UI.openMoveAll(page), allAt(FIVE, DESK));
      assert(tap.ok, `the 5 aren't at ${DESK} after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"})`);
      if (Array.isArray(tap.body?.cardIds)) eq(sorted(tap.body.cardIds), sorted(FIVE.map((c) => cardIdOf(t, c))), "cardIds sent (the 5 only)");
      const after = await dump();
      const r = checkDeskMove(before, after, FIVE, DESK);
      const d = cardByCode(after.tables, DONE);
      eq([d.completed, d.location_id ?? null], [true, null], `${DONE} done, in its bag (no place)`);
      eq(cardByCode(after.tables, REFUNDED).status, "refunded", `${REFUNDED} status`);
      return r;
    }, { critical: true });
    await s.step('"5 cards are on your desk"; reloaded: "All on your desk", no move buttons, the done / refunded / not-here cards as before', async () => {
      const msg = (await messageSeen(page, UI.openMoved(5), 20_000)) ?? (await textSeen(page, UI.openMoved(5), 1_000));
      assert(msg, `no "5 cards are on your desk": "${flat(await mainText(page)).slice(0, 240)}"`);
      await goto(page, ROUTES.open(BO_ORDER));
      await openReady(page);
      assert(await textSeen(page, UI.openAllThere, 15_000), `no "All on your desk": "${flat(await mainText(page)).slice(0, 240)}"`);
      eq(await page.locator("main").first().getByRole("button", { name: /^move\b/i }).count(), 0, "move buttons");
      const problems = [];
      for (const code of FIVE) if (!UI.openWhere.desk.test(await openPanelText(page, code))) problems.push(`${code}: not "On your desk"`);
      if (!UI.openWhere.done.test(await openPanelText(page, DONE))) problems.push(`${DONE}: not "Done"`);
      if (!UI.openWhere.refunded.test(await openPanelText(page, REFUNDED))) problems.push(`${REFUNDED}: not "Refunded"`);
      for (const code of BO_AWAY) if (!UI.openWhere.away.test(await openPanelText(page, code))) problems.push(`${code}: not "Not here yet"`);
      assert(!problems.length, problems.slice(0, 5).join(" | "));
    });
  },

  // Several desks: a "Desk" picker; choosing DESK GAVIN moves the cards there (and is remembered)
  async "bag-open-desks"({ page, ctx, s, appUrl, mockUrl }) {
    await s.step(`setup: as bag-open-qr; two desks: ${DESK} (as the Desk page makes it) and ${BO_GAVIN.name} (${BO_GAVIN.code}, as Places adds it)`, async () => {
      await bagOpenSetup(ctx, mockUrl);
      await ensureDesk(ctx);
      const r = await api(ctx, "POST", ROUTES.trackLocations(), { name: BO_GAVIN.name, kind: "other" });
      assert([200, 201].includes(r.status), `add ${BO_GAVIN.name}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      eq(r.body?.location?.code, BO_GAVIN.code, "code");
    }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: a "Desk" picker offering DESK and ${BO_GAVIN.name} (DESK picked at first); "Move all 3 cards to my desk"`, async () => {
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      const sel = UI.openDeskPicker(page);
      eq(await sel.count(), 1, '"Desk" pickers');
      const labels = (await sel.first().locator("option").allTextContents()).map(flat);
      assert(labels.some((l) => /^desk$/i.test(l)) && labels.some((l) => l.toUpperCase() === BO_GAVIN.name), `options: ${labels.join(", ")}`);
      eq((await pickedDesk(page)).toUpperCase(), "DESK", "picked at first");
      eq(await moveAllN(page), 3, "N");
      return labels.join(", ");
    }, { critical: true });
    await s.step(`pick ${BO_GAVIN.name}, tap "Move all 3 cards to my desk": the 3 go to ${BO_GAVIN.code}, none to ${DESK}; location only, no email`, async () => {
      await chooseDesk(page, BO_GAVIN.name);
      assert(await until(async () => (await pickedDesk(page)).toUpperCase() === BO_GAVIN.name, 5_000), `picked: ${await pickedDesk(page)}`);
      eq(await moveAllN(page), 3, `N with ${BO_GAVIN.name} picked`);
      const before = await dump();
      const tap = await openTapMove(page, UI.openMoveAll(page), allAt(BO_PLAT, BO_GAVIN.code));
      assert(tap.ok, `the 3 aren't at ${BO_GAVIN.code} after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"}; sent ${JSON.stringify(tap.body ?? {}).slice(0, 120)})`);
      if (tap.body && "locationCode" in tap.body) eq(tap.body.locationCode, BO_GAVIN.code, "locationCode sent");
      const after = await dump();
      eq(cardsIn(after.tables, DESK), [], `cards at ${DESK}`);
      return checkDeskMove(before, after, BO_PLAT, BO_GAVIN.code);
    }, { critical: true });
    await s.step(`"3 cards are on your desk", "Open my desk" -> ${ROUTES.deskAt(BO_GAVIN.code)}`, async () => {
      const msg = (await messageSeen(page, UI.openMoved(3), 20_000)) ?? (await textSeen(page, UI.openMoved(3), 1_000));
      assert(msg, `no "3 cards are on your desk": "${flat(await mainText(page)).slice(0, 240)}"`);
      return checkOpenMyDesk(page, appUrl, BO_GAVIN.code);
    });
    await s.step(`reloaded: the picker still says ${BO_GAVIN.name} (remembered on this phone); "All on your desk", "Open my desk" -> ?desk=${BO_GAVIN.code}`, async () => {
      await goto(page, ROUTES.open(BO_BAG));
      await openReady(page);
      const kept = await until(async () => ((await pickedDesk(page).catch(() => "")).toUpperCase() === BO_GAVIN.name), 10_000);
      assert(kept, `the picker says "${await pickedDesk(page).catch(() => "?")}" after a reload`);
      assert(await textSeen(page, UI.openAllThere, 15_000), `no "All on your desk": "${flat(await mainText(page)).slice(0, 240)}"`);
      return checkOpenMyDesk(page, appUrl, BO_GAVIN.code);
    });
    await s.step(`picking DESK: the cards read "On ${BO_GAVIN.name}" and the button counts them again ("Move all 3 cards to my desk")`, async () => {
      await chooseDesk(page, "DESK");
      assert(await until(async () => (await moveAllN(page)) === 3, 10_000), `N is ${await moveAllN(page)} with DESK picked`);
      const problems = [];
      for (const code of BO_PLAT) if (!UI.openWhere.otherDesk(BO_GAVIN.name).test(await openPanelText(page, code))) problems.push(`${code}: not "On ${BO_GAVIN.name}"`);
      assert(!problems.length, problems.join(" | "));
    });
    await s.step(`the Desk page ?desk=${BO_GAVIN.code} lists the 3`, async () => {
      await goto(page, ROUTES.deskAt(BO_GAVIN.code));
      eq(await waitPanels(page, BO_PLAT, BO_ALL), BO_PLAT, "cards on DESK GAVIN");
    });
  },

  // A code that isn't a bag or an order of ours: the plain "not found"
  async "bag-open-unknown"({ page, ctx, s, mockUrl }) {
    await s.step("setup: as bag-open-qr (CD-2549 has bags G and P)", () => bagOpenSetup(ctx, mockUrl).then(() => ""), { critical: true, shot: false });
    for (const [code, what] of [
      ["CD-0000-99", "an order number nobody has"],
      ["CD-2549-Z", "a Bag ID that doesn't exist"],
      ["CD-2549-S", "a bag CD-2549 doesn't have (its Silver cards aren't here)"],
      ["HELLO", "not a code"],
      ["CD-2549-01", "a Card ID (cards keep their own page)"],
      ["LOC-CLAMP-01", "a place code"],
    ]) {
      await s.step(`${ROUTES.open(code)} (${what}): "Code not found", nothing of the order, no move button`, async () => `HTTP ${await checkNotFoundPage(page, ROUTES.open(code))}`);
    }
    await s.step("/q/CD-0000-99 (an unknown code scanned): 404 Code not found", async () => {
      const res = await ctx.request.get(ROUTES.qr("CD-0000-99"), { failOnStatusCode: false, maxRedirects: 0 });
      eq(res.status(), 404, "HTTP");
      assert(UI.openNotFound.test(await res.text()), 'no "Code not found"');
    }, { shot: false });
  },

  // Phone first: 390 px and 1440 px, no sideways scroll, the big button on the first screen
  async "bag-open-layout"({ page, ctx, s, browser, appUrl, mockUrl }) {
    await s.step("setup: as bag-open-qr", () => bagOpenSetup(ctx, mockUrl).then(() => ""), { critical: true, shot: false });
    for (const [code, label, n] of [[BO_BAG, "bag", 3], [BO_ORDER, "order", 7]]) {
      await s.step(`1440 px, the ${label} page (${code}): no sideways scroll, "Move all ${n} cards to my desk" on screen unscrolled; bag-open-1440-${label}.png`, async () => {
        await goto(page, ROUTES.open(code));
        await openReady(page);
        await page.screenshot({ path: path.join(OUT, `bag-open-1440-${label}.png`), fullPage: true });
        const w = await sidewaysScroll(page);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        eq(await moveAllN(page), n, "N");
        const b = await onScreenUnscrolled(page, UI.openMoveAll(page));
        assert(b.top >= 0 && b.bottom <= b.vh && !b.covered, `the button is at ${b.top}-${b.bottom}px of ${b.vh}px${b.covered ? ", covered" : ""}`);
        return `button ${b.width}x${b.height} at y ${b.top}`;
      }, { shot: false });
      await s.step(`390 px (iPhone 13), the ${label} page: no sideways scroll; "Move all ${n} cards to my desk" fully on the first screen, not covered, 44+ px tall${label === "bag" ? "; a photo opens full screen" : ""}; bag-open-390-${label}.png`, async () => {
        const phone = await phoneContext(browser, appUrl);
        try {
          await goto(phone.page, ROUTES.open(code));
          await openReady(phone.page);
          await phone.page.screenshot({ path: path.join(OUT, `bag-open-390-${label}.png`), fullPage: true });
          await phone.page.screenshot({ path: path.join(OUT, `bag-open-390-${label}-first-screen.png`) });
          const w = await sidewaysScroll(phone.page);
          assert(w <= 1, `scrolls sideways by ${w}px`);
          const b = await onScreenUnscrolled(phone.page, UI.openMoveAll(phone.page));
          assert(b.top >= 0 && b.bottom <= b.vh, `the button is at ${b.top}-${b.bottom}px on a ${b.vh}px screen: it needs a scroll`);
          assert(!b.covered, "the button is covered (a sticky bar?)");
          assert(b.height >= 44, `the button is ${b.height}px tall`);
          let note = `button ${b.width}x${b.height} at y ${b.top}-${b.bottom} of ${b.vh}`;
          if (label === "bag") note += `; ${await photoViewerCheck(phone.page, UI.openPanel(phone.page, BO_VALUE.code, BO_ALL), "bag-open-viewer-390")}`;
          const w2 = await sidewaysScroll(phone.page);
          assert(w2 <= 1, `scrolls sideways by ${w2}px (after the viewer)`);
          assert(!phone.errors.length, `browser errors: ${phone.errors.slice(0, 3).join(" | ").slice(0, 300)}`);
          return note;
        } finally {
          await phone.ctx.close();
        }
      }, { shot: false });
    }
  },
};

// ─── Print labels for any order (labels-any-*: the owner's request of Nov 24) ─────
// One "Print labels" action for ANY order (contract: lib/intake/prepare-labels.ts): an order whose
// cards are in the shop gets its unbagged cards bagged (tiers filled: card -> order -> signed
// checkout record -> price paid -> ask once), with no status change and no customer email; an
// Awaiting Cards order asks "Cards arrived? Receive all and print" (the normal receive); an unpaid
// order gets no working button. The orders are extra seed rows (seed.mjs buildLabelsAnySeed),
// inserted after each reset by seedLabelsAny().
const LA = LABELS_ANY_IDS;
const LAN = LABELS_ANY_ORDER_NUMBERS;
const LAC = LABELS_ANY_CUSTOMERS;
const LA_RECEIVED_EVENT = "Status updated to: Cards Received";
/** Bag ID letters and the fastest-first order (lib/intake/codes.ts TIER_LETTERS / TIER_ORDER), kept independent of the app. */
const LA_TIER_LETTER = { fast_pass: "F", elite: "D", ultra_premium: "P", premium: "G", expedited: "S", regular: "B", prep: "R" };
const LA_FASTEST_FIRST = ["fast_pass", "elite", "ultra_premium", "premium", "expedited", "regular", "prep"];
const LA_RESTORATION_TIERS = ["regular", "expedited", "premium", "ultra_premium", "elite", "fast_pass"];

/**
 * Puts the labels-any orders (CD-2470 in shop, CD-2480 signed, CD-2490 unknown tier, CD-2610
 * awaiting, CD-2620 unpaid) into the running mock, once per reset. Exported for a harness
 * started by hand: HARNESS_MOCK_URL=… node --input-type=module -e "await (await
 * import('./tests/intake/e2e/scenarios.mjs')).seedLabelsAny()".
 */
export async function seedLabelsAny() {
  const t = await tables();
  if (t.orders.some((o) => o.id === LA.inShopOrder)) return false;
  for (const [table, rows] of Object.entries(buildLabelsAnySeed().tables)) if (rows.length) await insertRows(table, rows);
  return true;
}
/** Setup step shared by the labels-any scenarios: the extra orders are there, none bagged yet. */
async function laSetup(s) {
  await s.step("setup: the labels-any orders are in the mock (CD-2470, CD-2480, CD-2490, CD-2610, CD-2620), none in a bag", async () => {
    await seedLabelsAny();
    const t = await tables();
    for (const [key, num] of Object.entries(LAN)) {
      const o = t.orders.find((x) => x.id === LA[key]);
      assert(o?.order_number === num, `${num} not in the mock`);
      eq(bagsOf(t, o.id).length, 0, `${num} bags`);
    }
    return Object.values(LAN).join(", ");
  }, { critical: true, shot: false });
}

/** What the labels-any checks compare for one order: status, bags, cards, events and the customer's emails. */
function laState(d, orderId, email) {
  const t = d.tables;
  const evs = t.order_events.filter((e) => e.order_id === orderId);
  return {
    status: t.orders.find((o) => o.id === orderId)?.status ?? null,
    bags: bagsOf(t, orderId).map((b) => ({ id: b.id, code: b.bag_code, tier: b.tier, received_on: b.received_on })).sort((a, b) => a.code.localeCompare(b.code)),
    cards: cardsOf(t, orderId).map((c) => ({ id: c.id, tier: c.tier, bag_id: c.bag_id, received: !!c.received_at, awaiting: !!c.awaiting_arrival })).sort((a, b) => a.id.localeCompare(b.id)),
    events: evs.length,
    visibleEvents: evs.filter((e) => e.is_customer_visible).length,
    statusEvents: evs.filter((e) => e.event_type === "status_updated").length,
    receivedEvents: evs.filter((e) => e.description === LA_RECEIVED_EVENT).length,
    stageEvents: evs.filter((e) => e.event_type === "stage_update").length,
    customerEmails: mailsTo(d.emails, email).length,
  };
}
/** Nothing about the order changed since `before` (a refused request writes nothing). */
async function laUnchanged(before, orderId, email, what) {
  eq(laState(await dump(), orderId, email), before, `${what}: order, bags, cards, events, emails`);
}

/** GET the plan (PreparePlan); fails unless it is one. */
async function laPlan(ctx, orderId) {
  const r = await api(ctx, "GET", ROUTES.prepareLabelsApi(orderId));
  assert(r.status === 200 && r.body && typeof r.body.mode === "string", `GET prepare-labels: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  return r.body;
}
const laPost = (ctx, orderId, data = {}) => api(ctx, "POST", ROUTES.prepareLabelsApi(orderId), data);
/** A 200 PrepareResponse, or the step fails with what came back. */
function laPrepared(r, what = "POST prepare-labels") {
  assert(r.status === 200 && r.body?.ok === true && Array.isArray(r.body.bags), `${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 240)}`);
  return r.body;
}
/** The bags expected for these cards and tiers: one per tier, Bag ID <order>-<letter> (batch 1), fastest tier first. */
function laExpectedBags(orderNumber, cardIds, tiers) {
  const by = new Map();
  cardIds.forEach((id, i) => { if (!by.has(tiers[i])) by.set(tiers[i], []); by.get(tiers[i]).push(id); });
  return [...by.entries()]
    .sort(([a], [b]) => LA_FASTEST_FIRST.indexOf(a) - LA_FASTEST_FIRST.indexOf(b))
    .map(([tier, ids]) => ({ tier, code: `${orderNumber}-${LA_TIER_LETTER[tier]}`, cardIds: ids }));
}
/** The answer's bags against the expected ones: [code, tier, cardCount], in the answer's (fastest-first) order. */
function laCheckAnswerBags(body, orderNumber, cardIds, tiers) {
  eq(body.bags.map((b) => [b.code, b.tier, b.cardCount]), laExpectedBags(orderNumber, cardIds, tiers).map((w) => [w.code, w.tier, w.cardIds.length]), "bags in the answer (fastest tier first)");
  return body.bags.map((b) => `${b.code} (${b.cardCount})`).join(", ");
}
/**
 * The order's cards are bagged: one bag per tier (Bag ID <order>-<letter>, received `receivedOn`),
 * each card in its tier's bag and received, its tier written to cards.tier, Card IDs <order>-01…
 */
function laCheckBagged(t, orderId, orderNumber, cardIds, tiers, receivedOn) {
  const want = laExpectedBags(orderNumber, cardIds, tiers);
  const bags = bagsOf(t, orderId);
  eq(bags.map((b) => b.bag_code).sort(), want.map((w) => w.code).sort(), "Bag IDs");
  for (const w of want) {
    const bag = bags.find((b) => b.bag_code === w.code);
    eq(bag.tier, w.tier, `${w.code} tier`);
    eq(bag.received_on, receivedOn, `${w.code} received_on`);
    eq(t.cards.filter((c) => c.bag_id === bag.id).map((c) => c.id).sort(), [...w.cardIds].sort(), `${w.code} cards`);
  }
  cardIds.forEach((cid, i) => {
    const c = t.cards.find((x) => x.id === cid);
    eq(c.tier, tiers[i], `${c.card_name}: cards.tier`);
    assert(c.received_at && !c.awaiting_arrival, `${c.card_name}: not received (received_at ${c.received_at}, awaiting_arrival ${c.awaiting_arrival})`);
  });
  const codes = cardIds.map((cid) => t.cards.find((x) => x.id === cid).card_code);
  eq(codes, cardIds.map((_, i) => `${orderNumber}-${nn(i + 1)}`), "Card IDs");
  return want.map((w) => {
    const b = bags.find((x) => x.bag_code === w.code);
    return `${w.code} (${w.cardIds.length}) received ${b.received_on}, due ${b.due_date ?? "-"} ${b.due_status}`;
  }).join("; ");
}
/** Every bag of the order has label_printed_at (the print stamps it), waiting up to `ms`. */
async function laStamped(orderId, ms = 10_000) {
  const t = await until(async () => { const x = await tables(); const b = bagsOf(x, orderId); return b.length && b.every((y) => y.label_printed_at) ? x : null; }, ms);
  const bags = bagsOf(t ?? (await tables()), orderId);
  assert(t, `not marked printed: ${bags.filter((b) => !b.label_printed_at).map((b) => b.bag_code).join(", ")}`);
  return bags.map((b) => `${b.bag_code} ${b.label_printed_at}`).join(", ");
}

// ─── Printing in the browser: what a tap opened ───
/**
 * Records what print taps do in a browser context: new tabs, downloads, GETs of the label routes
 * (/api/admin/intake/labels/…), and window.open / navigator.share calls (wrapped, never replaced).
 * Call before the page loads (the wrapper is an init script).
 */
async function watchPrints(ctx) {
  await ctx.addInitScript(() => {
    const log = (window.__harnessPrints = []);
    const open = window.open;
    window.open = function (...args) { log.push({ kind: "open", url: String(args[0] ?? ""), at: Date.now() }); return open.apply(window, args); };
    if (typeof navigator.share === "function") {
      const share = navigator.share.bind(navigator);
      navigator.share = (data) => { log.push({ kind: "share", files: (data?.files ?? []).map((f) => f.name), at: Date.now() }); return share(data); };
    }
  });
  const w = { requests: [], pages: [], downloads: [] };
  const onDownload = (d) => w.downloads.push({ name: d.suggestedFilename(), url: d.url(), download: d, at: Date.now() });
  for (const p of ctx.pages()) p.on("download", onDownload);
  ctx.on("page", (p) => { w.pages.push({ page: p, at: Date.now() }); p.on("download", onDownload); });
  ctx.on("request", (r) => { if (r.method() === "GET" && r.url().includes("/api/admin/intake/labels/")) w.requests.push({ url: r.url(), at: Date.now() }); });
  return w;
}
/** Every sign of printing since `t0`: { kind: open | share | tab | download | get, url?, text }. */
async function printsSince(page, w, t0) {
  const calls = await page.evaluate(() => window.__harnessPrints ?? []).catch(() => []);
  const short = (u) => String(u).replace(/^https?:\/\/[^/]+/, "");
  return [
    ...calls.filter((c) => c.at >= t0).map((c) => (c.kind === "open" ? { kind: "open", url: c.url, text: `window.open ${short(c.url)}` } : { kind: "share", text: `share sheet: ${c.files.join(", ")}` })),
    ...w.pages.filter((p) => p.at >= t0).map((p) => ({ kind: "tab", url: p.page.url(), text: `new tab ${short(p.page.url())}` })),
    ...w.downloads.filter((d) => d.at >= t0).map((d) => ({ kind: "download", url: d.url, name: d.name, download: d.download, text: `download ${d.name}` })),
    ...w.requests.filter((r) => r.at >= t0).map((r) => ({ kind: "get", url: r.url, text: `GET ${short(r.url)}` })),
  ];
}
/**
 * The first tap: marks the button's surroundings (to find the print button it leaves there), taps
 * it and waits for the POST to prepare-labels. Returns { status, body, request }.
 */
async function tapPrepare(page, button) {
  await button.evaluate((el) => {
    document.querySelectorAll("[data-harness-print]").forEach((n) => n.removeAttribute("data-harness-print"));
    let n = el;
    for (let i = 0; i < 2 && n.parentElement && n.parentElement !== document.body; i++) n = n.parentElement;
    n.setAttribute("data-harness-print", "");
  });
  const res = await clickForApi(page, button, "/prepare-labels");
  let body = null;
  let request = null;
  try { body = await res.json(); } catch { /* not json */ }
  try { request = res.request().postDataJSON(); } catch { /* no body */ }
  return { status: res.status(), body, request };
}
/**
 * The second tap: the print button the first one left (in a dialog, where the first button was,
 * else the page's first), then waits for a sign of printing. Returns { name, signs }.
 */
async function tapPrint(page, w) {
  const scopes = [page.getByRole("dialog"), page.locator("[data-harness-print]"), page.locator("main").first(), page.locator("body")];
  // "Print 2 labels" first; a plain "Print labels" only after 8 s (it may be the first button, not yet re-rendered)
  const t1 = Date.now();
  const btn = await until(async () => {
    const any = Date.now() - t1 > 8_000;
    for (const sc of scopes) {
      for (const loc of any ? [UI.printCounted(sc), UI.printPrepared(sc)] : [UI.printCounted(sc)]) {
        const b = loc.first();
        if (await b.isVisible().catch(() => false)) return b;
      }
    }
    return null;
  }, 25_000);
  assert(btn, "no print button after the first tap (looked for \"Print 2 labels\" / \"Print labels\" / \"Print all 2 labels\")");
  const name = (await btn.innerText()).replace(/\s+/g, " ").trim();
  assert(await waitEnabled(btn, 30_000), `"${name}" stays disabled`);
  const t0 = Date.now();
  await btn.click();
  const signs = await until(async () => { const x = await printsSince(page, w, t0); return x.length ? x : null; }, 20_000);
  assert(signs, `tapped "${name}": no new tab, download, share sheet or label request followed`);
  await page.waitForTimeout(1_500);
  return { name, signs: await printsSince(page, w, t0) };
}
/** What the print opened holds the order's labels: the PDF (one page per bag), the label JSON (one entry per bag) or one picture per bag. */
async function checkPrintOutput(ctx, printed, nBags) {
  const what = printed.signs.map((x) => x.text).slice(0, 3).join("; ");
  const labelUrl = (u) => !!u && /\/api\/admin\/intake\/labels\/(order|bag)\//.test(u);
  const pdfUrl = printed.signs.map((x) => x.url).find((u) => labelUrl(u) && !/format=json/.test(u));
  if (pdfUrl) {
    const doc = await labelPdf(ctx, pdfUrl);
    eq(doc.getPageCount(), nBags, `pages of ${pdfUrl.replace(/^https?:\/\/[^/]+/, "")} (one per bag)`);
    return `"${printed.name}": ${what}; PDF ${doc.getPageCount()} page(s)`;
  }
  const pdfDownload = printed.signs.find((x) => x.kind === "download" && /\.pdf$/i.test(x.name ?? ""));
  if (pdfDownload) {
    const doc = await PDFDocument.load(fs.readFileSync(await pdfDownload.download.path()));
    eq(doc.getPageCount(), nBags, `pages of the downloaded ${pdfDownload.name} (one per bag)`);
    return `"${printed.name}": ${what}; PDF ${doc.getPageCount()} page(s)`;
  }
  const jsonUrl = printed.signs.map((x) => x.url).find((u) => labelUrl(u) && /format=json/.test(u));
  if (jsonUrl) {
    const body = await labelJson(ctx, jsonUrl);
    eq((body.bags ?? []).length, nBags, "bags in the label pictures' JSON (one per bag)");
    const pictures = printed.signs.filter((x) => x.kind === "download").length;
    return `"${printed.name}": ${what}; ${nBags} label(s) as pictures${pictures ? `, ${pictures} downloaded` : ""}`;
  }
  return `"${printed.name}": ${what}`;
}

// ─── The tier question (one per group of cards with no tier; the guess preselected) ───
/** What a tier control shows now: { kind, value, text } (text: the choice shown, a placeholder or ''). */
function readTierControl(loc) {
  return loc.evaluate((el) => {
    if (el.tagName === "SELECT") {
      const o = el.selectedOptions[0];
      return { kind: "select", value: el.value, text: (o?.textContent ?? "").trim() };
    }
    if (el.getAttribute("role") === "radiogroup") {
      const r = el.querySelector("[role='radio'][aria-checked='true'], input[type='radio']:checked");
      const text = r ? (r.getAttribute("aria-label") || r.closest("label")?.textContent || r.textContent || "") : "";
      return { kind: "radio", value: r?.getAttribute("value") ?? r?.getAttribute("data-value") ?? "", text: text.trim() };
    }
    return { kind: "combobox", value: el.getAttribute("data-value") ?? "", text: (el.textContent ?? "").trim() };
  });
}
const tierWord = (tier) => new RegExp(`\\b${esc(TIER_NAMES[tier])}\\b`, "i");
const controlShows = (ctl, tier) => ctl.value === tier || tierWord(tier).test(ctl.text);
const controlShowsNone = (ctl) => !LA_RESTORATION_TIERS.some((t) => controlShows(ctl, t));
/** Picks a tier in a tier control (a <select> option by value or name, a radio, or a combobox option). */
async function setTierControl(page, loc, tier) {
  const { kind } = await readTierControl(loc);
  if (kind === "select") {
    const value = await loc.evaluate((el, [key, name]) => [...el.options].find((o) => o.value === key || new RegExp(`\\b${name}\\b`, "i").test(o.textContent ?? ""))?.value ?? null, [tier, TIER_NAMES[tier]]);
    assert(value != null, `no ${TIER_NAMES[tier]} option in the tier list`);
    await loc.selectOption(value);
  } else if (kind === "radio") {
    await loc.getByRole("radio", { name: tierWord(tier) }).first().click();
  } else {
    await loc.click();
    await page.getByRole("option", { name: tierWord(tier) }).first().click();
  }
}
/** The visible tier controls in a scope, each with what it shows. */
async function tierControlsIn(scope) {
  const out = [];
  for (const loc of await UI.tierControls(scope).all()) if (await loc.isVisible().catch(() => false)) out.push({ loc, ...(await readTierControl(loc)) });
  return out;
}

/**
 * The Awaiting Cards tap: the button ("Print labels", or "Cards arrived? Receive all and print"
 * itself), then the question it asks ("Cards arrived?" with "Receive all and print", in a dialog
 * or in place) answered yes, and waits for the POST that succeeds (a first 409 asking to confirm
 * is fine). Returns { status, body, request, label, asked } (asked: the question's text, if any).
 */
async function tapReceiveAll(page, button) {
  await button.evaluate((el) => {
    document.querySelectorAll("[data-harness-print]").forEach((n) => n.removeAttribute("data-harness-print"));
    let n = el;
    for (let i = 0; i < 2 && n.parentElement && n.parentElement !== document.body; i++) n = n.parentElement;
    n.setAttribute("data-harness-print", "");
  });
  const label = (await button.innerText()).replace(/\s+/g, " ").trim();
  let done = false;
  const ok = page.waitForResponse((r) => r.url().includes("/prepare-labels") && r.request().method() === "POST" && r.status() === 200, { timeout: 90_000 })
    .then((r) => { done = true; return r; });
  ok.catch(() => {}); // awaited below; this keeps an early timeout from being an unhandled rejection
  await button.click();
  const found = await until(async () => {
    if (done) return { none: true };
    for (const sc of [page.getByRole("dialog"), page.getByRole("alertdialog"), page.locator("[data-harness-print]")]) {
      const b = UI.confirmReceiveAll(sc).first();
      if (await b.isVisible().catch(() => false)) return { b, sc };
    }
    return null;
  }, 45_000);
  let asked = "";
  if (found?.b) {
    asked = (await found.sc.first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    await found.b.click();
  }
  const res = await ok;
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  let body = null;
  let request = null;
  try { body = await res.json(); } catch { /* not json */ }
  try { request = res.request().postDataJSON(); } catch { /* no body */ }
  return { status: res.status(), body, request, label, asked };
}
/** A button counts as disabled by the attribute or by aria-disabled="true" (the print button uses the latter). */
const laDisabled = async (btn) => (await btn.isDisabled().catch(() => false)) || (await btn.getAttribute("aria-disabled")) === "true";
/** One phone (390 px) pass over a page: screenshot, no sideways scroll, no browser errors. */
async function laPhoneCheck(phone, name) {
  await phone.page.screenshot({ path: path.join(OUT, `${name}-390.png`), fullPage: true });
  const over = await sidewaysScroll(phone.page);
  assert(over <= 1, `the page scrolls sideways by ${over}px at 390`);
  assert(!phone.errors.length, `browser errors: ${phone.errors.slice(0, 3).join(" | ").slice(0, 300)}`);
}

const LABELS_ANY_SCENARIOS = {
  // CD-2470, in progress since Nov 5 (before Receiving), order tier Gold, 2 of 5 cards with no
  // tier of their own: through the API, one POST bags them all without touching the order
  async "labels-any-in-shop"({ ctx, s, appUrl }) {
    const id = LA.inShopOrder;
    const num = LAN.inShopOrder;
    const email = LAC.inShopOrder.email;
    const tiers = IN_SHOP_CARD_TIERS.map((t) => t ?? IN_SHOP_ORDER_TIER);
    await laSetup(s);
    await s.step("GET plan: bag_in_shop, 5 cards to bag, no tier question (card or order tier), received on 2026-11-05 (the 'Cards Received' day), no bags yet", async () => {
      const plan = await laPlan(ctx, id);
      eq(plan.orderId, id, "orderId");
      eq(plan.orderNumber, num, "orderNumber");
      eq(plan.status, "in_progress", "status");
      eq(plan.mode, "bag_in_shop", "mode");
      eq(plan.toBag, 5, "toBag");
      eq(plan.tierQuestions ?? [], [], "tierQuestions");
      eq(plan.needsAnswers, false, "needsAnswers");
      eq(plan.receivedOn, IN_SHOP_RECEIVED_ON, "receivedOn");
      eq(plan.receivedOnSource, "event", "receivedOnSource");
      eq((plan.bags ?? []).length, 0, "bags");
      eq([plan.skipped?.refunded, plan.skipped?.awaitingArrival], [0, 0], "skipped (refunded, awaitingArrival)");
      return `${plan.mode}, ${plan.toBag} to bag, received ${plan.receivedOn} (${plan.receivedOnSource})`;
    }, { critical: true, shot: false });
    const before = laState(await dump(), id, email);
    let first = null;
    await s.step("POST (no body): 200, newlyBagged 5, bags CD-2470-P (2) + CD-2470-G (3), emailed false, orderStatusChanged false, a message", async () => {
      first = laPrepared(await laPost(ctx, id));
      eq(first.newlyBagged, 5, "newlyBagged");
      eq(first.emailed, false, "emailed");
      eq(first.orderStatusChanged, false, "orderStatusChanged");
      laCheckAnswerBags(first, num, LA.inShopCards, tiers);
      assert(typeof first.message === "string" && first.message.trim(), "no message for staff");
      return first.message;
    }, { critical: true, shot: false });
    await s.step("DB: one bag per tier, received_on 2026-11-05, each card in its tier's bag, cards.tier filled from the order (cards 3 and 5 -> Gold), Card IDs CD-2470-01..05", async () =>
      laCheckBagged(await tables(), id, num, LA.inShopCards, tiers, IN_SHOP_RECEIVED_ON), { shot: false });
    await s.step("order untouched: still in_progress, no 'Status updated' or customer-visible event, no stage event, no customer email", async () => {
      const d = await dump();
      const after = laState(d, id, email);
      eq(after.status, "in_progress", "order status");
      eq(after.statusEvents, before.statusEvents, "'Status updated to' events");
      eq(after.visibleEvents, before.visibleEvents, "customer-visible order events");
      eq(after.stageEvents, before.stageEvents, "stage_update events");
      eq(after.customerEmails, 0, "emails to the customer");
      const added = d.tables.order_events.filter((e) => e.order_id === id).slice(before.events).map((e) => `${e.event_type}: ${e.description}`);
      return `${added.length} staff-only event(s)${added.length ? `: ${added.join(" | ").slice(0, 200)}` : ""}; ${d.emails.length} email(s) captured in all`;
    }, { shot: false });
    await s.step("the bagged cards' tier is now locked: PATCH card 3's tier -> 409, tier unchanged", async () => {
      const r = await api(ctx, "PATCH", ROUTES.cardTierApi(LA.inShopCards[2]), { tier: "regular" });
      eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
      eq((await tables()).cards.find((c) => c.id === LA.inShopCards[2]).tier, IN_SHOP_ORDER_TIER, "card 3 tier");
      return r.body?.error ?? "";
    }, { shot: false });
    await s.step("POST again: 200, newlyBagged 0, the same bags; nothing written (idempotent)", async () => {
      const d0 = await dump();
      const again = laPrepared(await laPost(ctx, id), "second POST");
      eq(again.newlyBagged, 0, "newlyBagged");
      eq(again.emailed, false, "emailed");
      eq(again.orderStatusChanged, false, "orderStatusChanged");
      eq(again.bags.map((b) => [b.id, b.code, b.cardCount]), first.bags.map((b) => [b.id, b.code, b.cardCount]), "bags");
      const d1 = await dump();
      eq(laState(d1, id, email), laState(d0, id, email), "order, bags, cards, events, emails");
      eq(d1.tables.tier_bags.length, d0.tables.tier_bags.length, "tier_bags rows");
      return again.message ?? "";
    }, { shot: false });
    await s.step("GET plan again: ready, nothing to bag, the order's 2 bags", async () => {
      const plan = await laPlan(ctx, id);
      eq(plan.mode, "ready", "mode");
      eq(plan.toBag, 0, "toBag");
      eq((plan.bags ?? []).map((b) => b.code).sort(), ["CD-2470-G", "CD-2470-P"], "bags");
    }, { shot: false });
    // The labels: one per tier bag, one PDF page per bag (the existing label checks)
    await labelSteps(s, ctx, { appUrl, orderId: id, customerName: LAC.inShopOrder.name, title: "CD-2470 labels" });
  },

  // CD-2480: no tier on the cards or the order; the signed checkout record names them (Silver,
  // Silver + slab removal, Platinum): filled for sure, no question, one POST bags them
  async "labels-any-signed"({ ctx, s }) {
    const id = LA.signedOrder;
    const num = LAN.signedOrder;
    const email = LAC.signedOrder.email;
    await laSetup(s);
    await s.step("GET plan: bag_in_shop, 3 to bag, the tiers from the signed record (sure, needsAnswer false): Silver, Silver, Platinum; received on 2026-11-09", async () => {
      const plan = await laPlan(ctx, id);
      eq(plan.mode, "bag_in_shop", "mode");
      eq(plan.toBag, 3, "toBag");
      eq(plan.needsAnswers, false, "needsAnswers");
      eq(plan.receivedOn, SIGNED_RECEIVED_ON, "receivedOn");
      const qs = plan.tierQuestions ?? [];
      assert(qs.length, "no tier question (expected the signed tiers shown for information)");
      for (const q of qs) {
        eq([q.confidence, q.source, q.needsAnswer], ["sure", "signed", false], `question for ${(q.cardNames ?? []).join(", ")}: confidence, source, needsAnswer`);
        assert(typeof q.why === "string" && q.why.trim(), "a question with no why");
      }
      const guessOf = (cid) => qs.find((q) => (q.cardIds ?? []).includes(cid))?.guess ?? "(no question)";
      eq(LA.signedCards.map(guessOf), SIGNED_CARD_TIERS, "guess per card (from the signed record)");
      return qs.map((q) => `${q.why} (${q.cardIds.length})`).join("; ");
    }, { critical: true, shot: false });
    const before = laState(await dump(), id, email);
    await s.step("POST (no tiers): 200, newlyBagged 3, bags CD-2480-P (1) + CD-2480-S (2), no email, status not changed", async () => {
      const body = laPrepared(await laPost(ctx, id));
      eq(body.newlyBagged, 3, "newlyBagged");
      eq([body.emailed, body.orderStatusChanged], [false, false], "emailed, orderStatusChanged");
      return laCheckAnswerBags(body, num, LA.signedCards, SIGNED_CARD_TIERS);
    }, { critical: true, shot: false });
    await s.step("DB: cards.tier from the signed record, bags received 2026-11-09, Card IDs CD-2480-01..03; order still received, no customer email, no status event", async () => {
      const d = await dump();
      const out = laCheckBagged(d.tables, id, num, LA.signedCards, SIGNED_CARD_TIERS, SIGNED_RECEIVED_ON);
      const after = laState(d, id, email);
      eq(after.status, "received", "order status");
      eq([after.statusEvents, after.visibleEvents, after.customerEmails], [before.statusEvents, before.visibleEvents, 0], "status events, customer-visible events, customer emails");
      return out;
    }, { shot: false });
  },

  // CD-2490: no tier anywhere and no signature; cards 1-2 were paid Silver's price (a likely guess),
  // card 3 a price no tier has (unknown): staff must answer, once
  async "labels-any-unknown-tier"({ ctx, s }) {
    const id = LA.unknownTierOrder;
    const num = LAN.unknownTierOrder;
    const email = LAC.unknownTierOrder.email;
    const [c1, c2, c3] = LA.unknownTierCards;
    await laSetup(s);
    await s.step("GET plan: needsAnswers; question 1 = cards 1-2, guess Silver (likely, from the price), question 2 = card 3, no guess (unknown); every tier offered", async () => {
      const plan = await laPlan(ctx, id);
      eq(plan.mode, "bag_in_shop", "mode");
      eq(plan.toBag, 3, "toBag");
      eq(plan.needsAnswers, true, "needsAnswers");
      eq(plan.receivedOn, UNKNOWN_TIER_RECEIVED_ON, "receivedOn");
      const qs = plan.tierQuestions ?? [];
      const of = (cid) => qs.find((q) => (q.cardIds ?? []).includes(cid));
      const likely = of(c1);
      const unknown = of(c3);
      assert(likely && unknown, `no question for card 1 or card 3: ${JSON.stringify(qs).slice(0, 240)}`);
      eq([...likely.cardIds].sort(), [c1, c2].sort(), "the Silver question's cards");
      eq([likely.guess, likely.confidence, likely.source, likely.needsAnswer], ["expedited", "likely", "price", true], "Silver question: guess, confidence, source, needsAnswer");
      eq(unknown.cardIds, [c3], "the unknown question's cards");
      eq([unknown.guess, unknown.confidence, unknown.needsAnswer], [null, "unknown", true], "unknown question: guess, confidence, needsAnswer");
      for (const q of qs) {
        assert(typeof q.why === "string" && q.why.trim(), "a question with no why");
        const keys = (q.choices ?? []).map((c) => c.key);
        const missing = LA_RESTORATION_TIERS.filter((k) => !keys.includes(k));
        assert(!missing.length, `choices miss ${missing.join(", ")}`);
      }
      return qs.map((q) => `"${q.why}" ${q.guess ?? "no guess"} x${q.cardIds.length}`).join("; ");
    }, { critical: true, shot: false });
    const before = laState(await dump(), id, email);
    await s.step("POST without tiers: 409 with the question (error, unanswered = all 3 cards, the tierQuestions, needsConfirmReceive false); nothing written", async () => {
      const r = await laPost(ctx, id);
      eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      assert(typeof r.body?.error === "string" && r.body.error.trim(), "no error text");
      eq([...(r.body.unanswered ?? [])].sort(), [c1, c2, c3].sort(), "unanswered");
      eq(r.body.needsConfirmReceive, false, "needsConfirmReceive");
      assert((r.body.tierQuestions ?? []).length >= 1, "the 409 doesn't carry the question");
      await laUnchanged(before, id, email, "after the 409");
      return r.body.error;
    }, { critical: true, shot: false });
    await s.step("POST with an unknown tier key ('gold'): 400; nothing written", async () => {
      const r = await laPost(ctx, id, { tiers: { [c1]: "expedited", [c2]: "expedited", [c3]: "gold" } });
      eq(r.status, 400, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      await laUnchanged(before, id, email, "after the 400");
      return r.body?.error ?? "";
    }, { shot: false });
    await s.step("POST answering card 3 only: 409, unanswered = cards 1-2 (a likely guess still needs its confirm tap); nothing written", async () => {
      const r = await laPost(ctx, id, { tiers: { [c3]: "regular" } });
      eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      eq([...(r.body?.unanswered ?? [])].sort(), [c1, c2].sort(), "unanswered");
      await laUnchanged(before, id, email, "after the 409");
    }, { shot: false });
    await s.step("POST with every answer (cards 1-2 Silver, card 3 Bronze): 200, bags CD-2490-S (2) + CD-2490-B (1), cards.tier written, received 2026-11-10, no email", async () => {
      const body = laPrepared(await laPost(ctx, id, { tiers: { [c1]: "expedited", [c2]: "expedited", [c3]: "regular" } }));
      eq(body.newlyBagged, 3, "newlyBagged");
      eq(body.emailed, false, "emailed");
      laCheckAnswerBags(body, num, LA.unknownTierCards, ["expedited", "expedited", "regular"]);
      const d = await dump();
      const out = laCheckBagged(d.tables, id, num, LA.unknownTierCards, ["expedited", "expedited", "regular"], UNKNOWN_TIER_RECEIVED_ON);
      const after = laState(d, id, email);
      eq([after.status, after.customerEmails, after.statusEvents], ["in_progress", 0, before.statusEvents], "status, customer emails, status events");
      return out;
    }, { critical: true, shot: false });
    await s.step("GET plan again: ready, no question left", async () => {
      const plan = await laPlan(ctx, id);
      eq([plan.mode, plan.toBag, plan.needsAnswers, (plan.tierQuestions ?? []).length], ["ready", 0, false, 0], "mode, toBag, needsAnswers, questions");
    }, { shot: false });
  },

  // CD-2610, Awaiting Cards: "Cards arrived? Receive all and print" = the normal receive (status
  // -> Cards Received, the usual customer email), then the labels
  async "labels-any-awaiting"({ page, ctx, s }) {
    const id = LA.awaitingOrder;
    const num = LAN.awaitingOrder;
    const email = LAC.awaitingOrder.email;
    const tiers = AWAITING_CARD_TIERS.map((t) => t ?? AWAITING_ORDER_TIER);
    const w = await watchPrints(ctx);
    await laSetup(s);
    await s.step("GET plan: receive_first, awaiting_cards, 3 to bag, no tier question (order tier Silver), received today", async () => {
      const plan = await laPlan(ctx, id);
      eq([plan.mode, plan.status, plan.toBag, plan.needsAnswers], ["receive_first", "awaiting_cards", 3, false], "mode, status, toBag, needsAnswers");
      eq(plan.tierQuestions ?? [], [], "tierQuestions");
      eq(plan.receivedOn, todayNy(), "receivedOn");
      return `${plan.receivedOn} (${plan.receivedOnSource})`;
    }, { critical: true, shot: false });
    const before = laState(await dump(), id, email);
    await s.step("POST without confirmReceive: 409 needsConfirmReceive; nothing written (still awaiting, no bag, no email, no event)", async () => {
      const r = await laPost(ctx, id);
      eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      eq(r.body?.needsConfirmReceive, true, "needsConfirmReceive");
      assert(typeof r.body?.error === "string" && r.body.error.trim(), "no error text");
      await laUnchanged(before, id, email, "after the 409");
      return r.body.error;
    }, { critical: true, shot: false });
    let answer = null;
    await s.step("order page: the button asks \"Cards arrived?\", \"Receive all and print\" -> POST { confirmReceive: true } -> 200", async () => {
      await goto(page, ROUTES.order(id));
      const btn = UI.receiveAllAndPrint(page).or(UI.prepareLabels(page)).first();
      await btn.waitFor({ timeout: 60_000 });
      assert(await waitEnabled(btn), "the button is disabled");
      const r = await tapReceiveAll(page, btn);
      answer = r.body;
      eq(r.request?.confirmReceive, true, "confirmReceive in the request");
      assert(/cards arrived/i.test(`${r.label} ${r.asked}`), `never asked "Cards arrived?" (button "${r.label}", question "${r.asked.slice(0, 120)}")`);
      return `"${r.label}" -> "${r.asked.slice(0, 80)}…": ${r.body?.message ?? ""}`;
    });
    if (!answer) await s.step("(fallback) POST { confirmReceive: true } through the API", async () => { answer = laPrepared(await laPost(ctx, id, { confirmReceive: true })); }, { critical: true, shot: false });
    await s.step("answer: newlyBagged 3, orderStatusChanged, emailed, bag CD-2610-S (3)", async () => {
      assert(answer?.ok === true, `answer: ${JSON.stringify(answer).slice(0, 200)}`);
      eq([answer.newlyBagged, answer.orderStatusChanged, answer.emailed], [3, true, true], "newlyBagged, orderStatusChanged, emailed");
      return laCheckAnswerBags(answer, num, LA.awaitingCards, tiers);
    }, { shot: false });
    await s.step("DB: status received, ONE 'Cards Received' event, exactly one customer email (as Receive), bag CD-2610-S received today, cards.tier Silver", async () => {
      const d = await dump();
      const after = laState(d, id, email);
      eq(after.status, "received", "order status");
      eq(after.receivedEvents, 1, "'Cards Received' events");
      eq(after.customerEmails, 1, "emails to the customer");
      const out = laCheckBagged(d.tables, id, num, LA.awaitingCards, tiers, todayNy());
      return `${out}; customer email "${mailsTo(d.emails, email)[0]?.subject ?? ""}"`;
    }, { critical: true, shot: false });
    await s.step("then the labels print (second tap): 1 page", async () => checkPrintOutput(ctx, await tapPrint(page, w), 1));
    await s.step("POST { confirmReceive: true } again: 200, newlyBagged 0, no second email or event, still received", async () => {
      const d0 = await dump();
      const again = laPrepared(await laPost(ctx, id, { confirmReceive: true }), "second POST");
      eq([again.newlyBagged, again.emailed, again.orderStatusChanged], [0, false, false], "newlyBagged, emailed, orderStatusChanged");
      eq(laState(await dump(), id, email), laState(d0, id, email), "order, bags, cards, events, emails");
    }, { shot: false });
  },

  // CD-2620, never paid: no working button (disabled, with the reason) and the API refuses
  async "labels-any-not-allowed"({ page, ctx, s, browser, appUrl }) {
    const id = LA.unpaidOrder;
    const email = LAC.unpaidOrder.email;
    await laSetup(s);
    let plan = null;
    await s.step("GET plan: not_allowed, with a reason", async () => {
      plan = await laPlan(ctx, id);
      eq([plan.mode, plan.status], ["not_allowed", "awaiting_payment"], "mode, status");
      assert(typeof plan.reason === "string" && plan.reason.trim(), "no reason");
      return plan.reason;
    }, { critical: true, shot: false });
    const before = laState(await dump(), id, email);
    await s.step("POST, and POST { confirmReceive: true, tiers }: refused (409 { error }); nothing written", async () => {
      const out = [];
      for (const data of [{}, { confirmReceive: true, tiers: Object.fromEntries(LA.unpaidCards.map((c) => [c, "premium"])) }]) {
        const r = await laPost(ctx, id, data);
        eq(r.status, 409, `HTTP for ${JSON.stringify(data).slice(0, 60)} (${JSON.stringify(r.body).slice(0, 160)})`);
        assert(typeof r.body?.error === "string" && r.body.error.trim(), "no error text");
        out.push(r.body.error);
      }
      await laUnchanged(before, id, email, "after the refusals");
      return out[0];
    }, { shot: false });
    const check = async (p) => {
      await goto(p, ROUTES.order(id));
      await p.waitForTimeout(1_000);
      const all = UI.anyPrepare(p);
      const n = await all.count();
      assert(n > 0, "no \"Print labels\" button on the unpaid order (expected one, disabled, with the reason)");
      const btn = all.first();
      assert(await laDisabled(btn), `"${(await btn.innerText()).trim()}" is enabled on an unpaid order`);
      const near = await btn.evaluate((el) => {
        const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        let n2 = el;
        for (let i = 0; i < 3 && n2.parentElement; i++) n2 = n2.parentElement;
        return { title: el.getAttribute("title") ?? "", desc: ids.map((x) => document.getElementById(x)?.textContent ?? "").join(" "), around: n2.innerText ?? "" };
      });
      const reason = plan.reason.trim();
      const said = [near.title, near.desc, near.around].find((x) => x.includes(reason) || UI.notAllowedReason.test(x));
      assert(said, `no reason next to the button (expected "${reason}" or words like "not paid")`);
      // a tap does nothing
      const posts = [];
      const onReq = (r) => { if (r.method() === "POST" && r.url().includes("/prepare-labels")) posts.push(r.url()); };
      p.on("request", onReq);
      await btn.click({ force: true, timeout: 5_000 }).catch(() => {});
      await p.waitForTimeout(2_000);
      p.off("request", onReq);
      eq(posts.length, 0, "POSTs after tapping the disabled button");
      return `"${(await btn.innerText()).replace(/\s+/g, " ").trim()}" disabled: ${(near.desc || near.title || reason).slice(0, 120)}`;
    };
    await s.step("1440: the order page shows the button disabled with the reason; a tap sends nothing", () => check(page));
    await s.step("390: the same on a phone, no sideways scroll", async () => {
      const phone = await phoneContext(browser, appUrl);
      try {
        const out = await check(phone.page);
        await laPhoneCheck(phone, "labels-any-not-allowed");
        return out;
      } finally {
        await phone.ctx.close();
      }
    }, { shot: false });
    await s.step("still nothing written", () => laUnchanged(before, id, email, "after the taps"), { shot: false });
  },

  // The order page of CD-2470 (in progress, no bags): one tap prepares, a second tap prints;
  // at 1440, then again from a fresh seed at 390
  async "labels-any-order-page"({ page, ctx, s, browser, appUrl }) {
    const id = LA.inShopOrder;
    const num = LAN.inShopOrder;
    const email = LAC.inShopOrder.email;
    const tiers = IN_SHOP_CARD_TIERS.map((t) => t ?? IN_SHOP_ORDER_TIER);
    const w = await watchPrints(ctx);
    await laSetup(s);
    const flow = async (p, pw, size) => {
      await s.step(`${size}: the order page of ${num} has an enabled "Print labels"`, async () => {
        await goto(p, ROUTES.order(id));
        const btn = UI.prepareLabels(p).first();
        await btn.waitFor({ timeout: 60_000 });
        assert(await waitEnabled(btn), "the button is disabled");
        return (await btn.innerText()).replace(/\s+/g, " ").trim();
      }, { critical: true, shot: size === "1440" });
      await s.step(`${size}: tap 1 prepares: POST 200, CD-2470-P (2) + CD-2470-G (3) received 2026-11-05, still in_progress, no customer email`, async () => {
        const tTap = Date.now();
        const r = await tapPrepare(p, UI.prepareLabels(p).first());
        eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
        const d = await dump();
        const out = laCheckBagged(d.tables, id, num, LA.inShopCards, tiers, IN_SHOP_RECEIVED_ON);
        const st = laState(d, id, email);
        eq([st.status, st.customerEmails], ["in_progress", 0], "status, customer emails");
        await p.waitForTimeout(1_500);
        const early = await printsSince(p, pw, tTap);
        const printedEarly = early.filter((x) => x.kind !== "get");
        return `${r.body?.message ?? out}${printedEarly.length ? ` (already printing after tap 1: ${printedEarly.map((x) => x.text).join("; ")})` : ""}`;
      }, { critical: true, shot: size === "1440" });
      await s.step(`${size}: tap 2 prints: a new tab / download / share sheet with the labels (PDF: one page per bag)`, async () => checkPrintOutput(ctx, await tapPrint(p, pw), 2), { shot: size === "1440" });
      await s.step(`${size}: both bags are marked printed (label_printed_at)`, () => laStamped(id), { shot: false });
    };
    await flow(page, w, "1440");
    await s.step("390: fresh seed (CD-2470 unbagged again)", async () => {
      await reset();
      await seedLabelsAny();
      eq(bagsOf(await tables(), id).length, 0, "bags");
    }, { critical: true, shot: false });
    const phone = await phoneContext(browser, appUrl);
    try {
      const pw = await watchPrints(phone.ctx);
      await flow(phone.page, pw, "390");
      await s.step("390: the order page fits (no sideways scroll), no browser errors", () => laPhoneCheck(phone, "labels-any-order-page"), { shot: false });
    } finally {
      await phone.ctx.close();
    }
  },

  // CD-2490 (no tier anywhere): the tap asks once, Silver preselected for cards 1-2 and nothing
  // for card 3; Bronze picked, confirmed: one POST with every card's tier, then the labels
  async "labels-any-tier-dialog"({ page, ctx, s, browser, appUrl }) {
    const id = LA.unknownTierOrder;
    const num = LAN.unknownTierOrder;
    const email = LAC.unknownTierOrder.email;
    const [c1, c2, c3] = LA.unknownTierCards;
    const w = await watchPrints(ctx);
    await laSetup(s);
    const before = laState(await dump(), id, email);
    const openQuestion = async (p) => {
      await goto(p, ROUTES.order(id));
      const btn = UI.prepareLabels(p).first();
      await btn.waitFor({ timeout: 60_000 });
      assert(await waitEnabled(btn), "the button is disabled");
      await btn.click();
      const scope = UI.tierScope(p);
      await scope.waitFor({ timeout: 30_000 });
      const ctls = await until(async () => { const x = await tierControlsIn(scope); return x.length ? x : null; }, 15_000);
      assert(ctls, "the tier question shows no tier list");
      return { scope, ctls };
    };
    await s.step("390: the tap asks the tier question on a phone (nothing saved yet), no sideways scroll", async () => {
      const phone = await phoneContext(browser, appUrl);
      try {
        const { ctls } = await openQuestion(phone.page);
        await laPhoneCheck(phone, "labels-any-tier-dialog");
        return ctls.map((c) => c.text || c.value || "(none)").join(" | ");
      } finally {
        await phone.ctx.close();
      }
    }, { shot: false });
    let q = null;
    await s.step("1440: tap \"Print labels\": the question shows Silver preselected (cards 1-2) and no tier for card 3; nothing saved yet", async () => {
      q = await openQuestion(page);
      const silver = q.ctls.filter((c) => controlShows(c, "expedited"));
      const none = q.ctls.filter((c) => controlShowsNone(c));
      assert(silver.length >= 1, `no control preselected Silver: ${q.ctls.map((c) => `${c.kind} "${c.text}" ${c.value}`).join(" | ")}`);
      assert(none.length >= 1, `no control left without a tier for card 3: ${q.ctls.map((c) => `${c.kind} "${c.text}" ${c.value}`).join(" | ")}`);
      const text = await q.scope.innerText();
      const named = [...LA.unknownTierCards.keys()].map((i) => `Test Unknown-Tier Card ${i + 1}`).filter((n) => text.includes(n));
      await laUnchanged(before, id, email, "with the question open");
      return `${q.ctls.length} control(s): ${q.ctls.map((c) => c.text || c.value || "(none)").join(" | ")}; names shown: ${named.join(", ") || "none"}`;
    }, { critical: true });
    await s.step("1440: pick Bronze where no tier is set, confirm: POST with every card's tier (1-2 Silver, 3 Bronze) -> 200", async () => {
      for (const c of q.ctls.filter((x) => controlShowsNone(x))) await setTierControl(page, c.loc, "regular");
      const ok = page.waitForResponse((r) => r.url().includes("/prepare-labels") && r.request().method() === "POST" && r.status() === 200, { timeout: 60_000 });
      await UI.tierConfirm(q.scope).click();
      const res = await ok;
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      const sent = res.request().postDataJSON()?.tiers ?? {};
      eq([c1, c2, c3].map((c) => sent[c] ?? null), ["expedited", "expedited", "regular"], "tiers sent per card");
      const d = await dump();
      return laCheckBagged(d.tables, id, num, LA.unknownTierCards, ["expedited", "expedited", "regular"], UNKNOWN_TIER_RECEIVED_ON);
    }, { critical: true });
    await s.step("1440: then the labels print: 2 pages (CD-2490-S, CD-2490-B)", async () => checkPrintOutput(ctx, await tapPrint(page, w), 2));
    await s.step("no customer email, status unchanged", async () => {
      const st = laState(await dump(), id, email);
      eq([st.status, st.customerEmails, st.statusEvents], ["in_progress", 0, before.statusEvents], "status, customer emails, status events");
    }, { shot: false });
  },

  // The receiving workspace of CD-2470: ONE "Print labels", nothing to tick first
  async "labels-any-workspace"({ page, ctx, s, browser, appUrl }) {
    const id = LA.inShopOrder;
    const num = LAN.inShopOrder;
    const email = LAC.inShopOrder.email;
    const tiers = IN_SHOP_CARD_TIERS.map((t) => t ?? IN_SHOP_ORDER_TIER);
    const w = await watchPrints(ctx);
    await laSetup(s);
    const countExact = async () => {
      let n = 0;
      for (const b of await page.getByRole("button", { name: UI.prepareLabelsExact }).all()) if (await b.isVisible().catch(() => false)) n++;
      return n;
    };
    await s.step("the workspace shows ONE \"Print labels\", enabled, with no card ticked", async () => {
      await goto(page, ROUTES.receivingOrder(id));
      await UI.prepareLabels(page).first().waitFor({ timeout: 60_000 });
      eq(await countExact(), 1, "visible \"Print labels\" buttons");
      assert(await waitEnabled(UI.prepareLabels(page).first()), "the button is disabled");
      let ticked = 0;
      for (const box of await page.getByRole("checkbox", { name: /^Arrived:/i }).all()) if (await box.isChecked().catch(() => false)) ticked++;
      eq(ticked, 0, "ticked \"Arrived\" boxes");
      return (await UI.prepareLabels(page).first().innerText()).replace(/\s+/g, " ").trim();
    }, { critical: true });
    await s.step("tap it without ticking anything: POST 200, the 5 cards in CD-2470-P + CD-2470-G (received 2026-11-05), status unchanged, no email", async () => {
      const r = await tapPrepare(page, UI.prepareLabels(page).first());
      eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      const d = await dump();
      const out = laCheckBagged(d.tables, id, num, LA.inShopCards, tiers, IN_SHOP_RECEIVED_ON);
      const st = laState(d, id, email);
      eq([st.status, st.customerEmails], ["in_progress", 0], "status, customer emails");
      return out;
    }, { critical: true });
    await s.step("tap 2 prints the 2 labels", async () => checkPrintOutput(ctx, await tapPrint(page, w), 2));
    await s.step("reloaded: the bags show (CD-2470-P, CD-2470-G) and at most ONE \"Print labels\" / \"Print N labels\" (no second print step)", async () => {
      await goto(page, ROUTES.receivingOrder(id));
      const text = await page.locator("main").first().innerText();
      for (const code of ["CD-2470-P", "CD-2470-G"]) assert(text.includes(code), `${code} not shown`);
      const n = await countExact();
      assert(n <= 1, `${n} visible "Print labels" / "Print N labels" buttons`);
      return `${n} such button(s) once every card is bagged and printed`;
    });
    await s.step("390: the workspace fits (no sideways scroll)", async () => {
      const msg = await phoneShot(browser, appUrl, ROUTES.receivingOrder(id), "labels-any-workspace");
      assert(!msg, msg);
    }, { shot: false });
  },

  // Receiving: a search result row carries the action (tap it right there, the order isn't opened)
  async "labels-any-receiving-row"({ page, ctx, s, browser, appUrl }) {
    const id = LA.inShopOrder;
    const num = LAN.inShopOrder;
    const email = LAC.inShopOrder.email;
    const tiers = IN_SHOP_CARD_TIERS.map((t) => t ?? IN_SHOP_ORDER_TIER);
    const w = await watchPrints(ctx);
    await laSetup(s);
    const search = `${ROUTES.receiving}?q=${encodeURIComponent(num)}`;
    await s.step(`search ${num} on Receiving: its row has "Print labels" (enabled)`, async () => {
      await goto(page, search);
      const row = UI.receivingRow(page, num);
      await row.waitFor({ timeout: 30_000 });
      const btn = UI.prepareLabels(row).first();
      assert(await btn.isVisible(), "the row's action isn't \"Print labels\"");
      assert(await waitEnabled(btn), "the button is disabled");
      return (await btn.innerText()).replace(/\s+/g, " ").trim();
    }, { critical: true });
    await s.step("tap it in the row: POST 200, the 5 cards bagged (CD-2470-P, CD-2470-G), still on Receiving, no email", async () => {
      const r = await tapPrepare(page, UI.prepareLabels(UI.receivingRow(page, num)).first());
      eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      assert(new URL(page.url()).pathname === ROUTES.receiving, `the tap left Receiving for ${page.url()}`);
      const d = await dump();
      const out = laCheckBagged(d.tables, id, num, LA.inShopCards, tiers, IN_SHOP_RECEIVED_ON);
      eq(laState(d, id, email).customerEmails, 0, "customer emails");
      return out;
    }, { critical: true });
    await s.step("tap 2 prints the 2 labels", async () => checkPrintOutput(ctx, await tapPrint(page, w), 2));
    await s.step(`search ${LAN.awaitingOrder} (Awaiting Cards): its row's action asks "Cards arrived?" with "Receive all and print"; Cancel saves nothing`, async () => {
      const aId = LA.awaitingOrder;
      const aEmail = LAC.awaitingOrder.email;
      const before = laState(await dump(), aId, aEmail);
      await goto(page, `${ROUTES.receiving}?q=${encodeURIComponent(LAN.awaitingOrder)}`);
      const row = UI.receivingRow(page, LAN.awaitingOrder);
      await row.waitFor({ timeout: 30_000 });
      const btn = UI.receiveAllAndPrint(row).or(UI.prepareLabels(row)).first();
      const label = (await btn.innerText()).replace(/\s+/g, " ").trim();
      await btn.click();
      const dlg = page.getByRole("dialog").first();
      await dlg.waitFor({ timeout: 30_000 });
      const asked = (await dlg.innerText()).replace(/\s+/g, " ").trim();
      assert(/cards arrived/i.test(`${label} ${asked}`), `never asked "Cards arrived?" ("${label}" / "${asked.slice(0, 120)}")`);
      assert(await UI.confirmReceiveAll(dlg).first().isVisible(), "no \"Receive all and print\" in the question");
      await dlg.getByRole("button", { name: /^(cancel|close|not now|no)\b/i }).first().click();
      await page.waitForTimeout(1_000);
      await laUnchanged(before, aId, aEmail, "after Cancel");
      return `"${label}" -> "${asked.slice(0, 100)}…"`;
    });
    await s.step("390: the search results fit (no sideways scroll)", async () => {
      const msg = await phoneShot(browser, appUrl, search, "labels-any-receiving-row");
      assert(!msg, msg);
    }, { shot: false });
  },
  // CD-2610 made unpaid: "Receive all and print" asks the Receive button's own question first and
  // sends allowUnpaid only after the tick; without it the API refuses exactly like /receive
  async "labels-any-unpaid-receive"({ page, ctx, s, mockUrl }) {
    const id = LA.awaitingOrder;
    const num = LAN.awaitingOrder;
    const email = LAC.awaitingOrder.email;
    const tiers = AWAITING_CARD_TIERS.map((t) => t ?? AWAITING_ORDER_TIER);
    const UNPAID_ERROR = "This order hasn't been paid. Confirm to receive anyway.";
    const UNPAID_CONFIRM = "This order hasn't been paid. Receive anyway?";
    await laSetup(s);
    await s.step("setup: CD-2610 not paid (payment_status pending), Awaiting Cards: plan receive_first, payment unpaid, 3 to bag", async () => {
      await mockUpdate(mockUrl, "orders", { payment_status: "pending" }, "id", id);
      const plan = await laPlan(ctx, id);
      eq([plan.mode, plan.payment, plan.toBag], ["receive_first", "unpaid", 3], "mode, payment, toBag");
    }, { critical: true, shot: false });
    const before = laState(await dump(), id, email);
    await s.step("POST { confirmReceive: true } without allowUnpaid: 409 as the receive route (UNPAID_ERROR, unpaid: true, needsAllowUnpaid); nothing written", async () => {
      const r = await laPost(ctx, id, { confirmReceive: true });
      eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 200)})`);
      eq([r.body?.needsAllowUnpaid, r.body?.unpaid, r.body?.payment, r.body?.error], [true, true, "unpaid", UNPAID_ERROR], "needsAllowUnpaid, unpaid, payment, error");
      const rr = await api(ctx, "POST", `/api/admin/intake/orders/${id}/receive`, { cardIds: LA.awaitingCards });
      eq([rr.status, rr.body?.error, rr.body?.unpaid], [409, UNPAID_ERROR, true], "the receive route's own answer");
      await laUnchanged(before, id, email, "after the 409s");
      return r.body.error;
    }, { critical: true, shot: false });
    await s.step("POST a body that isn't JSON: 400 (not read as {}); an empty body is {} (409, needs the confirm); nothing written", async () => {
      const raw = (data) => ctx.request.fetch(ROUTES.prepareLabelsApi(id), { method: "POST", headers: { "Content-Type": "application/json" }, data, failOnStatusCode: false, maxRedirects: 0 });
      const bad = await raw("{not json");
      eq(bad.status(), 400, `HTTP for a malformed body (${(await bad.text()).slice(0, 120)})`);
      const empty = await raw(undefined); // no body at all
      eq(empty.status(), 409, `HTTP for an empty body (${(await empty.text()).slice(0, 120)})`);
      await laUnchanged(before, id, email, "after the raw POSTs");
    }, { shot: false });
    await s.step(`order page: the dialog asks "${UNPAID_CONFIRM}" with a tick box; "Receive all and print" without the tick sends nothing`, async () => {
      await goto(page, ROUTES.order(id));
      const btn = UI.prepareLabels(page).first();
      await btn.waitFor({ timeout: 60_000 });
      assert(await waitEnabled(btn), "the button is disabled");
      await btn.click();
      const dlg = page.getByRole("dialog").first();
      await dlg.waitFor({ timeout: 30_000 });
      const text = (await dlg.innerText()).replace(/\s+/g, " ");
      assert(text.includes(UNPAID_CONFIRM), `the dialog doesn't ask "${UNPAID_CONFIRM}": "${text.slice(0, 200)}"`);
      assert(/cards arrived/i.test(text), "not the \"Cards arrived?\" question");
      const box = dlg.getByRole("checkbox");
      eq(await box.count(), 1, "tick boxes in the dialog");
      const posts = [];
      const onReq = (r) => { if (r.method() === "POST" && r.url().includes("/prepare-labels")) posts.push(r.url()); };
      page.on("request", onReq);
      await UI.confirmReceiveAll(dlg).first().click();
      await page.waitForTimeout(1_500);
      page.off("request", onReq);
      eq(posts.length, 0, "POSTs without the tick");
      assert(await dlg.isVisible(), "the dialog closed");
      assert(/tick the box/i.test(await dlg.innerText()), "no message asking for the tick");
      await laUnchanged(before, id, email, "after the unticked tap");
      return text.slice(0, 140);
    }, { critical: true });
    await s.step("tick it, \"Receive all and print\": POST { confirmReceive, allowUnpaid } -> 200; Cards Received, ONE customer email, a received_unpaid line, CD-2610-S", async () => {
      const dlg = page.getByRole("dialog").first();
      await dlg.getByRole("checkbox").check();
      const ok = page.waitForResponse((r) => r.url().includes("/prepare-labels") && r.request().method() === "POST", { timeout: 90_000 });
      await UI.confirmReceiveAll(dlg).first().click();
      const res = await ok;
      eq(res.status(), 200, `HTTP (${(await res.text()).slice(0, 200)})`);
      const req = res.request().postDataJSON();
      eq([req.confirmReceive, req.allowUnpaid], [true, true], "confirmReceive, allowUnpaid in the request");
      const d = await dump();
      const st = laState(d, id, email);
      eq([st.status, st.receivedEvents, st.customerEmails], ["received", 1, 1], "status, 'Cards Received' events, customer emails");
      eq(d.tables.order_events.filter((e) => e.order_id === id && e.event_type === "received_unpaid").length, 1, "received_unpaid lines");
      return laCheckBagged(d.tables, id, num, LA.awaitingCards, tiers, todayNy());
    }, { critical: true });
  },

  // CD-2470 with a card added after it arrived (Nov 20, after Cards Received Nov 5): the workspace box
  // counts what the server bags (5, not 6), goes away once they are bagged, and the late card stays
  // for the ticks below (planOrderSetup addedLater)
  async "labels-any-added-later"({ page, ctx, s, mockUrl }) {
    const id = LA.inShopOrder;
    const num = LAN.inShopOrder;
    const tiers = IN_SHOP_CARD_TIERS.map((t) => t ?? IN_SHOP_ORDER_TIER);
    const late = "1a00000c-0000-4000-8000-000000000099";
    const lateName = "Test Added-Later Card";
    await laSetup(s);
    await s.step("setup: a 6th card created 2026-11-20 (after Cards Received on 2026-11-05), Gold; plan: bag_in_shop, toBag 5, the reason says 1 card was added later", async () => {
      const { error } = await mockDb(mockUrl).from("cards").insert({ id: late, order_id: id, card_name: lateName, tier: "premium", created_at: "2026-11-20T15:00:00.000Z" });
      assert(!error, `insert: ${error?.message}`);
      const plan = await laPlan(ctx, id);
      eq([plan.mode, plan.toBag], ["bag_in_shop", 5], "mode, toBag");
      assert(/1 card was added after the order arrived/.test(plan.reason ?? ""), `reason: ${plan.reason}`);
      return plan.reason;
    }, { critical: true, shot: false });
    await s.step("the workspace box says 5 cards (the server's count), not 6", async () => {
      await goto(page, ROUTES.receivingOrder(id));
      const box = page.getByRole("region", { name: /^print labels$/i }).filter({ hasText: /in a bag yet/ }).first();
      await box.waitFor({ timeout: 60_000 });
      const text = (await box.innerText()).replace(/\s+/g, " ");
      assert(/\b5 cards aren't in a bag yet\b/.test(text), `box: "${text.slice(0, 160)}"`);
      return text.slice(0, 120);
    }, { critical: true });
    await s.step("tap: 200, newlyBagged 5 (CD-2470-P + CD-2470-G); the late card has no bag and isn't received", async () => {
      const box = page.getByRole("region", { name: /^print labels$/i }).filter({ hasText: /in a bag yet/ }).first();
      const r = await tapPrepare(page, UI.prepareLabels(box).first());
      eq([r.status, r.body?.newlyBagged], [200, 5], `HTTP, newlyBagged (${JSON.stringify(r.body).slice(0, 200)})`);
      const d = await dump();
      const c = d.tables.cards.find((x) => x.id === late);
      eq([c.bag_id ?? null, c.received_at ?? null], [null, null], "late card bag_id, received_at");
      return laCheckBagged(d.tables, id, num, LA.inShopCards, tiers, IN_SHOP_RECEIVED_ON);
    }, { critical: true });
    await s.step("close (X) without printing: the box is gone, the keyboard is on the Bags heading, the late card still has its Arrived tick box", async () => {
      await page.getByRole("button", { name: /^close without printing$/i }).first().click();
      await page.waitForTimeout(2_000);
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      const boxes = await page.getByText(/in a bag yet/).count();
      eq(boxes, 0, "\"…in a bag yet\" boxes");
      const focused = await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? "");
      eq(focused, "bags-h", "focused element");
      assert(await UI.arrived(page, lateName).isVisible(), `no Arrived tick box for ${lateName}`);
      return `focus on #${focused}`;
    });
  },

  // A bag whose cards were all refunded has no live card: no "Print label" for it on the Bags board
  // or the "Bags missing labels" queue (the label route has nothing to print)
  async "labels-any-empty-bag"({ page, ctx, s, mockUrl }) {
    const id = LA.inShopOrder;
    await laSetup(s);
    await s.step("setup: CD-2470 bagged (POST), then both Platinum cards refunded: CD-2470-P has no live card", async () => {
      laPrepared(await laPost(ctx, id));
      const t = await tables();
      const p = bagsOf(t, id).find((b) => b.bag_code === "CD-2470-P");
      assert(p, "no CD-2470-P");
      const inP = t.cards.filter((c) => c.bag_id === p.id);
      eq(inP.length, 2, "cards in CD-2470-P");
      for (const c of inP) await mockUpdate(mockUrl, "cards", { status: "refunded" }, "id", c.id);
      return inP.map((c) => c.card_code).join(", ");
    }, { critical: true, shot: false });
    const printBtn = (scope) => scope.getByRole("button", { name: /^(re)?print label$/i });
    await s.step("Bags board: CD-2470-G has \"Print label\"; CD-2470-P has none (or isn't listed)", async () => {
      await goto(page, ROUTES.bags);
      const rowOf = (code) => page.locator("li").filter({ has: page.getByRole("link", { name: `Open bag ${code}`, exact: true }) }).last();
      await rowOf("CD-2470-G").waitFor({ timeout: 60_000 });
      eq(await printBtn(rowOf("CD-2470-G")).count(), 1, "CD-2470-G print buttons");
      const pRows = await rowOf("CD-2470-P").count();
      const pBtns = pRows ? await printBtn(rowOf("CD-2470-P")).count() : 0;
      eq(pBtns, 0, "CD-2470-P print buttons");
      return `CD-2470-P ${pRows ? "listed without a print button" : "not listed"}`;
    });
    await s.step("\"Bags missing labels\" queue: CD-2470-G has \"Print label\"; CD-2470-P is listed without one", async () => {
      await goto(page, `${ROUTES.receiving}?queue=labels`);
      const rowOf = (code) => page.locator("li").filter({ hasText: code }).filter({ has: page.getByRole("link", { name: new RegExp(`^${code}\\b`) }) }).last();
      await page.getByText("CD-2470-G").first().waitFor({ timeout: 60_000 });
      eq(await printBtn(page.locator("li").filter({ hasText: "CD-2470-G" }).last()).count(), 1, "CD-2470-G print buttons");
      const pRow = page.locator("li").filter({ hasText: "CD-2470-P" }).last();
      assert(await pRow.count(), "CD-2470-P isn't in the queue");
      eq(await printBtn(pRow).count(), 0, "CD-2470-P print buttons");
      void rowOf;
    });
  },

  // The receiving workspace of an Awaiting Cards order (CD-2610): a "Cards arrived?" box receives
  // all and prints, tiers filled from the order, the shelf slot made as the Receive button does
  async "labels-any-workspace-awaiting"({ page, ctx, s, browser, appUrl }) {
    const id = LA.awaitingOrder;
    const num = LAN.awaitingOrder;
    const email = LAC.awaitingOrder.email;
    const tiers = AWAITING_CARD_TIERS.map((t) => t ?? AWAITING_ORDER_TIER);
    const w = await watchPrints(ctx);
    await laSetup(s);
    const boxOf = (p) => p.getByRole("region", { name: /^cards arrived\?$/i }).first();
    await s.step("390: the workspace shows the \"Cards arrived?\" box, no sideways scroll", async () => {
      const msg = await phoneShot(browser, appUrl, ROUTES.receivingOrder(id), "labels-any-workspace-awaiting");
      assert(!msg, msg);
    }, { shot: false });
    await s.step("1440: the box says it receives all 3 cards and has an enabled \"Receive all and print\"", async () => {
      await goto(page, ROUTES.receivingOrder(id));
      const box = boxOf(page);
      await box.waitFor({ timeout: 60_000 });
      const text = (await box.innerText()).replace(/\s+/g, " ");
      assert(/receives all 3 cards/.test(text), `box: "${text.slice(0, 160)}"`);
      const btn = box.getByRole("button", { name: /^receive all and print$/i });
      assert(await waitEnabled(btn), "the button is disabled");
      return text.slice(0, 120);
    }, { critical: true });
    let answer = null;
    await s.step("tap it, then \"Receive all and print\" in the question: POST { confirmReceive: true } -> 200, one bag CD-2610-S, a shelf slot", async () => {
      await boxOf(page).getByRole("button", { name: /^receive all and print$/i }).click();
      const dlg = page.getByRole("dialog").first();
      await dlg.waitFor({ timeout: 30_000 });
      assert(/cards arrived/i.test(await dlg.innerText()), "the question isn't \"Cards arrived?\"");
      const ok = page.waitForResponse((r) => r.url().includes("/prepare-labels") && r.request().method() === "POST", { timeout: 90_000 });
      await UI.confirmReceiveAll(dlg).first().click();
      const res = await ok;
      answer = await res.json();
      eq(res.status(), 200, `HTTP (${JSON.stringify(answer).slice(0, 200)})`);
      eq(res.request().postDataJSON()?.confirmReceive, true, "confirmReceive");
      eq([answer.newlyBagged, answer.orderStatusChanged, answer.emailed], [3, true, true], "newlyBagged, orderStatusChanged, emailed");
      laCheckAnswerBags(answer, num, LA.awaitingCards, tiers);
      const d = await dump();
      const bag = bagsOf(d.tables, id)[0];
      const shelf = `LOC-SHELF-${String(bag.due_date).replaceAll("-", "")}`;
      eq(answer.shelves?.map((x) => [x.bagCode, x.location?.code]), [[`${num}-S`, shelf]], "shelves in the answer");
      assert(d.tables.locations.some((l) => l.code === shelf && l.kind === "shelf"), `${shelf} not made`);
      const st = laState(d, id, email);
      eq([st.status, st.receivedEvents, st.customerEmails], ["received", 1, 1], "status, 'Cards Received' events, customer emails");
      return `${answer.message}`;
    }, { critical: true });
    await s.step("then the label prints: 1 page", async () => checkPrintOutput(ctx, await tapPrint(page, w), 1));
  },
};
Object.assign(SCENARIOS, LABELS_ANY_SCENARIOS);

// ─── The finished-card flow (done-*: the owner's decisions of Nov 25) ──────────────────────────
// A finished card goes back in its own bag (cards.location_id null, never LOC-DONE) and its holder
// is freed; the bag keeps count ("1 of 3 done"); the first card out of a bag (to a desk or holder)
// files the BAG in the Open bags box (LOC-OPEN-BAGS, A-Z by the customer's last name's first
// letter: "Test Customer A" -> A, "Test Customer Reyes" -> R); the bag's last card -> "Bag
// finished: put it in the Ready to ship bin" and "It's in the Ready to ship bin" puts the bag at
// LOC-SHIP (POST /api/admin/track/bag-ready); the order's last non-refunded card -> the order
// Completed through setOrderStatus with ONE customer email and the held notes email
// (lib/intake/order-autocomplete.ts), from every Done: the scan landing, the Desk, the card page's
// step picker, the order page's Done toggle. Wording: UI.done* (the DONE-FLOW agent's ui-text.md,
// lib/intake/tracking/bag-home.ts).
const OPEN_BAGS = "LOC-OPEN-BAGS";
const SHIP_PLACE = "LOC-SHIP";
/** CD-2549's customer "Test Customer A": the last word is "A", so the sentences say "A's bag" and file it under A. */
const BO_LAST = "A";
const BO_LETTER = "A";
const DN = DONE_ORDER_NUMBER;
const DONE_ORDER = DONE_IDS.doneOrder;
/** CD-2700-01..05: Platinum 01-02 (bag CD-2700-P), Gold 03-05 (bag CD-2700-G); 05 is refunded by the setup. */
const DONE_CODES = DONE_IDS.doneCards.map((_, i) => `${DN}-${nn(i + 1)}`);
const DONE_P = `${DN}-P`;
const DONE_G = `${DN}-G`;
const DONE_REFUNDED = DONE_CODES[4];
const COMPLETED_EVENT = "Status updated to: Completed";
const AUTO_EVENT = "order_auto_completed";
const NOTES_EMAILED_EVENT = "completion_notes_emailed";

/**
 * Puts the done order (CD-2700, Test Customer Reyes; seed.mjs buildDoneSeed) into the running mock,
 * once per reset. For a harness started by hand: HARNESS_MOCK_URL=… node --input-type=module -e
 * "await (await import('./tests/intake/e2e/scenarios.mjs')).seedDone()".
 */
export async function seedDone() {
  const t = await tables();
  if (t.orders.some((o) => o.id === DONE_ORDER)) return false;
  for (const [table, rows] of Object.entries(buildDoneSeed().tables)) if (rows.length) await insertRows(table, rows);
  return true;
}
/**
 * The done order as the done-order-complete* scenarios start it: CD-2700's 5 cards received on
 * 2026-11-20 through the API (bags CD-2700-P: 01-02, CD-2700-G: 03-05; status received, the
 * customer's "Cards Received" email), 05 refunded in the mock (it stays in its bag), a receiving
 * photo on 01-04; then the cards in `done` marked done through POST done, and `status` / `payment`
 * written to the order in the mock. Returns the tables.
 */
export async function doneOrderSetup(ctx, mockUrl, { done = [], status = null, payment = null } = {}) {
  await seedDone();
  await receiveViaApi(ctx, DONE_ORDER, DONE_IDS.doneCards, "2026-11-20");
  let t = await tables();
  DONE_IDS.doneCards.forEach((cid, i) => eq(t.cards.find((c) => c.id === cid)?.card_code, DONE_CODES[i], `${DONE_CARD_NAMES[i]}'s Card ID`));
  eq(bagCardCodes(t, DONE_P), DONE_CODES.slice(0, 2), `bag ${DONE_P}`);
  eq(bagCardCodes(t, DONE_G), DONE_CODES.slice(2), `bag ${DONE_G}`);
  const five = t.cards.find((c) => c.id === DONE_IDS.doneCards[4]);
  await mockUpdate(mockUrl, "cards", { status: "refunded", refunded_cents: five.service_price_cents }, "id", five.id);
  await setReceivingPhotos(mockUrl, DONE_IDS.doneCards.slice(0, 4));
  // cards first (while the order is still received), then the status / payment the scenario wants
  if (done.length) await trackOk(ctx, ROUTES.trackDone, { cardIds: done.map((code) => cardIdOf(t, code)) });
  const patch = { ...(status ? { status } : {}), ...(payment ? { payment_status: payment } : {}) };
  if (Object.keys(patch).length) await mockUpdate(mockUrl, "orders", patch, "id", DONE_ORDER);
  t = await tables();
  const o = t.orders.find((x) => x.id === DONE_ORDER);
  assert(!DONE_STATUSES_E2E.includes(o.status), `${DN} is ${o.status} after the setup (not every card is done)`);
  return t;
}
const DONE_STATUSES_E2E = ["completed", "shipped_back", "delivered"];
const doneOrderOf = (t) => t.orders.find((o) => o.id === DONE_ORDER);
/** The done order's scan landing has rendered (h1: the customer's name). */
const doneReady = (page) => page.getByRole("heading", { name: DONE_CUSTOMER.name }).first().waitFor({ timeout: 30_000 });
/** Where a bag is now: its place's code (tier_bags.location_id), or null. */
function bagPlaceCode(t, bagCode) {
  const b = bagByCode(t, bagCode);
  return (b?.location_id && t.locations.find((l) => l.id === b.location_id)?.code) || null;
}
/** Rows of `table` that weren't there before (dump() before and after). */
const newRows = (before, after, table) => {
  const old = new Set((before.tables[table] ?? []).map((r) => r.id));
  return (after.tables[table] ?? []).filter((r) => !old.has(r.id));
};
/** The customer's order-status email for Completed ("Update on your order — Completed") and the notes email ("Restoration complete — notes …"). */
const completedMails = (list, email) => mailsTo(list, email).filter((m) => /\bcompleted\b/i.test(m.subject ?? ""));
const notesMails = (list, email) => mailsTo(list, email).filter((m) => /\bnotes\b/i.test(m.subject ?? ""));
/** A database check: the card is marked done. */
const cardDone = (code) => async () => !!cardByCode(await tables(), code)?.completed;

/**
 * What marking a card done must do (`before`/`after`: dump() around it): done with completed_at,
 * back in its bag (cards.location_id null: not LOC-DONE, not the desk or holder it was in), one
 * new 'done' card_moves row from where it was to no place (a card that was already in its bag may
 * have none). Returns the problems found.
 */
function doneInBagProblems(before, after, code, fromCode) {
  const t = after.tables;
  const c = cardByCode(t, code);
  if (!c) return [`no card ${code}`];
  const out = [];
  if (!c.completed || !c.completed_at) out.push(`${code} not done (completed ${c.completed}, completed_at ${c.completed_at})`);
  if ((c.location_id ?? null) !== null) out.push(`${code} is at ${t.locations.find((l) => l.id === c.location_id)?.code ?? c.location_id}, not back in its bag (no place)`);
  const rows = newRows(before, after, "card_moves").filter((m) => m.card_id === c.id);
  const from = fromCode ? (placeOf(t, fromCode)?.id ?? `?${fromCode}`) : null;
  if (rows.length > 1 || (fromCode && rows.length !== 1)) out.push(`${code}: ${rows.length} new card_moves rows`);
  for (const m of rows) {
    if (m.action !== "done") out.push(`${code}: row action ${m.action}`);
    if ((m.from_location_id ?? null) !== from) out.push(`${code}: row from ${m.from_location_id}, it was at ${fromCode ?? "no place"}`);
    if ((m.to_location_id ?? null) !== null) out.push(`${code}: row to ${t.locations.find((l) => l.id === m.to_location_id)?.code ?? m.to_location_id} (back in its bag is no place)`);
  }
  return out;
}

/**
 * The order became Completed exactly once (`before`/`after`: dump() around the last Done): status
 * completed; exactly ONE customer email whose subject says Completed and ONE notes email (the
 * held notes), no other customer email; one customer-visible "Status updated to: Completed"
 * event; the notes logged as emailed once; at most one staff line (order_auto_completed).
 */
function checkOrderCompleted(before, after, { orderId = DONE_ORDER, email = DONE_CUSTOMER.email } = {}) {
  const problems = [];
  const o = after.tables.orders.find((x) => x.id === orderId);
  if (o?.status !== "completed") problems.push(`status ${o?.status}`);
  const fresh = after.emails.slice(before.emails.length);
  const c = completedMails(fresh, email), n = notesMails(fresh, email);
  const all = mailsTo(fresh, email);
  if (c.length !== 1) problems.push(`${c.length} "Completed" emails to the customer`);
  if (n.length !== 1) problems.push(`${n.length} notes emails`);
  if (all.length !== c.length + n.length) problems.push(`other customer emails: ${all.filter((m) => !c.includes(m) && !n.includes(m)).map((m) => m.subject).join(" | ").slice(0, 160)}`);
  const evs = newRows(before, after, "order_events").filter((e) => e.order_id === orderId);
  const st = evs.filter((e) => e.description === COMPLETED_EVENT);
  if (st.length !== 1) problems.push(`${st.length} "${COMPLETED_EVENT}" events`);
  else if (!st[0].is_customer_visible) problems.push(`"${COMPLETED_EVENT}" isn't customer visible`);
  const notesLogged = evs.filter((e) => e.event_type === NOTES_EMAILED_EVENT).length;
  if (notesLogged !== 1) problems.push(`${notesLogged} ${NOTES_EMAILED_EVENT} events`);
  const auto = evs.filter((e) => e.event_type === AUTO_EVENT);
  if (auto.length > 1) problems.push(`${auto.length} ${AUTO_EVENT} events`);
  if (auto.some((e) => e.is_customer_visible)) problems.push(`the ${AUTO_EVENT} line is customer visible`);
  assert(!problems.length, `${problems.join(" | ")} (all customer emails: ${all.map((m) => m.subject).join(" | ").slice(0, 200)})`);
  return `completed; "${c[0].subject}" + "${n[0].subject}"${auto.length ? `; staff line "${auto[0].description}"` : ""}`;
}
/** The order did NOT change (`status` kept): no status event, no customer email. */
function checkOrderUnchanged(before, after, { orderId = DONE_ORDER, email = DONE_CUSTOMER.email } = {}) {
  const was = before.tables.orders.find((x) => x.id === orderId)?.status;
  const now = after.tables.orders.find((x) => x.id === orderId)?.status;
  const problems = [];
  if (now !== was) problems.push(`status ${was} -> ${now}`);
  const evs = newRows(before, after, "order_events").filter((e) => e.order_id === orderId && e.event_type === "status_updated");
  if (evs.length) problems.push(`status events: ${evs.map((e) => e.description).join(" | ")}`);
  const mails = mailsTo(after.emails.slice(before.emails.length), email);
  if (mails.length) problems.push(`customer emails: ${mails.map((m) => m.subject).join(" | ").slice(0, 160)}`);
  assert(!problems.length, problems.join(" | "));
  return `still ${now}, no email`;
}

/**
 * Tap a button that saves and wait (2 min: a first compile) until `landed()`, a database check, is
 * true. If nothing was sent within 6 s the button is asking first: a dialog's "Yes, mark N done" /
 * "Yes" / "Confirm" is answered (or, in `scope`, "Tap again" / the same button again). Returns the
 * first POST to /api/admin/: its path, JSON body, status and JSON answer, and every POST path.
 */
async function tapAndLand(page, button, landed, { scope = null, ms = 120_000 } = {}) {
  const posts = [];
  const onRequest = (r) => { if (r.method() === "POST" && r.url().includes("/api/admin/")) posts.push(r); };
  page.on("request", onRequest);
  try {
    await button.click();
    // a question ("Mark all 2 cards done?" with "Yes, mark 2 done"): in a dialog, else inline on the page
    const dlg = page.getByRole("dialog").or(page.getByRole("alertdialog"));
    const inDialog = dlg.getByRole("button", { name: UI.doneConfirmRe }).first();
    const inPage = page.locator("main").first().getByRole("button", { name: UI.doneConfirmRe }).first();
    const asked = async () => (await inDialog.isVisible().catch(() => false)) || (await inPage.isVisible().catch(() => false));
    await until(async () => posts.length > 0 || (await asked()) || (await landed()), 6_000, 200);
    if (!posts.length && !(await landed())) {
      if (await inDialog.isVisible().catch(() => false)) await inDialog.click({ timeout: 5_000 }).catch(() => {});
      else if (await inPage.isVisible().catch(() => false)) await inPage.click({ timeout: 5_000 }).catch(() => {});
      else if (scope) await UI.deskConfirm(scope).click({ timeout: 5_000 }).catch(() => {});
    }
    const ok = await until(landed, ms, 500);
    const first = posts[0] ?? null;
    let body = null;
    try { body = first ? JSON.parse(first.postData() ?? "null") : null; } catch { /* not JSON */ }
    const res = first ? await first.response().catch(() => null) : null;
    let answer = null;
    try { answer = res ? await res.json() : null; } catch { /* not JSON */ }
    const pathOf = (r) => new URL(r.url()).pathname;
    return { ok: !!ok, path: first ? pathOf(first) : null, body, status: res?.status() ?? null, answer, posts: posts.map(pathOf) };
  } finally {
    page.off("request", onRequest);
  }
}
/** A line on the page (a status / alert / toast, else <main>'s text) matching `re` within `ms`: the text, or null. */
async function saidOnPage(page, re, ms = 20_000) {
  return until(async () => {
    const live = await UI.liveRegions(page).evaluateAll((els) => els.filter((e) => !e.closest("dialog")).map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)).catch(() => []);
    const hit = live.find((x) => re.test(x));
    if (hit) return hit;
    const txt = flat(await page.locator("main").first().innerText().catch(() => ""));
    const m = re.exec(txt);
    return m ? txt.slice(Math.max(0, m.index - 20), m.index + m[0].length + 40) : null;
  }, ms);
}
/** <main>'s text before the first group of cards (the header: name, counts, the "Bag:" line, the big step). */
const headText = async (page) => (await mainText(page)).split(/\n\s*(cards in this bag|(platinum|gold|silver|bronze|diamond|fast pass) · CD-)/i)[0];
/** The scan landing of `code` for the done order (or CD-2549), loaded. */
async function openDoneLanding(page, code) {
  await goto(page, ROUTES.open(code));
  if (code.startsWith(DN)) await doneReady(page);
  else await openReady(page);
}
/** A Done button on the scan landing in the card's panel (none: 0). */
const doneButtonsIn = (page, code, codes) => UI.doneCard(UI.openPanel(page, code, codes)).count();

const DONE_SCENARIOS = {
  // A done card put back in a holder (or left on the Done shelf) holds its bag back: no bin step, bag-ready 409,
  // the card says "Done · in CLAMP 07" with a Done that puts it back; a shipped-back order gets no bin step at all
  async "done-card-out"({ page, ctx, s, mockUrl }) {
    const OUT = "CD-2549-08";
    let t = null;
    await s.step(`setup: as bag-open-qr; CLAMP 01..07; ${BO_PLAT.join(", ")} all done (POST done); then ${OUT} (done) put in CLAMP 07 again`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await bulkSlots(ctx, "clamp", 7);
      await trackOk(ctx, ROUTES.trackDone, { cardIds: BO_PLAT.map((c) => cardIdOf(t, c)) });
      await assignOk(ctx, "LOC-CLAMP-07", [cardIdOf(t, OUT)]);
      t = await tables();
      eq([cardByCode(t, OUT).completed, cardsIn(t, "LOC-CLAMP-07")], [true, [OUT]], `${OUT} done, in CLAMP 07`);
    }, { critical: true, shot: false });
    await s.step(`POST bag-ready for ${BO_BAG}: refused "${OUT} is still in CLAMP 07: tap Done on it first."; the bag stays put`, async () => {
      const was = bagPlaceCode(await tables(), BO_BAG);
      const r = await api(ctx, "POST", ROUTES.trackBagReady, { bagId: bagByCode(t, BO_BAG).id });
      eq(r.status, 409, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
      eq(r.body?.error, `${OUT} is still in CLAMP 07: tap Done on it first.`, "error");
      eq(bagPlaceCode(await tables(), BO_BAG), was, `${BO_BAG} place`);
      return r.body.error;
    }, { shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: "3 of 3 done" but NO "Bag finished" step; ${OUT} says "Done · in CLAMP 07" with ONE "Done" button`, async () => {
      await openDoneLanding(page, BO_BAG);
      const problems = [];
      if (!(await textSeen(page, UI.doneCount(3, 3), 15_000))) problems.push('no "3 of 3 done"');
      if (UI.bagFinished.test(await mainText(page))) problems.push('"Bag finished" shows while a card is in CLAMP 07');
      if (await page.getByRole("button", { name: UI.readyToShipRe }).count()) problems.push("the Ready to ship button shows");
      const txt = await openPanelText(page, OUT);
      if (!/done · in CLAMP 07/i.test(txt)) problems.push(`${OUT}: "${txt.slice(0, 160)}"`);
      if ((await doneButtonsIn(page, OUT, BO_ALL)) !== 1) problems.push(`${OUT}: ${await doneButtonsIn(page, OUT, BO_ALL)} Done buttons`);
      for (const c of BO_PLAT.filter((c) => c !== OUT)) if (await doneButtonsIn(page, c, BO_ALL)) problems.push(`${c} (in its bag) has a Done button`);
      assert(!problems.length, problems.join(" | "));
    });
    await s.step(`tap ${OUT}'s "Done": back in its bag (no place, CLAMP 07 freed, one 'done' row); then the "Bag finished" step shows`, async () => {
      const before = await dump();
      const tap = await tapAndLand(page, UI.doneCard(UI.openPanel(page, OUT, BO_ALL)), async () => (cardByCode(await tables(), OUT)?.location_id ?? null) === null, { scope: UI.openPanel(page, OUT, BO_ALL) });
      if (!tap.ok) await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, OUT)] });
      const after = await dump();
      const problems = doneInBagProblems(before, after, OUT, "LOC-CLAMP-07");
      if (!tap.ok) problems.unshift(`the tap didn't put it back (POSTs: ${tap.posts.join(", ") || "none"}; done through the API instead)`);
      const step = await saidOnPage(page, UI.bagFinished, 20_000);
      if (!step) problems.push(`no "Bag finished" step after (the page says: "${flat(await mainText(page)).slice(0, 240)}")`);
      assert(!problems.length, problems.join(" | "));
      return tap.answer?.message ?? "";
    });
    await s.step(`the order shipped back (in the mock): reloaded, no "Bag finished" step; bag-ready refused "… the order was shipped back already."`, async () => {
      await mockUpdate(mockUrl, "orders", { status: "shipped_back" }, "order_number", BO_ORDER);
      await openDoneLanding(page, BO_BAG);
      const problems = [];
      if (UI.bagFinished.test(await mainText(page))) problems.push('"Bag finished" shows for a shipped-back order');
      if (await page.getByRole("button", { name: UI.readyToShipRe }).count()) problems.push("the Ready to ship button shows");
      const r = await api(ctx, "POST", ROUTES.trackBagReady, { bagId: bagByCode(t, BO_BAG).id });
      if (r.status !== 409 || r.body?.error !== `${BO_BAG} isn't going in the Ready to ship bin: the order was shipped back already.`) problems.push(`bag-ready HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      assert(!problems.length, problems.join(" | "));
      return r.body?.error;
    });
  },

  // One card done on the scan landing: back in its bag, its holder freed, the bag counts it
  async "done-one"({ page, ctx, s, mockUrl }) {
    const C = BO_STEP.code; // CD-2549-07
    const REST = BO_PLAT.filter((c) => c !== C);
    let t = null;
    await s.step(`setup: as bag-open-qr; CLAMP 01..07; ${C} put in CLAMP 07 (Clamp Work), so ${BO_BAG} goes in the Open bags box`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await bulkSlots(ctx, "clamp", 7);
      const r = await assignOk(ctx, "LOC-CLAMP-07", [cardIdOf(t, C)]);
      t = await tables();
      eq(cardsIn(t, "LOC-CLAMP-07"), [C], "cards in CLAMP 07");
      eq(latestStage(t, cardIdOf(t, C)), "Clamp Work", `${C} step`);
      return `${BO_BAG} at ${bagPlaceCode(t, BO_BAG) ?? "no place"}; "${r.message}"`;
    }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: "3 cards" (none done yet), "Bag: Open bags box · ${BO_LETTER}"; each card ONE "Done" (named "Done: <Card ID>"); ${C} "In CLAMP 07"`, async () => {
      await openDoneLanding(page, BO_BAG);
      eq(await openPanelsShown(page), BO_PLAT, "cards with a panel");
      const top = await headText(page);
      const problems = [];
      if (!countShown(top, 3)) problems.push('no "3 cards"');
      if (!UI.doneBagLine(UI.donePlace.openBags(BO_LETTER)).test(flat(top))) problems.push(`no "Bag: Open bags box · ${BO_LETTER}"`);
      for (const code of BO_PLAT) {
        const n = await doneButtonsIn(page, code, BO_ALL);
        if (n !== 1) problems.push(`${code}: ${n} Done buttons`);
      }
      if (!UI.openWhere.holder("CLAMP 07").test(await openPanelText(page, C))) problems.push(`${C} not "In CLAMP 07"`);
      const name = await nameOf(UI.doneCard(UI.openPanel(page, C, BO_ALL))).catch(() => "");
      if (!new RegExp(`^done\\b.*${esc(C)}`, "i").test(name)) problems.push(`${C}'s Done is named "${name}" (want "Done: ${C}")`);
      assert(!problems.length, `${problems.join(" | ")} (head: "${flat(top).slice(0, 240)}")`);
      return /bag:\s*[^\n]+/i.exec(top)?.[0] ?? "";
    });

    let before = null, tap = null;
    await s.step(`tap ${C}'s "Done": the card is done (one tap; POST done)`, async () => {
      before = await dump();
      tap = await tapAndLand(page, UI.doneCard(UI.openPanel(page, C, BO_ALL)), cardDone(C), { scope: UI.openPanel(page, C, BO_ALL) });
      assert(tap.ok, `${C} isn't done after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"}; ${tap.path ?? ""} ${tap.status ?? ""})`);
      return `${tap.path} ${tap.status} ${JSON.stringify(tap.body ?? {}).slice(0, 120)}`;
    });
    if (!cardByCode(await tables(), C)?.completed) {
      await s.step(`(fallback) Done on ${C} through the API`, async () => { before = before ?? (await dump()); await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, C)] }); }, { shot: false });
    }
    await s.step(`${C} back in its bag: done, no place (not LOC-DONE), CLAMP 07 empty and freed, one 'done' row CLAMP 07 -> no place; ${REST.join(", ")} untouched; ${BO_BAG} not finished, still in ${OPEN_BAGS}; order still received; no customer email`, async () => {
      const after = await dump();
      const t1 = after.tables;
      const problems = doneInBagProblems(before, after, C, "LOC-CLAMP-07");
      if (cardsIn(t1, "LOC-CLAMP-07").length) problems.push(`CLAMP 07 holds ${cardsIn(t1, "LOC-CLAMP-07").join(", ")}`);
      if (tap?.answer && Array.isArray(tap.answer.freed) && !freedCodes(tap.answer).includes("LOC-CLAMP-07")) problems.push(`the answer's freed: ${JSON.stringify(freedCodes(tap.answer))}`);
      for (const code of REST) {
        const was = cardByCode(before.tables, code), now = cardByCode(t1, code);
        if (!!now.completed !== !!was.completed || (now.location_id ?? null) !== (was.location_id ?? null)) problems.push(`${code} changed`);
      }
      if (bagByCode(t1, BO_BAG).completed_at) problems.push(`${BO_BAG} finished with 2 cards to go`);
      if (bagPlaceCode(t1, BO_BAG) !== OPEN_BAGS) problems.push(`${BO_BAG} at ${bagPlaceCode(t1, BO_BAG)}, not ${OPEN_BAGS}`);
      const was = before.tables.orders.find((o) => o.id === IDS.mailOrder).status, now = t1.orders.find((o) => o.id === IDS.mailOrder).status;
      if (now !== was) problems.push(`order ${was} -> ${now}`);
      const mails = mailsTo(after.emails.slice(before.emails.length), CUSTOMER_A);
      if (mails.length) problems.push(`customer emails: ${mails.map((m) => m.subject).join(" | ")}`);
      assert(!problems.length, problems.slice(0, 6).join(" | "));
      return tap?.answer?.message ?? "";
    }, { shot: false });
    await s.step(`the page says "Done. Put it back in ${BO_LAST}'s bag: Open bags box, under ${BO_LETTER}." (the API's message too)`, async () => {
      const re = UI.doneSentence(BO_LAST, UI.donePlaceIn.openBags(BO_LETTER));
      const msg = await saidOnPage(page, re);
      assert(msg, `not said (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      if (tap?.answer?.message) assert(re.test(tap.answer.message), `the API's message: "${tap.answer.message}"`);
      return msg;
    });
    await s.step(`header "1 of 3 done"; ${C} reads Done with no Done or move button; ${REST.join(", ")} keep their Done button; the same after a reload`, async () => {
      const check = async (when) => {
        const problems = [];
        if (!(await textSeen(page, UI.doneCount(1, 3), 20_000))) problems.push(`${when}: no "1 of 3 done"`);
        const txt = await openPanelText(page, C);
        if (!UI.openWhere.done.test(txt)) problems.push(`${when}: ${C} not "Done"`);
        const btns = await UI.openPanel(page, C, BO_ALL).getByRole("button", { name: /^(done|move)\b/i }).count();
        if (btns) problems.push(`${when}: ${C} has ${btns} Done/move buttons`);
        for (const code of REST) if ((await doneButtonsIn(page, code, BO_ALL)) !== 1) problems.push(`${when}: ${code} has no Done button`);
        return problems;
      };
      const p = await check("before a reload");
      await openDoneLanding(page, BO_BAG);
      p.push(...(await check("reloaded")));
      assert(!p.length, p.join(" | "));
    });
    await s.step("the same Done request again changes nothing (no row, no email, still in its bag)", async () => {
      const path = tap?.path ?? ROUTES.trackDone;
      const body = tap?.body ?? { cardIds: [cardIdOf(t, C)] };
      const t0 = await dump();
      const r = await api(ctx, "POST", path, body);
      eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
      const t1 = await dump();
      eq(t1.tables.card_moves.length, t0.tables.card_moves.length, "card_moves rows");
      eq(t1.emails.length, t0.emails.length, "emails");
      eq(cardByCode(t1.tables, C).location_id ?? null, null, `${C} place`);
      return `${path}: "${r.body?.message ?? ""}"`;
    }, { shot: false });
  },

  // The first card out of a bag files the BAG in the Open bags box, under the last name's first letter
  async "done-open-bags"({ page, ctx, s, mockUrl }) {
    let t = null;
    await s.step(`setup: as bag-open-qr; CLAMP 01..02; no ${OPEN_BAGS} yet`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await bulkSlots(ctx, "clamp", 2);
      t = await tables();
      assert(!placeOf(t, OPEN_BAGS), `${OPEN_BAGS} exists before any card left a bag`);
      return `${BO_BAG} at ${bagPlaceCode(t, BO_BAG) ?? "no place"}, CD-2549-G at ${bagPlaceCode(t, "CD-2549-G") ?? "no place"} (as received)`;
    }, { critical: true, shot: false });
    let first = null;
    await s.step(`${ROUTES.open(BO_BAG)}: CD-2549-08's "Move to my desk": the card at ${DESK}; its bag ${BO_BAG} in ${OPEN_BAGS} (made: kind other, "OPEN BAGS"); CD-2549-G where it was`, async () => {
      await openDoneLanding(page, BO_BAG);
      const before = await tables();
      first = await openTapMove(page, UI.openMoveOne(UI.openPanel(page, "CD-2549-08", BO_ALL)), allAt(["CD-2549-08"], DESK));
      assert(first.ok, `CD-2549-08 isn't at ${DESK} after 2 minutes (POSTs: ${first.posts.join(", ") || "none"})`);
      const t1 = await tables();
      const boxes = t1.locations.filter((l) => l.code === OPEN_BAGS);
      eq(boxes.length, 1, `${OPEN_BAGS} places`);
      eq([boxes[0].kind, boxes[0].active], ["other", true], `${OPEN_BAGS} kind, active`);
      assert(/^open bags$/i.test(boxes[0].name), `${OPEN_BAGS} is named "${boxes[0].name}"`);
      eq(bagPlaceCode(t1, BO_BAG), OPEN_BAGS, `${BO_BAG} place`);
      eq(bagPlaceCode(t1, "CD-2549-G"), bagPlaceCode(before, "CD-2549-G"), "CD-2549-G place (none of its cards came out)");
      return `${first.path} ${first.status}; ${BO_BAG} located_at ${bagByCode(t1, BO_BAG).located_at ?? "(not set)"}`;
    });
    await s.step(`the page says "Put the bag in the Open bags box, under ${BO_LETTER}."`, async () => {
      const msg = await saidOnPage(page, UI.putBagInOpenBags(BO_LETTER));
      assert(msg, `not said (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      return msg;
    });
    await s.step(`CD-2549-09's "Move to my desk" too: ${BO_BAG} stays in ${OPEN_BAGS}, still one ${OPEN_BAGS} place`, async () => {
      const tap = await openTapMove(page, UI.openMoveOne(UI.openPanel(page, "CD-2549-09", BO_ALL)), allAt(["CD-2549-09"], DESK));
      assert(tap.ok, `CD-2549-09 isn't at ${DESK} (POSTs: ${tap.posts.join(", ") || "none"})`);
      const t1 = await tables();
      eq(bagPlaceCode(t1, BO_BAG), OPEN_BAGS, `${BO_BAG} place`);
      eq(t1.locations.filter((l) => l.code === OPEN_BAGS).length, 1, `${OPEN_BAGS} places`);
    }, { shot: false });
    await s.step(`a holder (API): CD-2549-01 into CLAMP 01: CD-2549-G in ${OPEN_BAGS}; the answer's bags[] names it (opened, letter ${BO_LETTER}) and its message says "Put the bag in the Open bags box, under ${BO_LETTER}."`, async () => {
      const r = await assignOk(ctx, "LOC-CLAMP-01", [cardIdOf(t, "CD-2549-01")]);
      eq(bagPlaceCode(await tables(), "CD-2549-G"), OPEN_BAGS, "CD-2549-G place");
      const bag = (r.bags ?? []).find((b) => b.code === "CD-2549-G");
      const problems = [];
      if (!bag) problems.push(`no CD-2549-G in bags ${JSON.stringify(r.bags ?? null).slice(0, 160)}`);
      else {
        if (bag.opened !== true) problems.push(`opened ${bag.opened}`);
        if (bag.letter !== BO_LETTER) problems.push(`letter ${bag.letter}`);
        if (bag.location?.code !== OPEN_BAGS) problems.push(`location ${bag.location?.code}`);
      }
      if (!UI.putBagInOpenBags(BO_LETTER).test(r.message ?? "")) problems.push(`message "${r.message}"`);
      assert(!problems.length, problems.join(" | "));
      return r.message;
    }, { shot: false });
    await s.step(`resolve ${BO_BAG} and CD-2549-G: location ${OPEN_BAGS}; reloaded, the scan landing says "Bag: Open bags box · ${BO_LETTER}"`, async () => {
      for (const code of [BO_BAG, "CD-2549-G"]) eq((await resolveVia(ctx, code, "bag")).location?.code ?? null, OPEN_BAGS, `${code} location`);
      await openDoneLanding(page, BO_BAG);
      const top = flat(await headText(page));
      assert(UI.doneBagLine(UI.donePlace.openBags(BO_LETTER)).test(top), `no "Bag: Open bags box · ${BO_LETTER}": "${top.slice(0, 240)}"`);
    });
    await s.step(`the Bags board: the rows of ${BO_BAG} and CD-2549-G say "Open bags · ${BO_LETTER}"`, async () => {
      await goto(page, ROUTES.bags);
      const problems = [];
      for (const code of [BO_BAG, "CD-2549-G"]) {
        const row = UI.boardRow(page, code);
        const txt = (await row.count()) ? flat(await row.first().innerText()) : "";
        if (!UI.donePlace.openBags(BO_LETTER).test(txt)) problems.push(`${code}'s row: "${txt.slice(0, 160)}"`);
      }
      assert(!problems.length, problems.join(" | "));
    });
    await s.step(`the done order ${DN} (${DONE_CUSTOMER.name}): ${ROUTES.open(DONE_P)} "Move all 2 cards to my desk": ${DONE_P} in ${OPEN_BAGS} under ${DONE_CUSTOMER.letter}; the page says "2 cards are on your desk" and "Put the bag in the Open bags box, under ${DONE_CUSTOMER.letter}."`, async () => {
      await seedDone();
      await receiveViaApi(ctx, DONE_ORDER, DONE_IDS.doneCards.slice(0, 4), "2026-11-20");
      await openDoneLanding(page, DONE_P);
      const tap = await openTapMove(page, UI.openMoveAll(page), allAt(DONE_CODES.slice(0, 2), DESK));
      assert(tap.ok, `the 2 aren't at ${DESK} (POSTs: ${tap.posts.join(", ") || "none"})`);
      eq(bagPlaceCode(await tables(), DONE_P), OPEN_BAGS, `${DONE_P} place`);
      const moved = await saidOnPage(page, UI.openMoved(2));
      const msg = await saidOnPage(page, UI.putBagInOpenBags(DONE_CUSTOMER.letter));
      assert(moved && msg, `the page says: "${flat(await mainText(page)).slice(0, 300)}"`);
      return msg;
    });
    await s.step(`the bag labels carry the filing letter: ${BO_BAG} "${BO_LETTER}", ${DONE_P} "${DONE_CUSTOMER.letter}" (a text of its own; its size and the name's reported)`, async () => {
      const t1 = await tables();
      const out = [];
      for (const [code, letter, name] of [[BO_BAG, BO_LETTER, BO_CUSTOMER], [DONE_P, DONE_CUSTOMER.letter, DONE_CUSTOMER.name]]) {
        const body = await labelJson(ctx, ROUTES.bagLabel(bagByCode(t1, code).id, "?format=json"));
        const p = body.bags?.[0]?.labels?.[0];
        assert(isLabelPage(p), `${code}: no label page in ${JSON.stringify(body).slice(0, 160)}`);
        const all = texts(p);
        const mark = all.filter((e) => String(e.text).trim() === letter);
        assert(mark.length >= 1, `${code}: no "${letter}" on its label (texts: ${all.map((e) => e.text).join(" | ").slice(0, 200)})`);
        // the name as printed (upper case, maybe over two lines), not the letter
        const isName = (e) => { const x = norm(e.text); return x.length > 1 && norm(name).includes(x); };
        const nameSize = Math.max(0, ...all.filter(isName).map((e) => e.size));
        out.push(`${code}: "${letter}" ${Math.max(...mark.map((e) => e.size)).toFixed(0)} pt, name ${nameSize.toFixed(0)} pt`);
      }
      return out.join("; ");
    }, { shot: false });
  },

  // The bag's last card done: "Bag finished: put it in the Ready to ship bin", one tap puts the bag at LOC-SHIP
  async "done-bag-finished"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const LAST = "CD-2549-09";
    let t = null;
    await s.step(`setup: as bag-open-qr; CD-2549-07 + -08 done (POST done: back in the bag, no place); ${LAST} on ${DESK} (${BO_BAG} -> ${OPEN_BAGS})`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await trackOk(ctx, ROUTES.trackDone, { cardIds: ["CD-2549-07", "CD-2549-08"].map((c) => cardIdOf(t, c)) });
      await ensureDesk(ctx);
      await assignOk(ctx, DESK, [cardIdOf(t, LAST)]);
      t = await tables();
      for (const code of ["CD-2549-07", "CD-2549-08"]) eq([cardByCode(t, code).completed, cardByCode(t, code).location_id ?? null], [true, null], `${code} done, no place (in its bag)`);
      eq(bagPlaceCode(t, BO_BAG), OPEN_BAGS, `${BO_BAG} place`);
    }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(BO_BAG)}: "2 of 3 done"; ${LAST} "On your desk" with "Done"; no "Bag finished" yet`, async () => {
      await openDoneLanding(page, BO_BAG);
      const problems = [];
      if (!(await textSeen(page, UI.doneCount(2, 3), 15_000))) problems.push('no "2 of 3 done"');
      if (!UI.openWhere.desk.test(await openPanelText(page, LAST))) problems.push(`${LAST} not "On your desk"`);
      if ((await doneButtonsIn(page, LAST, BO_ALL)) !== 1) problems.push(`${LAST}: no Done button`);
      if (UI.bagFinished.test(await mainText(page))) problems.push('"Bag finished" already shows');
      assert(!problems.length, problems.join(" | "));
    });
    let before = null;
    await s.step(`tap ${LAST}'s "Done": done, back in its bag (off ${DESK}); ${BO_BAG} finished (completed_at) but NOT moved yet (still ${OPEN_BAGS}); order not completed (Gold bag open); no customer email`, async () => {
      before = await dump();
      let tap;
      try {
        tap = await tapAndLand(page, UI.doneCard(UI.openPanel(page, LAST, BO_ALL)), cardDone(LAST), { scope: UI.openPanel(page, LAST, BO_ALL) });
      } catch (e) {
        tap = { ok: false, posts: [`(the tap failed: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)})`], answer: null };
      }
      if (!tap.ok) await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, LAST)] });
      const after = await dump();
      const problems = doneInBagProblems(before, after, LAST, DESK);
      if (!tap.ok) problems.unshift(`the tap didn't mark it done (POSTs: ${tap.posts.join(", ") || "none"}; done through the API instead)`);
      const bag = bagByCode(after.tables, BO_BAG);
      if (!bag.completed_at) problems.push(`${BO_BAG} not finished`);
      if (bagPlaceCode(after.tables, BO_BAG) !== OPEN_BAGS) problems.push(`${BO_BAG} at ${bagPlaceCode(after.tables, BO_BAG)} before the Ready to ship tap`);
      if (DONE_STATUSES_E2E.includes(after.tables.orders.find((o) => o.id === IDS.mailOrder).status)) problems.push("the order was completed");
      if (mailsTo(after.emails.slice(before.emails.length), CUSTOMER_A).length) problems.push("a customer email went out");
      if (tap.answer && !(tap.answer.bags ?? []).some((b) => b.code === BO_BAG && b.finished)) problems.push(`the answer's bags[] doesn't say ${BO_BAG} finished: ${JSON.stringify(tap.answer.bags ?? null).slice(0, 160)}`);
      assert(!problems.length, problems.join(" | "));
      return tap.answer?.message ?? "";
    });
    await s.step(`ONE big step: "Bag finished: put it in the Ready to ship bin" (sub line "${BO_BAG} · 3 of 3 done") with ONE "It's in the Ready to ship bin" (44+ px)`, async () => {
      const msg = await saidOnPage(page, UI.bagFinished, 20_000);
      assert(msg, `no "Bag finished: put it in the Ready to ship bin" (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      const btn = page.getByRole("button", { name: UI.readyToShipRe });
      assert(await until(async () => (await btn.count()) === 1, 15_000), `${await btn.count()} "It's in the Ready to ship bin" buttons`);
      const box = await btn.first().boundingBox();
      assert(box && box.height >= 44, `the button is ${box ? Math.round(box.height) : "not"} px tall`);
      const text = flat(await mainText(page));
      assert(new RegExp(`${esc(BO_BAG)}\\s*·\\s*3 of 3 done`, "i").test(text) || UI.doneCount(3, 3).test(text), `no "${BO_BAG} · 3 of 3 done"`);
      return msg;
    });
    let ready = null;
    await s.step(`tap "It's in the Ready to ship bin": ${BO_BAG} at ${SHIP_PLACE} (POST bag-ready); its cards still in it (no place); the page says "In the Ready to ship bin"`, async () => {
      const b0 = await dump();
      ready = await tapAndLand(page, page.getByRole("button", { name: UI.readyToShipRe }).first(), async () => bagPlaceCode(await tables(), BO_BAG) === SHIP_PLACE);
      assert(ready.ok, `the tap didn't put it at ${SHIP_PLACE} (POSTs: ${ready.posts.join(", ") || "none"}; ${ready.path ?? ""} ${ready.status ?? ""} ${JSON.stringify(ready.answer ?? null).slice(0, 160)})`);
      const t1 = await tables();
      for (const code of BO_PLAT) eq(cardByCode(t1, code).location_id ?? null, null, `${code} place (in its bag)`);
      eq(mailsTo((await emails()).slice(b0.emails.length), CUSTOMER_A).length, 0, "customer emails");
      const after = await saidOnPage(page, UI.inShipBin, 20_000);
      assert(after, `no "In the Ready to ship bin" (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      return `${ready.path} ${ready.status}: "${ready.answer?.message ?? ""}"`;
    });
    if (bagPlaceCode(await tables(), BO_BAG) !== SHIP_PLACE) {
      await s.step(`(fallback) POST bag-ready for ${BO_BAG}`, async () => {
        const r = await api(ctx, "POST", ROUTES.trackBagReady, { bagId: bagByCode(await tables(), BO_BAG).id });
        assert(r.status === 200 && bagPlaceCode(await tables(), BO_BAG) === SHIP_PLACE, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
        return r.body?.message ?? "";
      }, { critical: true, shot: false });
    }
    await s.step("tapping it again / the same request again changes nothing (changed false)", async () => {
      const b0 = await dump();
      const r = await api(ctx, "POST", ready?.path ?? ROUTES.trackBagReady, ready?.body ?? { bagId: bagByCode(b0.tables, BO_BAG).id });
      eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
      if ("changed" in (r.body ?? {})) eq(r.body.changed, false, "changed");
      const b1 = await dump();
      eq(bagPlaceCode(b1.tables, BO_BAG), SHIP_PLACE, `${BO_BAG} place`);
      eq(b1.emails.length, b0.emails.length, "emails");
      return r.body?.message ?? "";
    }, { shot: false });
    await s.step(`reloaded: "3 of 3 done", "Bag: Ready to ship", no Done buttons, no "It's in the Ready to ship bin" button`, async () => {
      await openDoneLanding(page, BO_BAG);
      const problems = [];
      if (!(await textSeen(page, UI.doneCount(3, 3), 15_000))) problems.push('no "3 of 3 done"');
      if (!UI.doneBagLine(UI.donePlace.ship).test(flat(await headText(page)))) problems.push('no "Bag: Ready to ship"');
      const dones = await page.locator("main").first().getByRole("button", { name: /^done\b/i }).count();
      if (dones) problems.push(`${dones} Done buttons`);
      if (await page.getByRole("button", { name: UI.readyToShipRe }).count()) problems.push('the "It\'s in the Ready to ship bin" button is back');
      assert(!problems.length, `${problems.join(" | ")} ("${flat(await headText(page)).slice(0, 200)}")`);
    });
    await s.step(`POST bag-ready for CD-2549-G (cards not done): refused "Not every card in CD-2549-G is done yet (0 of 4 done).", the bag stays put`, async () => {
      const t1 = await tables();
      const was = bagPlaceCode(t1, "CD-2549-G");
      const r = await api(ctx, "POST", ROUTES.trackBagReady, { bagId: bagByCode(t1, "CD-2549-G").id });
      assert(r.status >= 400 && r.status < 500, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      assert(/not every card in CD-2549-G is done yet \(0 of 4 done\)/i.test(r.body?.error ?? ""), `error "${r.body?.error}"`);
      eq(bagPlaceCode(await tables(), "CD-2549-G"), was, "CD-2549-G place");
      return `HTTP ${r.status}: ${r.body?.error}`;
    }, { shot: false });
    await s.step(`the Bags board says ${BO_BAG} is "Ready to ship" (its own row, or CD-2549-G's list of the order's other bags: "${BO_BAG} … (done · Ready to ship)"); CD-2549-G's row "0 of 4 done"; ship check of ${BO_BAG}: ready`, async () => {
      await goto(page, ROUTES.bags);
      const problems = [];
      const rowG = UI.boardRow(page, "CD-2549-G");
      const g = (await rowG.count()) ? flat(await rowG.first().innerText()) : "";
      if (!g) problems.push("no row for CD-2549-G");
      else if (!UI.doneCount(0, 4).test(g)) problems.push(`CD-2549-G's row: "${g.slice(0, 160)}"`);
      const rowP = UI.boardRow(page, BO_BAG);
      const p = (await rowP.count()) ? flat(await rowP.first().innerText()) : "";
      const own = !!p && UI.donePlace.ship.test(p);
      const listed = new RegExp(`${esc(BO_BAG)}[^()]*\\(done · ready to ship\\)`, "i").test(g);
      if (!own && !listed) problems.push(`"Ready to ship" for ${BO_BAG} neither in its own row ("${p.slice(0, 100)}") nor in CD-2549-G's ("${g.slice(0, 160)}")`);
      const chk = await shipCheckVia(ctx, BO_BAG);
      if (chk.ready !== true) problems.push(`ship check ready ${chk.ready}`);
      // Finished bags waiting to ship: their own section, the bag's row saying it's in the bin
      const ready = UI.readyRow(page, BO_BAG);
      const r = (await ready.count()) ? flat(await ready.first().innerText()) : "";
      if (!r) problems.push(`${BO_BAG} not under "Ready to ship"`);
      else if (!UI.inShipBin.test(r)) problems.push(`${BO_BAG}'s Ready to ship row: "${r.slice(0, 160)}"`);
      if (await UI.readyRow(page, "CD-2549-G").count()) problems.push('CD-2549-G (0 of 4 done) under "Ready to ship"');
      const href = (await ready.count()) ? await ready.first().getByRole("link", { name: `Open bag ${BO_BAG}`, exact: true }).getAttribute("href") : null;
      if (r && href !== ROUTES.open(BO_BAG)) problems.push(`its "Open bag" goes to ${href}, not the scan landing`);
      assert(!problems.length, problems.join(" | "));
      const w = await phoneShot(browser, appUrl, ROUTES.bags, "done-bag-finished-board");
      assert(!w, w);
      return own ? `${BO_BAG}'s own row: "${p.slice(0, 80)}"` : `in CD-2549-G's row: "${g.slice(0, 120)}"`;
    });
  },

  // The order's last card done on the scan landing ("Mark all N done"): Completed, ONE email, the held notes
  async "done-order-complete"({ page, ctx, s, mockUrl }) {
    const LEFT = DONE_CODES.slice(2, 4); // CD-2700-03, -04
    let t = null;
    await s.step(`setup: ${DN} (${DONE_CUSTOMER.name}) received (bags ${DONE_P}: 01-02, ${DONE_G}: 03-05), ${DONE_REFUNDED} refunded; ${DONE_P}'s 01 + 02 done (POST done): the order NOT completed, no Completed email`, async () => {
      const b0 = await dump();
      t = await doneOrderSetup(ctx, mockUrl);
      const b1 = await dump();
      await trackOk(ctx, ROUTES.trackDone, { cardIds: DONE_CODES.slice(0, 2).map((c) => cardIdOf(t, c)) });
      const after = await dump();
      t = after.tables;
      eq(doneOrderOf(t).status, "received", `${DN} status`);
      eq(completedMails(after.emails.slice(b1.emails.length), DONE_CUSTOMER.email).length, 0, "Completed emails");
      return `${mailsTo(after.emails.slice(b0.emails.length), DONE_CUSTOMER.email).map((m) => m.subject).join(" | ")}`;
    }, { critical: true, shot: false });
    await s.step(`${ROUTES.open(DONE_G)}: "2 cards" (refunded not counted); ${DONE_REFUNDED} "Refunded" without a Done button; ONE "Mark all 2 done"`, async () => {
      await openDoneLanding(page, DONE_G);
      const problems = [];
      eq(await openPanelsShown(page, DONE_CODES), DONE_CODES.slice(2), "cards with a panel");
      if (!countShown(await headText(page), 2)) problems.push('no "2 cards"');
      if (!UI.openWhere.refunded.test(await openPanelText(page, DONE_REFUNDED, DONE_CODES))) problems.push(`${DONE_REFUNDED} not "Refunded"`);
      if (await doneButtonsIn(page, DONE_REFUNDED, DONE_CODES)) problems.push(`${DONE_REFUNDED} has a Done button`);
      const all = page.getByRole("button", { name: UI.doneAllRe });
      if ((await all.count()) !== 1) problems.push(`${await all.count()} "Mark all" buttons`);
      else if (!/^mark all 2 done$/i.test(await nameOf(all.first()))) problems.push(`it reads "${await nameOf(all.first())}"`);
      assert(!problems.length, problems.join(" | "));
    });
    let before = null, tap = null;
    await s.step(`tap "Mark all 2 done" (confirm "Mark all 2 cards done?" -> "Yes, mark 2 done"): 03 and 04 done, back in their bag`, async () => {
      before = await dump();
      tap = await tapAndLand(page, UI.doneAll(page), async () => { const t1 = await tables(); return LEFT.every((c) => cardByCode(t1, c)?.completed); });
      assert(tap.ok, `not both done after 2 minutes (POSTs: ${tap.posts.join(", ") || "none"})`);
      if (Array.isArray(tap.body?.cardIds)) eq(sorted(tap.body.cardIds), sorted(LEFT.map((c) => cardIdOf(t, c))), "cardIds sent (03, 04: not the refunded 05)");
      const after = await dump();
      const problems = LEFT.flatMap((c) => doneInBagProblems(before, after, c, null));
      assert(!problems.length, problems.join(" | "));
      return `${tap.path} ${tap.status}`;
    });
    if (!(await tables()).cards.filter((c) => LEFT.includes(c.card_code)).every((c) => c.completed)) {
      await s.step("(fallback) 03 and 04 done through the API", async () => { before = before ?? (await dump()); await trackOk(ctx, ROUTES.trackDone, { cardIds: LEFT.map((c) => cardIdOf(t, c)) }); }, { shot: false });
    }
    await s.step(`the order is Completed: ONE "Completed" email to ${DONE_CUSTOMER.email} and ONE notes email (held notes), one "${COMPLETED_EVENT}" event; ${DONE_REFUNDED} (refunded) still not done`, async () => {
      const after = await dump();
      const r = checkOrderCompleted(before, after);
      const five = cardByCode(after.tables, DONE_REFUNDED);
      eq([five.status, !!five.completed], ["refunded", false], `${DONE_REFUNDED} status, done`);
      return r;
    }, { shot: false });
    await s.step(`the page says "${DONE_G} … Bag finished: put it in the Ready to ship bin" and the order's line ("Order completed. ${DONE_CUSTOMER.name} emailed.")`, async () => {
      const finished = await saidOnPage(page, UI.bagFinished);
      const done = await saidOnPage(page, UI.orderCompletedLine(DONE_CUSTOMER.name), 5_000);
      assert(finished, `no "Bag finished: put it in the Ready to ship bin" (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      assert(done, `no "Order completed. ${DONE_CUSTOMER.name} emailed." (the page says: "${flat(await mainText(page)).slice(0, 300)}"; the answer: ${JSON.stringify(tap?.answer?.orderCompletions ?? null).slice(0, 200)})`);
      return `${finished} | ${done}`;
    });
    await s.step(`the Bags board: the Completed order's bags ${DONE_P} and ${DONE_G} are off the open bags and under "Ready to ship", each "Not in the bin yet"`, async () => {
      await goto(page, ROUTES.bags);
      const problems = [];
      for (const code of [DONE_P, DONE_G]) {
        const row = UI.readyRow(page, code);
        const txt = (await row.count()) ? flat(await row.first().innerText()) : "";
        if (!txt) problems.push(`${code} not under "Ready to ship"`);
        else if (!UI.notInBin.test(txt)) problems.push(`${code}'s row: "${txt.slice(0, 160)}"`);
        if (await page.getByRole("list", { name: "Open bags" }).locator("li").filter({ has: page.getByRole("link", { name: `Open bag ${code}`, exact: true }) }).count()) problems.push(`${code} still among the open bags`);
      }
      assert(!problems.length, problems.join(" | "));
      return flat(await UI.readySection(page).innerText()).slice(0, 200);
    });
    await s.step("the same Mark-all request again: nothing new (no email, no event)", async () => {
      const b0 = await dump();
      const r = await api(ctx, "POST", tap?.path ?? ROUTES.trackDone, tap?.body ?? { cardIds: LEFT.map((c) => cardIdOf(t, c)) });
      eq(r.status, 200, `HTTP (${JSON.stringify(r.body).slice(0, 160)})`);
      const b1 = await dump();
      eq(b1.emails.length, b0.emails.length, "emails");
      eq(newRows(b0, b1, "order_events").filter((e) => e.order_id === DONE_ORDER).map((e) => e.description), [], "new order events");
    }, { shot: false });
    await s.step(`un-doing ${LEFT[0]} later (the order page's toggle, POST cards/<id>/complete) does NOT un-complete the order; no email`, async () => {
      const b0 = await dump();
      const r = await api(ctx, "POST", ROUTES.cardComplete(cardIdOf(t, LEFT[0])), {});
      eq([r.status, r.body?.completed], [200, false], "toggle answer (HTTP, completed)");
      const b1 = await dump();
      eq(cardByCode(b1.tables, LEFT[0]).completed, false, `${LEFT[0]} done`);
      return `${checkOrderUnchanged(b0, b1)}; ${DONE_G} completed_at ${bagByCode(b1.tables, DONE_G).completed_at ?? "cleared (reopened)"}`;
    }, { shot: false });
    await s.step(`marking ${LEFT[0]} done again (POST done): still Completed, no second Completed email, no new status event`, async () => {
      const b0 = await dump();
      await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, LEFT[0])] });
      const b1 = await dump();
      eq(cardByCode(b1.tables, LEFT[0]).completed, true, `${LEFT[0]} done`);
      return checkOrderUnchanged(b0, b1);
    }, { shot: false });
  },

  // The order's last card done on the Desk page (order In Progress): Completed, ONE email; the back-in-its-bag sentence names REYES
  async "done-order-complete-desk"({ page, ctx, s, mockUrl }) {
    const LAST = DONE_CODES[3];
    let t = null;
    await s.step(`setup: ${DN} received, ${DONE_REFUNDED} refunded, the order In Progress (in the mock); 01-03 done; ${LAST} on ${DESK} (${DONE_G} -> ${OPEN_BAGS})`, async () => {
      t = await doneOrderSetup(ctx, mockUrl, { status: "in_progress", done: DONE_CODES.slice(0, 3) });
      await ensureDesk(ctx);
      await assignOk(ctx, DESK, [cardIdOf(t, LAST)]);
      t = await tables();
      eq(doneOrderOf(t).status, "in_progress", `${DN} status`);
      eq(bagPlaceCode(t, DONE_G), OPEN_BAGS, `${DONE_G} place`);
    }, { critical: true, shot: false });
    await s.step(`the Desk page (?desk=${DESK}): ${LAST}'s panel`, async () => {
      await goto(page, ROUTES.deskAt(DESK));
      eq(await waitPanels(page, [LAST], DONE_CODES), [LAST], "cards with a panel");
    });
    let before = null;
    await s.step(`${LAST}: "Done" (its "Mark it done? Then put it back in its bag." answered): done, back in its bag (off the desk)`, async () => {
      before = await dump();
      const panel = UI.deskPanel(page, LAST, DONE_CODES);
      await tapToSave(page, UI.deskDone(panel), panel);
      await until(cardDone(LAST), 15_000);
      const problems = doneInBagProblems(before, await dump(), LAST, DESK);
      assert(!problems.length, problems.join(" | "));
    });
    if (!cardByCode(await tables(), LAST)?.completed) {
      await s.step(`(fallback) Done on ${LAST} through the API`, async () => { before = before ?? (await dump()); await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, LAST)] }); }, { shot: false });
    }
    await s.step(`the order (In Progress) is Completed: ONE Completed email, ONE notes email, one status event`, async () => checkOrderCompleted(before, await dump()), { shot: false });
    await s.step(`the Desk says "Done. Put it back in REYES's bag: Open bags box, under ${DONE_CUSTOMER.letter}.", "Bag finished: put it in the Ready to ship bin." with "Open REYES's bag", and "Order completed. ${DONE_CUSTOMER.name} emailed."; ${LAST}'s panel is gone`, async () => {
      const sentence = await saidOnPage(page, UI.doneSentence(DONE_CUSTOMER.lastName, UI.donePlaceIn.openBags(DONE_CUSTOMER.letter)));
      const finished = await saidOnPage(page, UI.bagFinished, 5_000);
      const ordered = await saidOnPage(page, UI.orderCompletedLine(DONE_CUSTOMER.name), 5_000);
      const problems = [];
      if (!sentence) problems.push(`no "Done. Put it back in ${DONE_CUSTOMER.lastName.toUpperCase()}'s bag: Open bags box, under ${DONE_CUSTOMER.letter}."`);
      if (!finished) problems.push('no "Bag finished: put it in the Ready to ship bin."');
      if (!ordered) problems.push(`no "Order completed. ${DONE_CUSTOMER.name} emailed."`);
      const link = page.getByRole("link", { name: new RegExp(`^open ${esc(DONE_CUSTOMER.lastName)}['’]s bag$`, "i") }).first();
      if (!(await link.count())) problems.push(`no "Open ${DONE_CUSTOMER.lastName.toUpperCase()}'s bag" link`);
      else {
        const href = new URL(await link.getAttribute("href"), "http://x");
        if (decodeURIComponent(href.pathname).toUpperCase() !== ROUTES.open(DONE_G).toUpperCase()) problems.push(`the link goes to ${href.pathname}`);
      }
      // the panel goes when the Desk page's refresh lands (seconds in next dev)
      const t0 = Date.now();
      const gone = await until(async () => (await UI.deskPanel(page, LAST, DONE_CODES).count()) === 0, 20_000);
      if (!gone) problems.push(`${LAST}'s panel is still there after 20 s`);
      assert(!problems.length, `${problems.join(" | ")} (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      return `${sentence}; the panel went ${Date.now() - t0} ms after the words showed`;
    });
  },

  // The order's last card done with the card page's step picker "Done": Completed, ONE email
  async "done-order-complete-card-page"({ page, ctx, s, mockUrl }) {
    const LAST = DONE_CODES[3];
    let t = null, before = null;
    await s.step(`setup: ${DN} received, ${DONE_REFUNDED} refunded; 01-03 done`, async () => {
      t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 3) });
    }, { critical: true, shot: false });
    await s.step(`${LAST}'s card page: the step picker's "Done" (POST /api/admin/intake/stages): done; the line "Marked done. Put it back in REYES's bag…"`, async () => {
      await goto(page, ROUTES.card(cardIdOf(t, LAST)));
      before = await dump();
      const res = await clickForApi(page, UI.markDone(page), "/api/admin/intake/stages");
      assert(res.status() < 300, `stages answered ${res.status()}: ${await res.text()}`);
      assert(cardByCode(await tables(), LAST).completed, `${LAST} not done`);
      const body = await res.json().catch(() => null);
      const line = await saidOnPage(page, UI.doneSentence(DONE_CUSTOMER.lastName, "", "marked done"), 10_000);
      return `${line ?? "(no \"Marked done. Put it back in …\" line)"}; orderCompletion ${JSON.stringify(body?.orderCompletion ?? null).slice(0, 160)}`;
    });
    if (!cardByCode(await tables(), LAST)?.completed) {
      await s.step(`(fallback) ${LAST} done through the stages API`, async () => {
        before = before ?? (await dump());
        const r = await api(ctx, "POST", ROUTES.stagesApi, { orderId: DONE_ORDER, cardIds: [cardIdOf(t, LAST)], toStage: "done", fromStages: { [cardIdOf(t, LAST)]: null } });
        assert(r.status < 300, `stages: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      }, { shot: false });
    }
    await s.step("the order is Completed: ONE Completed email, ONE notes email, one status event", async () => checkOrderCompleted(before, await dump()), { shot: false });
  },

  // The order's last card done with the order page's Done toggle ("Mark Done"): Completed, ONE email
  async "done-order-complete-admin"({ page, ctx, s, mockUrl }) {
    const LAST = DONE_CODES[3];
    const NAME = DONE_CARD_NAMES[3];
    let t = null, before = null;
    await s.step(`setup: ${DN} received, ${DONE_REFUNDED} refunded; 01-03 done; ${LAST} on ${DESK} (${DONE_G} -> ${OPEN_BAGS})`, async () => {
      t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 3) });
      await ensureDesk(ctx);
      await assignOk(ctx, DESK, [cardIdOf(t, LAST)]);
      t = await tables();
      eq(cardByCode(t, LAST).location_id, placeOf(t, DESK).id, `${LAST} place`);
    }, { critical: true, shot: false });
    // The order page's toggle ends like every Done: the card back in its bag (off the desk), where the bag is said
    const putBack = new RegExp(`put it back in ${esc(DONE_CUSTOMER.lastName.toUpperCase())}['’]s bag: ${UI.donePlaceIn.openBags(DONE_CUSTOMER.letter)}`, "i");
    await s.step(`the order page: "${NAME}"'s "Mark Done" (POST cards/<id>/complete): done, back in its bag (off ${DESK}, one 'done' row); the toggle says "Put it back in REYES's bag: Open bags box, under ${DONE_CUSTOMER.letter}." and "Order completed. ${DONE_CUSTOMER.name} emailed."`, async () => {
      await goto(page, ROUTES.order(DONE_ORDER));
      before = await dump();
      const toggle = UI.cardRow(page, NAME, page.getByRole("button", { name: /^mark done$/i })).getByRole("button", { name: /^mark done$/i }).first();
      const res = await clickForApi(page, toggle, `/api/admin/cards/${cardIdOf(t, LAST)}/complete`);
      assert(res.status() < 300, `complete answered ${res.status()}: ${await res.text()}`);
      const body = await res.json().catch(() => null);
      eq(body?.completed, true, "completed");
      eq(body?.orderCompletion?.completed, true, "orderCompletion.completed");
      const problems = doneInBagProblems(before, await dump(), LAST, DESK);
      if (!(body?.bagPlaces ?? []).some((b) => b.code === DONE_G && b.finished && b.returned === 1)) problems.push(`bagPlaces: ${JSON.stringify(body?.bagPlaces ?? null).slice(0, 200)}`);
      const back = await messageSeen(page, putBack, 10_000);
      if (!back) problems.push(`no "Put it back in ${DONE_CUSTOMER.lastName.toUpperCase()}'s bag: Open bags box, under ${DONE_CUSTOMER.letter}."`);
      const note = await messageSeen(page, UI.orderCompletedLine(DONE_CUSTOMER.name), 10_000);
      if (!note) problems.push(`no "Order completed. ${DONE_CUSTOMER.name} emailed." (the answer: ${JSON.stringify(body?.orderCompletion ?? null).slice(0, 200)})`);
      assert(!problems.length, problems.join(" | "));
      return `${back} | ${note}`;
    });
    if (!cardByCode(await tables(), LAST)?.completed) {
      await s.step(`(fallback) ${LAST} done through POST cards/<id>/complete`, async () => {
        before = before ?? (await dump());
        const r = await api(ctx, "POST", ROUTES.cardComplete(cardIdOf(t, LAST)), {});
        eq([r.status, r.body?.completed], [200, true], "toggle answer");
      }, { shot: false });
    }
    await s.step("the order is Completed: ONE Completed email, ONE notes email, one status event", async () => checkOrderCompleted(before, await dump()), { shot: false });
    await s.step(`the order page shows Completed; un-doing ${LAST} there (toggle again) keeps it Completed, no email`, async () => {
      const b0 = await dump();
      const r = await api(ctx, "POST", ROUTES.cardComplete(cardIdOf(t, LAST)), {});
      eq([r.status, r.body?.completed], [200, false], "toggle answer");
      eq(r.body?.orderCompletion, undefined, "orderCompletion on un-doing");
      const out = checkOrderUnchanged(b0, await dump());
      await goto(page, ROUTES.order(DONE_ORDER));
      assert(/\bcompleted\b/i.test(await page.locator("main").first().innerText()), 'the order page doesn\'t say "Completed"');
      return out;
    }, { shot: false });
  },

  // Two Done requests at once: still ONE Completed email (the conditional status change)
  async "done-order-complete-race"({ page, ctx, s, mockUrl }) {
    const ids = (t, codes) => codes.map((c) => cardIdOf(t, c));
    let t = null;
    await s.step(`setup: ${DN} received, ${DONE_REFUNDED} refunded; 01-03 done`, async () => {
      t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 3) });
    }, { critical: true, shot: false });
    await s.step(`the last card (${DONE_CODES[3]}) in two POST done requests at once: both 200; ONE Completed email, ONE notes email, one status event`, async () => {
      const before = await dump();
      const rs = await Promise.all([0, 1].map(() => api(ctx, "POST", ROUTES.trackDone, { cardIds: ids(t, [DONE_CODES[3]]) })));
      eq(rs.map((r) => r.status), [200, 200], "HTTP");
      return checkOrderCompleted(before, await dump());
    }, { shot: false });
    await s.step(`fresh seed; 01-02 done; the last two (03, 04) in two requests at once, one card each: ONE Completed email`, async () => {
      await reset();
      t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 2) });
      const before = await dump();
      const rs = await Promise.all([DONE_CODES[2], DONE_CODES[3]].map((c) => api(ctx, "POST", ROUTES.trackDone, { cardIds: ids(t, [c]) })));
      eq(rs.map((r) => r.status), [200, 200], "HTTP");
      return checkOrderCompleted(before, await dump());
    }, { shot: false });
    await s.step(`fresh seed; 01-02 done; the scan landing's Done on 03 and on 04 tapped back to back: ONE Completed email`, async () => {
      await reset();
      t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 2) });
      await openDoneLanding(page, DONE_G);
      const before = await dump();
      const a = UI.doneCard(UI.openPanel(page, DONE_CODES[2], DONE_CODES));
      const b = UI.doneCard(UI.openPanel(page, DONE_CODES[3], DONE_CODES));
      await Promise.all([a.click(), b.click()]);
      const landed = async () => { const t1 = await tables(); return DONE_CODES.slice(2, 4).every((c) => cardByCode(t1, c)?.completed); };
      if (!(await until(landed, 120_000, 500))) await trackOk(ctx, ROUTES.trackDone, { cardIds: ids(t, DONE_CODES.slice(2, 4)) });
      await sleep(2_000);
      return checkOrderCompleted(before, await dump());
    });
    await s.step(`fresh seed; 01-03 done; the scan landing's Done on ${DONE_CODES[3]} double-tapped: ONE Completed email`, async () => {
      await reset();
      t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 3) });
      await openDoneLanding(page, DONE_G);
      const before = await dump();
      await UI.doneCard(UI.openPanel(page, DONE_CODES[3], DONE_CODES)).click({ clickCount: 2 });
      if (!(await until(cardDone(DONE_CODES[3]), 120_000, 500))) await trackOk(ctx, ROUTES.trackDone, { cardIds: ids(t, [DONE_CODES[3]]) });
      await sleep(2_000);
      return checkOrderCompleted(before, await dump());
    });
  },

  // Never for a cancelled or refunded order; refunded cards don't count
  async "done-order-complete-not-allowed"({ ctx, s, mockUrl }) {
    const last = (t) => [cardIdOf(t, DONE_CODES[3])];
    for (const [what, opts, why] of [
      ["cancelled", { status: "cancelled" }, /cancelled/i],
      ["refunded (payment_status refunded)", { payment: "refunded" }, /isn.t paid|not paid/i],
    ]) {
      await s.step(`a ${what} order: the last card done (POST done) -> the order stays as it was, no status event, no customer email; the answer says why`, async () => {
        await reset();
        const t = await doneOrderSetup(ctx, mockUrl, { ...opts, done: DONE_CODES.slice(0, 3) });
        const before = await dump();
        const r = await api(ctx, "POST", ROUTES.trackDone, { cardIds: last(t) });
        const after = await dump();
        const out = checkOrderUnchanged(before, after);
        const said = JSON.stringify(r.body?.orderCompletions ?? r.body ?? null);
        return `HTTP ${r.status}; ${out}; ${why.test(said) ? "the answer says why" : `the answer: ${said.slice(0, 160)}`}`;
      }, { shot: false });
    }
    await s.step("04 refunded too (05 already is): 01-02 done, then 03 (POST done) completes the order (refunded cards don't count)", async () => {
      await reset();
      const t = await doneOrderSetup(ctx, mockUrl, { done: DONE_CODES.slice(0, 2) });
      await mockUpdate(mockUrl, "cards", { status: "refunded" }, "card_code", DONE_CODES[3]);
      const before = await dump();
      await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, DONE_CODES[2])] });
      return checkOrderCompleted(before, await dump());
    }, { shot: false });
  },

  // The Desk page's Done: back in its bag with the same sentence as the scan landing
  async "done-desk"({ page, ctx, s, mockUrl }) {
    const C = "CD-2549-07";
    let t = null;
    await s.step(`setup: as bag-open-qr; CD-2549-07 + -08 on ${DESK} (API): ${BO_BAG} -> ${OPEN_BAGS}`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await ensureDesk(ctx);
      await assignOk(ctx, DESK, ["CD-2549-07", "CD-2549-08"].map((c) => cardIdOf(t, c)));
      t = await tables();
      eq(cardsIn(t, DESK), ["CD-2549-07", "CD-2549-08"], `cards at ${DESK}`);
      eq(bagPlaceCode(t, BO_BAG), OPEN_BAGS, `${BO_BAG} place`);
    }, { critical: true, shot: false });
    await s.step("the Desk page: 2 panels", async () => {
      await goto(page, ROUTES.deskAt(DESK));
      eq(await waitPanels(page, ["CD-2549-07", "CD-2549-08"], BO_ALL), ["CD-2549-07", "CD-2549-08"], "cards with a panel");
    });
    let before = null;
    await s.step(`${C}: "Done" (the confirm answered): done, back in its bag (no place: not LOC-DONE, not the desk); one 'done' row from the desk; no customer email; ${BO_BAG} not finished`, async () => {
      before = await dump();
      const panel = UI.deskPanel(page, C, BO_ALL);
      await tapToSave(page, UI.deskDone(panel), panel);
      await until(cardDone(C), 15_000);
      const after = await dump();
      const problems = doneInBagProblems(before, after, C, DESK);
      if (mailsTo(after.emails.slice(before.emails.length), CUSTOMER_A).length) problems.push("a customer email went out");
      if (bagByCode(after.tables, BO_BAG).completed_at) problems.push(`${BO_BAG} finished`);
      assert(!problems.length, problems.join(" | "));
    });
    if (!cardByCode(await tables(), C)?.completed) {
      await s.step(`(fallback) Done on ${C} through the API`, async () => { before = before ?? (await dump()); await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, C)] }); }, { shot: false });
    }
    await s.step(`the Desk says "Done. Put it back in ${BO_LAST}'s bag: Open bags box, under ${BO_LETTER}." (as the scan landing); only CD-2549-08 is left`, async () => {
      const msg = await saidOnPage(page, UI.doneSentence(BO_LAST, UI.donePlaceIn.openBags(BO_LETTER)));
      assert(msg, `not said (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
      eq(await waitPanels(page, ["CD-2549-08"], BO_ALL), ["CD-2549-08"], "cards with a panel");
      return msg;
    });
    await s.step(`reloaded: the desk lists only CD-2549-08; ${C} isn't at ${DESK} or LOC-DONE (database)`, async () => {
      await goto(page, ROUTES.deskAt(DESK));
      eq(await waitPanels(page, ["CD-2549-08"], BO_ALL), ["CD-2549-08"], "cards with a panel");
      const t1 = await tables();
      eq(cardsIn(t1, DESK), ["CD-2549-08"], `cards at ${DESK}`);
      eq(cardsIn(t1, "LOC-DONE"), [], "cards at LOC-DONE");
    });
  },

  // The Scan page's search (name, order number) says where each bag is
  async "done-search"({ page, ctx, s, mockUrl }) {
    let t = null;
    const SILVER = "CD-2549-S";
    const places = {};
    await s.step(`setup: as bag-open-qr + Silver 05-06 (${SILVER}, on its due-date shelf); CD-2549-07 on ${DESK} (${BO_BAG} -> ${OPEN_BAGS}); CD-2549-G's 01-04 done and the bag in the Ready to ship bin (POST bag-ready)`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await receiveViaApi(ctx, IDS.mailOrder, [mailCard(4), mailCard(5)], "2026-11-15");
      t = await tables();
      const silver = bagByCode(t, SILVER);
      assert(silver, `no ${SILVER}`);
      let shelfHow = "put there on receipt";
      if (!silver.location_id) {
        const slot = placeOf(t, shelfCode(silver.due_date));
        assert(slot, `no shelf slot ${shelfCode(silver.due_date)} (the receipt makes it)`);
        await mockUpdate(mockUrl, "tier_bags", { location_id: slot.id, located_at: new Date().toISOString() }, "id", silver.id);
        shelfHow = "set in the mock (the receipt left it unplaced)";
      }
      await ensureDesk(ctx);
      await assignOk(ctx, DESK, [cardIdOf(t, "CD-2549-07")]);
      await trackOk(ctx, ROUTES.trackDone, { cardIds: BO_GOLD.map((c) => cardIdOf(t, c)) });
      const r = await api(ctx, "POST", ROUTES.trackBagReady, { bagId: bagByCode(t, "CD-2549-G").id });
      assert(r.status === 200, `bag-ready: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      t = await tables();
      eq([bagPlaceCode(t, BO_BAG), bagPlaceCode(t, "CD-2549-G"), bagPlaceCode(t, SILVER)], [OPEN_BAGS, SHIP_PLACE, shelfCode(silver.due_date)], "places of P, G, S");
      places[BO_BAG] = UI.donePlace.openBags(BO_LETTER);
      places["CD-2549-G"] = UI.donePlace.ship;
      places[SILVER] = UI.donePlace.shelf(silver.due_date);
      return `${SILVER}: ${shelfName(silver.due_date)} (${shelfHow}); bag-ready: "${r.body?.message ?? ""}"`;
    }, { critical: true, shot: false });
    const bagCodes = [BO_BAG, "CD-2549-G", SILVER];
    /**
     * Each bag's place shown with it: a block naming that bag (its Bag ID or one of its Card IDs, and
     * no other bag's) with the place's words ("Bag: Open bags box · A" on a bag's line or a card's row).
     */
    const checkPlaces = async (where) => {
      const main = page.locator("main").first();
      const t1 = await tables();
      const idsOf = (code) => [code, ...bagCardCodes(t1, code)];
      const anyOf = (codes) => new RegExp(codes.map((c) => `${esc(c)}(?![A-Z0-9])`).join("|"));
      const problems = [];
      for (const code of bagCodes) {
        const others = bagCodes.filter((c) => c !== code).flatMap(idsOf);
        const hit = main.locator("li, article, section, div, tr, p, [role='listitem']")
          .filter({ hasText: anyOf(idsOf(code)) })
          .filter({ hasText: places[code] })
          .filter({ hasNotText: anyOf(others) });
        if (!(await until(async () => (await hit.count()) > 0, 10_000))) problems.push(`${code}: no "${places[code].source}" next to it`);
      }
      assert(!problems.length, `${where}: ${problems.join(" | ")} (the page says: "${flat(await mainText(page)).slice(0, 300)}")`);
    };
    await s.step(`Scan page, Type a code instead, "${BO_CUSTOMER}" + Enter: ${BO_BAG} "Open bags box · ${BO_LETTER}", CD-2549-G "Ready to ship", ${SILVER} "Shelf DUE …"`, async () => {
      await goto(page, ROUTES.scan);
      await typeCode(page, BO_CUSTOMER);
      await checkPlaces("search by name");
    });
    await s.step(`Scan page, Type a code instead, "${BO_ORDER}" + Enter (the order): the same places`, async () => {
      await goto(page, ROUTES.scan);
      await typeCode(page, BO_ORDER);
      await checkPlaces("the order");
    });
    await s.step("the search API: each card's bagLocation is its bag's place", async () => {
      const body = await searchVia(ctx, BO_CUSTOMER);
      const problems = [];
      for (const [code, want] of [[BO_BAG, OPEN_BAGS], ["CD-2549-G", SHIP_PLACE], [SILVER, shelfCode(bagByCode(t, SILVER).due_date)]]) {
        const cards = body.cards.filter((c) => c.bagCode === code);
        if (!cards.length) problems.push(`no card of ${code}`);
        for (const c of cards) if ((c.bagLocation?.code ?? null) !== want) problems.push(`${c.code}: bagLocation ${c.bagLocation?.code ?? null}`);
      }
      assert(!problems.length, problems.slice(0, 5).join(" | "));
      return `${body.cards.length} cards`;
    }, { shot: false });
  },

  // 390 and 1440: no sideways scroll; the Done buttons, "Mark all", and the bag-finished step on screen
  async "done-layout"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step(`setup: as bag-open-qr; CD-2549-07 done (POST done); CD-2549-04 on ${DESK}`, async () => {
      t = await bagOpenSetup(ctx, mockUrl);
      await trackOk(ctx, ROUTES.trackDone, { cardIds: [cardIdOf(t, "CD-2549-07")] });
      await ensureDesk(ctx);
      await assignOk(ctx, DESK, [cardIdOf(t, "CD-2549-04")]);
    }, { critical: true, shot: false });
    const layout = async (p, label, { first }) => {
      const w = await sidewaysScroll(p);
      assert(w <= 1, `${label}: scrolls sideways by ${w}px`);
      const b = await onScreenUnscrolled(p, first);
      assert(b.top >= 0 && b.bottom <= b.vh && !b.covered, `${label}: the primary button is at ${b.top}-${b.bottom}px of ${b.vh}px${b.covered ? ", covered" : ""}`);
      assert(b.height >= 44, `${label}: the primary button is ${b.height}px tall`);
      return `${label}: ${b.width}x${b.height} at y ${b.top}`;
    };
    const doneButtonsTall = async (p, codes) => {
      const out = [];
      for (const code of codes) {
        const box = await UI.doneCard(UI.openPanel(p, code, BO_ALL)).boundingBox().catch(() => null);
        if (!box || box.height < 44) out.push(`${code}: Done ${box ? Math.round(box.height) : "not shown"} px`);
      }
      return out;
    };
    await s.step(`1440 px, ${BO_BAG} (1 of 3 done): no sideways scroll; the big button on screen; Done buttons 44+ px; done-layout-1440-bag.png`, async () => {
      await openDoneLanding(page, BO_BAG);
      await page.screenshot({ path: path.join(OUT, "done-layout-1440-bag.png"), fullPage: true });
      const note = await layout(page, "1440", { first: UI.openMoveAll(page) });
      const short = await doneButtonsTall(page, ["CD-2549-08", "CD-2549-09"]);
      assert(!short.length, short.join(" | "));
      return note;
    }, { shot: false });
    await s.step(`390 px (iPhone 13), ${BO_BAG}: no sideways scroll; the big button fully on the first screen, 44+ px; Done buttons 44+ px; "Mark all 2 done" on the page; no browser errors; done-layout-390-bag.png`, async () => {
      const phone = await phoneContext(browser, appUrl);
      try {
        await openDoneLanding(phone.page, BO_BAG);
        await phone.page.screenshot({ path: path.join(OUT, "done-layout-390-bag.png"), fullPage: true });
        const note = await layout(phone.page, "390", { first: UI.openMoveAll(phone.page) });
        const short = await doneButtonsTall(phone.page, ["CD-2549-08", "CD-2549-09"]);
        assert(!short.length, short.join(" | "));
        assert(await UI.doneAll(phone.page).count(), 'no "Mark all 2 done"');
        assert(!phone.errors.length, `browser errors: ${phone.errors.slice(0, 3).join(" | ").slice(0, 300)}`);
        return note;
      } finally { await phone.ctx.close(); }
    }, { shot: false });
    await s.step(`390 px, the Desk page with CD-2549-04: no sideways scroll; its Done 44+ px on screen; done-layout-390-desk.png`, async () => {
      const phone = await phoneContext(browser, appUrl);
      try {
        await goto(phone.page, ROUTES.deskAt(DESK));
        eq(await waitPanels(phone.page, ["CD-2549-04"], BO_ALL), ["CD-2549-04"], "cards with a panel");
        await phone.page.screenshot({ path: path.join(OUT, "done-layout-390-desk.png"), fullPage: true });
        const w = await sidewaysScroll(phone.page);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        const btn = UI.deskDone(UI.deskPanel(phone.page, "CD-2549-04", BO_ALL));
        await btn.scrollIntoViewIfNeeded();
        const box = await btn.boundingBox();
        assert(box && box.height >= 44, `Done is ${box ? Math.round(box.height) : "not"} px tall`);
        assert(!phone.errors.length, `browser errors: ${phone.errors.slice(0, 3).join(" | ").slice(0, 300)}`);
        return `Done ${Math.round(box.width)}x${Math.round(box.height)}`;
      } finally { await phone.ctx.close(); }
    }, { shot: false });
    await s.step(`${BO_BAG} finished (08, 09 done through the API): "It's in the Ready to ship bin" fully on the first screen at 1440 and 390, 44+ px, not covered; no sideways scroll; done-layout-{1440,390}-finished.png`, async () => {
      await trackOk(ctx, ROUTES.trackDone, { cardIds: ["CD-2549-08", "CD-2549-09"].map((c) => cardIdOf(t, c)) });
      await openDoneLanding(page, BO_BAG);
      await page.screenshot({ path: path.join(OUT, "done-layout-1440-finished.png"), fullPage: true });
      const notes = [await layout(page, "1440", { first: page.getByRole("button", { name: UI.readyToShipRe }).first() })];
      const phone = await phoneContext(browser, appUrl);
      try {
        await openDoneLanding(phone.page, BO_BAG);
        await phone.page.screenshot({ path: path.join(OUT, "done-layout-390-finished.png"), fullPage: true });
        await phone.page.screenshot({ path: path.join(OUT, "done-layout-390-finished-first-screen.png") });
        notes.push(await layout(phone.page, "390", { first: phone.page.getByRole("button", { name: UI.readyToShipRe }).first() }));
        assert(!phone.errors.length, `browser errors: ${phone.errors.slice(0, 3).join(" | ").slice(0, 300)}`);
      } finally { await phone.ctx.close(); }
      return notes.join("; ");
    }, { shot: false });
  },
};
Object.assign(SCENARIOS, DONE_SCENARIOS);

// ─── The Scan page (scan-*, owner Nov 26 2026) ──────────────────────────────
// "remove the camera, make it so you can only use the scanner, and also add the images under each
// card", and make it clearer when a scanned holder has a card in it. The Eyoyo handheld scanner is
// paired with the shop's iPhone as a Bluetooth keyboard: it types the label's text, a few ms per key,
// then Enter, with nothing focused (the page's keyboard wedge, components/intake/scan/scan-input.tsx).

const SCAN_LINK = (code) => `HTTPS://THECARDDOC1.COM/Q/${code}`;
/** A catalog picture (lib/card-catalog.ts isCatalogImageUrl): the reference photo when a card has none of its own. */
const SCAN_CATALOG = "https://assets.tcgdex.net/en/base/base1/15/high.webp";
/** The Scan page's tile sizes (lib/intake/tracking/summaries.ts TILE_WIDTHS): a thumbnail is never wider. */
const SCAN_TILE_MAX_W = 480;
const SCAN_FULL_MIN_W = 1280;

/** Records every way a page could ask for the camera: getUserMedia (new and old), a camera permission query. */
const watchCamera = (c) => c.addInitScript(() => {
  window.__camera = [];
  const note = (what) => window.__camera.push(what);
  const proto = window.MediaDevices && window.MediaDevices.prototype;
  if (proto && typeof proto.getUserMedia === "function") {
    const real = proto.getUserMedia;
    proto.getUserMedia = function (...a) { note("getUserMedia"); return real.apply(this, a); };
  }
  for (const k of ["getUserMedia", "webkitGetUserMedia"]) {
    if (typeof navigator[k] === "function") {
      const real = navigator[k].bind(navigator);
      navigator[k] = (...a) => { note(k); return real(...a); };
    }
  }
  if (navigator.permissions && typeof navigator.permissions.query === "function") {
    const real = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => { if (d && /camera/i.test(String(d.name))) note("permissions.query(camera)"); return real(d); };
  }
});
const cameraCalls = (p) => p.evaluate(() => window.__camera ?? []);

/**
 * The handheld scanner reading labels on one page: keys about 10 ms apart, then Enter. The page reads
 * the same label only once within 2 s (a scanner's double read), so a repeat waits that out.
 */
function scannerOn(p) {
  const last = new Map();
  return async (code, opts = {}) => {
    const since = Date.now() - (last.get(code) ?? 0);
    if (since < 2_100) await sleep(2_100 - since);
    last.set(code, Date.now());
    await scanType(p, SCAN_LINK(code), { delay: 10, ...opts });
    last.set(code, Date.now());
  };
}

/**
 * On Netlify (IMAGE_CDN=netlify) a thumbnail is /.netlify/images?url=<original>&w=<px>, which `next
 * dev` doesn't serve: the browser context answers it with the original (and notes each width asked).
 */
async function serveThumbs(c, widths = []) {
  await c.route(/\/\.netlify\/images\?/, async (route) => {
    const u = new URL(route.request().url());
    widths.push(Number(u.searchParams.get("w")));
    try {
      const r = await route.fetch({ url: u.searchParams.get("url") });
      await route.fulfill({ response: r });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  return widths;
}

/** The card catalog's host (the reference photos) isn't reachable from the sandbox: the browser context answers it with a PNG. */
const serveCatalog = (c) => c.route(/^https:\/\/assets\.tcgdex\.net\//, (route) => route.fulfill({ status: 200, contentType: "image/png", body: placeholderPng([230, 190, 70]) }));

const scanMain = (p) => p.locator("main").first().innerText().then(flat);
const openDialogs = (p) => p.locator("dialog[open]").count();
const focusedEl = (p) => p.evaluate(() => {
  const a = document.activeElement;
  return !a || a === document.body ? "nothing" : `${a.tagName.toLowerCase()} "${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 40)}"`;
});
/** Wait until the page's <main> names every one of `codes` (a scan's answer shown); returns its text. */
async function scanShows(p, codes, ms = 30_000) {
  const text = (await until(async () => { const x = await scanMain(p); return codes.every((c) => x.includes(c)) ? x : null; }, ms)) ?? await scanMain(p);
  const missing = codes.filter((c) => !text.includes(c));
  assert(!missing.length, `not shown: ${missing.join(", ")} (the page says: "${text.slice(0, 200)}")`);
  return text;
}
/** "Got it: CD-2549-G" over the top panel (it shows 1.6 s): seen within `ms` of the scan's Enter. */
async function gotItSeen(p, code, ms = 1_500) {
  await p.getByText(UI.gotIt(code)).first().waitFor({ state: "visible", timeout: ms });
}
/** A card's block in a list (bag, order, search, a holder's stack): the innermost <li>/<article> naming it. */
// (textContent runs a Card ID into the next word, "CD-2549-01Test Card…", so only a digit or "-" may not follow)
const scanCardBlock = (p, code) => p.locator("main").first().locator("li, article").filter({ hasText: new RegExp(`${esc(code)}(?![0-9-])`) })
  .filter({ hasNot: p.locator("main li li, main article article").filter({ hasText: new RegExp(`${esc(code)}(?![0-9-])`) }) }).last();

/** The photos a card must show, from the database: receiving first, then the customer's, else the catalog's. */
function photosWanted(t, code) {
  const c = cardByCode(t, code);
  const own = [...(c.receiving_photo_urls ?? []).map((url) => ({ kind: "receiving", url })), ...(c.photo_urls ?? []).map((url) => ({ kind: "customer", url }))];
  if (own.length) return own.slice(0, 6);
  return c.catalog_image_url ? [{ kind: "reference", url: c.catalog_image_url }] : [];
}
/** The alt a photo tile carries (card-photos.tsx): "Receiving photo 1 of CD-2549-01 Test Card Gold One". */
function photoAlts(want, label) {
  const seen = { receiving: 0, customer: 0, reference: 0 };
  const noun = { receiving: "Receiving photo", customer: "Customer photo" };
  return want.slice(0, 3).map((w) => {
    seen[w.kind] += 1;
    return w.kind === "reference" ? `Reference photo of ${label} from the card catalog, not the customer's card` : `${noun[w.kind]} ${seen[w.kind]} of ${label}`;
  });
}
/** Is this a resized copy (Netlify's image CDN), not the original? */
const isThumbPath = (src, original) => {
  if (!String(src).startsWith("/.netlify/images?")) return false;
  const u = new URL(src, "http://x");
  return u.searchParams.get("url") === original && Number(u.searchParams.get("w")) <= SCAN_TILE_MAX_W;
};

/**
 * One card's photos on the Scan page, against the database and the API's answer (`apiCard`): the
 * list "Photos of <Card ID> <name>" under the card's details, tiles in order (receiving, customer;
 * else the reference photo with its label), each <img> the API's thumbnail (tile), lazy, loaded; or
 * "No photo yet". Returns a short note.
 */
async function checkCardPhotos(p, t, code, apiCard, { block = null, cdn = false, minH = 90, maxH = 200 } = {}) {
  const want = photosWanted(t, code);
  const name = cardByCode(t, code).card_name;
  const label = `${code} ${name}`;
  const row = block ?? scanCardBlock(p, code);
  const list = UI.scanCardPhotos(p, code);
  if (!want.length) {
    eq(await list.count(), 0, `${code}: photo lists`);
    const txt = flat(await row.innerText());
    assert(UI.scanNoPhoto.test(txt), `${code}: no "No photo yet" ("${txt.slice(0, 160)}")`);
    eq(await row.locator("img").count(), 0, `${code}: images in its block`);
    return `${code}: no photo yet`;
  }
  await list.first().waitFor({ timeout: 15_000 });
  eq(await list.count(), 1, `${code}: photo lists`);
  const imgs = list.locator("img");
  eq(await imgs.count(), Math.min(3, want.length), `${code}: thumbnails`);
  eq(await imgs.evaluateAll((els) => els.map((e) => e.getAttribute("alt"))), photoAlts(want, label), `${code}: photos in order (alt)`);
  // Under the card's details: below its Card ID and its name
  const listBox = await list.boundingBox();
  const above = [];
  for (const loc of [row.getByText(code, { exact: true }).first(), row.getByText(name).first()]) {
    const b = await loc.boundingBox().catch(() => null);
    if (b) above.push(b.y + b.height);
  }
  assert(above.length === 2, `${code}: its Card ID or name isn't in its block`);
  assert(listBox && listBox.y >= Math.max(...above) - 1, `${code}: the photos (top ${listBox?.y}) are not under its details (bottom ${Math.max(...above)})`);
  assert(listBox.height >= minH && listBox.height <= maxH, `${code}: thumbnails ${Math.round(listBox.height)} px tall (want ${minH}-${maxH})`);
  const apiPhotos = apiCard?.photos ?? [];
  eq(apiPhotos.map((x) => [x.kind, x.url]), want.map((w) => [w.kind, w.url]), `${code}: the API's photos`);
  const n = await imgs.count();
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    const [src, srcset, loading] = await img.evaluate((el) => [el.getAttribute("src"), el.getAttribute("srcset"), el.getAttribute("loading")]);
    const tile = apiPhotos[i].tile;
    eq(src, tile.src, `${code} photo ${i + 1}: src is the API's thumbnail (tile)`);
    eq(srcset ?? null, tile.srcSet ?? null, `${code} photo ${i + 1}: srcset`);
    eq(loading, "lazy", `${code} photo ${i + 1}: loading`);
    if (want[i].kind === "reference") {
      // the catalog's host isn't reachable from the sandbox: serveCatalog() answers it in the browser
      eq(src, SCAN_CATALOG.replace("/high.webp", "/low.webp"), `${code}: the reference thumbnail (the catalog's small picture)`);
    }
    if (cdn) {
      assert(isThumbPath(src, want[i].url), `${code} photo ${i + 1}: not a resized copy of ${want[i].url}: ${src}`);
      for (const part of String(srcset ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        const [u, w] = part.split(/\s+/);
        assert(isThumbPath(u, want[i].url) && parseInt(w, 10) <= SCAN_TILE_MAX_W, `${code} photo ${i + 1}: srcset entry "${part}"`);
      }
    }
    await img.scrollIntoViewIfNeeded();
    const ok = await until(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), 15_000);
    assert(ok, `${code} photo ${i + 1} did not load (${src})`);
  }
  if (want[0].kind === "reference") {
    const txt = flat(await row.innerText());
    assert(UI.scanReference.test(txt), `${code}: the catalog picture isn't labelled "Reference photo" ("${txt.slice(0, 160)}")`);
    assert(/not the customer.s card/i.test(txt), `${code}: no "Not the customer's card"`);
  }
  return `${code}: ${want.map((w) => ({ receiving: "receiving", customer: "customer", reference: "reference" })[w.kind]).join(" + ")}${want.length > 3 ? ` (3 shown, +${want.length - 3})` : ""}`;
}

/** A tap on a card's first photo: the full-screen viewer (90%+ of the screen), the API's full-size image, loaded; Close closes it. */
async function checkViewer(p, code, apiCard, { shot } = {}) {
  const tile = UI.scanCardPhotos(p, code).first().getByRole("button").first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  const viewer = UI.photoViewer(p);
  await viewer.waitFor({ timeout: 15_000 });
  const box = await viewer.boundingBox();
  const vp = p.viewportSize();
  const cover = box ? (100 * box.width * box.height) / (vp.width * vp.height) : 0;
  assert(cover >= 90, `the viewer covers ${Math.round(cover)}% of the screen`);
  const img = viewer.locator("img").first();
  eq(await img.getAttribute("src"), apiCard.photos[0].full.src, "the viewer's image is the API's full-size one");
  assert(await until(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), 15_000), "the full-screen photo did not load");
  const text = flat(await viewer.innerText());
  const kind = { receiving: /receiving photo/i, customer: /customer photo/i, reference: /reference photo/i }[apiCard.photos[0].kind];
  assert(kind.test(text), `viewer title: "${text.slice(0, 120)}"`);
  if (apiCard.photos.length > 1) assert(new RegExp(`\\b1 of ${apiCard.photos.length}\\b`).test(text), `viewer counter: "${text.slice(0, 120)}"`);
  if (shot) await p.screenshot({ path: path.join(OUT, shot) }).catch(() => {});
  await UI.viewerClose(viewer).click();
  await until(async () => (await openDialogs(p)) === 0, 5_000);
  eq(await openDialogs(p), 0, "open dialogs after Close");
  return `${Math.round(cover)}% of the screen; focus after Close: ${await focusedEl(p)}`;
}

const SCAN_SCENARIOS = {
  // The scanner only: no camera anywhere; the Eyoyo's keystrokes + Enter, with nothing focused, open
  // what was scanned, right after the page loads, after a result, and after a photo (a modal) closes.
  async "scan-scanner-only"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const G = "CD-2549-G";
    const P = "CD-2549-P";
    const G_CARDS = BO_GOLD;
    const P_CARDS = ["CD-2549-07", "CD-2549-08"];
    await s.step("setup: CD-2549 Gold 01-04 (bag CD-2549-G) + Platinum 07-08 (CD-2549-P) and CD-2600-01..03 received, receiving photos", async () => {
      await deskReceive(ctx, mockUrl);
    }, { critical: true, shot: false });

    const runAt = async (label, p, errors) => {
      const scan = scannerOn(p);
      const shot = (name) => p.screenshot({ path: path.join(OUT, `scan-scanner-only-${label}-${name}.png`), fullPage: true }).catch(() => {});
      await s.step(`${label}: /admin/scan: the "Ready to scan" panel and its line; no camera (no video, canvas, camera word or button, no capture input); the code box closed; nothing focused; no sideways scroll`, async () => {
        await goto(p, ROUTES.scan);
        await UI.scanReady(p).waitFor({ timeout: 60_000 });
        const panelText = flat(await UI.scanReady(p).innerText());
        assert(UI.readyToScan.test(panelText), `the panel says "${panelText.slice(0, 160)}"`);
        assert(panelText.includes(UI.readyToScanSub), `no "${UI.readyToScanSub}" in the panel ("${panelText.slice(0, 160)}")`);
        const text = await scanMain(p);
        assert(!/camera/i.test(text), `the page mentions a camera: "${text.slice(0, 200)}"`);
        eq(await p.locator("video, canvas").count(), 0, "video/canvas elements");
        eq(await p.locator("input[type=file][capture], input[accept^='image'][capture]").count(), 0, "camera capture inputs");
        eq(await p.getByRole("button", { name: /camera|torch|flash ?light|start scanning/i }).count(), 0, "camera buttons");
        eq(await UI.scanInput(p).count(), 0, "code boxes before Type a code instead");
        await UI.typeCodeLink(p).waitFor({ timeout: 15_000 });
        eq(await focusedEl(p), "nothing", "focused on load");
        const w = await sidewaysScroll(p);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        await shot("01-ready");
      }, { critical: true, shot: false });

      await s.step(`${label}: right after a fresh load, the scanner (keys 10 ms apart + Enter, nothing focused) reads ${G}'s label: "Got it: ${G}" flashes, its 4 cards show, no navigation`, async () => {
        await goto(p, ROUTES.scan);
        const looked = p.waitForResponse((r) => r.url().includes("/api/admin/track/resolve"), { timeout: 120_000 });
        const t0 = Date.now();
        await scan(G);
        await gotItSeen(p, G);
        const flashMs = Date.now() - t0;
        await looked;
        await scanShows(p, G_CARDS);
        eq(new URL(p.url()).pathname, ROUTES.scan, "still on the Scan page");
        await shot("02-bag");
        return `"Got it" ${flashMs} ms after the first key`;
      }, { critical: true, shot: false });

      await s.step(`${label}: after that result, the scanner reads ${P}: "Got it: ${P}", its cards replace ${G}'s`, async () => {
        await scan(P);
        await gotItSeen(p, P);
        const text = await scanShows(p, P_CARDS);
        assert(!G_CARDS.some((c) => text.includes(c)), `${G}'s cards still shown: "${text.slice(0, 200)}"`);
      }, { shot: false });

      await s.step(`${label}: a photo opened full screen and closed with Close (focus back on the photo): the next scan (${G}) opens, and its Enter doesn't reopen the photo`, async () => {
        const tile = UI.scanCardPhotos(p, "CD-2549-07").first().getByRole("button").first();
        await tile.click();
        await UI.photoViewer(p).waitFor({ timeout: 15_000 });
        await UI.viewerClose(UI.photoViewer(p)).click();
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        const f = await focusedEl(p);
        await scan(G, { blur: false });
        await gotItSeen(p, G);
        await scanShows(p, G_CARDS);
        await sleep(400);
        eq(await openDialogs(p), 0, "a photo reopened by the scan's Enter");
        return `focus before the scan: ${f}`;
      }, { shot: false });

      await s.step(`${label}: the same after Esc closes the photo: the scanner reads ${P}`, async () => {
        const tile = UI.scanCardPhotos(p, "CD-2549-02").first().getByRole("button").first();
        await tile.click();
        await UI.photoViewer(p).waitFor({ timeout: 15_000 });
        await p.keyboard.press("Escape");
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        eq(await openDialogs(p), 0, "open dialogs after Esc");
        await scan(P, { blur: false });
        await gotItSeen(p, P);
        await scanShows(p, P_CARDS);
        await sleep(400);
        eq(await openDialogs(p), 0, "a photo reopened by the scan's Enter");
      }, { shot: false });

      await s.step(`${label}: with a card's "Assign to a slot" focused, the scanner reads ${G}: it opens, the button isn't pressed`, async () => {
        const btn = p.getByRole("button", { name: /^assign to a slot$/i }).first();
        await btn.focus();
        assert((await focusedEl(p)).startsWith("button"), "a button has focus");
        await scan(G, { blur: false });
        await scanShows(p, G_CARDS);
        const text = await scanMain(p);
        assert(!/scan the (slot|holder) for/i.test(text), `the scan pressed "Assign to a slot" ("${text.slice(0, 120)}")`);
      }, { shot: false });

      await s.step(`${label}: a scan while a photo is open full screen closes it and shows ${P}`, async () => {
        const tile = UI.scanCardPhotos(p, "CD-2549-01").first().getByRole("button").first();
        await tile.click();
        await UI.photoViewer(p).waitFor({ timeout: 15_000 });
        await scan(P, { blur: false });
        await until(async () => (await openDialogs(p)) === 0, 10_000);
        eq(await openDialogs(p), 0, "open dialogs after the scan");
        await scanShows(p, P_CARDS);
      }, { shot: false });

      await s.step(`${label}: "Type a code instead" reveals the code box (focused); CD-2549-02 + Enter shows that card; the scanner typing into the box works too; Esc closes it`, async () => {
        eq(await UI.scanInput(p).count(), 0, "a code box before the tap");
        await UI.typeCodeLink(p).click();
        const box = UI.scanInput(p);
        await box.waitFor({ timeout: 15_000 });
        assert(await box.evaluate((el) => el === document.activeElement), "the code box has no focus");
        await box.fill("CD-2549-02");
        await box.press("Enter");
        await p.getByText("Test Card Gold Two").first().waitFor({ timeout: 30_000 });
        await shot("03-typed");
        // A scanner typing into the open box (on a computer it keeps the focus; on a phone it lets go)
        await box.focus();
        await scan(G, { blur: false });
        await scanShows(p, G_CARDS);
        if (!(await box.isVisible().catch(() => false))) return "the box closed after the scan";
        await box.focus();
        await p.keyboard.press("Escape");
        await until(async () => (await UI.scanInput(p).count()) === 0, 5_000);
        eq(await UI.scanInput(p).count(), 0, "code boxes after Esc");
        await UI.typeCodeLink(p).waitFor({ timeout: 5_000 });
        return "Esc closed it";
      }, { shot: false });

      await s.step(`${label}: no camera asked for (no getUserMedia, no camera permission query), no sideways scroll, no browser errors`, async () => {
        eq(await cameraCalls(p), [], "camera calls");
        const w = await sidewaysScroll(p);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        if (errors) assert(!errors.length, errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    };

    const phone = await phoneContext(browser, appUrl);
    try {
      await watchCamera(phone.ctx);
      await runAt("390", phone.page, phone.errors);
    } finally {
      await phone.ctx.close();
    }
    // 1440: the runner's desktop page (its browser errors are checked by the runner)
    await watchCamera(ctx);
    await runAt("1440", page, null);
  },

  // Photos under each card: receiving first, then the customer's, else "Reference photo"; the API's
  // thumbnails (not the originals); a tap opens the full-size photo full screen; "No photo yet".
  // When the server serves Netlify thumbnails (NETLIFY=true at build: next.config.ts IMAGE_CDN) every tile must be
  // a /.netlify/images?url=…&w=<=480 copy; the harness drops NETLIFY, so there it checks the <img> takes `tile`.
  async "scan-card-photos"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const G = "CD-2549-G";
    // CD-2549-01: its receiving photo + the seed's 2 customer photos; -02: a customer photo only;
    // -03: only a catalog picture (the reference photo); -04: nothing
    let t = null;
    let api0 = null;
    let cdn = false;
    await s.step("setup: CD-2549 and CD-2600 received with receiving photos; CD-2549-02 a customer photo only, -03 only a catalog picture, -04 no photo", async () => {
      t = await deskReceive(ctx, mockUrl);
      const customer = cardByCode(t, "CD-2549-07").photo_urls?.[0];
      assert(customer, "the seed's CD-2549-07 customer photo");
      await mockUpdate(mockUrl, "cards", { receiving_photo_urls: [], photo_urls: [customer] }, "card_code", "CD-2549-02");
      await mockUpdate(mockUrl, "cards", { receiving_photo_urls: [], photo_urls: [], catalog_image_url: SCAN_CATALOG }, "card_code", "CD-2549-03");
      await mockUpdate(mockUrl, "cards", { receiving_photo_urls: [], photo_urls: [], catalog_image_url: null }, "card_code", "CD-2549-04");
      t = await tables();
      eq(photosWanted(t, "CD-2549-01").map((w) => w.kind), ["receiving", "customer", "customer"], "CD-2549-01 in the database");
    }, { critical: true, shot: false });
    await s.step(`resolve ${G}: each card's photos (receiving, then customer; the catalog's only without them), a thumbnail (tile) and a full-size image each`, async () => {
      const r = await api(ctx, "GET", ROUTES.trackResolve(G));
      eq(r.status, 200, "HTTP");
      const cards = r.body?.bag?.cards ?? [];
      eq(cards.map((c) => c.code), BO_GOLD, "cards");
      for (const c of cards) {
        eq((c.photos ?? []).map((x) => [x.kind, x.url]), photosWanted(t, c.code).map((w) => [w.kind, w.url]), `${c.code} photos`);
        for (const x of c.photos ?? []) assert(x.tile?.src && x.full?.src, `${c.code}: a photo without tile/full`);
      }
      api0 = Object.fromEntries(cards.map((c) => [c.code, c]));
      const own = api0["CD-2549-01"].photos[0];
      cdn = String(own.tile.src).startsWith("/.netlify/images?");
      if (cdn) {
        for (const c of cards) for (const x of c.photos ?? []) {
          if (x.kind === "reference") continue;
          assert(isThumbPath(x.tile.src, x.url), `${c.code}: tile ${x.tile.src} is not a resized copy (w <= ${SCAN_TILE_MAX_W})`);
          const fw = Number(new URL(x.full.src, "http://x").searchParams.get("w"));
          assert(fw >= SCAN_FULL_MIN_W, `${c.code}: the full-size image is ${fw} px wide`);
        }
        return `IMAGE_CDN=netlify: tiles ${own.tile.src.slice(0, 60)}… (srcset ${own.tile.srcSet})`;
      }
      eq(own.tile.src, own.url, "off Netlify the tile is the original");
      return "CDN off in this harness (next.config.ts sets IMAGE_CDN from NETLIFY, which start.mjs removes): tile = original; the <img> must still take the tile, never full";
    }, { critical: true, shot: false });

    const runAt = async (label, p, c, errors) => {
      const scan = scannerOn(p);
      const widths = cdn ? await serveThumbs(c) : [];
      await serveCatalog(c);
      const shot = (name) => p.screenshot({ path: path.join(OUT, `scan-card-photos-${label}-${name}.png`), fullPage: true }).catch(() => {});
      await s.step(`${label}: scan ${G}: each card's photos under its details, in order, the API's thumbnails (lazy, loaded); -03 "Reference photo" / "Not the customer's card"; -04 "No photo yet"`, async () => {
        await goto(p, ROUTES.scan);
        await scan(G);
        await scanShows(p, BO_GOLD);
        const notes = [];
        for (const code of BO_GOLD) notes.push(await checkCardPhotos(p, t, code, api0[code], { cdn }));
        await p.evaluate(() => window.scrollTo(0, 0));
        await shot("01-bag");
        return notes.join(", ");
      }, { shot: false });
      await s.step(`${label}: thumbnails, not originals: every photo <img> under a card is a tile${cdn ? ` (/.netlify/images, w <= ${SCAN_TILE_MAX_W})` : ""}, never the full-size image`, async () => {
        const srcs = await p.locator("main").first().getByRole("list", { name: /^photos of /i }).locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
        assert(srcs.length >= 4, `only ${srcs.length} photo tiles`);
        const fulls = new Set(Object.values(api0).flatMap((x) => (x.photos ?? []).filter((ph) => ph.full.src !== ph.tile.src).map((ph) => ph.full.src)));
        const bad = srcs.filter((x) => fulls.has(x));
        assert(!bad.length, `full-size images used as thumbnails: ${bad.slice(0, 2).join(", ")}`);
        if (cdn) {
          const asked = [...new Set(widths)].sort((a, b) => a - b);
          assert(asked.length && asked.every((w) => w <= SCAN_TILE_MAX_W), `widths asked of the image CDN: ${asked.join(", ")}`);
          return `${srcs.length} tiles; CDN widths asked: ${asked.join(", ")}`;
        }
        return `${srcs.length} tiles (CDN off: tile = original here)`;
      }, { shot: false });
      await s.step(`${label}: a tap on CD-2549-01's first photo opens it full screen (the full-size image), Close closes it`, async () => {
        return checkViewer(p, "CD-2549-01", api0["CD-2549-01"], { shot: `scan-card-photos-${label}-02-viewer.png` });
      }, { shot: false });
      await s.step(`${label}: the order's label (CD-2549): every received card with its photos or "No photo yet"; the not-received ones "No photo yet"`, async () => {
        await scan(ORDER_NUMBERS.mailOrder);
        await scanShows(p, [...BO_GOLD, "CD-2549-07", "CD-2549-08"]);
        const r = await api(ctx, "GET", ROUTES.trackResolve(ORDER_NUMBERS.mailOrder));
        const all = [...(r.body?.order?.bags ?? []).flatMap((b) => b.cards), ...(r.body?.order?.looseCards ?? [])];
        const notes = [];
        for (const code of [...BO_GOLD, "CD-2549-07", "CD-2549-08"]) notes.push(await checkCardPhotos(p, t, code, all.find((x) => x.code === code), { cdn }));
        await p.evaluate(() => window.scrollTo(0, 0));
        await shot("03-order");
        return notes.join(", ");
      }, { shot: false });
      await s.step(`${label}: a typed Card ID (CD-2549-01) shows that card with its 3 photos`, async () => {
        await typeCode(p, "CD-2549-01");
        // the card alone (the order's other cards gone), then its photos
        const one = await until(async () => { const x = await scanMain(p); return x.includes("CD-2549-01") && !x.includes("CD-2549-02") ? x : null; }, 30_000);
        assert(one, `CD-2549-01 not shown on its own ("${(await scanMain(p)).slice(0, 200)}")`);
        await until(async () => (await UI.scanCardPhotos(p, "CD-2549-01").count()) > 0, 15_000);
        return checkCardPhotos(p, t, "CD-2549-01", api0["CD-2549-01"], { cdn });
      }, { shot: false });
      await s.step(`${label}: no sideways scroll; no browser errors`, async () => {
        const w = await sidewaysScroll(p);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        if (errors) assert(!errors.length, errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    };

    await runAt("1440", page, ctx, null);
    const phone = await phoneContext(browser, appUrl);
    try {
      await runAt("390", phone.page, phone.ctx, phone.errors);
    } finally {
      await phone.ctx.close();
    }
  },
};

// ─── The holder view (owner, Nov 26: "make it clearer when you scan a holder that has a card in it") ───
// components/intake/scan/holder-view.tsx (wording: the HOLDER agent's holder-text.md, in UI.holder*):
// "CLAMP 07 · has 1 card" (every holder holds one card: owner, Nov 26 2026; a desk, the only stack:
// "DESK SAM · 3 cards"; "CLAMP 07 · empty"), the card big (photos, name, Card ID, customer · order ·
// tier, due, step, "In CLAMP 07 for 2 hours"), and Move to my desk, Move to another holder, Done (asks
// "Mark done"), Take out. A stack (a desk): "Move all 3 to my desk". No desk yet: "Move to my desk"
// greyed and "No desk yet. …".
// Setup (holderSetup): CD-2549 Gold 01-04 + Platinum 07-08 and CD-2600-01 received (trackSetup),
// CLAMP 01..07 and HEAT PRESS 01..02, receiving photos on the CD-2549 cards; CD-2549-07 in CLAMP 07
// (step Clamp Work) put in 2 h 5 min ago; CLAMP 06 and HEAT PRESS 01 empty; no desk (`desk: true`
// makes LOC-DESK as the Desk page does, then the stack: CD-2549-01..03 on DESK SAM, each through
// HEAT PRESS 02 first, so at step Heat Press: holderStack).
const HOLDER = {
  code: "LOC-CLAMP-07", name: "CLAMP 07", card: "CD-2549-07", cardName: "Test Card Platinum One", customer: BO_CUSTOMER,
  order: ORDER_NUMBERS.mailOrder, bag: "CD-2549-P", tier: "Platinum", due: "2026-12-07", step: "Clamp Work", agoMin: 125,
};
const HOLDER_TO = { code: "LOC-HEAT-PRESS-01", name: "HEAT PRESS 01", step: "Heat Press" };
/** The stack: only a desk holds more than one card (owner, Nov 26 2026), so a second desk, DESK SAM. */
const HOLDER_STACK = { code: "LOC-DESK-SAM", name: "DESK SAM", cards: ["CD-2549-01", "CD-2549-02", "CD-2549-03"], step: "Heat Press" };
const HOLDER_EMPTY = { code: "LOC-CLAMP-06", name: "CLAMP 06" };

async function holderSetup(ctx, mockUrl, { desk = false } = {}) {
  const t0 = await trackSetup(ctx, { clamp: 7, "heat-press": 2 });
  await setReceivingPhotos(mockUrl, [...BO_GOLD, "CD-2549-07", "CD-2549-08"].map((c) => cardIdOf(t0, c)));
  await holderPut(ctx, mockUrl, t0, HOLDER.card, HOLDER.code);
  if (desk) {
    await ensureDesk(ctx);
    await holderStack(ctx, t0);
  }
  const t = await tables();
  eq(cardsIn(t, HOLDER.code), [HOLDER.card], `cards in ${HOLDER.name}`);
  eq(cardsIn(t, HOLDER_STACK.code), desk ? HOLDER_STACK.cards : [], `cards on ${HOLDER_STACK.name}`);
  eq(latestStage(t, cardIdOf(t, HOLDER.card)), HOLDER.step, `${HOLDER.card} step`);
  eq(!!placeOf(t, DESK), desk, `${DESK} exists`);
  return t;
}
/**
 * The stack on DESK SAM (made here; a desk is the only place that holds more than one card): each
 * card through HEAT PRESS 02 first (one card at a time), so the stack is at step Heat Press.
 */
async function holderStack(ctx, t0) {
  if (!placeOf(await tables(), HOLDER_STACK.code)) {
    const r = await api(ctx, "POST", ROUTES.trackLocations(), { name: HOLDER_STACK.name, kind: "other" });
    assert(r.status < 300 && r.body?.location?.code === HOLDER_STACK.code, `POST locations ${HOLDER_STACK.name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  for (const c of HOLDER_STACK.cards) {
    await assignOk(ctx, "LOC-HEAT-PRESS-02", [cardIdOf(t0, c)]);
    await assignOk(ctx, HOLDER_STACK.code, [cardIdOf(t0, c)]);
  }
  eq(cardsIn(await tables(), HOLDER_STACK.code), HOLDER_STACK.cards, `cards on ${HOLDER_STACK.name}`);
}
/** Put a card (back) in a holder through the API, as if put in HOLDER.agoMin minutes ago. */
async function holderPut(ctx, mockUrl, t, code, slot) {
  await assignOk(ctx, slot, [cardIdOf(t, code)], true);
  await mockUpdate(mockUrl, "cards", { located_at: new Date(Date.now() - HOLDER.agoMin * 60_000).toISOString() }, "card_code", code);
}
/** Scan a holder's label and wait for its header ("CLAMP 07 · has 1 card", "HEAT PRESS 02 · 3 cards", "CLAMP 06 · empty"). */
async function holderOpen(p, scan, place, n) {
  await scan(place.code);
  const want = n ? UI.holderHas(place.name, n) : UI.holderEmptyHead(place.name);
  const text = await until(async () => { const x = await scanMain(p); return want.test(x) ? x : null; }, 30_000) ?? await scanMain(p);
  assert(want.test(text), `${place.name}: no /${want.source}/ (the page says "${text.slice(0, 240)}")`);
  return text;
}
/**
 * Tap a holder button and wait for the save it makes (POST to a path matching `re`); when the
 * button asks first ("Mark it done? …" [Mark done]), that is answered.
 */
async function holderTap(p, button, re) {
  const saved = p.waitForResponse((r) => re.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60_000 });
  await button.click();
  let res = await Promise.race([saved, sleep(2_000).then(() => null)]);
  let asked = "";
  if (!res) {
    const yes = UI.holderConfirm(p);
    if (await yes.isVisible().catch(() => false)) {
      asked = await nameOf(yes);
      await yes.click();
    }
    res = await saved;
  }
  assert(res.status() < 300, `${new URL(res.url()).pathname} answered ${res.status()}: ${(await res.text()).slice(0, 200)}`);
  return { res, sent: JSON.parse(res.request().postData() ?? "{}"), asked };
}
const mailCount = async () => (await dump()).emails.length;
/** The four buttons of a holder with one card. */
const holderButtons = (p) => {
  const m = p.locator("main").first();
  return [["Move to my desk", UI.holderToDesk(m)], ["Move to another holder", UI.holderToHolder(m)], ["Done", UI.holderDone(m)], ["Take out", UI.holderTakeOut(m)]];
};

const SCAN_HOLDER_SCENARIOS = {
  // Scanning CLAMP 07 with a card in it: the header, the card's details, the four buttons, each working
  async "scan-holder-card"({ page, ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step(`setup: ${HOLDER.card} in ${HOLDER.name} (put in ${HOLDER.agoMin} min ago); ${HOLDER_EMPTY.name} and ${HOLDER_TO.name} empty; no desk yet (the stack, ${HOLDER_STACK.cards.join(", ")} on ${HOLDER_STACK.name}, comes with the desks)`, async () => {
      t = await holderSetup(ctx, mockUrl);
    }, { critical: true, shot: false });
    await s.step(`resolve ${HOLDER.name}: 1 card; ${HOLDER_EMPTY.name}: 0`, async () => {
      for (const [code, n] of [[HOLDER.code, 1], [HOLDER_EMPTY.code, 0]]) {
        const r = await api(ctx, "GET", ROUTES.trackResolve(code));
        eq([r.status, r.body?.kind, r.body?.location?.cards?.length], [200, "location", n], code);
      }
    }, { critical: true, shot: false });

    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const scan = scannerOn(p);
    const shot = (name) => p.screenshot({ path: path.join(OUT, `scan-holder-card-${name}.png`), fullPage: true }).catch(() => {});
    const m = () => p.locator("main").first();
    const cid = (code) => cardIdOf(t, code);
    try {
      await goto(p, ROUTES.scan);
      await s.step(`390: no desk yet: the scanner reads ${HOLDER.name}: "Move to my desk" greyed and "No desk yet. Open the Desk page once to make one."`, async () => {
        await holderOpen(p, scan, HOLDER, 1);
        const b = UI.holderToDesk(m());
        await b.waitFor({ timeout: 15_000 });
        assert(await b.isDisabled(), '"Move to my desk" is not greyed with no desk');
        const said = await saidOnPage(p, UI.holderNoDesk, 5_000);
        assert(said, `no "No desk yet…" ("${(await scanMain(p)).slice(0, 240)}")`);
        await ensureDesk(ctx);
        // The stack: on a second desk (only a desk holds more than one card)
        await holderStack(ctx, t);
        t = await tables();
        return said;
      }, { shot: false });

      await s.step(`390: ${DESK} made; the scanner reads ${HOLDER.name}: "${HOLDER.name} · has 1 card"; the card's name, Card ID, customer, order, tier, due date, step and time in the holder; its photos; the four buttons`, async () => {
        await goto(p, ROUTES.scan);
        const text = await holderOpen(p, scan, HOLDER, 1);
        assert(UI.holderHasExact(HOLDER.name, 1).test(text), `no "${HOLDER.name} · has 1 card" ("${text.slice(0, 200)}")`);
        const missing = [];
        for (const [what, re] of [
          ["name", nameRe(HOLDER.cardName)], ["Card ID", nameRe(HOLDER.card)], ["customer", nameRe(HOLDER.customer)],
          ["order", orderNumberRe(HOLDER.order)], ["tier", new RegExp(`\\b${HOLDER.tier}\\b`)], ["due", dueRe(HOLDER.due)],
          ["step", new RegExp(`step:?\\s*${esc(HOLDER.step)}`, "i")], ["time in the holder", UI.holderSince(HOLDER.name, 2)],
        ]) if (!re.test(text)) missing.push(`${what} /${re.source}/`);
        assert(!missing.length, `not shown: ${missing.join(", ")} (the page says "${text.slice(0, 500)}")`);
        const absent = [];
        for (const [what, b] of holderButtons(p)) if (!(await b.isVisible().catch(() => false)) || await b.isDisabled()) absent.push(what);
        assert(!absent.length, `buttons not shown or greyed: ${absent.join(", ")}`);
        const imgs = UI.scanCardPhotos(p, HOLDER.card).first().locator("img");
        await imgs.first().waitFor({ timeout: 15_000 });
        assert(await until(() => imgs.first().evaluate((el) => el.complete && el.naturalWidth > 0), 15_000), "its photo did not load");
        await shot("01-holder");
        return text.slice(0, 240);
      }, { shot: false });

      await s.step(`"Move to my desk": ${HOLDER.card} on ${DESK}, ${HOLDER.name} empty, step still ${HOLDER.step}, one card_moves row ${HOLDER.name} -> desk, no email, no step event; "${HOLDER.card} is on your desk."`, async () => {
        const before = await tables();
        const mails = await mailCount();
        const { res, sent } = await holderTap(p, UI.holderToDesk(m()), /\/api\/admin\/track\/(move|assign)$/);
        const after = await tables();
        const desk = placeOf(after, DESK);
        eq(cardsIn(after, DESK), [HOLDER.card], `cards on ${DESK}`);
        eq(cardsIn(after, HOLDER.code), [], `cards in ${HOLDER.name}`);
        eq(latestStage(after, cid(HOLDER.card)), HOLDER.step, "step");
        eq(stageEventCount(after), stageEventCount(before), "step events");
        const rows = movesOf(after, cid(HOLDER.card)).slice(movesOf(before, cid(HOLDER.card)).length);
        eq(rows.map((r) => [r.from_location_id, r.to_location_id, r.stage_before, r.stage_after]), [[placeOf(after, HOLDER.code).id, desk.id, HOLDER.step, HOLDER.step]], "card_moves rows (from, to, step before, after)");
        eq(await mailCount(), mails, "emails");
        const said = await saidOnPage(p, UI.holderOnDesk(HOLDER.card));
        await shot("02-to-desk");
        assert(said, `no "${HOLDER.card} is on your desk." ("${(await scanMain(p)).slice(0, 200)}")`);
        return `${new URL(res.url()).pathname} ${JSON.stringify(sent).slice(0, 120)}`;
      }, { shot: false });

      await s.step(`back in ${HOLDER.name} (API); "Move to another holder": the holder picker and "Scan the next slot"; the scanner (nothing focused on a phone) reads ${HOLDER_TO.name}: the card there, step ${HOLDER_TO.step}, ${HOLDER.name} empty, no email; the picker closes`, async () => {
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await holderOpen(p, scan, HOLDER, 1);
        await UI.holderToHolder(m()).click();
        await UI.holderPicker(p).waitFor({ timeout: 10_000 });
        const bar = await until(async () => { const x = flat(await p.locator("body").innerText()); return UI.holderNext.test(x) ? x.match(UI.holderNext)[0] : null; }, 5_000);
        await p.screenshot({ path: path.join(OUT, "scan-holder-card-03-move-picker.png") }).catch(() => {});
        const before = await tables();
        const mails = await mailCount();
        const saved = p.waitForResponse((r) => /\/api\/admin\/track\/(move|assign)$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60_000 });
        const f = await focusedEl(p);
        await scan(HOLDER_TO.code, { blur: false });
        const r = await saved;
        assert(r.status() < 300, `${new URL(r.url()).pathname} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`);
        const sent = JSON.parse(r.request().postData() ?? "{}");
        const after = await tables();
        eq(cardsIn(after, HOLDER_TO.code), [HOLDER.card], `cards in ${HOLDER_TO.name}`);
        eq(cardsIn(after, HOLDER.code), [], `cards in ${HOLDER.name}`);
        eq(latestStage(after, cid(HOLDER.card)), HOLDER_TO.step, "step");
        eq(await mailCount(), mails, "emails");
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        eq(await openDialogs(p), 0, "open dialogs after the scan");
        const said = await saidOnPage(p, UI.holderMovedTo(HOLDER_TO.name));
        assert(said, `no "In ${HOLDER_TO.name}." ("${(await scanMain(p)).slice(0, 200)}")`);
        assert(bar, 'no "Scan the next slot for …" while the picker was open');
        return `focused: ${f}; ${new URL(r.url()).pathname} ${JSON.stringify(sent).slice(0, 140)}`;
      }, { shot: false });

      await s.step(`back in ${HOLDER.name}; "Take out": no place, step kept, a release row, ${HOLDER.name} empty, no email; "${HOLDER.card} taken out of ${HOLDER.name}, not done…"`, async () => {
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await holderOpen(p, scan, HOLDER, 1);
        const before = await tables();
        const mails = await mailCount();
        const stepBefore = latestStage(before, cid(HOLDER.card));
        await holderTap(p, UI.holderTakeOut(m()), /\/api\/admin\/track\/release$/);
        const after = await tables();
        const c = cardByCode(after, HOLDER.card);
        eq([c.location_id ?? null, cardsIn(after, HOLDER.code)], [null, []], "no place; the holder empty");
        eq(latestStage(after, c.id), stepBefore, "step");
        eq(movesOf(after, c.id).slice(movesOf(before, c.id).length).map((r) => r.action), ["release"], "card_moves rows");
        eq(await mailCount(), mails, "emails");
        const said = await saidOnPage(p, UI.holderTakenOut(HOLDER.card, HOLDER.name));
        assert(said, `no "${HOLDER.card} taken out of ${HOLDER.name}" ("${(await scanMain(p)).slice(0, 200)}")`);
        return said;
      }, { shot: false });

      await s.step(`back in ${HOLDER.name}; "Done", its "Mark done" answered: done, back in its bag (no place), ${HOLDER.name} empty, a done row, no email; "Done. Put it back in A's bag…"`, async () => {
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await holderOpen(p, scan, HOLDER, 1);
        const before = await tables();
        const mails = await mailCount();
        const { asked } = await holderTap(p, UI.holderDone(m()), /\/api\/admin\/track\/done$/);
        const after = await tables();
        const c = cardByCode(after, HOLDER.card);
        eq([c.completed, c.location_id ?? null, cardsIn(after, HOLDER.code)], [true, null, []], "completed, place, the holder");
        eq(movesOf(after, c.id).slice(movesOf(before, c.id).length).map((r) => r.action), ["done"], "card_moves rows");
        eq(await mailCount(), mails, "emails");
        const said = await saidOnPage(p, UI.doneSentence("A"));
        await shot("04-done");
        assert(said, `no "Done. Put it back in A's bag" ("${(await scanMain(p)).slice(0, 200)}")`);
        return `asked: "${asked}"; said: "${said}"`;
      }, { shot: false });

      await s.step(`${HOLDER.name} again (now empty) and ${HOLDER_EMPTY.name} (never used): "<name> · empty" and "Empty. Scan a bag or card to put one here.", no Move, Done or Take out`, async () => {
        const notes = [];
        for (const place of [HOLDER, HOLDER_EMPTY]) {
          const text = await holderOpen(p, scan, place, 0);
          assert(UI.holderEmptyLine.test(text), `${place.name}: no "Empty. Scan a bag or card to put one here." ("${text.slice(0, 200)}")`);
          const shown = [];
          for (const [what, b] of holderButtons(p)) if (await b.isVisible().catch(() => false)) shown.push(what);
          assert(!shown.length, `${place.name}: buttons shown: ${shown.join(", ")}`);
          notes.push(`${place.name}: ok`);
        }
        await shot("05-empty");
        return notes.join("; ");
      }, { shot: false });

      await s.step(`the stack ${HOLDER_STACK.name}: "${HOLDER_STACK.name} · 3 cards", each card's Card ID, name, customer and photos; "Move all 3 to my desk": all 3 on ${DESK}, the holder empty, steps kept (${HOLDER_STACK.step}), 3 move rows, no email; "All 3 cards are on your desk."`, async () => {
        const text = await holderOpen(p, scan, HOLDER_STACK, 3);
        const missing = HOLDER_STACK.cards.filter((c) => !text.includes(c) || !text.includes(cardByCode(t, c).card_name));
        assert(!missing.length, `cards not shown with their names: ${missing.join(", ")}`);
        for (const c of HOLDER_STACK.cards) await UI.scanCardPhotos(p, c).first().waitFor({ timeout: 15_000 });
        await shot("06-stack");
        const before = await tables();
        const mails = await mailCount();
        const { res, sent } = await holderTap(p, UI.holderAllToDesk(m(), 3), /\/api\/admin\/track\/(move|assign)$/);
        const after = await tables();
        eq(cardsIn(after, DESK), sorted([...HOLDER_STACK.cards]), `cards on ${DESK}`);
        eq(cardsIn(after, HOLDER_STACK.code), [], `cards in ${HOLDER_STACK.name}`);
        for (const c of HOLDER_STACK.cards) eq(latestStage(after, cid(c)), HOLDER_STACK.step, `${c} step`);
        eq(stageEventCount(after), stageEventCount(before), "step events");
        eq(after.card_moves.length - before.card_moves.length, 3, "new card_moves rows");
        eq(await mailCount(), mails, "emails");
        const said = await saidOnPage(p, UI.holderAllOnDesk(3));
        assert(said, `no "All 3 cards are on your desk." ("${(await scanMain(p)).slice(0, 200)}")`);
        return `${new URL(res.url()).pathname} ${JSON.stringify(sent).slice(0, 140)}`;
      }, { shot: false });

      await s.step("no browser errors on the phone", async () => {
        assert(!phone.errors.length, phone.errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    } finally {
      await phone.ctx.close();
    }

    await s.step(`1440 (a computer: the picker's box takes the focus): ${HOLDER.card} back in ${HOLDER.name}; "Move to another holder", the scanner types ${HOLDER_TO.name}'s label into the box + Enter: the card in ${HOLDER_TO.name}, ${HOLDER.name} empty`, async () => {
      const scan = scannerOn(page);
      await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
      await goto(page, ROUTES.scan);
      await holderOpen(page, scan, HOLDER, 1);
      await UI.holderToHolder(page.locator("main").first()).click();
      await UI.holderPicker(page).waitFor({ timeout: 10_000 });
      await sleep(300);
      const f = await focusedEl(page);
      const saved = page.waitForResponse((r) => /\/api\/admin\/track\/(move|assign)$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60_000 });
      await scan(HOLDER_TO.code, { blur: false });
      const r = await saved;
      assert(r.status() < 300, `${new URL(r.url()).pathname} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`);
      const after = await tables();
      eq(cardsIn(after, HOLDER_TO.code), [HOLDER.card], `cards in ${HOLDER_TO.name}`);
      eq(cardsIn(after, HOLDER.code), [], `cards in ${HOLDER.name}`);
      await until(async () => (await openDialogs(page)) === 0, 5_000);
      eq(await openDialogs(page), 0, "open dialogs after the scan");
      return `focused: ${f}; ${new URL(r.url()).pathname} ${r.request().postData()?.slice(0, 140)}`;
    }, { shot: false });
  },

  // 390 and 1440: no sideways scroll; the primary buttons on the first screen (unscrolled, not covered, 44+ px)
  async "scan-layout"({ page, ctx, s, browser, appUrl, mockUrl }) {
    await s.step(`setup: as scan-holder-card, with ${DESK}`, () => holderSetup(ctx, mockUrl, { desk: true }), { critical: true, shot: false });
    const firstScreen = async (p, what, loc) => {
      const b = await onScreenUnscrolled(p, loc);
      const problems = [];
      if (b.top < 0 || b.bottom > b.vh) problems.push(`at ${b.top}-${b.bottom}px of ${b.vh}px`);
      if (b.covered) problems.push("covered");
      if (b.height < 44) problems.push(`${b.height}px tall`);
      if (b.width > b.vw) problems.push(`${b.width}px wide`);
      return problems.length ? `${what}: ${problems.join(", ")}` : null;
    };
    const runAt = async (label, p, errors) => {
      const scan = scannerOn(p);
      const shot = (name, full = true) => p.screenshot({ path: path.join(OUT, `scan-layout-${label}-${name}.png`), fullPage: full }).catch(() => {});
      const noSideways = async () => { const w = await sidewaysScroll(p); assert(w <= 1, `scrolls sideways by ${w}px`); };
      await s.step(`${label}: ready: the "Ready to scan" panel and "Type a code instead" on the first screen; no sideways scroll`, async () => {
        await goto(p, ROUTES.scan);
        await UI.scanReady(p).waitFor({ timeout: 60_000 });
        const b = await onScreenUnscrolled(p, UI.scanReady(p));
        assert(b.top >= 0 && b.bottom <= b.vh, `the panel at ${b.top}-${b.bottom}px of ${b.vh}px`);
        const link = await firstScreen(p, "Type a code instead", UI.typeCodeLink(p));
        assert(!link, link);
        await noSideways();
        await shot("01-ready", false);
      }, { shot: false });
      await s.step(`${label}: bag CD-2549-G: no sideways scroll; photos within the screen; each card's button 44+ px and not covered when scrolled to`, async () => {
        await scan("CD-2549-G");
        await scanShows(p, BO_GOLD);
        await noSideways();
        const vw = p.viewportSize().width;
        const wide = await p.locator("main").first().getByRole("list", { name: /^photos of /i }).evaluateAll((els, w) => els.filter((e) => e.getBoundingClientRect().right > w + 1).length, vw);
        eq(wide, 0, "photo rows past the screen's edge");
        const problems = [];
        for (const code of BO_GOLD) {
          const btn = scanCardBlock(p, code).getByRole("button", { name: /^(assign to a slot|put in\b)/i }).first();
          if (!(await btn.count())) { problems.push(`${code}: no button`); continue; }
          await btn.scrollIntoViewIfNeeded();
          const r = await btn.evaluate((el) => { const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { h: b.height, covered: !(hit && (hit === el || el.contains(hit))) }; });
          if (r.h < 44 || r.covered) problems.push(`${code}: ${Math.round(r.h)}px${r.covered ? ", covered" : ""}`);
        }
        await shot("02-bag");
        assert(!problems.length, problems.join(" | "));
      }, { shot: false });
      await s.step(`${label}: scrolled to the bottom of the bag's list, the scanner reads ${HOLDER.name}: its header is on screen where the page lands (no scrolling by hand)`, async () => {
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await sleep(300);
        const y0 = await p.evaluate(() => window.scrollY);
        await holderOpen(p, scan, HOLDER, 1);
        await sleep(800);
        const head = p.locator("main").first().getByText(UI.holderHas(HOLDER.name, 1)).first();
        const r = await head.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + Math.min(40, b.width / 2), b.top + b.height / 2);
          return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight, y: Math.round(window.scrollY), covered: !(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
        });
        await shot("03a-holder-after-scroll", false);
        assert(r.top >= 0 && r.bottom <= r.vh && !r.covered, `the header at ${r.top}-${r.bottom}px of ${r.vh}px${r.covered ? ", covered" : ""} (page scrolled to ${r.y}px, was ${y0}px)`);
        return `scrolled ${y0}px -> ${r.y}px; header at ${r.top}px`;
      }, { shot: false });
      await s.step(`${label}: ${HOLDER.name} with 1 card, fresh page: its header and the four buttons on the first screen (unscrolled, not covered, 44+ px); no sideways scroll`, async () => {
        await goto(p, ROUTES.scan);
        await holderOpen(p, scan, HOLDER, 1);
        await noSideways();
        await shot("03-holder");
        await shot("03-holder-first-screen", false);
        const head = await onScreenUnscrolled(p, p.locator("main").first().getByText(UI.holderHas(HOLDER.name, 1)).first());
        const problems = head.top < 0 || head.bottom > head.vh ? [`header at ${head.top}-${head.bottom}px of ${head.vh}px`] : [];
        for (const [what, b] of holderButtons(p)) { const x = await firstScreen(p, what, b); if (x) problems.push(x); }
        assert(!problems.length, problems.join(" | "));
      }, { shot: false });
      await s.step(`${label}: "Move to another holder": the holder picker on the first screen with ${HOLDER_TO.name} to tap; Esc and Cancel leave nothing waiting`, async () => {
        await UI.holderToHolder(p.locator("main").first()).click();
        const picker = UI.holderPicker(p);
        await picker.waitFor({ timeout: 10_000 });
        const option = UI.holderOption(picker, HOLDER_TO.name);
        await option.waitFor({ timeout: 15_000 });
        await shot("04-move-picker", false);
        const box = await picker.boundingBox();
        const vp = p.viewportSize();
        const problems = [];
        if (!box || box.y < -1 || box.x < -1 || box.x + box.width > vp.width + 1) problems.push(`the picker at ${JSON.stringify(box)}`);
        const ob = await option.boundingBox();
        if (!ob || ob.y + ob.height > vp.height || ob.height < 44) problems.push(`${HOLDER_TO.name} option at ${JSON.stringify(ob)}`);
        // Esc closes the picker; the holder's bar then says "Scan the next holder, or pick it from the list." [Pick from the list] [Cancel]
        await p.keyboard.press("Escape");
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        if (await openDialogs(p)) problems.push("Esc left the picker open");
        const fromList = p.getByRole("button", { name: /^pick from the list$/i }).first();
        if (!(await fromList.isVisible().catch(() => false))) problems.push('no "Pick from the list" after Esc');
        const cancel = p.locator("main").first().getByRole("button", { name: /^cancel$/i }).last();
        if (await cancel.isVisible().catch(() => false)) await cancel.click();
        else problems.push("no Cancel after Esc");
        await sleep(400);
        // nothing waits any more: the top panel is back to "Ready to scan" and the four buttons are back
        const cue = flat(await UI.scanReady(p).innerText().catch(() => ""));
        if (!UI.readyToScan.test(cue)) problems.push(`the top panel still says "${cue.slice(0, 80)}"`);
        if (await fromList.isVisible().catch(() => false)) problems.push('"Pick from the list" still shown');
        if (!(await UI.holderToHolder(p.locator("main").first()).isVisible().catch(() => false))) problems.push('"Move to another holder" not back');
        assert(!problems.length, problems.join(" | "));
      }, { shot: false });
      await s.step(`${label}: the stack ${HOLDER_STACK.name} (3 cards): "Move all 3 to my desk" on the first screen (not covered, 44+ px); no sideways scroll`, async () => {
        await holderOpen(p, scan, HOLDER_STACK, 3);
        await noSideways();
        await shot("05-stack");
        await shot("05-stack-first-screen", false);
        const x = await firstScreen(p, "Move all 3 to my desk", UI.holderAllToDesk(p.locator("main").first(), 3));
        assert(!x, x);
      }, { shot: false });
      await s.step(`${label}: the empty ${HOLDER_EMPTY.name}: "${HOLDER_EMPTY.name} · empty" and "Empty. Scan a bag…" on the first screen; no sideways scroll`, async () => {
        await holderOpen(p, scan, HOLDER_EMPTY, 0);
        await noSideways();
        const b = await onScreenUnscrolled(p, p.locator("main").first().getByText(UI.holderEmptyLine).first());
        await shot("06-empty", false);
        assert(b.top >= 0 && b.bottom <= b.vh, `"Empty. Scan a bag…" at ${b.top}-${b.bottom}px of ${b.vh}px`);
      }, { shot: false });
      if (errors) {
        await s.step(`${label}: no browser errors`, async () => {
          assert(!errors.length, errors.slice(0, 3).join(" | ").slice(0, 300));
        }, { shot: false });
      }
    };
    const phone = await phoneContext(browser, appUrl);
    try {
      await runAt("390", phone.page, phone.errors);
    } finally {
      await phone.ctx.close();
    }
    await runAt("1440", page, null);
  },
};
Object.assign(SCENARIOS, SCAN_SCENARIOS, SCAN_HOLDER_SCENARIOS);

// The scanner over Bluetooth: slow or stalled keys, repeats, Esc and a stray Enter (review fixes, Nov 26)
const SCAN_WEDGE_SCENARIOS = {
  async "scan-wedge-timing"({ page, ctx, s, mockUrl }) {
    const G = "CD-2549-G";
    const P = "CD-2549-P";
    const p = page;
    const resolves = [];
    p.on("response", (r) => { if (r.url().includes("/api/admin/track/resolve")) resolves.push(decodeURIComponent(new URL(r.url()).searchParams.get("code") ?? "")); });
    const focusTypeLink = async () => {
      await UI.typeCodeLink(p).focus();
      assert((await focusedEl(p)).startsWith("button"), `focus: ${await focusedEl(p)}`);
    };
    await s.step("setup: CD-2549 (bags G, P) received with receiving photos; CD-2549-08's photo points at a missing file", async () => {
      await deskReceive(ctx, mockUrl);
      await mockUpdate(mockUrl, "cards", { receiving_photo_urls: [`${mockUrl}/storage/v1/object/public/card-photos/harness-missing-photo.png`], photo_urls: [] }, "card_code", "CD-2549-08");
      await goto(p, ROUTES.scan);
      await UI.scanReady(p).waitFor({ timeout: 60_000 });
    }, { critical: true, shot: false });

    await s.step(`a slow scanner (120 ms a key) with "Type a code instead" focused: ${G} opens, and its Enter doesn't open the code box`, async () => {
      await focusTypeLink();
      await scanType(p, SCAN_LINK(G), { blur: false, delay: 120 });
      await scanShows(p, BO_GOLD);
      eq(await UI.scanInput(p).count(), 0, "code boxes (the scan's Enter pressed the focused link)");
    }, { shot: false });

    await s.step(`a 400 ms pause before Enter, the same link focused: ${P} opens, the code box stays closed`, async () => {
      await focusTypeLink();
      await p.keyboard.type(SCAN_LINK(P), { delay: 5 });
      await sleep(400);
      await p.keyboard.press("Enter");
      await scanShows(p, ["CD-2549-07", "CD-2549-08"]);
      eq(await UI.scanInput(p).count(), 0, "code boxes (the scan's Enter pressed the focused link)");
    }, { shot: false });

    await s.step(`the same label again 1 s later counts (a second card for the same place, a retry); a double read 200 ms apart counts once`, async () => {
      const before = resolves.filter((c) => c === G).length;
      await scanType(p, SCAN_LINK(G), { delay: 5 });
      await sleep(1_000);
      await scanType(p, SCAN_LINK(G), { delay: 5 });
      await until(() => resolves.filter((c) => c === G).length >= before + 2, 15_000);
      eq(resolves.filter((c) => c === G).length - before, 2, "lookups of a label scanned twice, 1 s apart");
      await sleep(1_000);
      const mid = resolves.filter((c) => c === G).length;
      await scanType(p, SCAN_LINK(G), { delay: 2 });
      await sleep(200);
      await scanType(p, SCAN_LINK(G), { delay: 2 });
      await sleep(2_000);
      eq(resolves.filter((c) => c === G).length - mid, 1, "lookups of a double read 200 ms apart");
      await scanShows(p, BO_GOLD);
    }, { shot: false });

    await s.step(`a scan that closes a photo, then a stray Enter: the photo doesn't open again and nothing is focused`, async () => {
      await sleep(800);
      await scanType(p, SCAN_LINK(P), { delay: 5 });
      await scanShows(p, ["CD-2549-07"]);
      const tile = UI.scanCardPhotos(p, "CD-2549-07").first().getByRole("button").first();
      await tile.click();
      await UI.photoViewer(p).waitFor({ timeout: 15_000 });
      await sleep(800);
      await scanType(p, SCAN_LINK(P), { blur: false, delay: 5 });
      await until(async () => (await openDialogs(p)) === 0, 10_000);
      await sleep(300);
      await p.keyboard.press("Enter");
      await sleep(500);
      eq(await openDialogs(p), 0, "open dialogs after a stray Enter");
      eq(await focusedEl(p), "nothing", "focus after the scan closed the photo");
    }, { shot: false });

    await s.step(`a thumbnail that can't load says "Photo couldn't load" in its tile`, async () => {
      const list = UI.scanCardPhotos(p, "CD-2549-08").first();
      await list.scrollIntoViewIfNeeded();
      await list.getByText(/photo couldn.t load/i).first().waitFor({ timeout: 15_000 });
      eq(await list.locator("img").count(), 0, "a broken <img> left in the tile");
    }, { shot: false });

    await s.step(`Esc closing a photo or the code box keeps a pending "Scan the slot for …"; Esc on the page drops it`, async () => {
      // The top panel's line (not the screen-reader status line, which keeps the last words)
      const waiting = async () => /scan the slot for/i.test(flat(await UI.scanReady(p).innerText()));
      const assign = p.getByRole("button", { name: /^assign to a slot$/i }).first();
      await assign.click();
      assert(await until(waiting, 10_000), "no \"Scan the slot for …\" after Assign to a slot");
      const tile = UI.scanCardPhotos(p, "CD-2549-07").first().getByRole("button").first();
      await tile.click();
      await UI.photoViewer(p).waitFor({ timeout: 15_000 });
      await p.keyboard.press("Escape");
      await until(async () => (await openDialogs(p)) === 0, 5_000);
      assert(await waiting(), "Esc on the photo dropped the waiting Assign");
      await UI.typeCodeLink(p).click();
      await UI.scanInput(p).waitFor({ timeout: 10_000 });
      await p.keyboard.press("Escape");
      await until(async () => (await UI.scanInput(p).count()) === 0, 5_000);
      eq(await UI.scanInput(p).count(), 0, "code boxes after Esc");
      assert(await waiting(), "Esc in the code box dropped the waiting Assign");
      await p.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === "function") a.blur(); });
      await p.keyboard.press("Escape");
      await until(async () => !(await waiting()), 5_000);
      assert(!(await waiting()), "Esc on the page kept the waiting Assign");
    }, { shot: false });
  },
};
Object.assign(SCENARIOS, SCAN_WEDGE_SCENARIOS);

// The holder view's review fixes (Nov 26): no button that saves takes focus by itself and a broken
// scan's Enter presses nothing; Done / Take out name the holder (fromCode) so a card moved meanwhile
// is refused; the cards a save took out leave the list even when the re-read fails, and the buttons
// stay greyed until it lands; ticks fixed while the next holder is awaited; a switched-off holder;
// a full desk asks "Add anyway?" (no force); the DONE sign after "Move to another holder"; the
// Scan page's older lines go after a holder save; one prompt over a holder with cards; the picker
// starts on its heading on a phone and never offers the Open bags box; "Got it: HEAT PRESS 02".
const SCAN_FIX_SCENARIOS = {
  async "scan-holder-fixes"({ ctx, s, browser, appUrl, mockUrl }) {
    const STACK = { ...HOLDER_STACK, cards: [...HOLDER_STACK.cards, "CD-2549-04"] };
    let t = null;
    await s.step(`setup: as scan-holder-card with ${DESK}; CD-2549-04 also on ${STACK.name} (4 cards)`, async () => {
      t = await holderSetup(ctx, mockUrl, { desk: true });
      await assignOk(ctx, STACK.code, [cardIdOf(t, "CD-2549-04")], true);
      t = await tables();
      eq(cardsIn(t, STACK.code), STACK.cards, `cards in ${STACK.name}`);
      assert(placeOf(t, "LOC-OPEN-BAGS"), "no LOC-OPEN-BAGS (a card out of its bag files the bag there)");
    }, { critical: true, shot: false });

    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const scan = scannerOn(p);
    const m = () => p.locator("main").first();
    const holderLine = () => p.locator('section[aria-labelledby^="holder-"] div[role="status"]').first().innerText().then(flat).catch(() => "");
    const posts = [];
    p.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/admin/track/")) posts.push({ path: new URL(r.url()).pathname, body: JSON.parse(r.postData() ?? "{}") }); });
    const postsTo = (re) => posts.filter((x) => re.test(x.path));
    const shot = (name) => p.screenshot({ path: path.join(OUT, `scan-holder-fixes-${name}.png`) }).catch(() => {});
    const boxes = () => m().locator('section[aria-labelledby^="holder-"] input[type="checkbox"]');
    const stackItem = (code) => m().getByRole("list", { name: new RegExp(`^cards in ${esc(STACK.name)}$`, "i") }).locator(":scope > li").filter({ hasText: code });
    const tick = async (code) => { await stackItem(code).getByRole("checkbox").first().check(); };
    try {
      await goto(p, ROUTES.scan);

      await s.step(`${HOLDER.name}: "Done" asks; the question takes focus, never "Mark done"; a broken scan's Enter (a focused "Mark done" too) saves nothing`, async () => {
        await holderOpen(p, scan, HOLDER, 1);
        await UI.holderDone(m()).click();
        await p.getByText(/mark it done\? then put it back in its bag/i).first().waitFor({ timeout: 10_000 });
        await sleep(200);
        const focus = await focusedEl(p);
        assert(!/^button "mark/i.test(focus), `"Mark done" took focus (${focus})`);
        assert(/^div /.test(focus), `the question group isn't focused (${focus})`);
        await shot("01-done-question");
        const before = postsTo(/\/done$/).length;
        // What's left of a broken read on the question: 2 characters and the scanner's Enter, then a stray key + Enter
        await p.keyboard.type("-P", { delay: 8 });
        await p.keyboard.press("Enter");
        await sleep(300);
        await p.keyboard.press("x");
        await sleep(600);
        await p.keyboard.press("Enter");
        // ... and with "Mark done" itself focused (a computer user tabbed to it): the scan's Enter is still kept from it
        await UI.holderConfirm(m()).focus();
        await p.keyboard.type("7P", { delay: 8 });
        await p.keyboard.press("Enter");
        await sleep(1_500);
        eq(postsTo(/\/done$/).length - before, 0, "POST /done after the broken scans");
        const c = cardByCode(await tables(), HOLDER.card);
        eq([c.completed, c.location_id], [false, placeOf(t, HOLDER.code).id], `${HOLDER.card}: completed, place`);
        await p.locator("main").first().getByRole("button", { name: /^cancel$/i }).last().click();
        return `focus on the question: ${focus}`;
      }, { shot: false });

      await s.step(`bag CD-2549-G, then ${STACK.name}: "Got it: ${STACK.name}"; one prompt (top panel "Ready to scan" / "Scan a bag to add a card here."; no "Tap a card from" list); photos at the list size`, async () => {
        await scan("CD-2549-G");
        await scanShows(p, ["CD-2549-01"]);
        await scan(STACK.code);
        await gotItSeen(p, STACK.name);
        const text = (await until(async () => { const x = await scanMain(p); return UI.holderHas(STACK.name, 4).test(x) ? x : null; }, 30_000)) ?? await scanMain(p);
        assert(UI.holderHas(STACK.name, 4).test(text), `no "${STACK.name} · 4 cards" ("${text.slice(0, 200)}")`);
        const cue = flat(await UI.scanReady(p).innerText());
        assert(/ready to scan/i.test(cue) && /scan a bag to add a card here/i.test(cue), `the top panel says "${cue.slice(0, 160)}"`);
        assert(!/pick its cards below|add a card to/i.test(cue), `the top panel still says "${cue.slice(0, 160)}"`);
        assert(!/tap a card from/i.test(text), "the bag's \"Tap a card from …\" list shows under a holder with cards");
        const tall = await m().getByRole("list", { name: /^photos of CD-2549-01/i }).locator("img").first().evaluate((el) => Math.round(el.getBoundingClientRect().height)).catch(() => 0);
        assert(tall > 0 && tall <= 120, `a stack card's photo is ${tall}px tall (list size: 112)`);
        await shot("02-stack");
        return `top panel: "${cue.slice(0, 80)}"; photo ${tall}px`;
      }, { shot: false });

      await s.step(`"Take out selected" for CD-2549-04 while the re-read fails: it leaves the list anyway (fromCode sent); the header says 3`, async () => {
        await tick("CD-2549-04");
        await p.route(/\/api\/admin\/track\/resolve/, (r) => r.abort());
        const saved = p.waitForResponse((r) => /\/release$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
        await m().getByRole("button", { name: /^take out selected$/i }).click();
        const r = await saved;
        eq(r.status(), 200, "POST release");
        const sent = JSON.parse(r.request().postData() ?? "{}");
        eq([sent.fromCode, sent.cardIds?.length], [STACK.code, 1], "release body (fromCode, cards)");
        await sleep(1_500);
        await p.unroute(/\/api\/admin\/track\/resolve/);
        const text = await scanMain(p);
        eq(await stackItem("CD-2549-04").count(), 0, "CD-2549-04 still listed");
        eq(await stackItem("CD-2549-03").count(), 1, "CD-2549-03 listed");
        assert(UI.holderHas(STACK.name, 3).test(text), `no "${STACK.name} · 3 cards" ("${text.slice(0, 160)}")`);
        eq(cardsIn(await tables(), STACK.code), STACK.cards.slice(0, 3), `cards in ${STACK.name}`);
      }, { shot: false });

      await s.step(`"Take out selected" for CD-2549-03 with a slow re-read: the buttons stay greyed until it lands`, async () => {
        await tick("CD-2549-03");
        let release = () => {};
        const held = new Promise((r) => { release = r; });
        await p.route(/\/api\/admin\/track\/resolve/, async (route) => { await held; await route.continue().catch(() => {}); });
        const saved = p.waitForResponse((r) => /\/release$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
        await m().getByRole("button", { name: /^take out selected$/i }).click();
        eq((await saved).status(), 200, "POST release");
        await sleep(800);
        const all = UI.holderAllToDesk(m(), 2);
        const during = await all.isDisabled().catch(() => null);
        release();
        await until(async () => !(await all.isDisabled().catch(() => true)), 15_000);
        await p.unroute(/\/api\/admin\/track\/resolve/);
        const afterwards = await all.isDisabled().catch(() => null);
        eq([during, afterwards], [true, false], `"Move all 2 to my desk" greyed during the re-read, then not`);
      }, { shot: false });

      await s.step(`tick CD-2549-01 and -02, "Move selected": the picker starts on its heading (no keyboard over the list) and offers no OPEN BAGS; Esc: the ticks are fixed ("Cancel to change the cards."); Cancel frees them`, async () => {
        await tick("CD-2549-01");
        await tick("CD-2549-02");
        await m().getByRole("button", { name: /^move selected$/i }).click();
        const picker = UI.holderPicker(p);
        await picker.waitFor({ timeout: 10_000 });
        // Two cards: each holder takes one card (owner, Nov 26 2026), so only the other desk is offered
        await picker.getByText(/^Each holder takes one card: put these 2 cards in one at a time, or on another desk\.$/).waitFor({ timeout: 15_000 });
        await UI.holderOption(picker, "DESK").waitFor({ timeout: 15_000 });
        assert(!(await UI.holderOption(picker, HOLDER_TO.name).count()), `${HOLDER_TO.name} is offered for 2 cards`);
        const focus = await focusedEl(p);
        assert(!/^input/.test(focus), `the picker's box took focus on a phone (${focus})`);
        const offered = flat(await picker.innerText());
        assert(!/open bags/i.test(offered), `the picker offers the Open bags box ("${offered.slice(0, 200)}")`);
        await shot("03-picker");
        await p.keyboard.press("Escape");
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        await p.getByText(/cancel to change the cards/i).first().waitFor({ timeout: 5_000 });
        const disabled = await boxes().evaluateAll((els) => els.map((e) => e.disabled));
        assert(disabled.length === 2 && disabled.every(Boolean), `tick boxes while waiting: ${JSON.stringify(disabled)}`);
        assert(await m().getByRole("button", { name: /^pick (all|none)$/i }).isDisabled(), "Pick all/none not greyed");
        await shot("04-ticks-fixed");
        await m().getByRole("button", { name: /^cancel$/i }).last().click();
        await until(async () => (await boxes().evaluateAll((els) => els.every((e) => !e.disabled))), 5_000);
        const freed = await boxes().evaluateAll((els) => els.map((e) => e.disabled));
        eq(freed, [false, false], "tick boxes after Cancel");
        return `picker focus: ${focus}`;
      }, { shot: false });

      await s.step(`CD-2549-02 moved to ${HOLDER_EMPTY.name} by another phone; "Done for selected" (01, 02): 01 done, 02 refused "Not in ${STACK.name} any more (now in ${HOLDER_EMPTY.name})." and left alone`, async () => {
        await assignOk(ctx, HOLDER_EMPTY.code, [cardIdOf(t, "CD-2549-02")]);
        const saved = p.waitForResponse((r) => /\/done$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
        await m().getByRole("button", { name: /^done for selected$/i }).click();
        await UI.holderConfirm(m()).click();
        const r = await saved;
        eq(r.status(), 200, "POST done");
        const sent = JSON.parse(r.request().postData() ?? "{}");
        eq(sent.fromCode, STACK.code, "done body fromCode");
        const after = await tables();
        eq([cardByCode(after, "CD-2549-01").completed, cardByCode(after, "CD-2549-02").completed], [true, false], "completed (01, 02)");
        eq(cardsIn(after, HOLDER_EMPTY.code), ["CD-2549-02"], `cards in ${HOLDER_EMPTY.name}`);
        const said = await until(async () => { const x = await holderLine(); return new RegExp(`not in ${esc(STACK.name)} any more \\(now in ${esc(HOLDER_EMPTY.name)}\\)`, "i").test(x) ? x : null; }, 15_000);
        await shot("05-refused");
        assert(said, `no "Not in ${STACK.name} any more (now in ${HOLDER_EMPTY.name})." ("${await holderLine()}")`);
        return said.slice(0, 160);
      }, { shot: false });

      await s.step(`${HOLDER.name} switched off in Places: "Move to my desk" and "Move to another holder" greyed with "This holder is switched off: …"; Take out still works (fromCode)`, async () => {
        const r = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: placeOf(t, HOLDER.code).id, active: false });
        eq(r.status, 200, `PATCH (${JSON.stringify(r.body).slice(0, 120)})`);
        await holderOpen(p, scan, HOLDER, 1);
        await p.getByText(/this holder is switched off: use take out or done, or switch it on in places\./i).first().waitFor({ timeout: 10_000 });
        const greyed = [await UI.holderToDesk(m()).isDisabled(), await UI.holderToHolder(m()).isDisabled(), await UI.holderDone(m()).isDisabled(), await UI.holderTakeOut(m()).isDisabled()];
        eq(greyed, [true, true, false, false], "greyed: to my desk, another holder, Done, Take out");
        await shot("06-switched-off");
        const saved = p.waitForResponse((x) => /\/release$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await UI.holderTakeOut(m()).click();
        const res = await saved;
        eq([res.status(), JSON.parse(res.request().postData() ?? "{}").fromCode], [200, HOLDER.code], "POST release (status, fromCode)");
        eq(cardsIn(await tables(), HOLDER.code), [], `cards in ${HOLDER.name}`);
        const on = await api(ctx, "PATCH", ROUTES.trackLocations(), { id: placeOf(t, HOLDER.code).id, active: true });
        eq(on.status, 200, "switched back on");
      }, { shot: false });

      await s.step(`${HOLDER.card} back in ${HOLDER.name}; "Move to another holder", Esc, then the DONE sign: ${HOLDER.name}'s own line says where the bag is`, async () => {
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await holderOpen(p, scan, HOLDER, 1);
        await UI.holderToHolder(m()).click();
        await UI.holderPicker(p).waitFor({ timeout: 10_000 });
        await p.keyboard.press("Escape");
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        const saved = p.waitForResponse((x) => /\/done$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await scan("LOC-DONE");
        const r = await saved;
        eq([r.status(), JSON.parse(r.request().postData() ?? "{}").fromCode], [200, HOLDER.code], "POST done (status, fromCode: the from-holder)");
        const said = await until(async () => { const x = await holderLine(); return UI.doneSentence("A").test(x) ? x : null; }, 20_000);
        await shot("07-done-sign");
        assert(said, `${HOLDER.name}'s line: "${await holderLine()}" (page: "${(await scanMain(p)).slice(0, 200)}")`);
        return said.slice(0, 160);
      }, { shot: false });

      await s.step(`${DESK} with a limit of 1 (Places) holding CD-2549-08: "Move to my desk" sends no force and asks "Add anyway?" (focus on the question); "Add anyway" puts it there`, async () => {
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await mockUpdate(mockUrl, "locations", { capacity: 1 }, "code", DESK);
        await assignOk(ctx, DESK, [cardIdOf(t, "CD-2549-08")], true);
        await holderOpen(p, scan, HOLDER, 1);
        const first = p.waitForResponse((x) => /\/move$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await UI.holderToDesk(m()).click();
        const r1 = await first;
        eq([r1.status(), JSON.parse(r1.request().postData() ?? "{}").force ?? false], [409, false], "first POST move (status, force)");
        await p.getByText(/already holds .*add anyway\?/i).first().waitFor({ timeout: 10_000 });
        await sleep(200);
        const focus = await focusedEl(p);
        assert(!/^button "add anyway/i.test(focus), `"Add anyway" took focus (${focus})`);
        await shot("08-desk-full");
        const second = p.waitForResponse((x) => /\/move$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await m().getByRole("button", { name: /^add anyway$/i }).click();
        const r2 = await second;
        eq([r2.status(), JSON.parse(r2.request().postData() ?? "{}").force], [200, true], "second POST move (status, force)");
        eq(cardsIn(await tables(), DESK), ["CD-2549-07", "CD-2549-08"], `cards on ${DESK}`);
        await saidOnPage(p, UI.holderOnDesk(HOLDER.card));
        await mockUpdate(mockUrl, "locations", { capacity: null }, "code", DESK);
        return `focus: ${focus}`;
      }, { shot: false });

      await s.step(`the Scan page's older green line ("Open the desk page", after a card put on ${DESK}) goes when a holder saves`, async () => {
        await scan("CD-2549-G");
        // The bag on screen (its header's "Bag page" link), not the empty CLAMP 07's own list of the same bag's cards
        await m().getByRole("link", { name: /^bag page$/i }).first().waitFor({ timeout: 30_000 });
        // The empty CLAMP 07 on screen before is still the slot cards go in ("Put a card in CLAMP 07"): stop that
        const stop = UI.scanReady(p).getByRole("button", { name: /^cancel$/i });
        if (await stop.isVisible().catch(() => false)) await stop.click();
        const assign = m().locator("li").filter({ hasText: /CD-2549-03(?![0-9-])/ }).getByRole("button", { name: /^assign to a slot$/i }).first();
        await assign.waitFor({ timeout: 10_000 });
        await assign.click();
        const put = p.waitForResponse((x) => /\/assign$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await scan(DESK);
        eq((await put).status(), 200, "POST assign");
        const old = m().getByRole("link", { name: /^open the desk page$/i });
        await old.first().waitFor({ timeout: 10_000 });
        await holderOpen(p, scan, HOLDER_EMPTY, 1);
        assert(await old.first().isVisible(), "the green line isn't above the holder (nothing to test)");
        const saved = p.waitForResponse((x) => /\/release$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await UI.holderTakeOut(m()).click();
        eq((await saved).status(), 200, "POST release");
        await until(async () => (await old.count()) === 0, 10_000);
        eq(await old.count(), 0, '"Open the desk page" lines left');
      }, { shot: false });

      await s.step("no browser errors on the phone", async () => {
        assert(!phone.errors.length, phone.errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    } finally {
      await phone.ctx.close();
    }
  },

  // Review fixes 2 (Nov 26): the DONE sign after "Move to another holder" names the from-holder
  // (fromCode), so a card someone moved meanwhile is refused (409), nothing done, no email, and the
  // move stops waiting; a forgotten move ends (10 minutes); a tap during the page's own re-read only
  // flashes "Still saving…" (the DONE sign's line stays); "Add anyway?" goes when another desk is
  // chosen and Add anyway sends to the desk it named; on a computer, DONE scanned into the picker's
  // box says "To finish it, close this list, then scan DONE or tap Done." and does nothing itself.
  async "scan-holder-fixes-2"({ page, ctx, s, browser, appUrl, mockUrl }) {
    const GAVIN = "LOC-DESK-GAVIN";
    const DONE_IN_PICKER = "To finish it, close this list, then scan DONE or tap Done.";
    const BUSY = "Still saving the last change. Try again in a moment.";
    let t = null;
    await s.step(`setup: as scan-holder-card with ${DESK} and ${GAVIN} (2 desks: the "My desk" select)`, async () => {
      t = await holderSetup(ctx, mockUrl, { desk: true });
      const r = await api(ctx, "POST", ROUTES.trackLocations(), { name: "Desk Gavin", kind: "other" });
      assert(r.status < 300, `POST locations: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      t = await tables();
      assert(placeOf(t, GAVIN), `no ${GAVIN}`);
    }, { critical: true, shot: false });

    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const scan = scannerOn(p);
    const m = () => p.locator("main").first();
    const holderLine = () => p.locator('section[aria-labelledby^="holder-"] div[role="status"]').first().innerText().then(flat).catch(() => "");
    const posts = [];
    p.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/admin/track/")) posts.push({ path: new URL(r.url()).pathname, body: JSON.parse(r.postData() ?? "{}") }); });
    const postsTo = (re) => posts.filter((x) => re.test(x.path));
    const shot = (name, pg = p) => pg.screenshot({ path: path.join(OUT, `scan-holder-fixes-2-${name}.png`) }).catch(() => {});
    const cue = async () => flat(await p.locator("[data-scanner]").first().innerText().catch(() => ""));
    /** HOLDER on screen, "Move to another holder", the picker closed with Esc: the page waits for the next holder. */
    const waitMove = async () => {
      await holderOpen(p, scan, HOLDER, 1);
      await UI.holderToHolder(m()).click();
      await UI.holderPicker(p).waitFor({ timeout: 10_000 });
      await p.keyboard.press("Escape");
      await until(async () => (await openDialogs(p)) === 0, 5_000);
      const c = await until(async () => { const x = await cue(); return UI.holderNext.test(x) ? x : null; }, 5_000);
      assert(c, `the top panel doesn't wait for the next holder ("${await cue()}")`);
    };
    try {
      await goto(p, ROUTES.scan);

      await s.step(`${HOLDER.card}: "Move to another holder"; another phone moves it to ${HOLDER_TO.name}; the DONE sign: POST done with fromCode ${HOLDER.code} refused (409), not done, still in ${HOLDER_TO.name}, no email, no history row; the move stops waiting (a holder scanned next moves nothing)`, async () => {
        await waitMove();
        await assignOk(ctx, HOLDER_TO.code, [cardIdOf(t, HOLDER.card)]);
        const before = await tables();
        const mails = await mailCount();
        const saved = p.waitForResponse((x) => /\/done$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await scan("LOC-DONE");
        const r = await saved;
        const sent = JSON.parse(r.request().postData() ?? "{}");
        eq([r.status(), sent.fromCode], [409, HOLDER.code], "POST done (status, fromCode)");
        const said = await saidOnPage(p, /isn't in clamp 07 any more \(now in heat press 01\)/i, 10_000);
        assert(said, `no "${HOLDER.card} isn't in ${HOLDER.name} any more (now in ${HOLDER_TO.name})." ("${(await scanMain(p)).slice(0, 200)}")`);
        const after = await tables();
        const c = cardByCode(after, HOLDER.card);
        eq([c.completed, c.location_id], [false, placeOf(after, HOLDER_TO.code).id], `${HOLDER.card}: completed, place`);
        eq(movesOf(after, c.id).length, movesOf(before, c.id).length, "card_moves rows for it");
        eq(await mailCount(), mails, "emails");
        // Shown as it is now, not waiting any more
        await until(async () => UI.holderEmptyHead(HOLDER.name).test(await scanMain(p)), 15_000);
        assert(UI.holderEmptyHead(HOLDER.name).test(await scanMain(p)), `${HOLDER.name} not shown empty ("${(await scanMain(p)).slice(0, 160)}")`);
        const top = await cue();
        assert(!UI.holderNext.test(top), `the top panel still waits: "${top}"`);
        await shot("01-stale-done-refused");
        const moves = postsTo(/\/move$/).length;
        await holderOpen(p, scan, HOLDER_EMPTY, 0);
        await sleep(1_000);
        eq(postsTo(/\/move$/).length - moves, 0, `POST move after scanning ${HOLDER_EMPTY.name}`);
        eq(cardsIn(await tables(), HOLDER_TO.code), [HOLDER.card], `cards in ${HOLDER_TO.name}`);
        return `${said.slice(0, 120)}; top panel: "${top.slice(0, 60)}"`;
      }, { shot: false });

      await s.step(`a forgotten move ends: "Move to another holder", then 11 minutes later (the phone's clock) the DONE sign marks nothing done and shows the Done place`, async () => {
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await waitMove();
        // As if the phone was locked for 11 minutes (its timers slept): only the clock moved on
        await p.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 11 * 60_000; });
        const dones = postsTo(/\/done$/).length;
        await scan("LOC-DONE");
        await until(async () => /\bdone\b/i.test(await scanMain(p)) && !UI.holderHas(HOLDER.name, 1).test(await scanMain(p)), 15_000);
        await sleep(1_000);
        eq(postsTo(/\/done$/).length - dones, 0, "POST done after the move ran out");
        const c = cardByCode(await tables(), HOLDER.card);
        eq([c.completed, cardsIn(await tables(), HOLDER.code)], [false, [HOLDER.card]], `${HOLDER.card}: completed, cards in ${HOLDER.name}`);
        const top = await cue();
        assert(!UI.holderNext.test(top), `the top panel still waits: "${top}"`);
        await shot("02-move-ran-out");
        // Back to the real clock
        await goto(p, ROUTES.scan);
        return `top panel: "${top.slice(0, 60)}"`;
      }, { shot: false });

      await s.step(`the DONE sign while the page reads ${HOLDER.name} again (slow): "Done. Put it back in …" shows; a tap on Take out then only flashes "${BUSY}" (no save; the line stays)`, async () => {
        await waitMove();
        let release = () => {};
        const held = new Promise((r) => { release = r; });
        const holderRead = new RegExp(`/api/admin/track/resolve\\?code=${esc(encodeURIComponent(HOLDER.code))}`);
        await p.route(holderRead, async (route) => { await held; await route.continue().catch(() => {}); });
        try {
          const saved = p.waitForResponse((x) => /\/done$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
          await scan("LOC-DONE");
          const r = await saved;
          eq([r.status(), JSON.parse(r.request().postData() ?? "{}").fromCode], [200, HOLDER.code], "POST done (status, fromCode)");
          const said = await until(async () => { const x = await holderLine(); return UI.doneSentence("A").test(x) ? x : null; }, 15_000);
          assert(said, `no "Done. Put it back in …" ("${await holderLine()}")`);
          const releases = postsTo(/\/release$/).length;
          const takeOut = UI.holderTakeOut(m());
          await takeOut.waitFor({ timeout: 5_000 });
          assert(!(await takeOut.isDisabled()), "Take out is greyed during the page's re-read (nothing to test)");
          await takeOut.click();
          const flashed = await until(async () => (await p.getByText(BUSY).first().isVisible().catch(() => false)) || null, 3_000);
          await shot("03-busy-tap");
          assert(flashed, `no "${BUSY}" flash`);
          await sleep(400);
          const line = await holderLine();
          assert(UI.doneSentence("A").test(line), `the DONE sign's line went: "${line}"`);
          assert(!line.includes(BUSY), `the result line says "${line}"`);
          eq(postsTo(/\/release$/).length - releases, 0, "POST release");
          return said.slice(0, 120);
        } finally {
          release();
          await p.unroute(holderRead).catch(() => {});
        }
      }, { shot: false });

      await s.step(`${DESK} with a limit of 1 holding CD-2549-08: "Move to my desk" asks "Add anyway?"; choosing Desk Gavin in "My desk" drops the question; back to Desk, Add anyway sends toCode ${DESK} with force`, async () => {
        await until(async () => UI.holderEmptyHead(HOLDER.name).test(await scanMain(p)), 15_000);
        await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
        await mockUpdate(mockUrl, "locations", { capacity: 1 }, "code", DESK);
        await assignOk(ctx, DESK, [cardIdOf(t, "CD-2549-08")], true);
        await holderOpen(p, scan, HOLDER, 1);
        const select = m().getByRole("combobox", { name: /my desk/i });
        await select.selectOption(DESK);
        const ask = async () => {
          const first = p.waitForResponse((x) => /\/move$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
          await UI.holderToDesk(m()).click();
          const r1 = await first;
          eq([r1.status(), JSON.parse(r1.request().postData() ?? "{}").toCode], [409, DESK], "POST move (status, toCode)");
          await p.getByText(/already holds .*add anyway\?/i).first().waitFor({ timeout: 10_000 });
        };
        await ask();
        await shot("04-desk-full");
        await select.selectOption(GAVIN);
        await until(async () => (await m().getByRole("button", { name: /^add anyway$/i }).count()) === 0, 5_000);
        eq(await m().getByRole("button", { name: /^add anyway$/i }).count(), 0, '"Add anyway" buttons after choosing Desk Gavin');
        await select.selectOption(DESK);
        await ask();
        const second = p.waitForResponse((x) => /\/move$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
        await m().getByRole("button", { name: /^add anyway$/i }).click();
        const r2 = await second;
        const body = JSON.parse(r2.request().postData() ?? "{}");
        eq([r2.status(), body.toCode, body.force], [200, DESK, true], "Add anyway: POST move (status, toCode, force)");
        eq(cardsIn(await tables(), DESK), ["CD-2549-07", "CD-2549-08"], `cards on ${DESK}`);
        await mockUpdate(mockUrl, "locations", { capacity: null }, "code", DESK);
      }, { shot: false });

      await s.step("no browser errors on the phone", async () => {
        assert(!phone.errors.length, phone.errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    } finally {
      await phone.ctx.close();
    }

    // A computer: the picker opens with its box focused, so the scanner types into it
    const dscan = scannerOn(page);
    const dm = () => page.locator("main").first();
    const dposts = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/admin/track/")) dposts.push(new URL(r.url()).pathname); });
    await s.step(`1440: "Move to another holder" (the picker's box focused); the DONE sign scanned into the box: "${DONE_IN_PICKER}", nothing saved; close the list, scan DONE: done (fromCode ${HOLDER.code})`, async () => {
      await holderPut(ctx, mockUrl, t, HOLDER.card, HOLDER.code);
      await goto(page, ROUTES.scan);
      await holderOpen(page, dscan, HOLDER, 1);
      await UI.holderToHolder(dm()).click();
      const picker = UI.holderPicker(page);
      await picker.waitFor({ timeout: 10_000 });
      await UI.holderOption(picker, HOLDER_TO.name).waitFor({ timeout: 15_000 });
      const focus = await focusedEl(page);
      assert(/^input/.test(focus), `the picker's box isn't focused on a computer (${focus})`);
      const n = dposts.length;
      const before = await tables();
      await dscan("LOC-DONE", { blur: false });
      const said = await until(async () => { const x = flat(await picker.innerText().catch(() => "")); return x.includes(DONE_IN_PICKER) ? x : null; }, 10_000);
      await shot("05-picker-done", page);
      assert(said, `the picker says "${flat(await picker.innerText().catch(() => "")).slice(0, 240)}"`);
      assert(!/holds bags, not cards/i.test(said), "still the bag-place line");
      await sleep(800);
      eq(dposts.slice(n), [], "POSTs after DONE was scanned into the box");
      eq(await openDialogs(page), 1, "the picker is still open");
      const mid = await tables();
      eq(cardsIn(mid, HOLDER.code), [HOLDER.card], `cards in ${HOLDER.name}`);
      eq(movesOf(mid, cardIdOf(t, HOLDER.card)).length, movesOf(before, cardIdOf(t, HOLDER.card)).length, "card_moves rows for it");
      await page.keyboard.press("Escape");
      await until(async () => (await openDialogs(page)) === 0, 5_000);
      const saved = page.waitForResponse((x) => /\/done$/.test(new URL(x.url()).pathname), { timeout: 30_000 });
      await dscan("LOC-DONE");
      const r = await saved;
      eq([r.status(), JSON.parse(r.request().postData() ?? "{}").fromCode], [200, HOLDER.code], "POST done (status, fromCode)");
      const after = await tables();
      eq([cardByCode(after, HOLDER.card).completed, cardByCode(after, HOLDER.card).location_id, cardsIn(after, HOLDER.code)], [true, null, []], `${HOLDER.card}: completed, place, cards in ${HOLDER.name}`);
      return `focus: ${focus}; the picker said: "${DONE_IN_PICKER}"`;
    }, { shot: false });
  },
};
Object.assign(SCENARIOS, SCAN_FIX_SCENARIOS);

// ─── One card per holder (owner, Nov 26 2026: "okay so I want every single sticker station thingy to
// only be able to hold one card other than my desk"): on a phone (390 px), the holder picker shows
// holders that have a card as full (greyed, with its Card ID, not a choice); a holder scanned for a
// card that has one already is refused with the server's sentence in the top panel, still waiting for
// another holder; Places says "Holds 1 card" with no capacity setting. Screenshots: scan-one-card-*.png
const ONE_CARD_SCENARIOS = {
  async "scan-one-card"({ ctx, s, browser, appUrl, mockUrl }) {
    let t = null;
    await s.step(`setup: as scan-holder-card with ${DESK}; CD-2549-08 in CLAMP 01, CD-2600-01 in CLAMP 02, CD-2549-04 in HEAT PRESS 02 (stored no limit: made before the rule)`, async () => {
      t = await holderSetup(ctx, mockUrl, { desk: true });
      await mockUpdate(mockUrl, "locations", { capacity: null }, "code", "LOC-HEAT-PRESS-02");
      for (const [code, slot] of [["CD-2549-08", "LOC-CLAMP-01"], ["CD-2600-01", "LOC-CLAMP-02"], ["CD-2549-04", "LOC-HEAT-PRESS-02"]]) await assignOk(ctx, slot, [cardIdOf(t, code)]);
      t = await tables();
      eq([cardsIn(t, "LOC-CLAMP-01"), cardsIn(t, "LOC-CLAMP-02"), cardsIn(t, "LOC-HEAT-PRESS-02")], [["CD-2549-08"], ["CD-2600-01"], ["CD-2549-04"]], "CLAMP 01, CLAMP 02, HEAT PRESS 02");
    }, { critical: true, shot: false });

    const phone = await phoneContext(browser, appUrl);
    const p = phone.page;
    const scan = scannerOn(p);
    const m = () => p.locator("main").first();
    const shot = (name, full = false) => p.screenshot({ path: path.join(OUT, `scan-one-card-${name}.png`), fullPage: full }).catch(() => {});
    const cue = async () => flat(await p.locator("[data-scanner]").first().innerText().catch(() => ""));
    try {
      await goto(p, ROUTES.scan);
      await s.step(`390: ${HOLDER.name}, "Move to another holder": the picker lists the holders that have a card as full, greyed with their Card ID ("Has CD-2549-08"), never as a choice`, async () => {
        await holderOpen(p, scan, HOLDER, 1);
        await UI.holderToHolder(m()).click();
        const picker = UI.holderPicker(p);
        await picker.waitFor({ timeout: 10_000 });
        const choices = (await holderChoices(p, picker)) ?? [];
        for (const name of ["CLAMP 01", "CLAMP 02", "HEAT PRESS 02"]) assert(!choices.some((c) => nameRe(name, "i").test(c)), `${name} (it has a card) is offered: ${choices.join(" | ").slice(0, 200)}`);
        for (const name of ["CLAMP 03", HOLDER_TO.name]) assert(choices.some((c) => nameRe(name, "i").test(c)), `${name} (empty) isn't offered: ${choices.join(" | ").slice(0, 200)}`);
        // The "Full" folds open: each full holder with its card
        for (const summary of await picker.getByText(/^Full \(\d+\)$/).all()) await summary.click();
        for (const code of ["CD-2549-08", "CD-2600-01", "CD-2549-04"]) await picker.getByText(`Has ${code}`, { exact: true }).waitFor({ timeout: 5_000 });
        const greyed = await picker.getByText("Has CD-2549-08", { exact: true }).evaluate((el) => !el.closest("button"));
        assert(greyed, '"Has CD-2549-08" is inside a button (it should not be a choice)');
        await picker.getByText("Has CD-2549-04", { exact: true }).scrollIntoViewIfNeeded();
        await shot("01-picker-full");
        return choices.filter((c) => /\b(CLAMP|HEAT PRESS)\b/.test(c)).join(", ").slice(0, 200);
      }, { shot: false });
      await s.step('the picker closed (Esc), the scanner reads CLAMP 01 (it has a card): refused, "CLAMP 01 already has a card (CD-2549-08 · …). Take it out first, or pick another holder." in the top panel, which still waits for another holder; nothing moved', async () => {
        await p.keyboard.press("Escape");
        await until(async () => (await openDialogs(p)) === 0, 5_000);
        const before = await tables();
        const answered = p.waitForResponse((r) => r.url().includes(ROUTES.trackMove) && r.request().method() === "POST", { timeout: 60_000 });
        await scan("LOC-CLAMP-01");
        const r = await answered;
        eq(r.status(), 409, "POST move");
        const body = JSON.parse(await r.text());
        eq([body.holderFull, body.holder?.code, (body.occupants ?? []).map((c) => c.code)], [true, "LOC-CLAMP-01", ["CD-2549-08"]], "holderFull, holder, occupants");
        const want = /CLAMP 01 already has a card \(CD-2549-08 · [^)]+\)\. Take it out first, or pick another holder\./;
        const c = await until(async () => { const x = await cue(); return want.test(x) && /scan another holder for CD-2549-07/i.test(x) ? x : null; }, 10_000);
        assert(c, `the top panel doesn't say it ("${await cue()}")`);
        const after = await tables();
        eq([cardsIn(after, "LOC-CLAMP-01"), cardsIn(after, HOLDER.code)], [["CD-2549-08"], [HOLDER.card]], `CLAMP 01, ${HOLDER.name}`);
        eq(after.card_moves.length, before.card_moves.length, "card_moves rows");
        await sleep(2_000); // the red flash goes; the panel keeps the sentence
        await shot("02-refused");
        return c;
      }, { shot: false });
      await s.step(`the scanner reads ${HOLDER_TO.name} (empty) next: ${HOLDER.card} goes in; the panel is ready again`, async () => {
        const answered = p.waitForResponse((r) => r.url().includes(ROUTES.trackMove) && r.request().method() === "POST", { timeout: 60_000 });
        await scan(HOLDER_TO.code);
        eq((await answered).status(), 200, "POST move");
        eq(cardsIn(await tables(), HOLDER_TO.code), [HOLDER.card], `cards in ${HOLDER_TO.name}`);
        const ready = await until(async () => { const x = await cue(); return !/already has a card/.test(x) ? x : null; }, 10_000);
        assert(ready, `the refusal stays ("${await cue()}")`);
      }, { shot: false });
      await s.step('Places at 390: each station says "Holds 1 card" (HEAT PRESS: "1 slot was set to no limit: now 1 card (owner\'s rule).") and has no capacity setting ("Set for all", "No limit"); desks say "No limit"; no sideways scroll', async () => {
        await goto(p, ROUTES.places);
        const text = flat(await m().innerText());
        assert(/Clamp\b[^]*?Holds 1 card/.test(text), `no "Holds 1 card" for Clamp ("${text.slice(0, 300)}")`);
        assert(text.includes("1 slot was set to no limit: now 1 card (owner's rule)."), "no note for HEAT PRESS 02's stored no limit");
        for (const gone of [/Set for all \d+/i, /No limit \(a stack/i, /Each holds a stack/i]) assert(!gone.test(text), `still says /${gone.source}/`);
        assert(/DESK\b[^]*?No limit/.test(text), 'no desk says "No limit"');
        const w = await sidewaysScroll(p);
        assert(w <= 1, `scrolls sideways by ${w}px`);
        await shot("03-places", true);
        await p.getByRole("heading", { name: /^Heat Press$/ }).first().scrollIntoViewIfNeeded().catch(() => {});
        await shot("04-places-heat-press");
      }, { shot: false });
      await s.step("no browser errors on the phone", async () => {
        assert(!phone.errors.length, phone.errors.slice(0, 3).join(" | ").slice(0, 300));
      }, { shot: false });
    } finally {
      await phone.ctx.close();
    }
  },
};
Object.assign(SCENARIOS, ONE_CARD_SCENARIOS);

// Setup helpers for scripts that reuse a running harness (screenshots of a page in a given state)
export { deskReceive, bulkSlots, assignOk, cardIdOf, scanType, typeCode, holderSetup, HOLDER, HOLDER_TO, HOLDER_STACK, HOLDER_EMPTY };

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
