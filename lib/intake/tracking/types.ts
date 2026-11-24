/**
 * Scan-anywhere card tracking: places (locations), card moves, the Scan
 * page's lookups and ship checks. Pure types (safe in client components and
 * tests). Server code: lib/intake/tracking/*.ts; routes: app/api/admin/track/**.
 *
 * Stage values: `stage` fields hold the STORED stage name
 * (lib/restoration-stages.ts STAGES, e.g. "Book"); `stageLabel` is what staff
 * read ("Drying", "Not started", "Done"). In card_moves, stage_before /
 * stage_after hold a stored stage name, "done" for a finished card, or null
 * for a card not started.
 */
import type { CodeKind } from "@/lib/intake/codes";

/** What a place is: a work station (one per step), a due-date shelf slot, the Done shelf, Shipping, anything else. */
export type LocationKind = "station" | "shelf" | "done" | "shipping" | "other";
export const LOCATION_KINDS: readonly LocationKind[] = ["station", "shelf", "done", "shipping", "other"];

/** Why a card_moves row was written. */
export type MoveAction = "move" | "receive" | "ship_check" | "done";

/** A `locations` row as stored. */
export type LocationRow = {
  id: string;
  code: string;               // LOC-HUMIDOR, LOC-SHELF-20261207 (unique, never changes: signs are printed)
  name: string;               // "Humidor", "DUE MON DEC 7"
  kind: LocationKind;
  stage: string | null;       // a STAGES name for a station, else null
  due_date: string | null;    // "YYYY-MM-DD" for a shelf slot
  sort: number;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

/** A `card_moves` row as stored (insert-only). */
export type CardMoveRow = {
  id: string;
  card_id: string;
  order_id: string | null;
  bag_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  stage_before: string | null;
  stage_after: string | null;
  action: MoveAction;
  by: string | null;
  session_id: string | null;
  created_at: string;
};

/** A place in short (where a card or bag is). */
export type LocationRef = { id: string; code: string; name: string; kind: LocationKind };

/** A place as the pages show it. */
export type TrackLocation = {
  id: string;
  code: string;
  name: string;
  kind: LocationKind;
  stage: string | null;
  /** "Drying" for the stored "Book"; null when not a station. */
  stageLabel: string | null;
  dueDate: string | null;
  sort: number;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  /** What the place's sign QR encodes: qrUrl(code), "HTTPS://THECARDDOC1.COM/Q/LOC-HUMIDOR". */
  qrUrl: string;
};

/** A place with how many cards are there now (GET /api/admin/track/locations). */
export type TrackLocationWithCount = TrackLocation & { cardCount: number };

/** One card as the Scan page shows it (FIND, results). */
export type TrackCardSummary = {
  id: string;
  code: string | null;             // Card ID, CD-2549-03
  name: string | null;
  set: string | null;
  year: string | null;
  number: string | null;
  tier: string | null;             // effective tier key
  tierName: string;
  customer: string | null;
  orderNumber: string;
  orderId: string;
  bagId: string | null;
  bagCode: string | null;
  dueDate: string | null;          // the bag's due date
  stage: string | null;            // stored stage name this round (null = not started or done)
  stageLabel: string;              // "Not started", "Humidor", "Drying", "Done"
  round: number;
  done: boolean;
  refunded: boolean;
  awaiting: boolean;               // flagged awaiting arrival
  received: boolean;               // arrived through Receiving (received_at or a bag) and not awaiting
  location: LocationRef | null;
  locatedAt: string | null;
  photoUrl: string | null;         // first receiving photo, else customer photo, else catalog image
  photosUrl: string;               // /admin/receiving/<orderId>/photos[?bag=<bagId>]
  cardUrl: string;                 // /admin/receiving/card/<cardId>
};

/** One tier bag as the Scan page shows it. */
export type TrackBagSummary = {
  id: string;
  code: string;                    // Bag ID, CD-2549-P
  tier: string;
  tierName: string;
  orderId: string;
  orderNumber: string;
  customer: string | null;
  dueDate: string | null;
  cardCount: number;               // non-refunded cards
  doneCount: number;
  complete: boolean;
  location: LocationRef | null;
  locatedAt: string | null;
  photosUrl: string;
  cards: TrackCardSummary[];       // every card in the bag (refunded last), by card number
};

/** One order as the Scan page shows it. */
export type TrackOrderSummary = {
  id: string;
  orderNumber: string;
  customer: string | null;
  status: string;
  bags: TrackBagSummary[];         // fastest tier first, then batch
  /** Cards in no bag (not received yet, or awaiting arrival). */
  looseCards: TrackCardSummary[];
  photosUrl: string;
};

/** One place as the Scan page shows it, with what's there. */
export type TrackLocationSummary = TrackLocation & {
  cardCount: number;
  /** Bags whose location is this place. */
  bagCount: number;
  /** The cards there (at most 200, most recently placed first). */
  cards: TrackCardSummary[];
};

/** GET /api/admin/track/resolve?code= (200). 400 { error } not a code, 404 { error } nothing has it. */
export type ResolveResponse =
  | { kind: "card"; code: string; card: TrackCardSummary }
  | { kind: "bag"; code: string; bag: TrackBagSummary }
  | { kind: "order"; code: string; order: TrackOrderSummary }
  | { kind: "location"; code: string; location: TrackLocationSummary };

/** POST /api/admin/track/move body. */
export type MoveRequest = {
  /** The place: LOC-HUMIDOR, or its scanned QR link. */
  locationCode: string;
  /** Card IDs, Bag IDs and order codes (or their QR links), 1 to 200. */
  codes: string[];
  /** The Scan page's session (a uuid), stored on each move. */
  sessionId?: string;
};

/** One scanned code's outcome. */
export type MoveResultItem = {
  /** The code as normalized (or as sent when it isn't one). */
  code: string;
  ok: boolean;
  kind: CodeKind | null;
  /** Cards whose place or step changed. */
  moved: number;
  /** Cards that were already there at that step (nothing written). */
  unchanged: number;
  /** The step the cards are at now when this move set it (stored name). */
  stage?: string;
  stageLabel?: string;
  /** One or two short sentences for staff ("3 cards moved to Humidor. Step: Humidor."). */
  message: string;
  /** Cards of this code the move covered (moved or unchanged). */
  cardIds: string[];
};

/** POST /api/admin/track/move (200). 400/404 { error } for a bad or unknown place. */
export type MoveResponse = {
  location: LocationRef;
  results: MoveResultItem[];
  /** Orders whose customer got the (one) step email. */
  emailedOrders: string[];
  /** Bags that became complete (LOC-DONE). */
  bagsCompleted: string[];
};

/** One move as history shows it (newest first). */
export type TrackMove = {
  id: string;
  at: string;
  by: string | null;
  action: MoveAction;
  cardId: string;
  cardCode: string | null;
  cardName: string | null;
  bagId: string | null;
  from: LocationRef | null;
  to: LocationRef | null;
  stageBefore: string | null;
  stageAfter: string | null;
  stageBeforeLabel: string | null;  // "Not started" for null, "Done" for "done"
  stageAfterLabel: string | null;
};

/** GET /api/admin/track/history?code= (card, bag, order or place code; last 50 moves). */
export type HistoryResponse = { kind: CodeKind; code: string; moves: TrackMove[] };

export type ShipCheckStatus = "ok" | "not_done" | "not_here" | "refunded";

export type ShipCheckCard = {
  id: string;
  code: string | null;
  name: string | null;
  bagId: string | null;
  bagCode: string | null;
  done: boolean;
  location: LocationRef | null;
  /** When it was last placed anywhere (located_at). */
  lastSeen: string | null;
  /** refunded > not_done > not_here (last place isn't a Shipping place) > ok. */
  status: ShipCheckStatus;
};

/** GET /api/admin/track/ship-check?code=<bag|order code> (a Card ID checks its bag). */
export type ShipCheckResponse = {
  scope: "order" | "bag";
  order: { id: string; orderNumber: string; customer: string | null; status: string };
  bags: { id: string; code: string; tier: string; tierName: string; cardCount: number; doneCount: number; location: LocationRef | null; ok: boolean }[];
  cards: ShipCheckCard[];
  counts: { ok: number; notDone: number; notHere: number; refunded: number };
  /** Every non-refunded card is done and at Shipping (and there is at least one). */
  ready: boolean;
};

/** GET /api/admin/track/locations (?all=1 includes inactive places). */
export type LocationsResponse = { locations: TrackLocationWithCount[] };

/** POST /api/admin/track/locations. A station needs `stage`; a shelf needs `dueDate` (the slot is ensured, not duplicated). */
export type CreateLocationRequest = { name: string; kind: LocationKind; stage?: string | null; dueDate?: string | null };

/** PATCH /api/admin/track/locations. The code never changes. */
export type UpdateLocationRequest = { id: string; name?: string; active?: boolean; sort?: number };

/** POST / PATCH /api/admin/track/locations (200/201). */
export type LocationResponse = { location: TrackLocation };
