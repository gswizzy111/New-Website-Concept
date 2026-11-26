/**
 * Scan-anywhere card tracking with serial-numbered SLOTS (owner's model, Nov
 * 24 2026): cards carry no sticker and are never scanned. Every physical
 * holder (each clamp, each heat press spot, each humidor spot ...) is a slot
 * with a QR label: CLAMP 07 = LOC-CLAMP-07. Staff scan a slot, then pick the
 * card(s) (from a bag QR or a search) to put in it; scanning a full slot
 * shows its card(s) to move on, finish (Done) or take out. Bags wait on
 * due-date shelf slots (LOC-SHELF-YYYYMMDD) until a card comes out, then in
 * the Open bags box (LOC-OPEN-BAGS, A-Z by last name); a finished bag goes in
 * the Ready to ship bin (LOC-SHIP). A done card goes back in its bag (no
 * place). LOC-DONE is still a place for anyone scanning cards to it.
 *
 * Pure types (safe in client components and tests). Server code:
 * lib/intake/tracking/*.ts; routes: app/api/admin/track/**.
 *
 * Stage values: `stage` fields hold the STORED stage name
 * (lib/restoration-stages.ts STAGES, e.g. "Book"); `stageLabel` is what staff
 * read ("Drying", "Not started", "Done"). In card_moves, stage_before /
 * stage_after hold a stored stage name, "done" for a finished card, or null
 * for a card not started.
 */
import type { CodeKind } from "@/lib/intake/codes";
import type { OrderAutoComplete } from "@/lib/intake/order-autocomplete";

/** What a place is: a slot of a work station, a due-date shelf slot, the Done place, Shipping, anything else. */
export type LocationKind = "station" | "shelf" | "done" | "shipping" | "other";
export const LOCATION_KINDS: readonly LocationKind[] = ["station", "shelf", "done", "shipping", "other"];

/** Why a card_moves row was written. */
export type MoveAction = "assign" | "move" | "release" | "done" | "receive" | "ship_check";

/**
 * A kind of work station whose slots are numbered: "clamp" -> CLAMP 01..N.
 * The list is STATION_TYPES in lib/intake/tracking/stations.ts.
 */
export type StationType = {
  key: string;                    // "clamp", "heat-press" (slot codes LOC-CLAMP-07, LOC-HEAT-PRESS-03)
  name: string;                   // "Clamp", "Heat Press" (slot names "CLAMP 07")
  stage: string;                  // the STAGES step a card gets in one of its slots
  defaultCapacity: number | null; // cards per slot (null = no limit)
};

/** A `locations` row as stored. */
export type LocationRow = {
  id: string;
  code: string;               // LOC-CLAMP-07, LOC-SHELF-20261207, LOC-DONE (unique, never changes: labels are printed)
  name: string;               // "CLAMP 07", "DUE MON DEC 7", "Done"
  kind: LocationKind;
  station: string | null;     // station type key for a slot ("clamp")
  serial: number | null;      // the slot's number (7)
  capacity: number | null;    // cards it holds (null = no limit)
  stage: string | null;       // a STAGES name for a slot, else null
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
export type LocationRef = {
  id: string;
  code: string;
  name: string;                // "CLAMP 07"
  kind: LocationKind;
  station: string | null;
  serial: number | null;
  stage: string | null;
};

/** A place as the pages show it. */
export type TrackLocation = {
  id: string;
  code: string;
  name: string;
  kind: LocationKind;
  station: string | null;
  /** "Clamp" (the station type's name); null when not a slot. */
  stationName: string | null;
  serial: number | null;
  capacity: number | null;
  stage: string | null;
  /** "Drying" for the stored "Book"; null when not a slot. */
  stageLabel: string | null;
  dueDate: string | null;
  sort: number;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  /** What the place's QR label encodes: qrUrl(code), "HTTPS://THECARDDOC1.COM/Q/LOC-CLAMP-07". */
  qrUrl: string;
};

/** A place with what's in it now (GET /api/admin/track/locations). */
export type TrackLocationWithCount = TrackLocation & {
  cardCount: number;
  /** Bags whose location is this place (shelf slots). */
  bagCount: number;
  /** Room for another card (capacity null = always). */
  free: boolean;
};

/** One card as the Scan page shows it. */
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
  /** The slot or place the card is in now (null = not in a slot: in its bag). */
  location: LocationRef | null;
  locatedAt: string | null;
  /** Where the card's bag is (Open bags box, its due-date shelf, Ready to ship); null when not recorded. */
  bagLocation?: LocationRef | null;
  photoUrl: string | null;         // first receiving photo, else customer photo, else catalog image
  /**
   * The card's photos as the Scan page shows them under each card: its
   * receiving photos, then the customer's (web addresses only, at most
   * MAX_CARD_PHOTOS); the card catalog's picture ("reference") only when it
   * has neither. Empty: no photo yet. Optional: answers from before it was
   * added have none (lib/intake/tracking/summaries.ts cardPhotos).
   */
  photos?: TrackCardPhoto[];
  photosUrl: string;               // /admin/receiving/<orderId>/photos[?bag=<bagId>]
  cardUrl: string;                 // /admin/receiving/card/<cardId>
};

/** An image address, with resized copies when there are some (lib/thumbnail.ts productImage). */
export type TrackImage = { src: string; srcSet?: string };

/** One of a card's photos, image addresses made on the server (lib/thumbnail.ts reads a server-only setting). */
export type TrackCardPhoto = {
  /** The photo as stored (the viewer's "Original" link). */
  url: string;
  /** receiving: taken at Receiving; customer: the customer's own; reference: the catalog's picture, not the customer's card. */
  kind: "receiving" | "customer" | "reference";
  /** The thumbnail under the card (a small resized copy on Netlify, the original elsewhere). */
  tile: TrackImage;
  /** The full-screen viewer's image. */
  full: TrackImage;
};

/** One tier bag with its cards and their slots. */
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
  /** Where the bag itself is (a due-date shelf slot), if recorded. */
  location: LocationRef | null;
  locatedAt: string | null;
  photosUrl: string;
  cards: TrackCardSummary[];       // every card in the bag (refunded last), by card number
};

/** One order with its bags and cards. */
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

/** A scanned slot or place with what's in it. */
export type TrackSlotSummary = TrackLocation & {
  cardCount: number;
  free: boolean;
  overCapacity: boolean;
  /** The cards in it (at most 200, most recently placed first). */
  cards: TrackCardSummary[];
  /** Bags placed here (shelf slots), without their cards. */
  bags: Omit<TrackBagSummary, "cards">[];
  /**
   * The switched-on desks (LOC-DESK first, then by sort and name), for the
   * Scan page's "Move to my desk" (holder view). Empty: there is no desk
   * yet. Optional: answers from before it was added, and a failed desk read
   * (the place still shows), have none (lib/intake/tracking/desk.ts
   * loadDeskRefs).
   */
  desks?: TrackDeskRef[];
};

/** A desk cards can go to ("Move to my desk"): LOC-DESK, LOC-DESK-GAVIN. */
export type TrackDeskRef = { id: string; code: string; name: string };

/**
 * GET /api/admin/track/resolve?code= (200): a slot/place -> the slot and its
 * cards; a bag or order -> its cards with their slots; a Card ID (typed) ->
 * the card. 400 { error } not a code, 404 { error } nothing has it.
 */
export type ResolveResponse =
  | { kind: "location"; code: string; location: TrackSlotSummary }
  | { kind: "bag"; code: string; bag: TrackBagSummary }
  | { kind: "order"; code: string; order: TrackOrderSummary }
  | { kind: "card"; code: string; card: TrackCardSummary };

/** GET /api/admin/track/search?q= (2+ characters): cards by Card ID, card name, customer or order number. */
export type SearchResponse = { query: string; cards: TrackCardSummary[]; truncated: boolean };

/** POST /api/admin/track/assign: put cards in a slot (or any place). */
export type AssignRequest = {
  locationCode: string;            // LOC-CLAMP-07 or its scanned QR link
  cardIds: string[];               // 1 to 200 card ids
  /** Add even when the slot is full ("add anyway"). */
  force?: boolean;
  sessionId?: string;
};

/** POST /api/admin/track/move: move the cards in one slot to another. */
export type MoveRequest = {
  fromCode: string;                // the full slot that was scanned
  toCode: string;                  // the slot they go to
  /** Only these cards (they must be in the from-slot); default every card in it. */
  cardIds?: string[];
  force?: boolean;
  sessionId?: string;
};

/** POST /api/admin/track/release: take cards out of their slot (no place). */
export type ReleaseRequest = { cardIds: string[]; sessionId?: string };

/** POST /api/admin/track/done: mark cards done; they leave their slot and go back in their bag (no place). */
export type DoneRequest = { cardIds: string[]; sessionId?: string };

/** One card's outcome. */
export type TrackCardResult = {
  cardId: string;
  code: string | null;
  name: string | null;
  ok: boolean;
  /** Its place or step changed (false: already there, or refused). */
  changed: boolean;
  /** Its step now, when it is at the slot's step (stored name). */
  stage?: string;
  stageLabel?: string;
  /** A short sentence for staff ("In CLAMP 07. Step: Clamp Work."). */
  message: string;
};

/** assign / move / release / done (200). */
export type TrackActionResponse = {
  /** Where the cards went (null for release). */
  location: LocationRef | null;
  results: TrackCardResult[];
  /** One line for the whole request ("2 cards in CLAMP 07. Step: Clamp Work."). */
  message: string;
  /** Cards whose place or step changed. */
  changed: number;
  /** Orders whose customer got the (one) step email. */
  emailedOrders: string[];
  /** Bags that became complete (done). */
  bagsCompleted: string[];
  /** Slots that are empty now because of this request. */
  freed: LocationRef[];
  /**
   * Cards were marked done: the order auto-complete check for each of their
   * orders (lib/intake/order-autocomplete.ts). `completed` = this request
   * made the order Completed and `emailed` = the customer got the usual
   * email; show `message` when set.
   */
  orderCompletions?: OrderAutoComplete[];
  /**
   * The bags of the cards this request changed, and where each is now
   * (lib/intake/tracking/bag-home.ts words them; `message` already ends
   * with those words: "Put it back in REYES's bag: Open bags box, under R.").
   */
  bags?: TrackBagPlace[];
};

/** A bag a request touched, and where it is now. */
export type TrackBagPlace = {
  id: string;
  /** Bag ID, CD-2549-P. */
  code: string;
  customer: string | null;
  /** The Open bags box divider: the customer's last name's first letter ("R"), "#" without one (lib/intake/filing-letter.ts). */
  letter: string;
  /** Where the bag is now (null: not recorded). */
  location: LocationRef | null;
  /** This request filed the bag in the Open bags box: a card of it came out to a desk or holder. */
  opened: boolean;
  /** Cards of this bag that this request marked done or put back in it. */
  returned: number;
  /** Every non-refunded card of the bag is done and back in it (none left in a holder, on a desk or the Done shelf). */
  finished: boolean;
  doneCount: number;
  /** Non-refunded cards. */
  cardCount: number;
  /** The bag's tier as staff call it ("Platinum"): one customer's bags are told apart by it and the Bag ID. */
  tierName?: string;
  /** Card IDs of the cards this request put back in it ("CD-2549-07"), when known. */
  returnedCodes?: string[];
};

/** POST /api/admin/track/bag-ready { bagId }: the finished bag is in the Ready to ship bin (LOC-SHIP). */
export type BagReadyResponse = { bag: TrackBagPlace; changed: boolean; message: string };

/** assign / move 409 when the slot would hold more than its capacity (send again with force: true to add anyway). */
export type CapacityConflict = {
  error: string;
  overCapacity: true;
  capacity: number;
  /** What's in the slot now. */
  occupants: TrackCardSummary[];
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

/** GET /api/admin/track/history?code= (bag, order, slot or Card ID; last 50 moves). */
export type HistoryResponse = { kind: CodeKind; code: string; moves: TrackMove[] };

/** refunded > not_done > in_slot (still in a work-station slot) > ok. */
export type ShipCheckStatus = "ok" | "not_done" | "in_slot" | "refunded";

export type ShipCheckCard = {
  id: string;
  code: string | null;
  name: string | null;
  bagId: string | null;
  bagCode: string | null;
  done: boolean;
  /** Where it is (a slot: "still in CLAMP 07"; LOC-DONE, Shipping, a shelf or nowhere are fine). */
  location: LocationRef | null;
  /** When it was last placed anywhere (located_at). */
  lastSeen: string | null;
  status: ShipCheckStatus;
};

/** GET /api/admin/track/ship-check?code=<bag|order code> (a Card ID checks its bag). */
export type ShipCheckResponse = {
  scope: "order" | "bag";
  order: { id: string; orderNumber: string; customer: string | null; status: string };
  bags: { id: string; code: string; tier: string; tierName: string; cardCount: number; doneCount: number; location: LocationRef | null; ok: boolean }[];
  cards: ShipCheckCard[];
  counts: { ok: number; notDone: number; inSlot: number; refunded: number };
  /** Every non-refunded card is done and out of the slots (and there is at least one). */
  ready: boolean;
};

/** GET /api/admin/track/locations (?all=1 includes switched-off places; ?station=clamp only that type's slots). */
export type LocationsResponse = { locations: TrackLocationWithCount[]; stations: StationType[] };

/**
 * POST /api/admin/track/locations, either:
 *   { station, count, startAt? }  numbered slots: CLAMP 01..N (startAt default: after the highest number in use)
 *   { name, kind, dueDate? }      one other place (kind 'shelf' needs dueDate: that day's slot)
 */
export type CreateSlotsRequest = { station: string; count: number; startAt?: number };
export type CreateLocationRequest = { name: string; kind: Exclude<LocationKind, "station">; dueDate?: string | null };
/** 201 for slots: the slots made, and the codes that already existed (left as they are). */
export type CreateSlotsResponse = { created: TrackLocation[]; skipped: string[] };

/** PATCH /api/admin/track/locations. The code and number never change. */
export type UpdateLocationRequest = { id: string; name?: string; active?: boolean; capacity?: number | null; sort?: number };

/** POST (one place) / PATCH /api/admin/track/locations (200/201). */
export type LocationResponse = { location: TrackLocation };
