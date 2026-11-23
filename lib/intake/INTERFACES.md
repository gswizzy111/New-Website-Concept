# lib/intake: interfaces for the Receiving section

Foundation of the receiving / tier bag / QR / 8-step tracking system. Read this
before building on it. Code is the source of truth; every export has a short
doc comment.

## Ground rules

- **Server vs client.** Pure modules (safe in client components and tests):
  `types.ts`, `codes.ts`, `business-days.ts`, `stage-plan.ts`,
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
- `cards` new columns: card_seq, card_code (unique), bag_id (set null when the
  bag is deleted), received_at, received_by, awaiting_arrival (default false),
  receiving_photo_urls (default `{}`). Unique (order_id, card_seq).
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
  doneStages, remainingStages, `next: NextStep | null`, updatedAt,
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
| `normalizeCode(raw): string` | upper case, strips spaces/`#`, takes the code from a pasted `/q/...` link; `""` if not a code |
| `codeKind(code): "card" \| "bag" \| null` | shape only |
| `qrPath(code): string` | `/q/CD-2549-03` |
| `qrUrl(code): string` | QR content, ALL upper case: `HTTPS://THECARDDOC1.COM/Q/CD-2549-03` (uses `siteUrl()`) |
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

- `NOT_STARTED_LABEL`, `DONE_LABEL`, `stageIndex(stage)`, `nextStepAfter(stage | null): NextStep`.
- `cardStageState(card, events): CardStageState`: `card` = { id, completed, completed_at?, current_round?, received_at?, received_by? }; `events` = the order's order_events NEWEST FIRST (stage_update and round_started rows are used). Current stage uses the existing `currentStages()`.
- `planAdvance({ cards: AdvanceCard[], cardIds, fromStage, toStage? }): { ok, plan: AdvancePlan } | refusal`; `AdvanceCard` = { id, current, completed, refunded, awaiting, round }; `SkipReason` = `different_stage | done | refunded | awaiting_arrival | not_on_order`.
- `isBagComplete(cards)`, `bagCompletionPatch(bag, cards, now)`, `stageGroups(cards)`.
- `advanceCards(admin, { orderId, cardIds, fromStage, toStage?, by }): AdvanceResult`
  - Moves only the chosen cards whose current step equals `fromStage` (null = not started) to the next step, or `toStage` (a stage name, or `"complete"`). From Final Dry the next step marks the card done (`completed = true`, like the Done toggle).
  - Writes exactly what the stage buttons write: `order_events` `stage_update`, description `Stage: <stage> [card:<id>]`, metadata `{ card_id, stage, round, by, bulk }`, customer visible.
  - ok: `{ target, moved: { cardId, stage, round }[], completed: cardId[], skipped: { cardId, reason, current }[], emailed, bagsCompleted: bagId[] }`. One customer email per call listing every moved card (no email for "done", as before). Show `skipped` to staff ("2 cards were at another step and were left alone").
- `refreshBagCompletion(admin, bagIds): { completed: bagId[], reopened: bagId[] }`: never throws. Sets `completed_at` once every non-refunded card is done (keeps the earliest), clears it and `completion_seen_at` when a card reopens. Call it after anything that changes `cards.completed` or `bag_id`.
- `refreshBagCompletionForCard(cardId, admin?)`: hook used by the existing `cards/[id]/complete` and `cards/[id]/round` routes.

## views.ts (pure) and data.ts (server)

- `loadOrderIntake(admin, orderId, { heal? = true }): IntakeResult<{ intake: OrderIntake }>`
- `loadBag(admin, bagId): IntakeResult<{ bag: BagSummary; order: IntakeOrder; cards: IntakeCard[]; dueChanges: TierBagDueChange[] }>` (cards: non-refunded first, by card number; dueChanges newest first)
- `loadCard(admin, cardId): IntakeResult<{ card: IntakeCard; order: IntakeOrder; bag: BagSummary | null }>`
- `resolveCode(admin, raw): { kind: "card" | "bag"; id; code } | null`
- `loadTierNames(admin)`, `CARD_COLUMNS`, `ORDER_COLUMNS`, `INTAKE_EVENT_TYPES`.
- Loaders also heal bag completion (cards ticked done on the old site or by the ship trigger). Card IDs are NOT assigned on load: cards without one show `code: null` until `receiveCards` / `ensureCardCodes`.
- Pure builders: `buildOrderIntake({ order, cards, bags, events, tierNames })`, `orderView`, `cardView`, `bagView`, `receivingStatus`, `completionStatus`, `historicalReceivedOn`, `byCardNumber`, `byBagOrder`, `RECEIVED_EVENT_TEXT`.

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
| `PATCH /api/admin/cards/[id]/tier` | `{ tier }` | set a card's tier (use for `needsTier`) |
| `POST /api/admin/orders/[id]/cards` | see route | add a card to an order (inserted with awaiting_arrival false) |

The new `/api/admin/intake/*` routes, `/q/[code]` and the label routes are
owned by the UI agents and documented in their own files.
