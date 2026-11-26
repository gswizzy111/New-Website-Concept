import { isDay, nyToday } from "@/lib/intake/business-days";
import { filingLetter } from "@/lib/intake/filing-letter";
import { bagPlaceText, isBackInBag, putBackSentence } from "@/lib/intake/tracking/bag-home";
import { isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type { CapacityConflict, LocationRef, TrackActionResponse, TrackCardSummary } from "@/lib/intake/tracking/types";

/**
 * Every word the plain Scan page says (owner, Nov 26 2026: "I want the page
 * to be pretty plain and then when I scan on someones order or a spot that
 * corresponds with an order then there card comes up"). Pure (safe in client
 * components and tests). The flow itself is scan-flow.ts; the exact strings
 * are listed for the e2e tests in the BUILDER's ui-text.md.
 */

type Card = Pick<TrackCardSummary, "code" | "name">;
type Place = Pick<LocationRef, "code" | "kind" | "name">;

/** "CD-2549-03" (the Card ID), else the card's name, else "the card". */
export function cardLabel(card: Card | null | undefined): string {
  return card?.code ?? (card?.name?.trim() || "the card");
}

const cardsWord = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

// ─── The top panel ──────────────────────────────────────────────────────

export const READY_TITLE = "Ready to scan";
export const STARTING_TITLE = "Getting ready…";
export const READY_SUB = "Point your scanner at a bag, order, holder or desk label and press the button.";

/** A card is picked: "Picked: CD-2549-03". */
export function pickedTitle(card: Card): string {
  return `Picked: ${cardLabel(card)}`;
}
/** Under "Picked: …" for a card that can move. */
export const PICKED_SUB = "Scan an empty spot twice to move it there. Scan DONE twice when it's finished.";
/** Under "Picked: …" for a refunded card (and the card view's note). */
export const REFUNDED_TEXT = "Refunded cards aren't worked on. Take it out and set it aside.";
/** Under "Picked: …" for a card that hasn't arrived. */
export const NOT_RECEIVED_TEXT = "It hasn't been received yet. Receive it first.";

/** The first scan of an empty spot: "Scan CLAMP 07 again to move CD-2549-03 here". */
export function pendingMoveTitle(spotName: string, card: Card): string {
  return `Scan ${spotName} again to move ${cardLabel(card)} here`;
}
/** The first scan of the DONE sign: "Scan DONE again to mark CD-2549-03 done". */
export function pendingDoneTitle(card: Card): string {
  return `Scan DONE again to mark ${cardLabel(card)} done`;
}
export const PENDING_SUB = "Any other scan cancels.";
export const CANCEL_LABEL = "Cancel";

/** While a save runs. */
export function savingTitle(kind: "move" | "done" | "takeout", card: Card, toName?: string | null): string {
  if (kind === "move") return `Moving ${cardLabel(card)} to ${toName ?? "the spot"}…`;
  if (kind === "done") return `Marking ${cardLabel(card)} done…`;
  return `Taking ${cardLabel(card)} out…`;
}

/** "in CLAMP 07", "on DESK" (a desk), "at BENCH 2" (any other place). */
export function atPlace(place: Pick<LocationRef, "code" | "kind" | "name">): string {
  if (place.kind === "other" && isDeskCode(place.code)) return `on ${place.name}`;
  if (place.kind === "station") return `in ${place.name}`;
  return `at ${place.name}`;
}

/** After the second scan: "CD-2549-03 is in CLAMP 07 now", "CD-2549-03 is on DESK now". */
export function movedTitle(card: Card, to: Pick<LocationRef, "code" | "kind" | "name">): string {
  return `${cardLabel(card)} is ${atPlace(to)} now`;
}

/** The new step after a move into a work-station slot: "Step: Clamp Work." */
export function stepLine(stageLabel: string | null | undefined): string | null {
  return stageLabel ? `Step: ${stageLabel}.` : null;
}

/** The step email a move sent. */
export const EMAILED_TEXT = "The customer got an email about the new step.";

/**
 * Take out: "CD-2549-03 taken out of CLAMP 07, not done. Put it back in
 * REYES's bag: Open bags box, under R." (the bags from the answer; without
 * them "Put it back in its bag.").
 */
export function takenOutText(what: string, holderName: string, bags: TrackActionResponse["bags"]): string {
  const back = putBackSentence(bags ?? [], 1) || "Put it back in its bag.";
  return `${what} taken out of ${holderName}, not done. ${back}`;
}

/** A full spot scanned with another card picked: "CLAMP 07 already has CD-2549-05" (2+: "already has 2 cards"). */
export function spotTakenTitle(spotName: string, cards: readonly Card[]): string {
  return cards.length === 1 ? `${spotName} already has ${cardLabel(cards[0])}` : `${spotName} already has ${cardsWord(cards.length)}`;
}
/**
 * Under it: the picked card didn't move, and what is picked now: "CD-2549-03
 * didn't move. CD-2549-05 is picked now." (2+ cards: "… Tap a card to pick it.").
 */
export function spotTakenSub(was: Card, now: Card | null): string {
  return `${didntMoveText(was)} ${now ? `${cardLabel(now)} is picked now.` : TAP_TO_PICK}`;
}

/** "CD-2549-03 didn't move." */
export function didntMoveText(card: Card): string {
  return `${cardLabel(card)} didn't move.`;
}

/** A card in a sentence with its name: "CD-2549-05 · Charizard". */
function cardWithName(card: Card): string {
  return [card.code, card.name?.trim() || null].filter(Boolean).join(" · ") || "a card";
}

/**
 * The second scan's move found the holder filled meanwhile (another phone):
 * "CLAMP 09 already has CD-2549-05 · Charizard" (2+: "CLAMP 09 already has 2
 * cards (CD-2549-05, CD-2549-06)"; none named: "CLAMP 09 already has a card").
 * No "Add anyway": a holder holds one card.
 */
export function holderFullTitle(spotName: string, occupants: readonly Card[]): string {
  if (!occupants.length) return `${spotName} already has a card`;
  if (occupants.length === 1) return `${spotName} already has ${cardWithName(occupants[0])}`;
  return `${spotName} already has ${cardsWord(occupants.length)} (${occupants.map((c) => cardLabel(c)).join(", ")})`;
}

/** The waiting spot scanned again too soon after the first (the scanner's repeat gate): "Scan CLAMP 09 again". */
export function scanAgainText(spotName: string): string {
  return `Scan ${spotName} again`;
}

/** A card picked in a switched-off holder or desk (it can still be moved out, taken out or done). */
export const SWITCHED_OFF_TEXT = "This holder is switched off: use Take out or Done, or switch it on in Places.";

/** The spot the picked card is in already: "CD-2549-03 is already in CLAMP 07" ("on DESK"). */
export function alreadyThereTitle(card: Card, place: Place): string {
  return `${cardLabel(card)} is already ${atPlace(place)}`;
}

/** The DONE sign with no card picked. */
export const PICK_FIRST_TITLE = "Pick a card first";
export const PICK_FIRST_SUB = "Scan its spot, bag or order. Then scan DONE twice.";

/** The DONE sign for a card that is done and back in its bag. */
export function doneAlreadyTitle(card: Card): string {
  return `${cardLabel(card)} is done already`;
}
export const DONE_ALREADY_SUB = "It's back in its bag.";

/** A refunded or not-received card can't go in a spot (the server's own words). */
export function refundedRefusal(card: Card): string {
  return `${cardLabel(card)} was refunded. Not moved.`;
}
export function notReceivedRefusal(card: Card): string {
  return `${cardLabel(card)} hasn't been received yet. Receive it first.`;
}
/** A switched-off spot (the server's own words). */
export function switchedOffText(spotName: string): string {
  return `${spotName} is switched off. Turn it back on in Places first.`;
}

/** The pending move or Done waited more than 30 seconds. */
export const EXPIRED_TITLE = "Nothing moved";
export function expiredSub(kind: "move" | "done", spotName: string, card: Card): string {
  return kind === "done"
    ? `That took over 30 seconds. Scan DONE twice to mark ${cardLabel(card)} done.`
    : `That took over 30 seconds. Scan ${spotName} twice to move ${cardLabel(card)} there.`;
}

/** A tap while the last change (or a scan) is still being saved or looked up: nothing was started. */
export const SAVE_BUSY_TEXT = "Still saving the last change. Try again in a moment.";

/** A scanner read that isn't one of ours, and a code nothing has. */
export const NOT_OURS_TEXT = "Not a Card Doc code. Scan a slot or a bag label.";
export function notFoundText(code: string): string {
  return `${code}: not found. The label may be from a deleted slot or bag.`;
}

/** "DESK already holds Charizard 1, Charizard 2 and 3 more. Add anyway?" (a desk with a limit set in Places). */
export function addAnywayText(name: string, conflict: Pick<CapacityConflict, "error" | "occupants">): string {
  const names = conflict.occupants.map((c) => c.name ?? c.code ?? "a card");
  if (!names.length) return conflict.error;
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(names.length === 2 ? " and " : ", ");
  return `${name} already holds ${shown}. Add anyway?`;
}

/** "In it now: CD-2549-01, CD-2549-02 · holds 2 cards". */
export function inItNowText(conflict: Pick<CapacityConflict, "capacity" | "occupants">): string {
  const codes = conflict.occupants.map((c) => c.code ?? c.name ?? "a card").join(", ");
  const holds = `holds ${conflict.capacity === 1 ? "1 card" : `${conflict.capacity} cards`}`;
  return codes ? `In it now: ${codes} · ${holds}` : `It ${holds}.`;
}
export const ADD_ANYWAY_LABEL = "Add anyway";

// ─── Ship check ─────────────────────────────────────────────────────────

export const SHIP_TITLE = "Ship check: scan the bag or order";
export const SHIP_SUB = "Opens its ship check page.";

// ─── The picked card ────────────────────────────────────────────────────

/** "1999 · Base Set · #4/102 · 1st Edition" (what's known of it; "" for nothing). */
export function cardDetails(card: Pick<TrackCardSummary, "year" | "set" | "number"> & Pick<Partial<TrackCardSummary>, "variation">): string {
  const num = card.number?.trim();
  return [card.year?.trim(), card.set?.trim(), num ? (num.startsWith("#") ? num : `#${num}`) : null, card.variation?.trim()].filter(Boolean).join(" · ");
}

/** Which note a box shows. */
export type NoteKind = "card" | "defects" | "order" | "staff";

/** A card's notes, each in its labelled box (as the scan landing's boxes). */
export type CardNote = { kind: NoteKind; title: string; text: string };

export const NOTE_TITLES: Record<NoteKind, string> = {
  card: "Notes on this card",
  defects: "Known defects",
  order: "Customer's notes",
  staff: "Staff notes",
};

/**
 * The notes the picked card shows next to its photos (owner, Nov 26 2026:
 * "I want to be able to see the notes when I scan on the spot along with the
 * photo"): the customer's note on the card, its known defects, the order's
 * notes from the customer, then the staff's own notes on the order. Only the
 * ones written.
 */
export function cardNoteList(card: Pick<Partial<TrackCardSummary>, "notes" | "knownDefects" | "customerNotes" | "staffNotes">): CardNote[] {
  const out: CardNote[] = [];
  const add = (kind: NoteKind, text: string | null | undefined) => {
    const t = text?.trim();
    if (t) out.push({ kind, title: NOTE_TITLES[kind], text: t });
  };
  add("card", card.notes);
  add("defects", card.knownDefects);
  add("order", card.customerNotes);
  add("staff", card.staffNotes);
  return out;
}

/** A row in a list: the card has a note on it or known defects (the order's notes show once it is picked). */
export const HAS_NOTES_LABEL = "Has notes";
export function hasCardNotes(card: Pick<Partial<TrackCardSummary>, "notes" | "knownDefects">): boolean {
  return !!(card.notes?.trim() || card.knownDefects?.trim());
}

/** A long note folds at NOTE_LINES lines (NOTE_LINES_PHONE on a phone, so the notes fit the first screen with the photo). */
export const NOTE_LINES = 6;
export const NOTE_LINES_PHONE = 3;
export const SHOW_MORE_LABEL = "Show more";
export const SHOW_LESS_LABEL = "Show less";

/** "Maria Reyes · Order CD-2549 · Gold". */
export function orderLine(card: Pick<TrackCardSummary, "customer" | "orderNumber" | "tierName">): string {
  return [card.customer?.trim() || "No name", card.orderNumber ? `Order ${card.orderNumber}` : null, card.tierName || null].filter(Boolean).join(" · ");
}

/** "Maria Reyes · Gold" (a row in a bag's list, where the order is the header). */
export function customerTierLine(card: Pick<TrackCardSummary, "customer" | "tierName">): string {
  return [card.customer?.trim() || "No name", card.tierName || null].filter(Boolean).join(" · ");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon Dec 7" for a stored day; "Mon Jan 4, 2027" in another year than `today` ("YYYY-MM-DD"). */
export function shortDay(day: string, today: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const text = `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text}, ${day.slice(0, 4)}`;
}

/**
 * The card's due date with how long is left: "Due Mon Dec 7 · 3 days left",
 * "· 1 day left", "· today", "· 1 day late", "· 3 days late" (`late`: past
 * due). "No due date" without one. `today` is New York's day.
 */
export function dueLine(day: string | null | undefined, today: string = nyToday()): { text: string; late: boolean } {
  if (!isDay(day)) return { text: "No due date", late: false };
  const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const when = n === 0 ? "today" : n > 0 ? `${n} day${n === 1 ? "" : "s"} left` : `${-n} day${n === -1 ? "" : "s"} late`;
  return { text: `Due ${shortDay(day, today)} · ${when}`, late: n < 0 };
}

/** How long, in words: "2 days", "1 day", "5 hours", "12 minutes", "1 minute"; null under a minute. */
export function durationText(ms: number): string | null {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return null;
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * Where the card is and for how long: "In CLAMP 07 for 2 days", "On DESK
 * GAVIN for 3 hours", "At BENCH 2 for 12 minutes"; under a minute "Put in
 * CLAMP 07 just now"; "In CLAMP 07" when the time isn't recorded. A card with
 * its bag (no place, a shelf, the Open bags box): "In its bag", with where
 * the bag is when known ("In its bag · Bag: Open bags box · R").
 */
export function whereText(card: Pick<TrackCardSummary, "location" | "locatedAt" | "bagLocation" | "customer">, now: number): string {
  const loc = card.location;
  if (isBackInBag(loc)) {
    const bag = bagPlaceText(card.bagLocation ?? (loc && loc.kind !== "other" ? loc : null), filingLetter(card.customer));
    return bag ? `In its bag · Bag: ${bag}` : "In its bag";
  }
  const at = atPlace(loc!);
  const prep = at.charAt(0).toUpperCase() + at.slice(1);
  const t = card.locatedAt ? Date.parse(card.locatedAt) : NaN;
  if (Number.isNaN(t)) return prep;
  const long = durationText(now - t);
  return long ? `${prep} for ${long}` : `Put ${at} just now`;
}

/** The one card's line in the phone's button bar: "CD-2549-07 · Charizard · Maria Reyes". */
export function barCardLine(card: Pick<TrackCardSummary, "code" | "name" | "customer">): string {
  return [card.code ?? "No Card ID", card.name?.trim() || null, card.customer?.trim() || null].filter(Boolean).join(" · ");
}

export const DONE_LABEL = "Done";
export const TAKE_OUT_LABEL = "Take out";
/** Done asks first. */
export const DONE_QUESTION = "Mark it done? Then put it back in its bag.";
export const DONE_YES_LABEL = "Mark done";
export const CARD_PAGE_LABEL = "Card page";
export const HIDE_MESSAGE_LABEL = "Hide this message";
export const STOP_LABEL = "Stop";
export const SEARCH_TRUNCATED_TEXT = "Only the first ones are shown: type more to narrow it down.";

// ─── Lists (a bag, an order, a desk, a search) ──────────────────────────

export const TAP_TO_PICK = "Tap a card to pick it.";

/** "Back to bag CD-2549-P", "Back to order CD-2549", "Back to DESK", "Back to the list". */
export function backLabel(source: "bag" | "order" | "desk" | "holder" | "search", title: string): string {
  if (source === "bag") return `Back to bag ${title}`;
  if (source === "order") return `Back to order ${title}`;
  if (source === "desk" || source === "holder") return `Back to ${title}`;
  return "Back to the list";
}

/** The kicker over a list's title. */
export function listKicker(source: "bag" | "order" | "desk" | "holder" | "search"): string {
  return { bag: "Bag", order: "Order", desk: "Desk", holder: "Holder", search: "Search" }[source];
}

/** A bag or order with nothing left in the bag to work on. */
export function emptyListText(source: "bag" | "order" | "desk" | "holder" | "search", query?: string): string {
  if (source === "bag") return "No cards waiting in the bag.";
  if (source === "order") return "No cards waiting in the bags.";
  if (source === "search") return `Nothing found for “${query ?? ""}”.`;
  return "No cards here.";
}

/** The places a card list's out cards are in, once each, in order ("CLAMP 07, DESK"). */
function placeNames(cards: readonly Pick<TrackCardSummary, "location">[]): string {
  return [...new Set(cards.map((c) => c.location?.name ?? "somewhere"))].join(", ");
}

/**
 * The cards of a bag or order that are out (in a holder, on a desk): "2 more
 * cards are out: CLAMP 07, DESK" ("1 more card is out: …") under a list that
 * has cards; "All 3 cards are out: …" / "2 cards are out: …" when none is
 * left to pick. Null when none is out.
 */
export function outLine(out: readonly Pick<TrackCardSummary, "location">[], listed: number, all: number): string | null {
  const n = out.length;
  if (!n) return null;
  const places = placeNames(out);
  if (listed > 0) return `${n} more ${n === 1 ? "card is" : "cards are"} out: ${places}`;
  if (n === all && n > 1) return `All ${n} cards are out: ${places}`;
  return `${n} ${n === 1 ? "card is" : "cards are"} out: ${places}`;
}

/** Done cards back in the bag: "1 card is done.", "2 cards are done."; null for none. */
export function doneInBagLine(n: number): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? "card is" : "cards are"} done.`;
}

/** A search's heading: "3 cards for “smith”" ("30+" when cut short). */
export function searchHeading(query: string, n: number, truncated: boolean): string {
  return `${n}${truncated ? "+" : ""} card${n === 1 && !truncated ? "" : "s"} for “${query}”`;
}

// ─── A place with no card to show ───────────────────────────────────────

/** An empty holder or desk: "CLAMP 07 · empty". */
export function emptySpotTitle(name: string): string {
  return `${name} · empty`;
}
/** Under it: how a card gets in. */
export function emptySpotText(name: string): string {
  return `To put a card here: scan the card's bag, order or spot, then scan ${name} twice.`;
}
/** A place that holds bags (a shelf, the Open bags box, the Ready to ship bin). */
export const BAGS_HERE_LABEL = "Bags here:";
export const NO_BAGS_TEXT = "No bags here.";
export const OPEN_DESK_LABEL = "Open desk page";

/** The list of what this tab saved and what went wrong (collapsed). */
export function recentScansLabel(n: number): string {
  return `Recent scans (${n})`;
}
