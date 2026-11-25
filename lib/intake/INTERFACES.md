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
- `lacksDueDate(bag)` (pure) and `fillMissingDueDates(admin, { orderId, by, holidays?, turnarounds? }): { filled: { bagId, bagCode, dueDate, dueStatus }[] }`: bags saved with no due date because their tier had no turnaround then (Prep before `PREP_TURNAROUND_KEY` is set), not `manual`, with a received day, get the date their tier's turnaround gives now (same rule as `setBagReceivedOn`); the update is guarded (`due_date is null`, not manual), each fill logged in `tier_bag_due_changes`; never throws. Saving the setting itself never dates old bags: "Print labels" does, per order.

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
shows progress). A new round starts from nothing. Done never sends a step
email; but the order's last card done completes the order, and that sends
the customer's usual completed email (`order-autocomplete.ts`, below).

- `NOT_STARTED_LABEL`, `DONE_LABEL`, `stageIndex(stage)`, `nextStepAfter(stage | null): NextStep`.
- `furthestStageIndex(cardId, round, events): number` (-1 none), `stepEmailsCustomer(target, furthest): boolean`.
- `cardStageState(card, events): CardStageState`: `card` = { id, completed, completed_at?, current_round?, received_at?, received_by? }; `events` = the order's order_events NEWEST FIRST (stage_update and round_started rows are used). Current stage uses the existing `currentStages()`.
- `planAdvance({ cards: AdvanceCard[], cardIds, fromStage?, fromStages?, toStage? }): { ok, plan: AdvancePlan } | refusal`; `AdvanceCard` = { id, current, completed, refunded, awaiting, round, furthest? }; `AdvancePlan.moves` = { cardId, stage, round, email }[]; `SkipReason` = `different_stage | already_there | done | refunded | awaiting_arrival | not_on_order`. Guard: a card moves only while its step is still `fromStages[id]` (else `fromStage`; one of them is required); a card at the target already is `already_there` (checked first, so a repeat is a no-op).
- `isBagComplete(cards)`, `bagCompletionPatch(bag, cards, now, orderStatus?)`, `stageGroups(cards)`.
- `keepsHistoricalCompletion(bag, orderStatus)`: a `migration` bag of a finished order (completed / shipped_back / delivered) stays complete even though its old cards were never ticked done (finished historical orders are never reopened). `refreshBagCompletion`, the loaders' healing and `bagView().complete` all follow it.
- `advanceCards(admin, { orderId, cardIds, fromStage?, fromStages?, toStage?, by }): AdvanceResult`
  - Puts the chosen cards at `toStage`: any stage name, earlier or later than now, or `"complete"` (done, like the Done toggle, from any step). Without `toStage`: the step after `fromStage` (the old one-tap advance; from Final Dry it marks the card done). Only cards still at the step the page showed move (`fromStages[id]`, else `fromStage`; null = not started).
  - Writes exactly what the stage buttons write: `order_events` `stage_update`, description `Stage: <stage> [card:<id>]`, metadata `{ card_id, stage, round, by, bulk }`; customer visible only when the step is new for the customer (`moved[].email`).
  - ok: `{ target, moved: { cardId, stage, round, email }[], completed: cardId[], skipped: { cardId, reason, current }[], emailed, bagsCompleted: bagId[], orderCompletion?, bagPlaces? }` (done cards go back in their bag, out of any holder: `returnCardsToBags`; `bagPlaces` says where each bag is). One customer email per call listing the moved cards with `email` (none for going back, re-entering or "done"). Show `skipped` to staff.
  - Reads the order's cards and stage events in pages (`fetchAll`, events newest first by `created_at`, then `id`), so a big order's furthest step and the `fromStages` guard see every event.
- `POST /api/admin/intake/stages` `{ orderId, cardIds, toStage?: <stage> | "done", fromStage?, fromStages?: { [cardId]: stage | null } }` -> `{ moved, completed, newStep (cardIds in the email), skipped, target, emailed, bagsCompleted, orderCompletion?, bagPlaces? }`; the old `{ orderId, cardIds, fromStage }` still advances one step.
- `setCardStage(admin, { orderId, cardId, stage, by }): { ok: true, changed, email, emailed } | refusal`: one card to one of the 8 steps (the order page's Restoration Stages buttons, `POST /api/admin/orders/[id]/stage`), same email rule: customer visible and emailed only past the furthest step this round; going back or re-entering is staff only; a card already at that step writes nothing (`changed: false`). Done cards can still be given a step, as before. 400 unknown stage, 404 card not on the order.

## step-picker.ts (pure)

The step picker (`StepPicker` in `components/intake/tracking-actions.tsx`): the
8 steps (admin names, "Drying" for Book) and Done as 9 buttons in order in a
`role="group"` named "Step for …", the current one `aria-pressed`, a check on
steps reached this round; one tap sends `toStage` + `fromStages`. Card page:
open; bag page: open for the whole bag, behind "Move these N cards" (a group,
when the bag's cards differ) and "Change step" (a card row); Bags board: "Set
the step". Done for several cards asks "Yes, mark done". `pickerChips(cards,
reached?)` (a step chip is current when every card NOT done is at it, so a bag
of 2 done + 3 at Humidor shows Humidor pressed; Done when every card is done),
`pickerRequest(orderId, cards, target)` (null: nothing to move; the picker then
says `pickerNothingToMove(target)`: "Already at Humidor." / "Already done."),
`pickerNeedsConfirm`, `pickerOutcome(target, requested, response)` (the line
after a tap; after Done it adds where the cards go back, from the route's
`bagPlaces`: "Marked done. Put it back in REYES's bag: Open bags box, under
R.", and `notes`: the order's auto-complete line, green when it completed the
order, amber otherwise), `groupPickerCards(stageGroups)`, `DONE_TARGET = "done"`.
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
`customerEmail: false` skips only the customer status email (a bag's "Mark
shipped" has just sent the shipped email with the tracking).

## order-autocomplete.ts (server): the last card done completes the order

Owner, Nov 25 2026 ("Do it automatically"). `completeOrderIfAllDone(admin,
orderId, by): OrderAutoComplete` (never throws; `completeOrdersIfAllDone` for
several orders, each once). Called once per order by every request that
newly marked a card done: `advanceCards` (stages route, step picker),
`markCardsDone` / assigning to the Done place (tracking `writePlan` step 7),
and the order page's Done toggle (`toggleCardCompletion` in
`card-completion.ts`, the former body of `POST /api/admin/cards/[id]/complete`).

- Completes only when every non-refunded card is `completed` (at least one;
  a card still on its way counts as not done), the order is `received` or
  `in_progress` (`AUTO_COMPLETE_FROM`) and `payment_status` is `paid`.
  Never from Awaiting Payment / Awaiting Cards / Cancelled, never again once
  Completed / Shipped Back / Delivered; un-doing a card never un-completes.
- Through `setOrderStatus({ status: "completed", onlyIfCurrent: <status read> })`:
  the status button's event, customer email and held completion-notes
  email; the conditional update means two requests finishing the last cards
  at once send ONE email (the other gets `reason: "taken"`). Then a
  staff-only `order_auto_completed` line: "Order completed automatically:
  last card done by gavin." (metadata `{ auto, by, cards }`).
- `OrderAutoComplete` = { orderId, orderNumber, customerName, completed,
  emailed, reason? (`not_all_done | no_cards | already_done | wrong_status |
  not_paid | taken | failed`), status, notesEmailed?, message?, error? }.
  `message` is the staff line: "Order completed. Pat Collector emailed.",
  "Order completed. No email sent: the order has no email address.", or
  for `wrong_status` / `not_paid` / `failed` why it wasn't completed.
- Responses (optional fields, present only when a card was newly marked
  done): `POST /api/admin/intake/stages` and `POST /api/admin/cards/[id]/complete`
  → `orderCompletion`; tracking `TrackActionResponse` (`done`, `assign` to
  the Done place) → `orderCompletions` (one per order of the cards marked done).

## Existing routes (contracts unchanged)

| route | body | response |
|---|---|---|
| `POST /api/admin/orders/[id]/status` | `{ status, tracking_number? }` | `{ ok: true, emailFailed?, notesEmailed? }`; 400 `Invalid status`, 404, 500 |
| `POST /api/admin/orders/[id]/stage` | `{ stage, card_id }` | `{ ok, emailed }` (`setCardStage`: emails only a step past the furthest this round; for bulk use `advanceCards`) |
| `POST /api/admin/cards/[id]/complete` | none | `{ completed, orderCompletion?, bagPlaces?, unbinned? }` (toggles; refreshes the bag; a card marked done goes back in its bag like every Done (`bagPlaces`, "Put it back in REYES's bag: …"); the last card done completes the order, above; un-doing a card of a bag in the Ready to ship bin files the bag back in the Open bags box (`unbinned`); 500 "Marked done, but not put back in the bag: …" when the move or its history row can't be saved) |
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
  counted: "4 cards", then "3 of 4 done"); where the bag is ("Bag: Open bags
  box · R", "Bag: Shelf DUE MON DEC 7", "Bag: Ready to ship"); the order's customer notes; links "Open full order" and "All
  photos" (the photos page, `?bag=` for a bag code). Then one big "Move all N
  cards to my desk", and each card (photos with the photos page's viewer, name,
  year / set / #, Card ID, declared value, notes, known defects, "Where it is
  now", the step read only, "Move to my desk" and "Done"), grouped per bag for an order
  code. Done, refunded and not-arrived cards are greyed, no button.
- **Done** (done flow, Nov 25 2026): a card's "Done" (one tap) and, per bag
  with 2+ cards to do, "Mark all N done" (asks "Mark all N cards done?":
  "Yes, mark N done" / "Cancel"): `POST /api/admin/track/done` (200 cards per
  request). The card goes back in its bag; its panel says the server's line
  ("Done. Put it back in REYES's bag: Open bags box, under R.") and the
  order's line when the order completed. A bag whose every card is done
  shows ONE big step "Bag finished: put it in the Ready to ship bin" with
  "It's in the Ready to ship bin" (`POST /api/admin/track/bag-ready`), then
  "In the Ready to ship bin"; under either, a secondary "Pack and ship this
  bag" (`packCodePath(code)`, the packing page; with "Label bought, not
  shipped" / "Label being bought" beside the count while a bag label is
  live). Once the bag's return label went out (`bag_shipments` shipped or
  delivered) the step reads "Shipped · <tracking>" ("Bag CD-2549-P shipped ·
  …" with several bags; "Track package", "Packing page", " · Delivered"),
  whatever the order's status, and the header's "Bag:" says "Shipped" /
  "Delivered" (the bag's place stays LOC-SHIP). Labels are read by
  `loadBagShipStates` (`lib/intake/shipping/bag-states.ts`; none before the
  bag_shipments migration: the page is as before). `_lib/view.ts`:
  `canFinish`, `doneAllIds`, `doneAllLabel`, `doneAllQuestion`,
  `doneOutcome`, `openBagsLine`, `bagSteps`, `bagStepTitle`,
  `stepWaitsForBin`, `stepLabelNote`, `PACK_LINK_TEXT`.
- **Moves**: `POST /api/admin/track/assign { locationCode: <desk code>, cardIds }`
  (no new route): the place only, never the step, no email. N = cards received,
  not done, not refunded and not on that desk; then "N cards are on your desk" +
  "Open my desk" (`deskPagePath(code)`), or "All on your desk". Each refused
  card or a failed request shows the server's message. At most 200 cards per
  request (`MOVE_CHUNK` = the route's `MAX_CARDS`; `moveChunks`,
  `chunkedMoveOutcome` merge the answers). The page shows the moved cards on
  the desk at once and keeps them there until every `router.refresh()` started
  so far has landed (the transition's pending flag); it refreshes after a
  failed move too, so a desk switched off meanwhile drops out of the picker.
- **Layout**: on a phone the customer's name, order, bag, due date and card
  count, then the big button (on the first screen, 390 x 664), then the order's
  bags, the customer's notes and the links; on a computer those two parts read
  as one card with the button panel beside it.
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
on due-date shelf slots until a card comes out, then in the Open bags box
(`LOC-OPEN-BAGS`); a finished bag goes in the Ready to ship bin (`LOC-SHIP`).
A done card goes back in its bag (no place). `LOC-DONE` stays a place for
anyone still scanning cards to it, but Done never uses it (see "Finished
cards and bags" below).

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
its slot, puts it back in its bag (location null) and refreshes bag
completion; no step email (the order's last card done completes the order,
with its completed email: `orderCompletions`). A card that comes out of its
bag files the bag in the Open bags box (below).

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
`shelvesFor` (each just-received bag's shelf slot, best effort: every
receipt calls it), `shelveBags`), `resolve.ts`, `ship-check.ts`, `history.ts`, `desk.ts` (loaders;
no server-only import); pure: `stations.ts`, `places.ts`, `move-plan.ts`,
`summaries.ts`, `desk-codes.ts`; response shapes in `types.ts`.

**Routes** (`app/api/admin/track/**`, full admin only):

| route | body / query | response |
|---|---|---|
| `POST assign` | `{ locationCode, cardIds, force?, sessionId? }` | `TrackActionResponse`; 409 `{ overCapacity, capacity, occupants }` |
| `POST move` | `{ fromCode, toCode, cardIds?, force?, sessionId? }` | `TrackActionResponse` (from-slot freed); 409 full / empty |
| `POST release` | `{ cardIds, sessionId? }` | "Take out": no place, step kept |
| `POST done` | `{ cardIds, sessionId? }` | done, back in its bag (no place), `bagsCompleted`, `bags`, `orderCompletions` |
| `POST bag-ready` | `{ bagId }` | `BagReadyResponse { bag, changed, message }`: the finished bag is at `LOC-SHIP`; 409 while a card is still to do |
| `GET resolve` | `?code=` slot, bag, order, Card ID or its QR link | `ResolveResponse` (a slot with its cards; a bag or order with each card's slot) |
| `GET search` | `?q=` (2+ characters) | up to 30 cards by Card ID, name, customer, order |
| `GET history` | `?code=` | last 50 moves, newest first |
| `GET ship-check` | `?code=` bag, order or Card ID | each card `ok`, `not_done`, `in_slot`, `refunded`; `ready` |
| `GET/POST/PATCH locations` | `?all=1&station=`; `{ station, count, startAt? }` or `{ name, kind, dueDate? }`; `{ id, name?, active?, capacity?, sort? }` | list with occupancy; CLAMP 01..N; rename, switch off, capacity |
| `GET locations/labels` | `?station=clamp&from=1&to=20` or `?ids=`; `&stock=`, `&format=json` | slot labels, one 50 x 80 mm page each |
| `GET locations/[id]/sign` | `&stock=`, `&format=json` | one slot label or shelf sign |

`POST /api/admin/intake/orders/[orderId]/receive` also answers `shelves` (each
received bag's due-date shelf slot, made with `ensureShelfSlot` through
`shelvesFor`; "Receive all and print" does the same).

**Pages**: `/admin/scan` (menu "Scan"), `/admin/receiving/desk` (menu "Desk"),
`/admin/receiving/locations` (Places: add slots and desks, capacity per type,
print labels), `/admin/receiving/shelf` (by due date),
`/admin/receiving/ship/<orderId>[?bag=]` (ship check),
`/admin/receiving/forgotten` (menu "Check", with a badge),
`/admin/receiving/printing` (Katasymbol guide).

## Finished cards and bags (done flow)

Owner, Nov 25 2026: a finished card goes back **in its own bag** (cards have
no sticker, so a loose card on a shared Done pile can't be matched); the
shared bin holds finished BAGS. Bags are found fast by one **Open bags box**
with A-Z dividers by the customer's last name.

- **Filing letter** (`lib/intake/filing-letter.ts`, pure): `filingLetter(name)`
  = first letter of the customer's LAST name (the last word; suffixes such as
  Jr., LLC, Inc., Co., Ltd skipped, Roman numerals II-IV only in capitals or
  in a 3+ word name, so "Lee Iv" is I; "Reyes, Maria" keeps Reyes; accents
  dropped and Ø Ł Æ Œ Đ ß Þ read as O L A O D S T), else the first letter of
  the name, else `"#"`. `customerLastName(name)`. The bag label prints it in
  a tab at the banner's top right; where even the smallest tab would make
  the name smaller or hide every card (4 x 3 in), no tab and the kicker reads
  "FILE UNDER R · THE CARD DOC" (`LabelFit.filing.inKicker`).
- **Done** (tracking `POST done`, the Desk, the scan landing, the ship check,
  and the step picker's Done through `advanceCards` → `returnCardsToBags`):
  the card is marked done, leaves its holder or desk (location null, "In the
  bag"; a `card_moves` 'done' row, written right after each holder's move:
  a failed write answers 500, never a silent unlogged move) and the answer
  says where the bag is:
  `message` "Done. Put it back in REYES's bag: Open bags box, under R."
  (TrackActionResponse `bags: TrackBagPlace[]`; the stages route
  `bagPlaces`). When the card's order has 2+ bags (one customer's Platinum
  and Gold bags: `TrackBagPlace.orderBagCount`), the one bag is named by tier
  and Bag ID: "Put it back in REYES's Platinum bag CD-2549-P: Open bags box,
  under R."; a one-bag order keeps "REYES's bag". The bag's last card adds "Bag finished: put it in the Ready
  to ship bin." The order page's Done toggle does the same
  (`toggleCardCompletion`). Bags of one customer (a mixed-tier order) in one
  answer are named apart, with the cards for each: "Put each back in its
  bag: CD-2549-07, CD-2549-08 in REYES's Platinum bag CD-2549-P (Open bags
  box, under R); CD-2549-01 in REYES's Gold bag CD-2549-G (on shelf …)."
  (`TrackBagPlace.tierName`, `returnedCodes`).
- **Back in the bag** (`isBackInBag`, pure): a done card is in its bag with no
  place or at a bag's place (a due-date shelf, the Open bags box, the Ready to
  ship bin). One in a holder, on a desk or on the old Done shelf (LOC-DONE, a
  loose pile) is still out: its bag isn't `finished`, the scan landing shows
  it "Done · in CLAMP 07" with a Done that puts it back, and no bin step.
  The ship checks use the same rule (`shipCheckStatus` in
  `lib/intake/tracking/summaries.ts` and `components/intake/ship/rules.ts`):
  such a card is `in_slot` ("Still in CLAMP 07", "Still on DESK", "Still on
  the Done shelf"), so no bag label is bought for its bag ("1 card is still
  out of the bag (on DESK)."); the ship check page's button for one outside
  a holder is "Back in its bag" (release: no place).
- **Open bags box** (`LOC-OPEN-BAGS` "OPEN BAGS", kind 'other', made on first
  use by `ensureOpenBags`, switched back on if off): every assign / move
  (`settleBags` after `writePlan`) files in it the bag of any card that comes
  OUT of its bag (it was in no place, on a shelf, at Done / Shipping or in the
  box, and goes to a desk or work-station slot), unless the bag is there
  already (`bagsToOpen`, pure). The answer's `message` ends "Put the bag in
  the Open bags box, under R." (`bags[].opened`). A card moved holder to
  holder files nothing. Best effort: a failure leaves the bag where it was.
- **Ready to ship** (`POST /api/admin/track/bag-ready { bagId }`,
  `putBagReadyToShip`): the finished bag's place becomes `LOC-SHIP` (made if
  missing); refused (409) while a non-refunded card is still to do ("Not
  every card in CD-2549-P is done yet (3 of 4 done)."), while a done card is
  out of the bag ("CD-2549-03 is still in CLAMP 07: tap Done on it first."),
  and for an order shipped back, delivered or cancelled ("CD-2549-P isn't
  going in the Ready to ship bin: the order was shipped back already."; the
  scan landing shows no bin step then). Un-doing a card reopens its bag
  (`refreshBagCompletion`); a reopened bag in the bin goes back in the Open
  bags box (`unbinReopenedBags`; the toggle says "Take REYES's bag out of
  the Ready to ship bin: Open bags box, under R.").
- **Words** (`lib/intake/tracking/bag-home.ts`, pure): `bagPlaceText(loc,
  letter, compact?)` "Open bags box · R" (Bags board: "Open bags · R"),
  "Shelf DUE MON DEC 7", "Ready to ship"; `bagPlacePhrase` "Open bags box,
  under R" / "on shelf DUE MON DEC 7" / "in the Ready to ship bin";
  `putBackSentence`, `doneText`, `openBagsSentence`, `finishedSentence`,
  `bagSentences`, `doneCountText` ("4 cards", then "3 of 4 done"),
  `orderCompletionNotes` (the order auto-complete lines, green / amber).
  Exact strings: the done-flow ui-text (tests/intake/done-flow.test.ts).
- **Pages**: the scan landing ("Bag: Open bags box · R", "3 of 4 done", a
  card's Done, "Mark all N done", the one big "Bag finished" step with "It's
  in the Ready to ship bin"), the Desk (Done says the same), the Scan page
  (search rows and bag headers: "Bag: Open bags box · R"; after a Done the
  order's line, green, or amber when it wasn't completed), the ship check
  (the order's line under a card's Mark done), the Bags board (the bag's
  place, "3 of 4 done"; below the open bags a "Ready to ship" section: the
  finished bags not shipped yet, a Completed order's included, the ones not
  in the bin first, each with "Pack and ship" (its packing page) and "Open
  bag" (its scan landing); a bag whose return label went out (bag_shipments
  shipped / delivered) is left out, one with a label bought and not shipped
  says "Label bought, not shipped" ("Label being bought" while claimed);
  before the bag_shipments migration the list is as before), the step
  picker (its Done line), the order page's Done toggle (the bag line and the
  order's line).
- `TrackCardSummary.bagLocation` (optional): where the card's bag is.

## Prepare labels (any order)

The owner's request of Nov 24 2026: "I want to easily be able to just print it
for any order", with tiers filled in automatically. One action, the same on the
order page (header), Receiving search rows, the receiving workspace (a box at
the top, shown while the order has cards to bag or receive, or bags to date)
and, for one bag, the Bags board and the "Bags missing labels" queue (those
print that bag only, no bagging, and only for a bag with live cards).

Code: `lib/intake/prepare-labels.ts` (types at the top; client components may
`import type` only, its functions reach server-only modules), the guesses in
`lib/intake/tier-guess.ts`, the button in `components/intake/print-order-labels.tsx`.

**API** (full admins only, the `adminName()` guard of the other receiving routes; 401 otherwise):

| route | body | response |
|---|---|---|
| `GET /api/admin/intake/orders/[orderId]/prepare-labels` | none | `PreparePlan` (read-only): `mode`, `reason?`, `payment`, `bags`, `toBag`, `tierQuestions`, `needsAnswers`, `dueDatesToFill`, `receivedOn` + `receivedOnSource` (`event`, `dropoff` or `today`; `bag` is no longer produced), `skipped` { refunded, awaitingArrival }; 404 / 500 `{ error }` |
| `POST` same | `{ tiers?: { [cardId]: tierKey }, confirmReceive?, allowUnpaid? }` (an empty body is `{}`; one that isn't JSON or is over 40 KB is 400, as on the receive route; there is no received-day override) | 200 `PrepareResponse` { bags (every bag with live cards, fastest tier first: the labels to print), newlyBagged, emailed, orderStatusChanged, shelves, dueDatesFilled, message }; 409 `PrepareConflict` (the plan + `error`, `needsConfirmReceive`, `needsAllowUnpaid`, `unpaid?`, `unanswered` card ids; nothing written); 409 `{ error }` not allowed; 400 bad body, unknown tier (`Unknown tier "gold".`); 400 / 409 when the receipt or bagging can't go ahead (checked with the answers in memory first: "… Nothing was changed."); 500 |

Then the labels print through the existing paths: `GET /api/admin/intake/labels/order/<orderId>?bags=<ids>`
(PDF, one page per bag, design B) or the Katasymbol path (`LabelPrintButton`).

**Modes** (`buildPreparePlan`, pure):

- `bag_in_shop`: received, in progress, completed, shipped back, delivered
  (`SETUP_STATUSES`) with live, arrived cards in no bag. Bagged with the
  Historical Order Setup's own plan (`planOrderSetup` / `applyOrderSetup`,
  source `migration`, due date from the received day + the tier's max
  turnaround marked `needs_review`, finished orders' bags created completed
  and seen). GET and POST share one rule (`inShopSetupPlan`). Received day:
  the order's first "Status updated to: Cards Received" day, else the
  drop-off day, else today, and then only for the cards bagged now (bags
  missing their date keep asking for it; a day an earlier tap put on a bag is
  never taken as the arrival day of later cards). On an open order, cards
  created after the cards were known to be here (`arrivedBy`: the event's
  time; a drop-off's hand-over, or the order's entry plus an hour when
  later; with neither, the order's first bag), to the second, not in a bag
  and not received, are left for Receiving (`reason` says so); a finished
  order's are bagged. Orders from before `INTAKE_START` are included.
- `receive_first`: Awaiting Cards. POST needs `confirmReceive: true` ("Cards
  arrived? Receive all and print"); an order that isn't paid also needs
  `allowUnpaid: true` after the dialog's tick on the Receive button's
  `UNPAID_CONFIRM` (without it: 409, `error` = `UNPAID_ERROR`, `unpaid: true`,
  as the receive route's `paymentBlock`). Then exactly the Receive button:
  `receiveCards` (Card IDs, bags source `receiving` with calculated due dates,
  status -> Cards Received through `setOrderStatus`, the usual customer and
  staff emails, the `cards_received` line), `shelvesFor` (shelf slots), and
  the `received_unpaid` line for an unpaid order.
- `ready`: every live, arrived card is in a bag: print. The button POSTs first
  only when `dueDatesToFill > 0` (a harmless no-op otherwise).
- `not_allowed`: cancelled, refunded, awaiting payment, no cards, a status
  outside the above. The button is disabled up front for cancelled, refunded
  and awaiting payment; any other refusal shows its `reason` under the button
  and the next tap asks again.
- `skipped`: refunded cards and cards flagged `awaiting_arrival` are never
  bagged here (they are counted and named in `reason`).

**Tier sources** (`guessTiers`, first that applies; only for cards among
`toBag` with neither a card nor an order tier):

1. `cards.tier`, then `orders.restoration_tier` (no question).
2. The signed checkout record (`signatures` master_terms `card_snapshot` /
   `document_text`, i.e. `authorizedOrderText`) or the signed show drop-off
   form: `confidence: "sure"`, filled in without asking (`needsAnswer: false`,
   listed in the dialog for information). Matched one-to-one: cards that
   already have a tier claim their signed entries first, and an untiered card
   is matched only when the entries left under its name are at least as many
   as the order's untiered cards with that name (two Charizards, one
   signature: neither is sure).
3. What was paid for the card itself (`cards.service_price_cents`): `"likely"`
   when it is exactly one tier's price (Diamond: its rate on the declared
   value). In production every recorded card price matches its tier; cards
   with no tier have none today.
4. What was paid for the order (service lines, checkout events, subtotal)
   against the tier prices (`restoration_settings`): `"likely"` when only one
   tier fits; a card name saying Prep: `"likely"` Prep. Diamond's $5,000 minimum always holds; a
   paid line naming no tier ("Full Card Restoration") is never read as the
   other lines' tiers (a PSA Prep line doesn't make that card Prep). The
   search is bounded (`GUESS_WORK_BUDGET` steps, a 20-card mixed checkout in
   well under 100 ms); past it the guess comes from the declared values only,
   and staff confirm it.
5. Otherwise `"unknown"` with a best guess (e.g. "Paid for 4 Gold and 2
   Silver, but not which card is which": the most valuable cards get the faster
   tier) or `guess: null`.

`likely` and `unknown` questions need one confirm tap (`needsAnswer: true`):
the dialog preselects `guess`, shows `why` under the select, and has "Set each
card" to pick a tier per card. Questions are grouped by guess (most orders: one).
Answers are written to `cards.tier` only after the receipt (`planReceiving`)
or the bagging (`inShopSetupPlan`) has been checked with them in memory, only
where it is still null and the card is in no bag (bagged cards' tiers are
locked, `tier-lock.ts`), with one staff-only `tier_changed` line ("Tiers
filled in for labels: …"). Cards bagged on the order's own tier get it
written onto `cards.tier` too (a filled tier is part of receiving; the
order's tier stays as it is; a tier upgrade still moves every card).

**Never** (in-shop orders): an order status change, a customer email, awaiting
flags, stage events or a value that is already set. The only rows written are
the tiers above, Card IDs, bags and card links (`applyOrderSetup`), the
`intake_setup` line worded "Bagged for labels: …" (staff only), and due
dates for dateless bags (`fillMissingDueDates`, logged). The Awaiting Cards
path writes what the Receive button writes, nothing more. Idempotent: a repeat
bags nothing new, sends nothing, and answers the same bags.

## Packing (per-bag return labels)

The owner's decision of Nov 25 2026: "Ship each bag when done". A mixed-tier
order ships back bag by bag, each with its own Shippo return label. Code:
`lib/intake/shipping/` (`types.ts` pure: shapes and rules, client components
may import it; `bag-label.ts` the Shippo purchase moved unchanged out of the
order page's return-label route, which now uses it too; `shipped-email.ts`
the customer's "Your cards have been shipped!" email, also moved unchanged;
`bag-shipments.ts` the services; `order-label.ts` the order page's
whole-order purchase (moved out of its route, now claiming the order first);
`ship-queue.ts` the bags waiting to ship; `return-packages.ts` the customer
pages).

**Schema** (`supabase/migrations/20261125_bag_shipments.sql`, additive,
rerunnable, RLS on, service role only): `bag_shipments` (bag_id, order_id,
status `claimed | purchased | shipped | delivered | failed | voided`, carrier,
service, tracking_number, tracking_url, label_url, shippo transaction / rate
ids, cost_cents, insurance_cents, order_label, claimed_at, purchased_at,
shipped_at, delivered_at, email_sent_at, created_by, shipped_by, error). One
live row (claimed..delivered) per bag (partial unique index); one
`order_label` row per order; a trigger checks the bag belongs to the order.
A row with `bag_id` null is the order page's claim on its whole-order label
(one live per order, only ever `claimed` or `failed`, deleted once the label
is saved on the order): readers of packages leave those rows out
(`.not("bag_id", "is", null)`). `error` only grows (`appendNote`).

**Rules**:

- Claim before buying (as the Stripe webhook claims a session): the
  `claimed` row is inserted before Shippo is called, so two taps buy one
  label. Shippo refusing marks it `failed` (retry works); no clear answer
  after the purchase was sent keeps the claim: 409 `inProgress` for 2
  minutes; then Shippo's history is read (`findLabelByMetadata`, the
  purchase's "Bag <code>" metadata, made after the claim): a label there is
  saved (200 `existing: true`, nothing bought), one still being made is 409
  `inProgress`, otherwise 409 `staleClaim` ("Shippo has no label for it, so
  buying again is safe" when the history says so) until a POST with
  `retryStaleClaim: true`. A label bought but not saved stays on its claim
  (label fields and a "Bought but not saved: <url>" note): any next POST
  saves it instead of buying (`PackingResponse.unsavedLabel`).
- The order page's whole-order label claims the ORDER the same way
  (`order-label.ts`); the bag route checks for that claim after writing its
  own (and re-reads `orders.return_label_url`), the order route checks for
  live bag labels after writing its own, so the two are never both bought;
  either side lets its claim go and answers 409 when it sees the other.
- Refused when the bag's ship check fails (a card not done, still in a
  holder, every card refunded), when the order has a whole-order label from
  the order page or the old site (`orderLabel`: it covers every bag), or in
  any order status but received, in progress, completed (not shipped back:
  the order only gets there when every bag has gone, or by hand).
- Rate: the one chosen (`rateObjectId`), else the service the customer paid
  for, else the cheapest (the order page's one tap). International: customs
  (one bag and no live card outside a bag: every card of the order, as the
  order page; otherwise the bag's cards), the fresh shipment's matching rate else its cheapest, no
  insurance, exactly as before. Insurance: the customer's paid return
  insurance is the floor, split across the bags by their cards' declared
  values (rounded up; the whole value per bag when a card has none).
- The order's FIRST label is written to `orders.return_label_url` and
  `outbound_*` when bought (conditional on return_label_url being empty), so
  neither site sells a second whole-order label; `orders.tracking_number` and
  the status change only when the order ships back, because both sites'
  admin order pages auto-ship an order that has a label and a tracking number.
  The order page's route refuses (409) while a bag label is live.
- Mark shipped: `purchased -> shipped` (conditional: one email per bag): the
  usual shipped email with this bag's tracking (a split order's email adds
  one line naming the cards in the package), a `bag_shipped` event (customer
  visible on a split order, staff only otherwise). When every bag with live
  cards has shipped and no live card is outside a bag: `setOrderStatus`
  shipped_back (`onlyIfCurrent`, tracking = the LAST package's, because both
  sites' order pages and the old site's Sync delivered mark an order
  delivered from `orders.tracking_number` alone), from received / in
  progress / completed only; `customerEmail: false` only when this bag's
  shipped email went out (else the status email carries the tracking). A
  status changed meanwhile is read again; a failure is in `message`, and the
  step runs again on the packing page's GET (`notice`) and on a repeated Mark
  shipped, a minute after the last bag shipped. A single-bag order ends
  exactly as the order page's label leaves it.
- Delivered (`syncBagDeliveries`, from `/api/cron/sync-delivered` and the
  admin Sync delivered button): each shipped package whose Shippo tracking is
  DELIVERED becomes delivered; an order counts as shipped bag by bag
  (`bagOrderIds`, left out of the old `orders.tracking_number` check) only
  when every bag with live cards has a shipped or delivered shipment (one
  shipped partly by hand goes by its tracking number), and becomes Delivered
  (same event as before, only from shipped_back) when every one is
  delivered. A read error is `failed: true`: both callers skip their
  tracking-number pass that run. The admin order page doesn't auto-deliver
  from the tracking number while a bag package is out
  (`bagShipmentsHoldDelivery`). `sync-return-tracking` fills a bag label's
  missing tracking number by its label URL, and a bag order's
  `orders.tracking_number` from its last package (`latestShippedBags`), never
  from `return_label_url` (the first).
- Customer pages (`/orders/<number>`, `/account/orders/<id>`): one "Return
  Tracking: Package 1 of 2" panel per shipped package when the order ships
  in several (`returnPackagesToShow`); single-bag orders keep the one panel.
- Preview mode: the services refuse writes (503) before any claim or Shippo
  call (and middleware answers every `/api/*` 503 anyway). Before the
  migration: only the bag flow says so (no bag label is bought: 500
  `shipmentsReady: false`, GET says why); everything else treats the missing
  table as "no bag shipments" and works exactly as before: the order page's
  label buys without its claim (with a console warning), the syncs go by
  `orders.tracking_number` / `return_label_url`, the order page auto-delivers,
  the ship queue lists whole orders.

**API** (full admins only, the `adminName()` guard; 401 otherwise; bag id in
the existing `bags/[id]` folder):

| route | body / query | response |
|---|---|---|
| `GET /api/admin/intake/bags/<id>/ship-label` | `?rates=1` adds Shippo rates | `PackingResponse`: bag, order, `check` (`ShipCheckResponse`, scope bag), `shipment`, `lastFailure`, `orderLabel`, `packages`, `shipmentsReady`, `canBuy`, `blocked`, `next` (`buy`, `print_and_ship`, `shipped`, `delivered`, `blocked`, `wait`), `rates?`, `ratesError?`, `unsavedLabel?`, `notice?`; 404, 500 |
| `POST /api/admin/intake/bags/<id>/ship-label` | `{ rateObjectId?, insuranceDeclaredValueCents?, retryStaleClaim? }` (`{}` = one tap) | 200 `{ shipment, existing, orderLabel, message }`; 409 `{ error, check }` / `{ error, orderLabel }` / `{ error, inProgress }` / `{ error, staleClaim, claimedAt }` / `{ error }` (order status); 400 no address or bad body; 422 no rates; 500 `Label purchase failed: …` (retry works), `{ error, uncertain }`, `{ error, labelUrl, unsaved }`, `{ error, shipmentsReady: false }`; 503 preview |
| `POST /api/admin/intake/bags/<id>/shipped` | none | 200 `MarkShippedResponse` { shipment, alreadyShipped, emailed, emailFailed?, orderShipped, orderStatus, notesEmailed?, packages, message }; 409 no label yet / still being bought; 404, 500, 503 |
| `POST /api/admin/orders/<id>/return-label` (order page, any admin) | `{ rateObjectId, insuranceDeclaredValueCents?, retryStaleClaim? }` | as before: 200 `{ labelUrl, trackingNumber, notesEmailed? }` / `{ labelUrl }`, 400, 404, 500 `{ error }`; plus 409 `{ error, inProgress }` (another tap, or Shippo still making it), 409 `{ error }` (a bag label is live), 409 `{ error, staleClaim, claimedAt }` (unfinished and Shippo unreadable: retry after checking) |

## Packing page (one bag)

`/admin/receiving/pack/<Bag ID>` (any case; `packCodePath(code)` in
`codes.ts`), full admins only; any other code is `notFound()` ("Bag not
found"). Phone first, one step at a time from the packing API's `next`:

- **Top**: the customer's name big, order number, tier, Bag ID, "N cards",
  "Ships to" (city, state, country of the return address), "Customer paid
  for" (`paidServiceOf`, e.g. "USPS Priority Mail"); on a split order
  "Package 1 of 2 of this order · 1 of 2 packages shipped".
- **The check** ("Match the cards in the bag"): each card with a small photo
  (receiving photo, else the customer's, else the catalog picture), name,
  Card ID and a big mark: ✓ "Done", ✗ "Not done", ⚠ "Still in CLAMP 07"
  (any done card not back in its bag, `isBackInBag`: "Still on DESK", "Still
  on the Done shelf"; not done / out of the bag also get "Open card →");
  refunded cards listed apart ("Refunded: not in this package").
- **The step**: `buy` "Ready to ship" + "Buy return label" (POST `{}`; under
  it "Buys USPS Priority Mail, what the customer paid for.") and "Choose
  another rate" (GET `?rates=1`, radios with "Customer paid", "Buy this
  label" posts `rateObjectId`); `print_and_ship` "Label bought" (service ·
  price, tracking, insured value), 1 "Print label" (QZ Tray to the D520, else
  the share sheet for Labelife, else the PDF opens: `useLabelPrint` in
  `components/admin/labelife-print-button.tsx`, the order page's path), 2
  "Mark shipped" with the question "Mark this bag shipped? The customer will
  be emailed the tracking number (<email>)." and "Yes, mark shipped";
  `shipped` / `delivered` the tracking and its link, nothing to press;
  `blocked` the API's sentence and where to fix it (ship check, the bag,
  the order, the order's label); `wait` the API's sentence and "Try again"
  (GET again; once the claim is over 2 minutes old, or a POST answered
  `staleClaim`, a warning about a second label first, then POST
  `{ retryStaleClaim: true }`); with `unsavedLabel` (bought, not kept) "Label
  bought, not saved yet", its link and "Save this label" (POST `{}`, buys
  nothing). The GET's `notice` shows above the step. Every API error is shown
  as worded; a label bought but not saved (`unsaved`) shows its link. One request at a time: a
  tap while one runs does nothing (the buttons wait).
- **Code**: `app/admin/receiving/pack/[code]/` (`page.tsx`, `_lib/load.ts`
  server: `loadPacking` plus photos, ship-to, paid service;
  `_components/pack-board.tsx`), words in `lib/intake/packing-view.ts`
  (pure; tests `tests/intake/packing-view.test.ts`, e2e `pack-*`).
- **Elsewhere**: the ship queue's restoration tab lists each bag that is
  finished (or has a label bought and not shipped, or whose order is
  Completed) with "Pack and ship this bag →" (`loadShipQueueBags` in
  `lib/intake/shipping/ship-queue.ts`; orders without bags as before); the admin order page's Shipping card lists
  "Packages (N, one label per bag)" once a bag label exists
  (`components/intake/bag-packages.tsx`); the Scan page's bag view offers
  "Pack and ship" for a finished bag; the scan landing's finished-bag step
  has "Pack and ship this bag" (and "Shipped · <tracking>" once it went);
  the Bags board's Ready to ship section links "Pack and ship" per bag and
  leaves out shipped bags (`loadBagShipStates` in
  `lib/intake/shipping/bag-states.ts`, both).

## Tests

`node scripts/test-intake.mjs [filter]` bundles `tests/intake/*.test.ts` with
esbuild (the `@/` alias resolved, `server-only` stubbed) and runs them with
node:test; no Next.js and no database. `services.test.ts` runs the services
end to end against the in-memory Supabase + Resend stand-in
(`tests/intake/harness/mock-supabase.mjs`, loaded at run time); the runner
picks its port and sets `RESEND_BASE_URL` / `RESEND_API_KEY` for it.
