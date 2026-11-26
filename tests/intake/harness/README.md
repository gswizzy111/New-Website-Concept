# Intake test harness

Runs the real app (`next dev`) against a fake, in-memory Supabase with fake
data, so the receiving / tier bag / QR / stage / label / Historical Order Setup
work can be tested end to end in a browser. Nothing here touches a real
database, sends a real email, or uses a working Stripe or Shippo key.

## Run it

From the worktree root:

```sh
node tests/intake/harness/selftest.mjs      # the mock against real supabase-js (no Next.js), ~1 s
node tests/intake/harness/smoke.mjs         # existing admin pages render signed in (desktop + phone)
node tests/intake/e2e/scenarios.mjs         # intake scenarios (all)
node tests/intake/e2e/scenarios.mjs --only receive-partial,qr
node tests/intake/e2e/scenarios.mjs --only labels,labels-40,qr,photos-page,print-step,bags-board   # one label per tier bag
node tests/intake/e2e/scenarios.mjs --only 'track-*'   # card tracking with serial-numbered slots (CLAMP 07)
node tests/intake/e2e/scenarios.mjs --only track-assign,track-move   # a few of them
node tests/intake/e2e/scenarios.mjs --only 'scan-*'    # the Scan page: the handheld scanner only (no camera), photos under each card, the holder view
node tests/intake/e2e/scenarios.mjs --only 'desk-*'    # the Desk: a heat press stack to the desk, the Desk page, scanning the desk
node tests/intake/e2e/scenarios.mjs --only 'bag-open-*'   # what a bag / order QR opens: the person, "Move all N cards to my desk"
node tests/intake/e2e/scenarios.mjs --only 'labels-any-*'   # "Print labels" for any order (prepare-labels, one tap)
node tests/intake/e2e/scenarios.mjs --only 'done-*'   # a finished card: back in its bag, Open bags box A-Z, Ready to ship, order auto-complete
node tests/intake/harness/start.mjs         # just start mock + app and keep them up (Ctrl+C stops both)
```

`start.mjs` prints the app URL, the mock URL and a line to reuse them:

```sh
HARNESS_APP_URL=http://localhost:PORT HARNESS_MOCK_URL=https://localhost:PORT node tests/intake/e2e/scenarios.mjs
```

Reusing a running harness skips the 1 to 3 minute first compile. Only one
`next dev` can run per folder (Next.js 16 locks `.next`), so stop any other dev
server in this worktree first, or reuse it this way. `HARNESS_APP_PORT` and
`HARNESS_MOCK_PORT` pin the ports, so a restarted harness keeps the same URLs.

One harness is one shared fake database: every scenario starts with
`POST /__reset`, so two test scripts run against the same harness at once will
wipe each other's state mid-step. Run them one after the other.

Chromium is preinstalled (`/opt/pw-browsers`) and Playwright is a global
install; `loadPlaywright()` finds it. Never run `playwright install`.

Screenshots (deviceScaleFactor 1) and `results.json` go to
`tests/intake/e2e/out/`; certificates and the dev server log go to
`tests/intake/harness/.run/` (both gitignored).

## Files

| File | What it is |
| --- | --- |
| `mock-supabase.mjs` | The fake Supabase: PostgREST, Storage, Auth, plus Resend's API. Library (`startMock`) or CLI (`--port`, `--https`). |
| `seed.mjs` | Fake data with fixed ids (`IDS`, `ORDER_NUMBERS`, `ADMIN_TOKEN`). |
| `start.mjs` | Starts mock + `next dev`; Playwright helpers. |
| `smoke.mjs` | Existing admin pages render with no server or browser errors. |
| `selftest.mjs` | 16 checks of the mock through `@supabase/supabase-js`. |
| `../e2e/scenarios.mjs` | Intake scenarios, one place for UI wording (`UI`) and routes (`ROUTES`). |

## What the app runs with

`start.mjs` runs `node scripts/legal-texts.mjs`, then `next dev -p <free port>`
with: `RESEND_API_KEY=re_placeholder`, `STRIPE_SECRET_KEY=sk_test_placeholder`,
`SHIPPO_API_TOKEN=shippo_test_placeholder`, `NEXT_PUBLIC_SUPABASE_URL=<mock>`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon`,
`SUPABASE_SERVICE_ROLE_KEY=placeholder-service`,
`NEXT_PUBLIC_APP_URL=http://localhost:<port>` (QR codes point at the local app),
`NEXT_PUBLIC_PREVIEW_MODE=false` (preview mode turns the admin off), and
`RESEND_BASE_URL=<mock>/__resend`.

- **Emails never send.** The Resend SDK honours `RESEND_BASE_URL`, so every
  email the app sends lands in the mock (`GET /__emails`, `dump().emails`) with
  its to/subject/html. Assert on them ("one customer email per bulk move").
- **The mock serves https** with a self-signed `localhost` certificate made
  once with `openssl` (`.run/`). The Next.js process trusts it through
  `NODE_EXTRA_CA_CERTS`/`SSL_CERT_FILE` pointing at a bundle of the machine's CAs
  plus that certificate; the browser context uses `ignoreHTTPSErrors`. https
  matters because `isOurCardPhoto()` only accepts `https://<supabase host>/...`
  photo URLs, so real uploads through `/api/upload` (stored in the mock) are
  accepted by the receiving routes. `HARNESS_HTTP=1` runs it over http instead.
- **Signed in** as `harness-admin` (full admin): `newAdminContext()` sets the
  `admin_session` cookie to `ADMIN_TOKEN`; the seed stores its SHA-256 in
  `admin_sessions`, as the real sign-in does.

## Playwright helpers (`start.mjs`)

```js
import { startHarness, loadPlaywright, newAdminContext, dump, reset, emails, insertRows } from "../harness/start.mjs";
const h = await startHarness();                  // or reuse via HARNESS_APP_URL/HARNESS_MOCK_URL
const { chromium } = loadPlaywright();
const browser = await chromium.launch();         // no options
const ctx = await newAdminContext(browser, { phone: false, appUrl: h.appUrl }); // 1440x900, or iPhone 13 with phone: true
const page = await ctx.newPage();
await page.goto("/admin/receiving");
const { tables, emails: mails, storage, unknown, rpcCalls } = await dump();
await reset();                                   // fresh seed
await insertRows("order_events", [...]);         // raw rows, no defaults/constraints (test setup)
await h.stop();
```

`ctx.request` shares the cookie, so API routes can be called directly
(`ctx.request.post("/api/admin/intake/orders/<id>/receive", { data })`).

## Mock endpoints

| | |
| --- | --- |
| `GET /__dump` | every table, captured emails, stored files, unknown tables/RPCs seen, RPC calls |
| `GET /__dump/<table>` | one table |
| `POST /__reset` | reseed (`{"seed":false}` empties everything) |
| `POST /__rows/<table>` | insert raw rows (no defaults or constraints) |
| `GET /__emails`, `GET /__requests` | captured emails; last 500 requests (method, path, status) |

## PostgREST coverage

Selects with columns, `alias:col`, `::casts`, JSON paths (`metadata->>card_id`)
and embedded relations (many-to-one and one-to-many, `!inner`, `!hint`,
`alias:rel(...)`), filters `eq neq gt gte lt lte like ilike match imatch in is
isdistinct cs cd ov fts` and `not.<op>` (`eq` on an array column takes a
PostgreSQL array literal, `{"a","b"}`, for optimistic updates), `or=(...)`/`and=(...)` (nested, also
`<rel>.or`), filters on embedded columns (`orders.status=in.(...)`), `order`
(asc/desc, nullsfirst/nullslast, `<rel>.order`), `limit`/`offset`
(`<rel>.limit`) and `Range`, `Prefer: count=exact` (content-range), `HEAD`,
`Accept: application/vnd.pgrst.object+json` (406 `PGRST116` unless exactly one
row) and `nulls=stripped`. Writes: POST (one row or many, `columns=`,
`return=representation|minimal`, `on_conflict` with
`resolution=ignore-duplicates|merge-duplicates`, `missing=default`; in a bulk
insert a column named by one row is NULL in the others, as in PostgREST), PATCH
and DELETE with filters.

Constraints (from the live schema and `20261123_intake_tracking.sql`):

- unique: `orders.order_number`, `cards.card_code`, `cards(order_id, card_seq)`,
  `tier_bags.bag_code`, `tier_bags(order_id, tier, batch)`,
  `admin_users.username`, `show_dropoffs.dropoff_number`, primary keys →
  409 `23505`, message naming the constraint. NULLs never clash (partial indexes).
- not null, check (order/card/bag statuses, `batch >= 1`, `due_status`,
  `source`, non-blank due-change reason, card_seq ≥ 1) → 400 `23502`/`23514`.
- foreign keys (insert/update) → 409 `23503`; on delete: orders cascade to
  cards, order_events, tier_bags; tier_bags cascade to tier_bag_due_changes;
  `cards.bag_id` is NO ACTION: deleting a bag that still holds cards is refused
  (409 `23503`, checked at the end of the delete, so deleting an order still
  takes its cards and bags together).
- triggers: order numbers `CD-<n>`, `orders.updated_at`, `cards.completed_at`
  stamp, cards ticked done when an order becomes shipped_back/delivered,
  `tier_bag_due_changes` immutable, `show_dropoffs` undeletable.
- card tracking (`20261124_card_tracking.sql`): `locations` (unique `code`,
  `LOC-[A-Z0-9-]` code check, name check, kind check, `station`/`serial`/
  `capacity` checks, stage one of the 8 steps, the slot shape check: kind
  'station' ⇔ a stage, and a slot has `station` + `serial`; unique
  `(station, serial)`); `card_moves` insert-only (an update answers 400
  `P0001`; deleting a card deletes its moves), action one of
  assign/move/release/done/receive/ship_check, `from_location_id` /
  `to_location_id` → locations NO ACTION (a place with history can't be
  deleted); `cards.location_id` and `tier_bags.location_id` → locations ON
  DELETE SET NULL. Two FKs from `card_moves` to `locations`: an embed of
  `locations` from `card_moves` needs a hint (`locations!to_location_id`), or
  the mock answers 300 `PGRST201` as PostgREST does.
- defaults: ids, `created_at`, card `status 'active'`, `completed false`,
  `current_round 1`, `photo_urls []`, `receiving_photo_urls []`,
  `awaiting_arrival false`, bag `batch 1`, `due_status 'pending'`,
  `source 'receiving'`, and the order defaults.

RPCs: `backlog_now` is computed from the mock's data with the migration's rule
(unfinished, non-refunded cards of received/in-progress paid orders, minus
`awaiting_arrival`), so backlog effects can be asserted. `backlog_report`,
`service_report`, `revenue_series`, `checkout_*`, `tier_slot_orders`,
`account_signup_state`, `search_card_catalog` return empty defaults. Unknown
RPCs return `null` and are listed in `dump().unknown.rpcs`; add a handler in
`defaultRpcs()` if the app needs one.

Storage (`card-photos` bucket): upload (raw or multipart, `x-upsert`), public
and authenticated download, signed URLs, signed upload URLs
(`createSignedUploadUrl` / `uploadToSignedUrl`), list, copy/move, remove. Auth:
nobody is ever signed in as a customer (`/auth/v1/user` → 401); admin user
calls and `generate_link` return fakes.

## Seed (fake data)

| Order | State | Cards |
| --- | --- | --- |
| CD-2549 (`IDS.mailOrder`) | awaiting_cards, mail-in, mixed tiers (order tier null), customer note | 4 Gold, 2 Silver, 3 Platinum, 1 with no tier; card 1 has 2 customer photos, card 7 one; card 4 has an instruction |
| CD-2550 (`IDS.dropoffOrder`) | received, drop-off (tier Gold), linked show drop-off form #1001 | 2 |
| CD-2400 (`IDS.deliveredOrder`) | delivered, Platinum, 'Status updated to: Cards Received' on 2026-10-01, all 8 stages done | 2 completed |
| CD-2450 (`IDS.inProgressOrder`) | in_progress, Gold, received 2026-11-02 | at Heat Press, at Humidor, not started |
| CD-2460 (`IDS.noDateOrder`) | received, Silver, self-ship, no received event | 2 (missing receiving date) |
| CD-2600 (`IDS.bigOrder`) | awaiting_cards, mail-in, mixed tiers (order tier null), customer `BIG_CUSTOMER_NAME`, `admin_notes` set (keeps it out of selftest's `admin_notes is null` list) | 40: 32 Gold + 8 Platinum (`BIG_CARD_TIERS`: every 5th Platinum), names `BIG_CARD_NAMES` (4 long ones), for the one-page-per-bag label tests |

Card tracking: `locations` holds only what the migration seeds, `LOC-DONE`
("Done", kind done) and `LOC-SHIP` ("Shipping", kind shipping) (`DEFAULT_PLACES`,
`IDS.places`); no slots (staff make them: the scenarios use the bulk API, `POST
/api/admin/track/locations { station, count }` → CLAMP 01..N) and no shelf slots
(made when a bag first needs one). Every card has `location_id`/`located_at`
null; `card_moves` is empty.

Also: all 6 tiers in `restoration_settings` (live values: Bronze 45-60, Silver
30-45, Gold 15-20, Platinum 10-15, Diamond 5-10, Fast Pass 1-7), the live
`store_config` keys (no prep turnaround key, so prep bags should read
`needs_review`), the migration's holidays 2026-2028 (incl. 2026-11-26 and
2026-12-25), a 'new' show drop-off form #1002, and the harness admin + session.
No `tier_bags`: the seed is the database as it is before receiving or
Historical Order Setup runs.

## Scenarios (`tests/intake/e2e/scenarios.mjs`)

Each starts from a fresh seed and prints PASS / FAIL / SKIP per step; a failed
critical step skips the rest of its scenario. Where a UI step fails, some
scenarios redo it through the API (marked "(fallback)") so the data checks
still say whether the backend is right.

- `search`: by order number, customer name, email; opens the workspace.
- `receive-partial`: 5 of 10 cards on 2026-11-15 → CD-2549-G/-S/-P, Platinum
  due 2026-12-07, Gold/Silver due by max turnaround in business days (checked
  against an independent business-day count), Card IDs CD-2549-01..10, the
  other cards `awaiting_arrival`, order received once with one 'Cards Received'
  event, a `cards_received` event "Received 5 of 10 cards…", backlog rule, at
  most one customer email, phone width without sideways scroll.
- `receive-rest`: the rest on 2026-11-18 → G2/S2/P2 (batch 2, own due dates,
  batch 1 unchanged); the no-tier card is refused (by the page and by the API)
  with a message naming it, then gets Bronze → CD-2549-B.
- `dropoff-add-card`: add a card with a photo (real `/api/upload` into mock
  storage; `INTERCEPT_UPLOAD=1` answers it in the browser) and receive it: same
  order, CD-2550-03, Gold bag, photo saved.
- `card-photo`: a receiving photo per card; customer photos untouched.
- `qr`: `/q/<card code>` and lower case → card page; `/Q/<bag code>` and lower
  case (the label's QR) → the scan landing (`/admin/receiving/open/CD-2549-P`);
  `/q/<order code>`, `/Q/…`, lower case → the scan landing (`/admin/receiving/open/CD-2549`);
  unknown → 404; signed out → `/admin/login?next=/q/<CODE>` (card, bag, order,
  unknown: no lookup) and `next=<page>` for admin pages (the scan landing, the
  photos page); the browser lands on the card page and on the bag's scan landing.
- `card-page`: Card ID, customer, order, tier, received and due dates, stage,
  customer photo; phone width.
- `bag-bulk-advance`: one card already at Humidor; the Not started group's
  "Move these 3 cards" step picker, Ready for Slab Crack, moves only the 3
  not-started cards, leaves it alone, sends one customer email; a stale API
  request (old `{ fromStage }` shape) skips it too; one card moved alone from
  its row's "Change step".
- `complete-bag`: card page picker Final Dry → Done → bag `completed_at`, order
  not completed, Completed section lists the bag with "New", workspace shows
  "Partially completed".
- `steps-any-order`: steps in any order (the owner, Nov 25): CD-2549-01 on its
  card page's picker Clamp Work → Humidor → Final Dry, CD-2549-07 by slot
  scans (assign CLAMP 01, move to HUMIDOR 01, move to FINAL DRY 01); each jump
  is one stage event; only Clamp Work and Final Dry email (going back is a
  staff-only event, no email); the picker shows the current step pressed and
  the steps reached this round checked; 390 px.
- `labels` (one label per tier bag, design "B · Name banner", no reusable tag): before anything
  is received the order's `?format=json` lists no bags; then CD-2549 with bags
  of 4 and 1 cards, CD-2600 with one bag of 16, then (same day, same bag) a
  Gold bag of 32 and a Platinum bag of 8. For each state: `?format=json` has one
  entry per bag with exactly ONE label page and no `tag` field, `cardCount`
  right; each label has exactly one `kind: "qr"` element holding the bag's
  `/Q/<BAG CODE>` link (at least 1 in); the customer name is the
  largest text; `cardCodes` are the bag's cards in card order (all of them up
  to 16; past that all, or what fits plus a "+N more … scan" line with the right
  N); the label shows its Bag ID and order number, and "Also in this order"
  only when the order has other bags; the order PDF has one page per bag at the
  label size, `?bags=<one>` 1 page; each bag route: PDF 1 page, JSON = that
  bag with the same label and no `tag`. PDFs parsed with pdf-lib.
- `labels-40`: all 40 CD-2600 cards made Gold (in the mock), received at once:
  one bag of 40 → the same checks (still one page).
- `photos-page`: every CD-2549 card received (the no-tier card made Bronze in
  the mock) with a receiving photo each. `/admin/receiving/<orderId>/photos`:
  every Card ID and name, each card under its own Bag ID, tiers, due date,
  stage, all 13 images (10 receiving + 3 customer) and two that load, no
  sideways scroll at 1440 and 390 px (screenshots). `?bag=<CD-2549-P>`: only
  that bag's cards and Card IDs, customer, Bag ID, tier, due date, a link to
  the bag page and "Whole order (10 cards in 4 bags)"; phone width.
- `print-step`: three bags; the "Print labels" step's button is enabled and
  says "Ready to print: 3 labels" with no receiving photos, with 3 of 4 and
  with all of them (labels print without waiting for photos); the bag label panel shows
  one label preview per bag (named by Bag ID) and "Print all 3 labels"; the
  bag page shows ONE label preview; the card page has a print-label button; no
  "Print tag" button and no tag preview on the order, bag or card page (the
  owner dropped the reusable tag); phone width.
- `bags-board`: `/admin/receiving/bags` after receiving CD-2549 (Gold, Platinum)
  and CD-2600 (Gold): CD-2549-P and CD-2549-G are separate rows, all rows in
  due-date order, the P row shows the customer and Dec 7; phone width.

Scenario setup that has no UI path (receiving photos, a tier change before
receiving) writes to the mock directly with supabase-js (`mockDb()`,
`setReceivingPhotos()` in `scenarios.mjs`), through a fetch that trusts the
harness's localhost certificate the way `start.mjs`'s mock helpers do.
- `setup`: Historical Order Setup preview → run → unique Card IDs, received
  dates from 'Cards Received' events / drop-off `created_at` (New York day),
  missing date flagged, delivered order stays delivered with its bag completed,
  stage history untouched, awaiting order left alone; preview + run again
  through the API → no new cards, bags or codes.

### Card tracking (`track-*`, the owner's slot model of Nov 24)

Cards carry no sticker and are never scanned: every holder is a slot with a QR
label (CLAMP 07 = `LOC-CLAMP-07`), staff put cards in slots, move a slot's
cards to the next slot, mark them done or take them out. Response shapes are
`lib/intake/tracking/types.ts`. Most scenarios receive CD-2549 Gold 01-04 +
Platinum 07-08 (2026-11-15) and CD-2600-01 (2026-11-20) and make slots through
the bulk API first (`trackSetup()`); capacities a step needs are set in the
mock (`mockUpdate()`), not left to the station type's default.

- `track-slots`: seeded LOC-DONE/LOC-SHIP only and the 8 station types; bulk
  CLAMP 01..05 and HEAT PRESS 01..03 (codes, names, serials, steps), 2 more
  continue at 06-07, `startAt` over existing numbers skips them, unknown type
  and count 0 refused; `?station=clamp` occupancy; PATCH capacity (3, null, 0
  refused), rename + switch off (`?all=1`); an "other" place (LOC-BENCH-2), no
  station by name; the Places page at 1440 and 390 px.
- `track-assign`: CD-2549-07 + -08 + CD-2600-01 into CLAMP 01: step Clamp Work,
  `assign` rows, exactly one customer email per order; the same request again
  changes nothing; CLAMP 02 (capacity 1): 409 `overCapacity` naming its card,
  then `force` adds anyway; a card put in another slot frees its old one (no
  new step, no email); a scanned link as the slot; refunded card refused;
  unknown slot / no cards refused.
- `track-move`: CLAMP 01 → HEAT PRESS 02 (capacity 1): 409, then `force`: CLAMP
  01 empty and `freed`, step back to Heat Press (any order: staff-only events),
  no email, `move` rows; two of three cards on to FINAL DRY 01:
  step Final Dry, one email; from an empty slot / a card not in the slot
  refused; Done: cards done at LOC-DONE, slot freed, bag CD-2549-P complete,
  no email, `done` rows (stage_after 'done'); Take out: no place, slot freed,
  step kept, a `release` row; again: nothing changes.
- `track-find`: resolve a slot (name, number, step, occupancy, its cards), an
  empty slot, scanned links, LOC-DONE, a bag and an order (cards with their
  slots), a typed Card ID; 404 / 400; search by Card ID, card name, customer,
  order number (1 character refused); history of a slot, a card (newest
  first), a bag.
- `track-ship`: ship check of bag CD-2549-G: not done → ok after Done;
  ticked done but still in CLAMP 02 → `in_slot`; the ship page shows ✓ "Done ·
  not in a slot", "Still in CLAMP 02", "Not marked done" + Mark done (Yes,
  mark done → POST done); take out → ready; refunded; order code and Card ID
  scopes; 390 px.
- `track-forgotten`: CD-2549-01 placed in CLAMP 01 nine days ago (past the 7-day slot rule; rows written
  as then) and CD-2600 Completed with a card not done are listed; CD-2549-02,
  put in a slot minutes ago, and CD-2400 are not; 390 px.
- `track-labels`: slot labels batch `?station=clamp&from=1&to=5` = 5 pages of
  50 x 80 mm, each a huge "CLAMP 0n" (biggest type), "Clamp Work", one QR of
  `/Q/LOC-CLAMP-0n`, the code; `?ids=` two heat press slots; the bag-label stock
  setting doesn't change them; `&stock=4x6`; the Dec 7 shelf sign; the bag
  label on 50 x 80 mm (stock `50x80mm`).
- `track-q`: `/q/LOC-CLAMP-01`, `/Q/…`, lower case → `/admin/scan?loc=LOC-CLAMP-01`;
  LOC-DONE, LOC-SHIP; bag/order codes → the scan landing, a Card ID → its card
  page; signed out → sign in
  with `next=/q/LOC-CLAMP-01`; the browser lands on the Scan page.
- `track-shelf`: Receive on the workspace says "Put in shelf: DUE MON DEC 7";
  Print shelf sign; one LOC-SHELF-20261207 slot shared by bags due that day
  (same order later, another order); the receive answer names the shelves;
  Shelf view in due-date order with each bag under its slot; `/q/LOC-SHELF-…`;
  390 px.
- `track-scan-page` (iPhone 13, 390 px): "Ready to scan" and "Type a code
  instead" (the code box closed); the handheld scanner (keystrokes + Enter
  with nothing focused) reads CLAMP 01's link: "Put a card in CLAMP 01"
  without navigating; the bag's QR lists its cards, "Put in CLAMP 01" on
  CD-2549-07 assigns it; a full slot shows its card with Move to another holder,
  Done, Take out (the holder view, `scan-holder-card`);
  `/admin/scan?loc=LOC-CLAMP-03`; no browser errors; the desktop menu's
  "Scan" link.

### The Scan page (`scan-*`, the owner's request of Nov 26)

"Remove the camera, make it so you can only use the scanner, and also add the
images under each card", and make it clearer when a scanned holder has a card
in it. The Eyoyo handheld scanner is paired with the shop's iPhone as a
Bluetooth keyboard: it types the label's text and presses Enter, with nothing
focused (the page's keyboard wedge). `scanType()` types the label's link
`HTTPS://THECARDDOC1.COM/Q/<code>` with keys 10 ms apart, then Enter;
`scannerOn(page)` waits out the page's 2 s double-read gate for a repeated
code. Wording: `UI.readyToScan*`, `UI.gotIt`, `UI.typeCodeLink`,
`UI.scanCardPhotos`, and the holder view's `UI.holder*` (from the HOLDER
agent's holder-text.md).

- `scan-scanner-only` (390 and 1440 px): no camera anywhere (no video or
  canvas, no camera word or button, no `capture` file input; an init script
  records every `getUserMedia`, `webkitGetUserMedia` and camera permission
  query: none); the "Ready to scan" panel and its line, the code box closed,
  nothing focused. Right after a fresh load a keyboard-wedge scan of bag
  CD-2549-G's link (nothing focused) flashes "Got it: CD-2549-G" (within
  1.5 s) and lists its 4 cards without navigating; after that result a scan of
  CD-2549-P replaces them; a photo opened full screen and closed with Close
  (focus back on the photo) or Esc, then a scan: it opens and its Enter
  reopens nothing; with "Assign to a slot" focused a scan presses nothing; a
  scan while a photo is open closes it; "Type a code instead" reveals the
  focused code box (CD-2549-02 + Enter shows it; a scanner typing into the
  box works; Esc closes it); no browser errors.
- `scan-card-photos` (1440 and 390 px): CD-2549-01 has a receiving photo and
  2 customer photos, -02 a customer photo only, -03 only a catalog picture,
  -04 nothing (set in the mock). The resolve API lists them receiving first,
  then customer, the catalog's only without either, each with a `tile` and a
  `full` image. Scanning the bag: each card's list "Photos of <Card ID>
  <name>" sits under its Card ID and name, the tiles in that order (by alt),
  each `<img>` the API's tile (`src` and `srcset`, never the full-size
  image), lazy and loaded; -03 "Reference photo" / "Not the customer's
  card"; -04 "No photo yet" and no image. A tap opens the full-size image
  full screen (90%+), Close closes it. The order's label and a typed Card ID
  show the same photos. **Thumbnails:** off Netlify `lib/thumbnail.ts` serves
  the original, so the tile equals the original in a plain harness (the
  scenario says so in its note). Start the harness with `IMAGE_CDN=netlify`
  to check the resize path: every tile must then be
  `/.netlify/images?url=<original>&w=<=480` (the browser context answers
  those with the original, since `next dev` doesn't serve them) and the
  viewer's image 1280+ px wide.
- `scan-holder-card` (390 px, one step at 1440): CD-2549-07 in CLAMP 07 (put
  in 2 h 5 min ago), CD-2549-01..03 in HEAT PRESS 02, CLAMP 06 and HEAT PRESS
  01 empty (`holderSetup()`). With no desk yet "Move to my desk" is greyed with
  "No desk yet. Open the Desk page once to make one."; then (LOC-DESK made)
  scanning CLAMP 07 shows "CLAMP 07 · has 1 card", the card's name, Card ID,
  customer, order, tier, due date, "Step: Clamp Work", "In CLAMP 07 for 2
  hours", its photo, and Move to my desk, Move to another holder, Done, Take
  out. Each works, the card put back in CLAMP 07 through the API in between:
  Move to my desk (on LOC-DESK, CLAMP 07 empty, step kept, one move row, no
  email, "CD-2549-07 is on your desk."); Move to another holder (the holder
  picker and "Scan the next slot"; the scanner reads HEAT PRESS 01: there,
  step Heat Press, no email, the picker closes; at 1440 the picker's box has
  the focus and takes the scan); Take out (no place, step kept, a release
  row, "taken out of CLAMP 07"); Done, answering "Mark done" (done, no place,
  a done row, no email, "Done. Put it back in A's bag…"). CLAMP 07 then and
  CLAMP 06 read "<name> · empty" and "Empty. Scan a bag or card to put one
  here." with no buttons; HEAT PRESS 02 reads "· 3 cards" with each card and
  its photos, and "Move all 3 to my desk" moves all 3 (steps kept, no email,
  "All 3 cards are on your desk.").
- `scan-layout` (390 and 1440 px, LOC-DESK made): no sideways scroll; the
  "Ready to scan" panel and "Type a code instead" on the first screen; bag
  CD-2549-G's photo rows inside the screen and each card's button 44+ px, not
  covered when scrolled to; CLAMP 07's header and its four buttons on the
  first screen (unscrolled, not covered, 44+ px); "Move to another holder":
  the picker on the first screen with HEAT PRESS 01 to tap, Esc and Cancel
  leave nothing waiting; HEAT PRESS 02's "Move all 3 to my desk" and CLAMP
  06's "Empty…" on the first screen. Screenshots `scan-layout-{390,1440}-*.png`.

2x screenshots of the same states (ready, bag, move picker, holder, stack,
empty) come from a script outside the repo that imports `holderSetup` and
`scanType` from `scenarios.mjs` against a running harness.

### Desk (`desk-*`, the owner's request of Nov 24)

A desk is a place (kind `other`) with a QR sign: `LOC-DESK`, or `LOC-DESK-<NAME>`
("DESK GAVIN" = `LOC-DESK-GAVIN`). A heat press stack of 8 comes out, staff scan
the holder, Move, scan the desk: all 8 go, location only (the step stays). The
Desk page (`/admin/receiving/desk`, menu "Desk", `?desk=<code>`) shows a panel
per card on the desk. Stack holders (humidor, humidity press, drying, heat
press, book weights, final dry) now default to no capacity limit; clamp and
slab crack stay at 1.

The setup (`deskReceive()` / `deskStack()`): CD-2549 Gold 01-04 + Platinum
07-08 (2026-11-15) and CD-2600-01..03 (2026-11-20) received; CD-2600 gets a
customer note, CD-2549-07 a known defect, CD-2600-02 a card note and a known
defect (CD-2549's order note and CD-2549-04's card note are in the seed); one
receiving photo per desk card (CD-2549-01 and -07 also have customer photos).
The desk stack is the 8 (`DESK_CARDS`: CD-2549-01..04, -07, -08, CD-2600-01,
-02); CD-2600-03 (`DESK_DECOY`) is received too but kept off the desk.
`LOC-DESK` comes from the Desk page (`ensureDesk`, by loading it once), else
from `POST /api/admin/track/locations { name: "Desk", kind: "other" }`; no seed
change.

- `desk-stack`: HEAT PRESS 01 made in bulk has capacity null (and the type's
  `defaultCapacity` is null); the 8 go in with ONE assign (200, no 409; step
  Heat Press; one email per order); the empty Desk page says so and how to fill
  it; `LOC-DESK` is kind other; `POST move { fromCode: LOC-HEAT-PRESS-01,
  toCode: LOC-DESK, cardIds }` moves all 8 (HEAT PRESS 01 freed, `emailedOrders`
  empty); the 8 are at the desk with `located_at`, still at Heat Press, no new
  step events; one `move` row each (Heat Press -> Heat Press, order and bag);
  no customer email; `resolve?code=LOC-DESK` lists the 8.
- `desk-page`: the Desk page lists exactly the 8 (one panel each; CD-2600-03,
  in CLAMP 01, is not there, nor any other Card ID); each panel has the Card ID,
  card name, customer, order number, the order's customer note, the card's own
  notes and defects (and no other card's); at least one `<img>` each;
  CD-2549-01 shows its receiving and customer photos and one loads; "Open
  order" -> `/admin/orders/<id>`; tier, step Heat Press and "HEAT PRESS 01"
  (where it came from); a photo tap opens the full-screen viewer (a dialog over
  90%+ of the screen) and Close closes it; 1440 px panels side by side, no
  sideways scroll (`desk-page-1440.png`); 390 px the 8 panels, no sideways
  scroll, the viewer (`desk-page-390.png`, `desk-page-viewer-*.png`); the menu's
  "Desk" link; a second desk "DESK GAVIN" (`LOC-DESK-GAVIN`, as Places names
  it) holding CD-2600-03: `?desk=LOC-DESK-GAVIN` lists only it,
  `?desk=LOC-DESK` the 8 and a picker naming DESK GAVIN.
- `desk-actions` (CLAMP 01..02 hold 1, CD-2600-03 fills CLAMP 02, HUMIDOR 01 no
  limit, set in the mock): on the Desk page, CD-2549-01 "Put in holder", type
  `clamp 1` + Enter -> CLAMP 01, step Clamp Work (if Enter saves nothing, the
  holder is tapped in the list and the step fails saying so); the picker showed
  CLAMP 01 and HUMIDOR 01, not the full CLAMP 02 (folded away counts as not
  offered); CD-2549-02 Done (its "Mark done" question, or a second tap, is
  answered) -> done at LOC-DONE, no email; CD-2549-03 Take out -> no place, step
  kept, a `release` row; without a reload 5 panels are left and a
  message (status, alert or toast) followed each action; tick CD-2600-01 and
  -02, "Put selected in…", type `humidor 1` -> both in HUMIDOR 01 (no 409), step
  back to Humidor (any order), no email; 3 panels and a message naming
  HUMIDOR 01; reloaded, still those 3; 390 px. A failed UI action is redone
  through the API ("(fallback)") so the later steps still run.
- `desk-scan` (iPhone 13, 390 px): `/q/LOC-DESK`, `/Q/LOC-DESK`, `/q/loc-desk`
  -> `/admin/scan?loc=LOC-DESK`; the scanner reads HEAT PRESS 01's link: its 8
  cards with Move; Move, then the desk's link: `POST move` (from HEAT PRESS 01,
  to LOC-DESK, 8 cards), all 8 at the desk at Heat Press, an "Open (the) desk
  page" link; on a fresh Scan page, typing `desk` + Enter ("Type a code
  instead"), the desk's link, and
  `/admin/scan?loc=LOC-DESK` each show the desk's 8 cards and "Open desk page"
  (-> `/admin/receiving/desk`, `?desk=LOC-DESK` if given); that link opens the
  Desk page with the 8; no browser errors.
- `desk-capacity`: the station list's defaults (clamp, slab-crack 1; the other
  six null); new CLAMP/SLAB CRACK slots store 1, HEAT PRESS/HUMIDOR null; a
  second card into CLAMP 01 or SLAB CRACK 01 -> 409 `overCapacity` (nothing
  written); HEAT PRESS 01 takes 3 then 2 more, HUMIDOR 01 takes 3 and then HEAT
  PRESS 01's 5 by `move` (all 200); HEAT PRESS 02 set to capacity 1 in the mock
  (a slot made under the old default keeps it): 2 cards -> 409.

### Scan landing (`bag-open-*`, the owner's request of Nov 25)

A bag label's QR (`/q/CD-2549-P`) and an order code (`/q/CD-2549`) now open
one simple page, `/admin/receiving/open/<Bag ID or order number>` (any case):
the customer's name big, the order, the bag's tier and due date, the card
count, the customer's notes, "Open full order" and "All photos"; ONE big
"Move all N cards to my desk"; then a panel per card (photos, name, year · set
· #, Card ID, where it is now, step, declared value, notes, "Move to my
desk"). An order code groups its cards under "Platinum · CD-2549-P" headings.
Moving goes through `POST /api/admin/track/assign` to the desk: place only,
never the step, no email. Wording: the builder's UI text (`UI.open*`).

The setup (`bagOpenSetup()`): CD-2549 Gold 01-04 (bag CD-2549-G, due Mon Dec
14) and Platinum 07-09 (bag CD-2549-P, due Mon Dec 7) received on 2026-11-15,
so 05, 06 and 10 are not here yet (awaiting_arrival, no bag); CD-2549-07 gets a
known defect, a $2,500.00 declared value and step Humidor (stage events), and
every received card a receiving photo. No seed change: everything else is made
through the API (slots, desks, Done) or written to the mock (a refund).

- `bag-open-qr`: `/q/CD-2549-P`, `/Q/…`, lower case -> the page; signed out ->
  sign in with `next=/q/CD-2549-P` (and the page itself with `next=<page>`);
  the browser lands there; the h1 is Test Customer A in the largest type,
  CD-2549, Platinum, CD-2549-P, "Due Mon Dec 7", "3 cards"; the "Customer's
  notes" box; "Open full order" -> `/admin/orders/<id>`, "All photos" -> the
  photos page `?bag=<bagId>`; ONE "Move all 3 cards to my desk" (44+ px), no
  desk picker with one desk; exactly 07-09 (one panel each, no other Card ID);
  each panel: photo, name, 1999 / Base Set / #, Card ID, "In the bag", one
  "Move to my desk"; 07: $2,500.00, its defect, Humidor, receiving + customer
  photos, and no Gold card's note on the page; a photo opens full screen; no
  stage track, date input or print-label button; the lower-case URL works.
- `bag-open-order`: `/q/CD-2549`, `/Q/…`, lower case -> the page; signed out ->
  `next=/q/CD-2549`; a card count; the "Bags" list (Platinum CD-2549-P Due Mon
  Dec 7 3 cards, Gold CD-2549-G Due Mon Dec 14 4 cards); notes; "All photos"
  without `?bag=`; "Move all 7 cards to my desk"; all 10 panels, each under its
  group heading (07-09 "Platinum · CD-2549-P", 01-04 "Gold · CD-2549-G", 05, 06,
  10 "Not here yet" or "Not in a bag"); those 3 say "Not here yet" with no
  button.
- `bag-open-move-all`: no `LOC-DESK` before; tap the big button: the 3 at
  `LOC-DESK` (made on first use, kind other); one card_moves row each (bag ->
  desk, step before = after), 07 still Humidor, no step events, nothing else
  moved, no email; "3 cards are on your desk" + "Open my desk" ->
  `/admin/receiving/desk?desk=LOC-DESK`; pressing again: no button left, and the
  same request sent again changes nothing; reloaded: "All on your desk", no
  move buttons, each "On your desk"; "Open my desk" opens the Desk page with
  the 3.
- `bag-open-move-one`: CD-2549-08's own button: only it moves (same checks);
  its panel "On your desk" without a button, 07 and 09 still "In the bag"; the
  big button "Move all 2 cards to my desk" + "1 already on your desk", also
  after a reload.
- `bag-open-from-holder`: CLAMP 01..07 made, 07 in CLAMP 07 (Clamp Work): its
  panel "In CLAMP 07", the big button counts it (3); its button: at the desk,
  CLAMP 07 empty, step still Clamp Work, the row from CLAMP 07; "On your desk".
- `bag-open-states`: CD-2549-02 Done (POST done), -03 refunded: bag CD-2549-G
  shows them greyed ("Done", "Refunded", no button), "3 cards", "Move all 2
  cards"; the order page: 05, 06, 10 "Not here yet" without a button, "Move all
  5 cards"; tapping it moves exactly 01, 04, 07, 08, 09 (02 stays done at
  LOC-DONE); "5 cards are on your desk"; reloaded "All on your desk".
- `bag-open-desks`: LOC-DESK and DESK GAVIN (`LOC-DESK-GAVIN`): a "Desk"
  picker (DESK first); picking DESK GAVIN and tapping moves the 3 there (none to
  LOC-DESK), "Open my desk" -> `?desk=LOC-DESK-GAVIN`; reloaded the picker
  still says DESK GAVIN (localStorage) and "All on your desk"; picking DESK the
  cards read "On DESK GAVIN" and the button counts 3; the Desk page for DESK
  GAVIN lists them.
- `bag-open-unknown`: `/admin/receiving/open/` CD-0000-99, CD-2549-Z,
  CD-2549-S (no such bag), HELLO, a Card ID and a place code -> "Code not
  found" (the HTTP status is reported, not asserted: `app/admin/loading.tsx`
  streams, so `notFound()` may answer 200), no customer, no button;
  `/q/CD-0000-99` -> 404.
- `bag-open-layout`: the bag and the order page at 1440 px and on an iPhone 13
  (390 x 664): no sideways scroll; the big button fully on the first screen
  (unscrolled, not covered, 44+ px); at 390 a photo opens full screen; no
  browser errors. Screenshots `bag-open-1440-{bag,order}.png`,
  `bag-open-390-{bag,order}.png` (+ `-first-screen`), `bag-open-viewer-*.png`.

The `qr` and `track-q` scenarios expect a bag or order code to open the scan
landing (`ROUTES.open`, upper case) since this change; a Card ID still opens
its card page and a place code the Scan page. The photos page stays one tap
away ("All photos").

### Print labels for any order (`labels-any-*`, the owner's request of Nov 24)

One "Print labels" (`components/intake/print-order-labels.tsx`: the order
page, Receiving search rows, the workspace) for ANY order, through
`GET/POST /api/admin/intake/orders/<id>/prepare-labels` (types in
`lib/intake/prepare-labels.ts`): cards in the shop get their missing tiers
filled (card, order, signed checkout record, price paid, else one question
with the best guess preselected) and go into tier bags with no status change
and no customer email; an Awaiting Cards order asks "Cards arrived? Receive
all and print" (the normal receive); an unpaid order gets no working button.
The labels then print through the existing label routes.

The orders are **extra seed rows, not in `buildSeed()`** (selftest counts the
default seed's in-shop cards and 'Cards Received' events):
`buildLabelsAnySeed()` in `seed.mjs` (`LABELS_ANY_IDS`,
`LABELS_ANY_ORDER_NUMBERS`, `LABELS_ANY_CUSTOMERS`, per-order tiers and days).
Each scenario inserts them after its reset with `seedLabelsAny()`
(`scenarios.mjs`, exported; `POST /__rows/<table>`, once per reset). To look at
them in a harness started by hand:
`HARNESS_MOCK_URL=https://localhost:PORT node --input-type=module -e "await (await import('./tests/intake/e2e/scenarios.mjs')).seedLabelsAny()"`
(a reset drops them again). All five were created before Receiving went live.

| Order | State | Cards |
| --- | --- | --- |
| CD-2470 (`inShopOrder`), Test Customer H | in_progress, order tier Gold, 'Cards Received' 2026-11-05, stage history on 2 cards, no Card IDs, no bags | 5: Platinum, Gold, none, Platinum, none (`IN_SHOP_CARD_TIERS`) |
| CD-2480 (`signedOrder`), I | received (2026-11-09), no tier on cards or order; a `master_terms` signature whose text (as `authorizedOrderText` writes it) and `card_snapshot` name Silver, Silver + slab removal, Platinum; card 2's `slab_removal` signature (no tier) | 3 (`SIGNED_CARD_TIERS`) |
| CD-2490 (`unknownTierOrder`), J | in_progress (received 2026-11-10), no tier anywhere, no signature | 3: paid $99.99, $99.99 (Silver's price), $130.00 (no tier's) |
| CD-2610 (`awaitingOrder`), K | awaiting_cards, created Nov 18, order tier Silver | 3: Silver, none, none |
| CD-2620 (`unpaidOrder`), L | awaiting_payment, payment pending, Gold | 2 Gold |

- `labels-any-in-shop` (API): plan `bag_in_shop`, `toBag` 5, no question,
  `receivedOn` 2026-11-05 (`event`), no bags, nothing skipped; POST → 200,
  `newlyBagged` 5, `emailed` / `orderStatusChanged` false, bags CD-2470-P (2)
  and CD-2470-G (3) fastest first; in the mock: one bag per tier received
  2026-11-05, each card in its tier's bag, cards 3 and 5 get `cards.tier`
  Gold, Card IDs CD-2470-01..05; still in_progress, no 'Status updated' or
  customer-visible event, no stage event, no customer email; card 3's tier
  now locked (PATCH tier → 409); POST again → `newlyBagged` 0, same bags,
  nothing written; plan `ready`; then the `labels` checks for the order (one
  label per bag, the order PDF one page per bag, each bag's route).
- `labels-any-signed` (API): every question `sure` / `signed` /
  `needsAnswer: false`, guesses Silver, Silver, Platinum; POST without tiers →
  200, CD-2480-P (1) + CD-2480-S (2), `cards.tier` written, received
  2026-11-09, still received, no customer email.
- `labels-any-unknown-tier` (API): `needsAnswers`; cards 1-2 one question,
  guess Silver (`likely`, `price`), card 3 one with no guess (`unknown`); all
  six tiers in `choices`; POST without tiers → 409 (`error`, `unanswered` = all
  3, `needsConfirmReceive` false, the questions); an unknown key (`gold`) →
  400; answering card 3 only → 409 `unanswered` = cards 1-2; nothing written
  by any of them; every answer → 200, CD-2490-S (2) + CD-2490-B (1); plan
  `ready`, no question left.
- `labels-any-awaiting`: plan `receive_first`, `receivedOn` today; POST
  without `confirmReceive` → 409 `needsConfirmReceive`, nothing written; on
  the order page the button asks "Cards arrived?" and "Receive all and print"
  POSTs `{ confirmReceive: true }` → 200 (fallback: the API): status received,
  ONE 'Cards Received' event, exactly one customer email, CD-2610-S (3)
  received today, `cards.tier` Silver; the second tap prints 1 page; POST
  again → nothing new.
- `labels-any-not-allowed`: plan `not_allowed` with a `reason`; POST (also
  with `confirmReceive` and tiers) → 409 `{ error }`, nothing written; the
  order page at 1440 and 390 shows the button disabled (`disabled` or
  `aria-disabled`) with the reason next to it (the plan's, or "Not paid yet…");
  a forced tap sends nothing.
- `labels-any-order-page`: CD-2470's order page at 1440, then from a fresh
  seed at 390: tap 1 POSTs (200) and bags the 5 cards as above (status and
  emails untouched); tap 2 prints: a new tab / download / share sheet / label
  request, the PDF it opens has one page per bag; both bags get
  `label_printed_at`; 390 without sideways scroll (`labels-any-order-page-390.png`).
- `labels-any-tier-dialog`: CD-2490's order page: the tap opens the question
  (390 first, nothing saved; `labels-any-tier-dialog-390.png`); at 1440 one
  tier list shows Silver preselected and one shows no tier; Bronze picked,
  confirmed → one POST with `tiers` cards 1-2 `expedited`, card 3 `regular` →
  200, CD-2490-S + CD-2490-B; the labels print (2 pages); no email.
- `labels-any-workspace`: CD-2470's workspace shows exactly ONE "Print labels"
  / "Print N labels" button, nothing ticked; tapped without ticking: bagged as
  above; tap 2 prints; reloaded, the bags show and there is at most one such
  button; 390 fits.
- `labels-any-receiving-row`: searching CD-2470 on Receiving, the row has
  "Print labels": tapped there (the page stays on Receiving), bagged, tap 2
  prints; CD-2610's row asks "Cards arrived?" with "Receive all and print",
  Cancel saves nothing; 390 fits.
- `labels-any-unpaid-receive`: CD-2610 made unpaid in the mock: plan
  `payment` `unpaid`; POST `{ confirmReceive: true }` → 409 `needsAllowUnpaid`,
  `unpaid: true`, the receive route's `UNPAID_ERROR` (the receive route answers
  the same); a body that isn't JSON → 400, no body → `{}` (409); on the order
  page the question shows `UNPAID_CONFIRM` with a tick box, "Receive all and
  print" without the tick sends nothing; ticked → `{ confirmReceive,
  allowUnpaid }` → 200, received, one customer email, a `received_unpaid` line.
- `labels-any-added-later`: a 6th CD-2470 card created 2026-11-20 (after
  Cards Received): plan `toBag` 5 and a `reason` naming it; the workspace box
  says 5 cards; the tap bags 5 and leaves it (no bag, not received); after X
  the box is gone, the keyboard is on the Bags heading, the card keeps its
  Arrived tick box.
- `labels-any-empty-bag`: CD-2470 bagged, then both Platinum cards refunded in
  the mock: the Bags board and the "Bags missing labels" queue show "Print
  label" for CD-2470-G and none for CD-2470-P.
- `labels-any-workspace-awaiting`: CD-2610's workspace shows a "Cards
  arrived?" box (390 without sideways scroll) with "Receive all and print";
  its question's confirm → 200, CD-2610-S, the bag's due-date shelf slot made
  (`shelves` in the answer, a `LOC-SHELF-…` place), received, one email; the
  label prints (1 page).

The harness has no QZ Tray: `newAdminContext()` refuses its websockets
(`localhost` / `localhost.qz.io`, ports 8181-8485). Without that, the sandbox's
outbound proxy accepts `ws://localhost.qz.io:8182`, `qz.websocket.isActive()`
turns true on pages that load QZ (the order page), and a label print takes the
QZ path, fails, and never stamps `label_printed_at`.

How a print is seen: `watchPrints()` wraps `window.open` and
`navigator.share` (init script; the calls still go through) and records new
tabs, downloads and GETs of `/api/admin/intake/labels/(order|bag)/…`;
`checkPrintOutput()` then reads the PDF it opened (pdf-lib) or the label JSON.
The second tap looks for "Print N labels" first (the button the first tap
leaves where it was), then any print-label button. Wording is in `UI`
(`prepareLabels`, `receiveAllAndPrint`, `confirmReceiveAll`, `printCounted`,
`printPrepared`, `tierScope`, `tierControls`, `tierConfirm`, `notAllowedReason`,
`receivingRow`), the route in `ROUTES.prepareLabelsApi`.
The mock has no backlog triggers, so "no backlog noise" isn't checked here.

Steps time out after 30 s (navigation 240 s for first compiles) instead of
waiting forever for a missing button.

The intake UI was being built while these were written: the wording they rely
on (`UI`) and the routes (`ROUTES`) are guesses where a page didn't exist yet
(bag, card, completed and setup pages, the label PDF route; for tracking, the
`&stock=4x6` slot-label parameter; for the Desk page, every button and message:
`deskPanel`, "Open order", "Put in holder", the holder picker's box, "Done",
"Take out", "Put selected in…", the photo viewer, the empty-desk wording, the
picker of desks). Fix them there.

### A finished card (`done-*`, the owner's decisions of Nov 25)

Done is one tap (no after photo) on the scan landing, the Desk page, the card
page's step picker and the order page's Done toggle. A done card goes back in
its own bag: `cards.location_id` null (not `LOC-DONE`), its holder freed. The
bag keeps count ("3 cards", then "1 of 3 done"). The first card out of a bag
(to a desk or holder) files the BAG in the one Open bags box (`LOC-OPEN-BAGS`,
kind other, "OPEN BAGS", made on first use) under the customer's last name's
first letter ("Test Customer A" -> A, "Test Customer Reyes" -> R); the bag's
last card -> "Bag finished: put it in the Ready to ship bin" and "It's in the
Ready to ship bin" (`POST /api/admin/track/bag-ready { bagId }`) puts the bag at
`LOC-SHIP`. The order's last non-refunded card -> the order Completed through
`setOrderStatus` (one "Status updated to: Completed" event, ONE customer email,
the held notes email), only from received / in_progress on a paid order. Exact
wording: the DONE-FLOW agent's ui-text.md, `lib/intake/tracking/bag-home.ts`;
in `UI.done*`, `UI.putBagInOpenBags`, `UI.bagFinished`, `UI.readyToShipRe`,
`UI.orderCompletedLine`.

Extra seed rows, not in `buildSeed()` (same reason as labels-any):
`buildDoneSeed()` in `seed.mjs` (`DONE_IDS`, `DONE_ORDER_NUMBER`,
`DONE_CUSTOMER`, `DONE_CARD_TIERS`, `DONE_CARD_NAMES`, `DONE_ORDER_NOTES`),
inserted after a reset by `seedDone()` (`scenarios.mjs`, exported; for a
harness started by hand: `HARNESS_MOCK_URL=https://localhost:PORT node
--input-type=module -e "await (await
import('./tests/intake/e2e/scenarios.mjs')).seedDone()"`).

| Order | State | Cards |
| --- | --- | --- |
| CD-2700 (`doneOrder`), Test Customer Reyes (`test.customer.reyes@example.com`) | awaiting_cards, paid, mail-in, no order tier; `admin_notes` + a `completion_notes_held` event (the notes go out on completion) | 5: Platinum 01-02, Gold 03-05 (`DONE_CARD_TIERS`) |

`doneOrderSetup()` receives all 5 on 2026-11-20 (bags CD-2700-P: 01-02,
CD-2700-G: 03-05; status received), refunds 05 in the mock (it stays in its bag),
then optionally marks cards done through `POST done` and sets the status /
payment status in the mock. The CD-2549 scenarios start from `bagOpenSetup()`.

- `done-one`: CD-2549-07 in CLAMP 07 (Clamp Work; its bag CD-2549-P then in the
  Open bags box); the scan landing reads "3 cards", "Bag: Open bags box · A",
  one "Done" per card (named "Done: CD-2549-07"); tapping it: done, no place,
  CLAMP 07 empty (and in `freed`), one `done` row CLAMP 07 -> no place, the other
  cards untouched, the bag not finished, order unchanged, no email; "Done. Put it
  back in A's bag: Open bags box, under A." on the page and in the API's
  `message`; "1 of 3 done", 07 Done without buttons, 08/09 keep theirs, also
  reloaded; the same request again changes nothing.
- `done-open-bags`: no `LOC-OPEN-BAGS` at first; CD-2549-08 "Move to my desk"
  makes it (one place, kind other, "OPEN BAGS") with CD-2549-P in it, CD-2549-G
  unmoved, and the page says "Put the bag in the Open bags box, under A."; a
  second card changes nothing; CD-2549-01 into CLAMP 01 (API) files CD-2549-G,
  the answer's `bags[]` says `opened`, letter A, `LOC-OPEN-BAGS` and its message
  the sentence; `resolve` gives both bags that location; "Bag: Open bags box ·
  A" after a reload; the Bags board's rows of both say "Open bags · A";
  CD-2700-P "Move all 2 cards to my desk": "under R"; the
  bag labels' JSON has the letter as its own text (A, R; sizes reported).
- `done-card-out`: 07-09 done (API), then 08 (done) into CLAMP 07: `bag-ready`
  refused "CD-2549-08 is still in CLAMP 07: tap Done on it first.", the bag
  unmoved; the scan landing reads "3 of 3 done" with NO bin step, 08 "Done ·
  in CLAMP 07" with ONE Done (07, 09 none); tapping it: no place, one `done`
  row CLAMP 07 -> no place, then the "Bag finished" step; the order shipped
  back (mock): no bin step, `bag-ready` refused "… the order was shipped back
  already."
- `done-bag-finished`: 07 + 08 done (API: no place), 09 on the desk; "2 of 3
  done"; 09's Done: done, off the desk, bag `completed_at` but still in the Open
  bags box, order not completed, no email, `bags[]` `finished`; ONE "Bag
  finished: put it in the Ready to ship bin" with ONE 44+ px "It's in the Ready
  to ship bin" and "CD-2549-P · 3 of 3 done"; the tap puts the bag at `LOC-SHIP`
  (cards stay in it), "In the Ready to ship bin"; again: `changed: false`;
  reloaded: "3 of 3 done", "Bag: Ready to ship", no Done or bin button;
  `bag-ready` for CD-2549-G refused "Not every card in CD-2549-G is done yet (0
  of 4 done)."; the Bags board's CD-2549-P row says "Ready to ship", CD-2549-G's
  "0 of 4 done" (or 0/4); CD-2549-P under the board's "Ready to ship" section
  ("In the Ready to ship bin", "Open bag" to its scan landing), CD-2549-G not;
  ship check ready; board at 390.
- `done-order-complete`: CD-2700, 01 + 02 done (no Completed email yet); the
  CD-2700-G page: "2 cards", 05 "Refunded" without Done, ONE "Mark all 2 done";
  tapped (its "Yes, mark 2 done" answered): 03 + 04 done, the order Completed
  with exactly ONE "Completed" email and ONE notes email to Reyes and nothing
  else, one customer-visible status event, the notes logged once, at most one
  staff `order_auto_completed` line; 05 still refunded and not done; "Bag
  finished…" and "Order completed. Test Customer Reyes emailed."; the Bags
  board lists CD-2700-P and -G under "Ready to ship" ("Not in the bin yet"),
  not among the open bags; the same request again: nothing; un-doing 03 (order page toggle) keeps Completed, no
  email; done again: still Completed, no second email.
- `done-order-complete-desk`: the order In Progress, 01-03 done, 04 on the desk;
  the Desk's Done (confirm answered) -> Completed, one email + notes; "Done. Put
  it back in REYES's bag: Open bags box, under R.", "Bag finished: put it in the
  Ready to ship bin." and the "Open REYES's bag" link (-> the CD-2700-G scan
  landing), "Order completed. Test Customer Reyes emailed."; 04's panel gone.
- `done-order-complete-card-page`: 01-03 done; 04's card page step picker
  "Done" (stages API) -> Completed, one email + notes ("Marked done. Put it back
  in …" reported).
- `done-order-complete-admin`: 01-03 done, 04 on the desk (CD-2700-G in the
  Open bags box); the order page's "Mark Done" on 04 -> `{ completed: true,
  orderCompletion: { completed: true }, bagPlaces }`: 04 back in its bag (off
  the desk, one `done` row), "Put it back in REYES's bag: Open bags box,
  under R." and "Order completed. Test Customer Reyes emailed." (role
  status), Completed with one email + notes; toggled back: no
  `orderCompletion`, still Completed, no email.
- `done-order-complete-race`: the last card in two `POST done` at once; the last
  two cards in two requests at once; the scan landing's Done on 03 and 04 back
  to back; 04's Done double-tapped: each from a fresh seed, each exactly ONE
  Completed email, one notes email, one status event.
- `done-order-complete-not-allowed`: a cancelled order and a refunded one
  (`payment_status` refunded): the last card done leaves the status, writes no
  status event, sends no email (the answer's reason reported); 04 refunded too:
  01-03 done completes the order.
- `done-desk`: CD-2549-07 + -08 on the desk (API); 07's Done on the Desk page:
  no place (not the desk, not `LOC-DONE`), one `done` row from the desk, no
  email, bag not finished; the same sentence as the scan landing; 08 left, also
  after a reload.
- `done-search`: CD-2549-P in the Open bags box (07 on the desk), CD-2549-G
  finished and in the bin (`bag-ready`), Silver CD-2549-S on its due-date shelf
  (written in the mock when the receipt leaves the bag unplaced); the Scan page,
  typing "Test Customer A" and then "CD-2549": next to each Bag ID "Open bags
  box · A", "Ready to ship", "Shelf DUE …"; the search API's `bagLocation` per
  card.
- `done-layout`: 1440 and 390 (iPhone 13): CD-2549-P with 1 of 3 done (no
  sideways scroll, the big button on the first screen, Done buttons 44+ px,
  "Mark all 2 done"), the Desk page's Done at 390, the finished bag's "It's in
  the Ready to ship bin" on the first screen unscrolled at both widths; no
  browser errors. Screenshots `done-layout-{1440,390}-{bag,finished}.png`,
  `done-layout-390-desk.png`, `done-layout-390-finished-first-screen.png`.

The older scenarios that expect Done to put a card at `LOC-DONE` (`track-move`'s
Done step, `desk-actions`' CD-2549-02, `bag-open-states`' setup check) describe
the behaviour before Nov 25: a done card now has no place.

## Known limits

- Not Postgres: no SQL functions or real triggers beyond those listed, no
  transactions across requests, no RLS, no `backlog_events` (the backlog
  triggers aren't simulated; `backlog_now` is computed directly). The mock
  answers one request at a time, so a race inside one request doesn't show;
  two app requests at once still interleave their reads and writes (what
  `done-order-complete-race` relies on: the conditional status change keeps it
  to one email). Unique constraints do show.
- The new migration's SQL is not executed: check it separately.
- Text sorts by code point, not the database collation; regex filters use
  JavaScript regexes.
- Embeds are resolved from the FK map in `SCHEMA` plus `<singular>_id`
  naming; an unknown relation answers empty and is listed in
  `dump().unknown.tables`.
- Stripe and Shippo calls fail (placeholder keys), so anything that buys a
  label or refunds can't be tested here. Google fonts load through the network
  on first compile.
- Printing itself (QZ Tray, the Labelife app, the D520) is hardware: the
  harness checks the PDF only.
- The first compile of each page takes 1-3 minutes (Turbopack, workspace root
  is the main checkout because `node_modules` is a symlink to it).
