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
  case (the label's QR) → that bag's photos (`/admin/receiving/<orderId>/photos?bag=<bagId>`);
  `/q/<order code>`, `/Q/…`, lower case → the whole order's photos; unknown → 404;
  signed out → `/admin/login?next=/q/<CODE>` (card, bag, order, unknown: no lookup)
  and `next=<page>` for admin pages; the browser lands on the card page and on
  the bag's photos.
- `card-page`: Card ID, customer, order, tier, received and due dates, stage,
  customer photo; phone width.
- `bag-bulk-advance`: one card already at Humidor; bulk "Move … to Ready for
  Slab Crack" moves only the 3 not-started cards, leaves it alone, sends one
  customer email; a stale API request skips it too; one card moved alone.
- `complete-bag`: Final Dry → done → bag `completed_at`, order not completed,
  Completed section lists the bag with "New", workspace shows "Partially
  completed".
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
- `print-step`: three bags; the "Print labels" step's button is disabled and
  says 4 cards need a photo, then 1, then (every card has a receiving photo)
  it is enabled and says "Ready to print: 3 labels"; the bag label panel shows
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

Steps time out after 30 s (navigation 240 s for first compiles) instead of
waiting forever for a missing button.

The intake UI was being built while these were written: the wording they rely
on (`UI`) and the routes (`ROUTES`) are guesses where a page didn't exist yet
(bag, card, completed and setup pages, the label PDF route). Fix them there.

## Known limits

- Not Postgres: no SQL functions or real triggers beyond those listed, no
  transactions across requests, no RLS, no `backlog_events` (the backlog
  triggers aren't simulated; `backlog_now` is computed directly). Concurrency is
  one request at a time, so race conditions don't show; unique constraints do.
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
