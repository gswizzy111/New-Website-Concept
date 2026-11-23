/**
 * Shared types of the receiving / tier bag / QR / stage tracking system
 * (lib/intake, admin Receiving section). Database rows use the column names;
 * the view models the pages render use camelCase. See lib/intake/INTERFACES.md.
 */

/** How a bag's due date was set (tier_bags.due_status). */
export type DueStatus = "calculated" | "manual" | "needs_review" | "missing_received_date" | "pending";

/** Where a bag came from: receiving, or the Historical Order Setup. */
export type BagSource = "receiving" | "migration";

/** Which of an order's (non-refunded) cards have physically arrived. */
export type ReceivingStatus = "not received" | "partially received" | "received";

/**
 * How far an order's (non-refunded) cards are: none done, some done (e.g. the
 * Gold bag finished, Silver still going), every card done. Computed, never
 * stored; the order's own status is never changed by bags.
 */
export type CompletionStatus = "in progress" | "partially completed" | "all cards done";

/** A tier_bags row as stored. */
export type TierBagRow = {
  id: string;
  order_id: string;
  tier: string;
  batch: number;
  bag_code: string;
  received_on: string | null;      // YYYY-MM-DD, New York day
  due_date: string | null;         // YYYY-MM-DD
  due_status: DueStatus;
  turnaround_days: number | null;  // snapshot of the tier's max turnaround
  due_note: string | null;
  completed_at: string | null;
  completion_seen_at: string | null;
  label_printed_at: string | null;
  source: BagSource;
  created_at: string;
  created_by: string | null;
};

/** A tier_bag_due_changes row (insert-only log of manual due date changes). */
export type TierBagDueChange = {
  id: string;
  bag_id: string;
  old_due: string | null;
  new_due: string | null;
  reason: string;
  changed_by: string | null;
  created_at: string;
};

/** The cards columns lib/intake reads (CARD_COLUMNS in lib/intake/data.ts). */
export type IntakeCardRow = {
  id: string;
  order_id: string;
  card_name: string | null;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  variation: string | null;
  notes: string | null;
  photo_urls: string[] | null;            // the customer's photos (never overwritten here)
  catalog_image_url: string | null;       // reference image from the card catalog
  tier: string | null;
  status: string | null;                  // active, on_hold_high_value, in_progress, refunded
  completed: boolean | null;
  completed_at: string | null;
  current_round: number | null;
  created_at: string | null;
  card_seq: number | null;
  card_code: string | null;
  bag_id: string | null;
  received_at: string | null;
  received_by: string | null;
  awaiting_arrival: boolean | null;
  receiving_photo_urls: string[] | null;  // photos taken at receiving, kept apart from photo_urls
};

/** The orders columns lib/intake reads (ORDER_COLUMNS in lib/intake/data.ts). */
export type IntakeOrderRow = {
  id: string;
  order_number: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  status: string;
  payment_status: string | null;
  restoration_tier: string | null;
  inbound_method: string | null;
  customer_notes: string | null;
  created_at: string;
};

/** An order_events row as the stage logic reads it (newest first where noted). */
export type StageEventRow = {
  event_type: string;
  description: string | null;
  metadata: unknown;
  created_at: string;
};

/** One line of a card's history, oldest first. */
export type StageHistoryEntry = {
  kind: "received" | "stage" | "round_started" | "completed";
  at: string;              // ISO timestamp
  by: string | null;       // admin username when recorded (stage events before Nov 2026 have none)
  round: number;
  stage: string | null;    // stored stage name for kind "stage"
  label: string;           // what to show: "Humidor", "Drying", "Round 2 started", "Received", "Done"
  bulk: boolean;           // moved together with other cards of the bag
};

/** What the next one-tap step does for a card. */
export type NextStep =
  | { kind: "stage"; stage: string; label: string }
  | { kind: "complete"; label: string };

/** Where a card is in the 8 steps (STAGES in lib/restoration-stages.ts), this round. */
export type CardStageState = {
  round: number;
  completed: boolean;
  /** Index in STAGES of the current stage; -1 = not started this round; STAGES.length = done. */
  currentIndex: number;
  /** Stored stage name ("Book"); null when not started or done. */
  current: string | null;
  /** Admin label: "Not started", "Drying", "Done". */
  currentLabel: string;
  /** Steps before the current one (all 8 when done). */
  doneStages: string[];
  /** Steps after the current one (all 8 when not started, none when done). */
  remainingStages: string[];
  /** The next step, or null when done. */
  next: NextStep | null;
  /** Time of the latest stage event of this round (or completion), if any. */
  updatedAt: string | null;
  /** Every recorded step of every round, plus received / round / done lines, oldest first. */
  history: StageHistoryEntry[];
};

/** Problems the receiving and Historical Order Setup pages flag on a card. */
export type CardFlags = {
  /** No customer photo and no receiving photo. */
  missingImage: boolean;
  /** Neither the card nor the order has a tier. */
  missingTier: boolean;
  /** In the building (or in a bag) but no received date is known. */
  missingReceivedDate: boolean;
};

/** A card as the receiving pages show it. */
export type IntakeCard = {
  id: string;
  orderId: string;
  seq: number | null;              // number within the order (1, 2, 3...)
  code: string | null;             // Card ID, e.g. CD-2549-03 (null until codes are assigned)
  qrUrl: string | null;            // what the card's QR encodes (upper case)
  name: string;
  set: string | null;
  year: string | null;
  number: string | null;
  variation: string | null;
  notes: string | null;
  tier: string | null;             // effective tier: cards.tier ?? orders.restoration_tier ('prep_standard' -> 'prep')
  tierName: string;                // "Gold", "Prep", "No tier"
  tierSource: "card" | "order" | null;
  status: string;
  refunded: boolean;
  customerPhotos: string[];        // cards.photo_urls
  catalogImageUrl: string | null;
  receivingPhotos: string[];       // cards.receiving_photo_urls
  receivedAt: string | null;
  receivedBy: string | null;
  receivedOn: string | null;       // bag's received_on, else the NY day of receivedAt
  awaitingArrival: boolean;
  bagId: string | null;
  bagCode: string | null;
  completed: boolean;
  completedAt: string | null;
  stage: CardStageState;
  flags: CardFlags;
};

/** One card line on a bag label (and the bag page list). */
export type BagLabelCard = {
  id: string;
  seq: number | null;
  code: string | null;
  qrUrl: string | null;
  name: string;
  set: string | null;
  number: string | null;
};

/** Cards of a bag that are at the same step, for bulk moves. */
export type BagStageGroup = {
  /** "done", "not_started" or the stored stage name. */
  key: string;
  /** Stored stage name, or null for not started / done. */
  stage: string | null;
  completed: boolean;
  label: string;           // "Not started", "Humidor", "Drying", "Done"
  cardIds: string[];
};

/** A bag with everything its page, the order workspace and the label panel need. */
export type BagSummary = {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  tier: string;
  tierName: string;
  tierLetter: string;
  batch: number;
  code: string;                    // Bag ID, e.g. CD-2549-P or CD-2549-P2
  qrUrl: string;
  receivedOn: string | null;
  dueDate: string | null;
  dueStatus: DueStatus;
  turnaroundDays: number | null;
  dueNote: string | null;
  completedAt: string | null;      // stored; follows `complete`
  completionSeenAt: string | null;
  labelPrintedAt: string | null;
  source: BagSource;
  createdAt: string;
  createdBy: string | null;
  /** Non-refunded cards in the bag. */
  cardCount: number;
  completedCount: number;
  /** Computed from the cards now: every non-refunded card is done (and there is at least one). */
  complete: boolean;
  /** The bag's unfinished cards are at different steps. */
  stagesDiffer: boolean;
  /** Cards grouped by step, in step order (not started first, done last). */
  stageGroups: BagStageGroup[];
  /** Non-refunded cards, by card number. */
  cards: BagLabelCard[];
};

/** The order header the receiving pages show. */
export type IntakeOrder = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
  statusLabel: string;
  paymentStatus: string | null;
  restorationTier: string | null;
  tierName: string;
  inboundMethod: string | null;
  isDropoff: boolean;
  customerNotes: string | null;
  createdAt: string;
  /**
   * The real historical received day (NY), for orders received before this
   * system: the first 'Status updated to: Cards Received' event, else the
   * drop-off order's creation day; null when unknown (never invented).
   */
  historicalReceivedOn: string | null;
};

export type OrderIntakeCounts = {
  total: number;           // non-refunded cards
  received: number;        // non-refunded cards with received_at
  awaiting: number;        // flagged awaiting_arrival
  notReceived: number;     // total - received
  completed: number;
  refunded: number;
  missingImage: number;
  missingTier: number;
  missingReceivedDate: number;
};

/** Everything the order receiving workspace shows. */
export type OrderIntake = {
  order: IntakeOrder;
  cards: IntakeCard[];     // by card number, then created order; refunded included (refunded: true)
  bags: BagSummary[];      // by tier letter then batch
  receiving: ReceivingStatus;
  completion: CompletionStatus;
  counts: OrderIntakeCounts;
};

/** Result shape shared by the intake services (never throws for expected problems). */
export type IntakeResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
