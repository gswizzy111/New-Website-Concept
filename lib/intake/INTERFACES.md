# lib/intake: interfaces for the Receiving section

Foundation of the receiving / tier bag / QR / 8-step tracking system. Read this
before building on it. Code is the source of truth; every export has a short
doc comment.

## Ground rules

- **Server vs client.** Pure modules (safe in client components and tests):
  `types.ts`, `codes.ts`, `business-days.ts`, `stage-plan.ts`, `step-picker.ts`,
  `receiving-plan.ts`, `views.ts`, and `computeDueDate` in `due-dates.ts`
  (`due-dates.ts` has no server-only import; its loaders take a client).
  Server only (`import "server-only"`): `receiving.ts`, `stages.ts`, `data.ts`,
  and `lib/order-status.ts`.
- **Client argument.** Every database function takes the server admin client
  first: `const admin = createAdminClient()` (`lib/supabase/admin.ts`).
  Exception: `setOrderStatus(input, admin?)` and
  `refreshBagCompletionForCard(cardId, admin?)` default it.
- **Auth is the caller's job.** Pages: `await requireAdmin()`; routes:
  `if (!(await isAdmin())) 401`. Audit name: `(await getAdminSession())?.username ?? null`
  passed as `by`.
- **Results never throw for expected problems.** Services return
  `{ ok: true, ... }` or `{ ok: false, status, error }` (`IntakeResult<T>`);
  use `status` as the HTTP status and show `error` as is (plain sentences).
- **Before the migration is applied** (`supabase/migrations/20261123_intake_tracking.sql`)
  loaders return `{ ok: false, status: 500, error }` whose message names the
  missing column/table (see `app/admin/receiving/_components/schema.ts`
  `isMissingSchema`). The two hooks in existing routes do nothing then.
- **Days** are `"YYYY-MM-DD"` New York calendar days. Timestamps are ISO strings.
- **Tiers** are stored keys: `regular` Bronze B, `expedited` Silver S,
  `premium` Gold G, `ultra_premium` Platinum P, `elite` Diamond D,
  `fast_pass` Fast Pass F, `prep` Prep R (`prep_standard` is read as `prep`),
  anything else U. Effective tier = `cards.tier ?? orders.restoration_tier`.

## Schema (20261123_intake_tracking.sql; not applied by agents)

- `tier_bags` (`TierBagRow`): id, order_id, tier, batch (1+), bag_code (unique),
  received_on, due_date, due_status (`calculated | manual | needs_review |
  missing_received_date | pending`), turnaround_days, due_note, completed_at,
  completion_seen_at, label_printed_at, source (`receiving | migration`),
  created_at, created_by. Unique (order_id, tier, batch). Cascades with the order.
- `tier_bag_due_changes` (`TierBagDueChange`): insert-only (updates refused),
  reason required (non-blank).
- `business_holidays`: day (pk), name, created_at. Seeded 2026-2028 (observed days).
- `cards` new columns: card_seq, card_code (unique), bag_id (references
  tier_bags, NO ACTION: **a bag can't be deleted while it has cards**; deleting
  the order still takes its cards and bags together), received_at, received_by,
  awaiting_arrival (default false), receiving_photo_urls (default `{}`).
  Unique (order_id, card_seq).
- Backlog: `backlog_now()` skips `awaiting_arrival` cards; the card trigger logs
  awaiting flips as `card_removed` / `card_added`, so `backlog_compute()`
  (unchanged) replays them exactly. Verified against the live functions.
  **Never insert a card with awaiting_arrival = true** (insert, then update).
- RLS on, no policies: only the service role reads these tables.

## types.ts

`DueStatus`, `BagSource`, `ReceivingStatus` (`"not received" | "partially received" | "received"`),
`CompletionStatus` (`"in progress" | "partially completed" | "all cards done"`),
row types `TierBagRow`, `TierBagDueChange`, `IntakeCardRow`, `IntakeOrderRow`, `StageEventRow`,
and the view models:

- `IntakeCard`: id, orderId, seq, code (Card ID or null), qrUrl, name, set, year,
  number, variation, notes, tier (effective), tierName, tierSource
  (`card | order | null`), status, refunded, customerPhotos (`cards.photo_urls`,
  never modified here), catalogImageUrl, receivingPhotos
  (`cards.receiving_photo_urls`), receivedAt, receivedBy, receivedOn (bag's
  received_on, else NY day of receivedAt), awaitingArrival, bagId, bagCode,
  completed, completedAt, `stage: CardStageState`, `flags: CardFlags`
  (`missingImage` = no customer and no receiving photo; `missingTier`;
  `missingReceivedDate` = in a bag with no received_on, or an arrived order
  with no receipt record and no historical received day).
- `CardStageState`: round, completed, currentIndex (-1 not started, 0-7, 8 done),
  current (stored name or null), currentLabel ("Not started", "Drying", "Done"),
  doneStages (steps reached this round, not the current one; any order, so
  a skipped step isn't done), remainingStages (not reached this round),
  furthestIndex (furthest step reached this round, -1 none: the email rule's
  mark), `next: NextStep | null` (the following step in STAGES order), updatedAt,
  `history: StageHistoryEntry[]` (oldest first; kinds `received | stage |
  round_started | completed`, with at, by, round, stage, label, bulk).
- `NextStep`: `{ kind: "stage", stage, label } | { kind: "complete", label: "Done" }`.
- `BagSummary` (also what the label panel uses): id, orderId, orderNumber,
  customerName, tier, tierName, tierLetter, batch, code (Bag ID), qrUrl,
  receivedOn, dueDate, dueStatus, turnaroundDays, dueNote, completedAt,
  completionSeenAt, labelPrintedAt, source, createdAt, createdBy, cardCount
  (non-refunded), completedCount, complete (computed now), stagesDiffer (more
  than one group in stageGroups, "done" counts as a group), `stageGroups:
  BagStageGroup[]` (key `not_started | <stage> | done`, stage, completed, label,
  cardIds; ordered not started, steps 1-8, done), `cards: BagLabelCard[]`
  (id, seq, code, qrUrl, name, set, number; non-refunded, by card number).
- `IntakeOrder`: id, orderNumber, customerName, customerEmail, customerPhone,
  status, statusLabel, paymentStatus, restorationTier, tierName, inboundMethod,
  isDropoff, customerNotes, createdAt, historicalReceivedOn (first
  'Status updated to: Cards Received' event day, else drop-off creation day,
  else null).
- `OrderIntake`: order, cards (by card number; refunded included), bags
  (fastest tier first, then batch), receiving, completion, `counts`
  (total, received, awaiting, notReceived, completed, refunded, missingImage,
  missingTier, missingReceivedDate; all over non-refunded cards except refunded).
- `IntakeResult<T>` = `({ ok: true } & T) | { ok: false; status: number; error: string }`.

## codes.ts (pure)

| export | |
|---|---|
| `TIER_LETTERS`, `TIER_NAMES`, `TIER_ORDER` | maps above; order fast_pass, elite, ultra_premium, premium, expedited, regular, prep |
| `normalizeTier(t): string \| null` | trim, `prep_standard` -> `prep`, blank -> null |
| `effectiveTier(cardTier, orderTier): string \| null` | |
| `tierLetter(tier): string` | `U` for unknown/none |
| `tierDisplayName(tier, names?): string` | `names` = restoration_settings display names; "No tier" when none |
| `tierRank(tier): number` | sort key |
| `cardCode(orderNumber, seq): string` | `CD-2549-03`, `CD-2549-104` |
| `bagCode(orderNumber, tier, batch = 1): string` | `CD-2549-P`, `CD-2549-P2` |
| `normalizeCode(raw): string` | upper case, URL-decoded, leading `#` dropped, the code from a pasted `/q/...` link (any host, any case, `?`/`#`/trailing `/` ignored), spaces read as dashes (`cd 2549 03` -> `CD-2549-03`), `CD2549` -> `CD-2549`; `""` unless letters/digits with at least one dash, max 40 (so never `%`, `_`, `*`, `/`, `:` or a line break). A bare number (`2549`, `#2549`) is never a code |
| `type CodeKind = "order" \| "card" \| "bag"` | |
| `codeKind(code): CodeKind \| null` | shape only, on a normalized code: order `^[A-Z]+-\d+$` (CD-2549, CD-12345), card `^[A-Z]+-\d+-\d{2,}$` (CD-2549-03, -104), bag `^[A-Z]+-\d+-[A-Z]\d*$` (CD-2549-P, -P2..-P99); never overlap |
| `orderPhotosPath(orderId, bagId?): string` | `/admin/receiving/<orderId>/photos`, with `bagId` `...?bag=<bagId>` (ids URL-encoded) |
| `openCodePath(code): string` | the scan landing: `/admin/receiving/open/CD-2549-P` (normalized code) |
| `codeTargetPath(kind, id, orderId?, code?): string` | where `/q` sends a resolved code: order and bag -> `openCodePath(code)` (the scan landing); without `code` (or a code of another kind) as before: order -> `orderPhotosPath(orderId \|\| id)`, bag -> `orderPhotosPath(orderId, id)` (`/admin/receiving/bag/<id>` without an orderId); card -> `/admin/receiving/card/<id>`; location -> `scanPathForLocation(code \|\| id)` |
| `qrPath(code): string` | `/q/CD-2549-03` |
| `qrUrl(code): string` | QR content, ALL upper case: `HTTPS://THECARDDOC1.COM/Q/CD-2549-P` (uses `siteUrl()`); the tier bag label's one QR is `qrUrl(bagCode)` |
| `compareCardsForSeq(a, b)` | (created_at, id) order with microseconds |
| `nextCardSeqs(cards): { id, seq }[]` | numbers for cards without one, after the max; never renumbers |

## business-days.ts (pure)

`NY_TIME_ZONE`, `DEFAULT_HOLIDAYS` (same 18 rows as the seed), `isDay(v)`,
`nyToday(now?)`, `toNyDate(ts)` (null if invalid), `addCalendarDays(day, n)`,
`weekday(day)` (0 Sun), `isWeekend(day)`, `isBusinessDay(day, holidays?)`,
`addBusinessDays(fromDay, n, holidays?)` (counting starts the business day
after fromDay; 2026-11-15 + 15 with 2026-11-26 off = 2026-12-07),
`businessDaysBetween(from, to, holidays?)` (signed: due in N / overdue by -N),
`holidaySet(rows)`.

## due-dates.ts

- `PREP_TURNAROUND_KEY = "prep_turnaround_max_days"` (store_config; not set today, so prep bags get `needs_review` and no date until a settings page writes it).
- `computeDueDate({ receivedOn, turnaroundDays, holidays, historical? }): { due_date, due_status, turnaround_days }` (pure): no day -> `missing_received_date`; no turnaround -> `needs_review`; historical -> date + `needs_review`; else `calculated`.
- `loadTurnarounds(admin): Record<tier, number | null>` (restoration_settings.turnaround_max_days + prep), `turnaroundFor(admin, tier)`.
- `loadHolidayRows(admin): { day, name }[]`, `loadHolidays(admin): Set<string>` (fall back to `DEFAULT_HOLIDAYS` if the table can't be read).
- `BAG_COLUMNS` (select list for `TierBagRow`).
- `changeBagDueDate(admin, { bagId, newDue, reason, by }): IntakeResult<{ bag: TierBagRow }>`: reason required (<= 500 chars); sets `due_status 'manual'`, `due_note = reason`, logs `tier_bag_due_changes` (reverts if the log fails). Same date + reason = "reviewed".
- `setBagReceivedOn(admin, { bagId, receivedOn, by, holidays? }): IntakeResult<{ bag }>`: not in the future; recomputes the due date (bag's turnaround snapshot, else today's tier setting; `migration` bags stay `needs_review`) unless the due date is `manual`; logs a due change when the date changes.

## receiving-plan.ts (pure) and receiving.ts (server)

- `planReceiving({ order, cards, bags, cardIds, receivedOn, markOthersAwaiting?, tierNames? }): PlanResult` with `ReceivingPlan` { seqs, bags: `PlannedBag[]` (tier, tierName, batch, code, existingId, cardIds), alreadyReceived, markAwaiting, totalCards, receivedBefore, receivedAfter, eventText }. `NeedsTier` = { cardId, seq, name }. `MAX_CARDS_PER_RECEIPT = 500`.
- `receiveCards(admin, { orderId, cardIds, receivedOn?, by, markOthersAwaiting? = true }): ReceiveResult`
  - ok: `{ receivedCardIds, alreadyReceived, bags: ReceivedBag[] (id, code, tier, tierName, batch, created, cardIds, receivedOn, dueDate, dueStatus), markedAwaiting, orderStatusChanged, emailFailed, eventText }`
  - refused: `{ ok: false, status, error, needsTier? }` (400 not on order / refunded / no tier / bad date; 404; 409 cancelled order or a concurrent receipt twice; 500).
  - Order of writes: Card IDs, bags, awaiting flags, received cards, then `awaiting_cards -> received` via `setOrderStatus(..., onlyIfCurrent)` (same event text and emails as the status button; no other status ever changes), then a staff-only `order_events` row `event_type 'cards_received'`: "Received 3 of 5 cards: Platinum bag CD-2549-P (2), Gold bag CD-2549-G (1)" (later receipts: "Received 2 more cards (5 of 5 in): ...").
  - Same tier + same received day + bag not completed -> the bag is reused; otherwise the next batch. Pass `markOthersAwaiting: false` for the Historical Order Setup (cards there all arrived long ago).
- `unreceiveCard(admin, { cardId, by }): { ok: true, bagDeleted } | refusal`: only while the card has no stage event and isn't done (409). Flags it awaiting if other cards of the order are received, else clears every awaiting flag of the order. Deletes the bag if empty, else refreshes its completion. Logs `card_unreceived` (staff only).
- `ensureCardCodes(admin, orderId): Map<cardId, { seq, code }>`: assigns missing Card IDs (throws on database errors).

## stage-plan.ts (pure) and stages.ts (server)

**Steps in any order** (the owner, Nov 25 2026): staff put a card at any of the
8 steps, skipping ahead or going back; a card's step is its newest stage event
of the round. **Customer email rule** (`stepEmailsCustomer(target, furthest)`,
pure): only a step PAST the furthest step the card reached this round emails
the customer (one email per order per request, as before) and its event is
customer visible; going back (even to a skipped step) or re-entering a step
already reached sends no email and writes a staff-only event
(`is_customer_visible: false`, so the customer's order page timeline only
shows progress). A new round starts from nothing. Done never emails.

- `NOT_STARTED_LABEL`, `DONE_LABEL`, `stageIndex(stage)`, `nextStepAfter(stage | null): NextStep`.
- `furthestStageIndex(cardId, round, events): number` (-1 none), `stepEmailsCustomer(target, furthest): boolean`.
- `cardStageState(card, events): CardStageState`: `card` = { id, completed, completed_at?, current_round?, received_at?, received_by? }; `events` = the order's order_events NEWEST FIRST (stage_update and round_started rows are used). Current stage uses the existing `currentStages()`.
- `planAdvance({ cards: AdvanceCard[], cardIds, fromStage?, fromStages?, toStage? }): { ok, plan: AdvancePlan } | refusal`; `AdvanceCard` = { id, current, completed, refunded, awaiting, round, furthest? }; `AdvancePlan.moves` = { cardId, stage, round, email }[]; `SkipReason` = `different_stage | already_there | done | refunded | awaiting_arrival | not_on_order`. Guard: a card moves only while its step is still `fromStages[id]` (else `fromStage`; one of them is required); a card at the target already is `already_there` (checked first, so a repeat is a no-op).
- `isBagComplete(cards)`, `bagCompletionPatch(bag, cards, now, orderStatus?)`, `stageGroups(cards)`.
- `keepsHistoricalCompletion(bag, orderStatus)`: a `migration` bag of a finished order (completed / shipped_back / delivered) stays complete even though its old cards were never ticked done (finished historical orders are never reopened). `refreshBagCompletion`, the loaders' healing and `bagView().complete` all follow it.
- `advanceCards(admin, { orderId, cardIds, fromStage?, fromStages?, toStage?, by }): AdvanceResult`
  - Puts the chosen cards at `toStage`: any stage name, earlier or later than now, or `"complete"` (done, like the Done toggle, from any step). Without `toStage`: the step after `fromStage` (the old one-tap advance; from Final Dry it marks the card done). Only cards still at the step the page showed move (`fromStages[id]`, else `fromStage`; null = not started).
  - Writes exactly what the stage buttons write: `order_events` `stage_update`, description `Stage: <stage> [card:<id>]`, metadata `{ card_id, stage, round, by, bulk }`; customer visible only when the step is new for the customer (`moved[].email`).
  - ok: `{ target, moved: { cardId, stage, round, email }[], completed: cardId[], skipped: { cardId, reason, current }[], emailed, bagsCompleted: bagId[] }`. One customer email per call listing the moved cards with `email` (none for going back, re-entering or "done"). Show `skipped` to staff.
- `POST /api/admin/intake/stages` `{ orderId, cardIds, toStage?: <stage> | "done", fromStage?, fromStages?: { [cardId]: stage | null } }` -> `{ moved, completed, newStep (cardIds in the email), skipped, target, emailed, bagsCompleted }`; the old `{ orderId, cardIds, fromStage }` still advances one step.

## step-picker.ts (pure)

The step picker (`StepPicker` in `components/intake/tracking-actions.tsx`): the
8 steps (admin names, "Drying" for Book) and Done as 9 buttons in order in a
`role="group"` named "Step for …", the current one `aria-pressed`, a check on
steps reached this round; one tap sends `toStage` + `fromStages`. Card page:
open; bag page: open for the whole bag, behind "Move these N cards" (a group,
when the bag's cards differ) and "Change step" (a card row); Bags board: "Set
the step". Done for several cards asks "Yes, mark done". `pickerChips(cards,
reached?)`, `pickerRequest(orderId, cards, target)` (null: nothing to move),
`pickerNeedsConfirm`, `pickerOutcome(target, requested, response)` (the line
after a tap), `groupPickerCards(stageGroups)`, `DONE_TARGET = "done"`.
- `refreshBagCompletion(admin, bagIds): { completed: bagId[], reopened: bagId[] }`: never throws. Sets `completed_at` once every non-refunded card is done (keeps the earliest), clears it and `completion_seen_at` when a card reopens. Call it after anything that changes `cards.completed` or `bag_id`.
- `refreshBagCompletionForCard(cardId, admin?)`: hook used by the existing `cards/[id]/complete` and `cards/[id]/round` routes.

## views.ts (pure) and data.ts (server)

- `loadOrderIntake(admin, orderId, { heal? = true }): IntakeResult<{ intake: OrderIntake }>`
- `loadBag(admin, bagId): IntakeResult<{ bag: BagSummary; order: IntakeOrder; cards: IntakeCard[]; dueChanges: TierBagDueChange[] }>` (cards: non-refunded first, by card number; dueChanges newest first)
- `loadCard(admin, cardId): IntakeResult<{ card: IntakeCard; order: IntakeOrder; bag: BagSummary | null }>`
- `resolveCode(admin, raw): { kind: CodeKind; id; code; orderId? } | null`: no read unless `codeKind` matches; each kind looked up only in its own table (order: `order_number` ILIKE, safe because the shape has no wildcards, exact spelling preferred, a number on two orders -> null; card: `card_code`; bag: `bag_code`). `orderId` is set for an order (= id) and a bag, not for a card. Throws on a failed read.
- `loadTierNames(admin)`, `CARD_COLUMNS`, `ORDER_COLUMNS`, `INTAKE_EVENT_TYPES`.
- Loaders also heal bag completion (cards ticked done on the old site or by the ship trigger). Card IDs are NOT assigned on load: cards without one show `code: null` until `receiveCards` / `ensureCardCodes`.
- Pure builders: `buildOrderIntake({ order, cards, bags, events, tierNames })`, `orderView(row, events, tierNames?)`, `cardView(row, order, bag, events, tierNames?)`, `bagView(bag, order /* id, orderNumber, customerName, status */, cards, tierNames?)`, `receivingStatus`, `completionStatus`, `historicalReceivedOn`, `byCardNumber`, `byBagOrder`, `RECEIVED_EVENT_TEXT`.
- `historicalReceivedOn` is the day of the first 'Cards Received' status event, so for an order received through this system it is the day the status changed, not a back-dated received day; use the bag's `receivedOn` for due dates and labels.

## lib/order-status.ts (server)

`setOrderStatus({ orderId, status, trackingNumber?, onlyIfCurrent? }, admin?): SetOrderStatusResult`
= `{ ok: true, emailFailed?, notesEmailed?, skipped? } | { ok: false, httpStatus, error }`.
The former body of `POST /api/admin/orders/[id]/status`, unchanged: order row,
`Status updated to: <label>` event (customer visible), customer email, admin
"Cards Arrived" email, completion notes email. `onlyIfCurrent` changes the
status only while it still has that value (`skipped: true` otherwise).

## Existing routes (contracts unchanged)

| route | body | response |
|---|---|---|
| `POST /api/admin/orders/[id]/status` | `{ status, tracking_number? }` | `{ ok: true, emailFailed?, notesEmailed? }`; 400 `Invalid status`, 404, 500 |
| `POST /api/admin/orders/[id]/stage` | `{ stage, card_id }` | `{ ok, emailed }` (one email per click; for bulk use `advanceCards`) |
| `POST /api/admin/cards/[id]/complete` | none | `{ completed }` (toggles; now also refreshes the bag) |
| `POST /api/admin/cards/[id]/round` | none | `{ ok, round }` (now also reopens the bag) |
| `PATCH /api/admin/cards/[id]/tier` | `{ tier }` | set a card's tier (use for `needsTier`); 409 `{ error, receivingUrl }` when the card is already in a bag (`lib/intake/tier-lock.ts`) |
| `PATCH /api/admin/orders/[id]/tier` | `{ tier }` | set the order's tier; 409 likewise when it would move bagged cards to another tier |
| `POST /api/admin/orders/[id]/cards` | see route | add a card to an order (inserted with awaiting_arrival false) |

The new `/api/admin/intake/*` routes, `/q/[code]` and the label routes are
owned by the UI agents and documented in their own files.

**QR links** (`app/q/[code]/route.ts`; `/Q/<CODE>` is rewritten to it in
`middleware.ts`): first the shape check, for everyone: `normalizeCode` then
`codeKind` (order, card, bag or location); anything else, a bare number included, is 404
without any lookup. Without a full admin session a well-formed code is never
looked up: it redirects to `/admin/login?next=/q/<CODE>` (the normalized code;
the login page accepts `/q/[A-Za-z0-9-]{1,40}` and same-site `/admin/...`
paths), so a signed-out visitor can't tell a real code from a made-up one.
Signed in, `resolveCode` then `codeTargetPath`: an order code or a Bag ID to
the scan landing (`/admin/receiving/open/<CODE>`, below), a Card ID to its card
page, a place code (`LOC-…`) to the Scan page at that place
(`/admin/scan?loc=LOC-CLAMP-07`); an unknown code (or a failed read, which is
logged) is 404. Every
response is `no-store`. A signed-out GET of any other `/admin/...` page redirects to
`/admin/login?next=<path+query>`.

## Scan landing (bag/order QR)

What a bag QR (`/q/CD-2549-P`) or an order QR (`/q/CD-2549`) opens (owner, Nov
25 2026: "a page that is very simple ... move the card to my desk"); labels
already printed land here with no reprint. Page
`app/admin/receiving/open/[code]/page.tsx`, full admins only (`requireAdmin`);
`[code]` is a Bag ID or order number in any case (normalized). Any other code,
or one nothing has, is `notFound()` (the segment's `not-found.tsx`: "Code not
found", the /q wording).

- **Shows**: the customer's name big; order number; a bag's tier, Bag ID and
  "Due Mon Dec 7" (an order code lists its bags); the card count (refunded not
  counted); the order's customer notes; links "Open full order" and "All
  photos" (the photos page, `?bag=` for a bag code). Then one big "Move all N
  cards to my desk", and each card (photos with the photos page's viewer, name,
  year / set / #, Card ID, declared value, notes, known defects, "Where it is
  now", the step read only, "Move to my desk"), grouped per bag for an order
  code. Done, refunded and not-arrived cards are greyed, no button.
- **Moves**: `POST /api/admin/track/assign { locationCode: <desk code>, cardIds }`
  (no new route): the place only, never the step, no email. N = cards received,
  not done, not refunded and not on that desk; then "N cards are on your desk" +
  "Open my desk" (`deskPagePath(code)`), or "All on your desk". Each refused
  card or a failed request shows the server's message. The page shows the cards
  on the desk at once, then `router.refresh()`.
- **Desk**: `LOC-DESK` by default (`ensureDesk` makes it on the first visit when
  there is no desk, as the Desk page does); with 2+ switched-on desks a
  "Desk" select, remembered per phone (localStorage `intake.openPage.desk`).
- **Code**: `_lib/load.ts` (server: `loadOpen` = `resolveCode` +
  `loadOrdersContext` + the Desk's extra columns through `deskCardView`;
  `loadDeskChoice`), `_lib/view.ts` (pure: `buildOpenView`, `whereText`,
  `moveAllState`, `moveOutcome`, `dueText`, `chooseDesk`),
  `_components/open-board.tsx`, `open-card.tsx`, `desk-choice.ts`. Tests:
  `tests/intake/bag-open.test.ts`.
- The bag label's QR caption is `BAG_QR_CAPTION` = "SCAN TO OPEN THE ORDER"
  (`lib/intake/labels/layout.ts`).

## Tracking (slots)

Owner's model (Nov 24 2026): cards carry no sticker and are never scanned.
Every physical holder is a numbered **slot** with a QR label: each clamp, heat
press spot, humidor spot and so on. Staff scan a slot on the Scan page
(`/admin/scan`, phone camera or a handheld scanner), then pick the card(s) from
a bag's QR or a search; the card is now in that slot and at its step. Bags wait
on due-date shelf slots; `LOC-DONE` and `LOC-SHIP` are places too.

**Codes** (`codes.ts`: `codeKind()` → `"location"`, checked first;
`isLocationCode`, `scanPathForLocation`): `LOC-` + an upper-case slug, at most
40 characters. Slots `LOC-<STATION>-<NN>` (`LOC-CLAMP-07`, name "CLAMP 07";
`stations.ts` `slotCode`/`slotName`), shelf slots `LOC-SHELF-YYYYMMDD` ("DUE MON
DEC 7"), `LOC-DONE`, `LOC-SHIP`, other places from their name (`LOC-BENCH-2`).
QR content is `qrUrl(code)`. Codes never change once printed: places are
renamed or switched off, never deleted.

**Station types** (`tracking/stations.ts` `STATION_TYPES`, editable list): key,
name, stage, default capacity: slab-crack, humidor, humidity-press, drying
(stage `Book`), heat-press, clamp, book-weights, final-dry. Holders that take a
stack have no limit by default (null: humidor, humidity-press, drying,
heat-press, book-weights, final-dry); clamp and slab-crack hold 1 (owner, Nov
24 2026). A new slot copies its type's stage and capacity; capacity is stored
per slot after that, so changing a default never changes slots already made
(Places: "Set for all N <type> slots" PATCHes each slot of the type, turned-off
ones too, 4 at a time, at most 200 per tap). Over capacity answers 409
`overCapacity`; `force: true` adds anyway.

**Desks** (`tracking/desk-codes.ts`, pure: `DESK_CODE`, `isDeskCode`,
`deskPagePath`; `tracking/desk.ts`: `deskPlaces`, `ensureDesk`,
`loadDeskCards`, `pickDesk`, re-exports the codes): a desk is a place of kind
`other` whose code is `LOC-DESK` or `LOC-DESK-<NAME>` (`LOC-DESK-GAVIN`, made
from its name "DESK GAVIN"; `LOC-DESKTOP` is not one). Like any `other` place
it changes where cards are, never their step, and has no capacity. A stack
goes on it with `POST move` (scan HEAT PRESS 01, Move, scan the desk). The
Desk page `/admin/receiving/desk[?desk=<code>]` (menu "Desk", full admins)
shows each card on one desk (photos, card and order details, the order's
customer notes, the card's notes and known defects, time on the desk, the
holder it came from) with Put in holder (`assign`), Done (`done`), Take out
(`release`, Undo = `assign` back to the desk with `force`) and Open order.
When no desk exists at all, the page makes `LOC-DESK` "DESK" (`ensureDesk`:
insert on conflict do nothing; a switched-off desk stays off) and shows the
place `ensureDesk` answers: a second `deskPlaces()` read in the same render
would get Next.js's memoized answer to the identical GET from before the
insert. Places lists
desks and adds them ("Add a desk"); the Scan page links a scanned desk to its
page.

**Rules** (`tracking/move-plan.ts`, pure): a card is in one place at a time
(putting it somewhere else frees the old slot); in a slot its step becomes the
slot's stage, **later or earlier** (steps in any order: a Clamp Work card put in
a heat press is at Heat Press; a done card stays done); at most one customer
email per order per request (`tracking/stage-email.ts`, same email as
`advanceCards`), listing only the cards at a step past the furthest they
reached this round (`stepEmailsCustomer`, `PlannedMove.email`; the other step
events are staff only); refunded and not-received cards are refused; repeating a
request changes nothing. Done marks the card done (as the Done toggle), frees
its slot, puts it at `LOC-DONE` and refreshes bag completion; no email.

**Schema** (`supabase/migrations/20261124_card_tracking.sql`, additive and
rerunnable; apply before deploying the code):

- `locations`: `code` unique, `name`, `kind` (station, shelf, done, shipping,
  other), `station` + `serial` (unique together) + `stage` + `capacity` for a
  slot (kind 'station' ⇔ a stage), `due_date` for a shelf slot, `sort`,
  `active`, `created_at`, `created_by`. RLS on. Seed: LOC-DONE, LOC-SHIP.
- `card_moves`: insert-only history (`forbid_change` on update): card, order,
  bag, from/to location, `stage_before`/`stage_after`, `action` (assign, move,
  release, done, receive, ship_check), `by`, `session_id`, `created_at`.
- `cards.location_id` / `located_at`, `tier_bags.location_id` / `located_at`
  (on delete set null).

**Server** (`lib/intake/tracking/*`, server only unless marked pure):
`moves.ts` (`assignCards`, `moveSlot`, `releaseCards`, `markCardsDone`,
`placeCards`), `locations.ts` (list with occupancy, `createSlots`,
`createLocation`, `updateLocation`), `shelf.ts` (`ensureShelfSlot`,
`shelveBags`), `resolve.ts`, `ship-check.ts`, `history.ts`, `desk.ts` (loaders;
no server-only import); pure: `stations.ts`, `places.ts`, `move-plan.ts`,
`summaries.ts`, `desk-codes.ts`; response shapes in `types.ts`.

**Routes** (`app/api/admin/track/**`, full admin only):

| route | body / query | response |
|---|---|---|
| `POST assign` | `{ locationCode, cardIds, force?, sessionId? }` | `TrackActionResponse`; 409 `{ overCapacity, capacity, occupants }` |
| `POST move` | `{ fromCode, toCode, cardIds?, force?, sessionId? }` | `TrackActionResponse` (from-slot freed); 409 full / empty |
| `POST release` | `{ cardIds, sessionId? }` | "Take out": no place, step kept |
| `POST done` | `{ cardIds, sessionId? }` | done, at LOC-DONE, `bagsCompleted` |
| `GET resolve` | `?code=` slot, bag, order, Card ID or its QR link | `ResolveResponse` (a slot with its cards; a bag or order with each card's slot) |
| `GET search` | `?q=` (2+ characters) | up to 30 cards by Card ID, name, customer, order |
| `GET history` | `?code=` | last 50 moves, newest first |
| `GET ship-check` | `?code=` bag, order or Card ID | each card `ok`, `not_done`, `in_slot`, `refunded`; `ready` |
| `GET/POST/PATCH locations` | `?all=1&station=`; `{ station, count, startAt? }` or `{ name, kind, dueDate? }`; `{ id, name?, active?, capacity?, sort? }` | list with occupancy; CLAMP 01..N; rename, switch off, capacity |
| `GET locations/labels` | `?station=clamp&from=1&to=20` or `?ids=`; `&stock=`, `&format=json` | slot labels, one 50 x 80 mm page each |
| `GET locations/[id]/sign` | `&stock=`, `&format=json` | one slot label or shelf sign |

`POST /api/admin/intake/orders/[orderId]/receive` also answers `shelves` (each
received bag's due-date shelf slot, made with `ensureShelfSlot`).

**Pages**: `/admin/scan` (menu "Scan"), `/admin/receiving/desk` (menu "Desk"),
`/admin/receiving/locations` (Places: add slots and desks, capacity per type,
print labels), `/admin/receiving/shelf` (by due date),
`/admin/receiving/ship/<orderId>[?bag=]` (ship check),
`/admin/receiving/forgotten` (menu "Check", with a badge),
`/admin/receiving/printing` (Katasymbol guide).

## Tests

`node scripts/test-intake.mjs [filter]` bundles `tests/intake/*.test.ts` with
esbuild (the `@/` alias resolved, `server-only` stubbed) and runs them with
node:test; no Next.js and no database. `services.test.ts` runs the services
end to end against the in-memory Supabase + Resend stand-in
(`tests/intake/harness/mock-supabase.mjs`, loaded at run time); the runner
picks its port and sets `RESEND_BASE_URL` / `RESEND_API_KEY` for it.
