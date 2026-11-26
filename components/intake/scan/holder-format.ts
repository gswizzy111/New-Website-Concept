import { outcomeOf, type Outcome } from "@/app/admin/receiving/desk/_lib/outcome";
import { isDay, nyToday } from "@/lib/intake/business-days";
import { isOpenBagsPlace, putBackSentence } from "@/lib/intake/tracking/bag-home";
import { DESK_CODE, isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type { LocationRef, TrackActionResponse, TrackCardSummary, TrackDeskRef, TrackLocation, TrackSlotSummary } from "@/lib/intake/tracking/types";
import { cardsLabel } from "./format";

/**
 * The words and rules of the Scan page's holder view (holder-view.tsx): what
 * a scanned holder with a card in it says, at a glance on a phone. Owner,
 * Nov 26 2026: "when you scan on a station that has a card in it, it is a
 * little more clear". Pure (safe in client components and tests).
 */

type Place = Pick<TrackLocation, "kind" | "code">;

/**
 * A place the holder view shows: a work-station slot (CLAMP 07, HEAT PRESS
 * 02) or another place cards sit in (desks, BENCH 2). Shelves, Done,
 * Shipping and the Open bags box hold bags and keep the plain place view.
 */
export function isHolderPlace(place: Place): boolean {
  if (place.kind === "station") return true;
  return place.kind === "other" && !isOpenBagsPlace(place);
}

/** A stack holder: one without a card limit (heat press, humidor, desks). */
export function isStack(slot: Pick<TrackSlotSummary, "capacity">): boolean {
  return slot.capacity == null;
}

const cardsWord = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

/** After the holder's name: "has 1 card" (a holder with a limit), "8 cards" (a stack), "empty". */
export function holderCountText(slot: Pick<TrackSlotSummary, "capacity" | "cardCount">): string {
  if (slot.cardCount <= 0) return "empty";
  return isStack(slot) ? cardsWord(slot.cardCount) : `has ${cardsWord(slot.cardCount)}`;
}

/** "CLAMP 07 · has 1 card", "HEAT PRESS 02 · 8 cards", "CLAMP 07 · empty". */
export function holderHeading(slot: Pick<TrackSlotSummary, "name" | "capacity" | "cardCount">): string {
  return `${slot.name} · ${holderCountText(slot)}`;
}

/** The empty holder's line. */
export const EMPTY_HOLDER_TEXT = "Empty. Scan a bag or card to put one here.";

/** "1999 · Base Set · #4/102" (what's known of it; "" for nothing). */
export function cardDetails(card: Pick<TrackCardSummary, "year" | "set" | "number">): string {
  const num = card.number?.trim();
  return [card.year?.trim(), card.set?.trim(), num ? (num.startsWith("#") ? num : `#${num}`) : null].filter(Boolean).join(" · ");
}

/** "Maria Reyes · Order CD-2549 · Gold". */
export function orderLine(card: Pick<TrackCardSummary, "customer" | "orderNumber" | "tierName">): string {
  return [card.customer?.trim() || "No name", card.orderNumber ? `Order ${card.orderNumber}` : null, card.tierName || null].filter(Boolean).join(" · ");
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

/** "In" a holder, "On" a desk, "At" any other place. */
function preposition(place: Place): "In" | "On" | "At" {
  if (place.kind === "station") return "In";
  if (place.kind === "other" && isDeskCode(place.code)) return "On";
  return "At";
}

/**
 * How long the card has been where it is: "In CLAMP 07 for 2 days", "On DESK
 * GAVIN for 3 hours", "At BENCH 2 for 12 minutes"; under a minute "Put in
 * CLAMP 07 just now"; "In CLAMP 07" when the time isn't recorded.
 */
export function inHolderText(place: Place & Pick<LocationRef, "name">, locatedAt: string | null | undefined, now: number): string {
  const prep = preposition(place);
  const t = locatedAt ? Date.parse(locatedAt) : NaN;
  if (Number.isNaN(t)) return `${prep} ${place.name}`;
  const long = durationText(now - t);
  return long ? `${prep} ${place.name} for ${long}` : `Put ${prep.toLowerCase()} ${place.name} just now`;
}

/** A refunded card in a holder. */
export const REFUNDED_TEXT = "Refunded cards aren't worked on. Take it out and set it aside.";

/**
 * The desk "Move to my desk" uses: the one this phone picked (its code, kept
 * like the bag page's desk choice) while it is still a switched-on desk, else
 * the first (LOC-DESK first); null when there is no desk. `desks` undefined
 * (an answer without them): the kept desk code, else LOC-DESK, named "your
 * desk" (the server says if it isn't there).
 */
export function myDesk(desks: readonly TrackDeskRef[] | undefined, storedCode: string | null | undefined): TrackDeskRef | null {
  const want = (storedCode ?? "").trim().toUpperCase();
  if (!desks) return { id: "", code: isDeskCode(want) ? want : DESK_CODE, name: "your desk" };
  return (want && desks.find((d) => d.code === want)) || desks[0] || null;
}

/** What a button does. */
export type HolderAction = "desk" | "other" | "done" | "takeout";

/**
 * The buttons for the holder's cards: one obvious primary, then the rest.
 * One card: Move to my desk, then Move to another holder, Done, Take out (on
 * my own desk, Move to another holder leads; a refunded card: Take out only).
 * A stack: Move all N to my desk, then Done / Move / Take out for the
 * picked cards (on my own desk: Move selected leads).
 */
export function holderButtons(input: { stack: boolean; onMyDesk: boolean; refunded?: boolean }): { primary: HolderAction; others: HolderAction[] } {
  if (!input.stack && input.refunded) return { primary: "takeout", others: [] };
  if (input.onMyDesk) return { primary: "other", others: ["done", "takeout"] };
  return { primary: "desk", others: input.stack ? ["done", "other", "takeout"] : ["other", "done", "takeout"] };
}

/** A button's words: one card, or a stack (`movable`: cards "Move all" takes). */
export function actionLabel(action: HolderAction, stack: boolean, movable = 0): string {
  if (!stack) {
    return { desk: "Move to my desk", other: "Move to another holder", done: "Done", takeout: "Take out" }[action];
  }
  if (action === "desk") return movable === 1 ? "Move 1 card to my desk" : `Move all ${movable} to my desk`;
  return { other: "Move selected", done: "Done for selected", takeout: "Take out selected" }[action];
}

/** "None picked", "3 of 8 picked", "All 8 picked". */
export function pickedText(picked: number, total: number): string {
  if (picked <= 0) return "None picked";
  return picked >= total ? `All ${total} picked` : `${picked} of ${total} picked`;
}

/** Done asks first: "Mark it done? Then put it back in its bag." */
export function doneQuestion(n: number): string {
  return n === 1 ? "Mark it done? Then put it back in its bag." : `Mark ${n} cards done? Then put each back in its bag.`;
}

/** The yes button: "Mark done", "Mark 3 cards done". */
export function doneYesLabel(n: number): string {
  return n === 1 ? "Mark done" : `Mark ${n} cards done`;
}

/** What the bar says while a request runs. */
export function savingText(action: HolderAction, what: string, toName?: string | null): string {
  if (action === "desk") return `Moving ${what} to your desk…`;
  if (action === "other") return `Moving ${what} to ${toName || "the holder"}…`;
  if (action === "done") return `Marking ${what} done…`;
  return `Taking ${what} out…`;
}

/** Moved to my desk, every card went: "CD-2549-03 is on your desk.", "All 8 cards are on your desk." */
export function onYourDeskText(what: string, n: number): string {
  return n === 1 ? `${what} is on your desk.` : `All ${n} cards are on your desk.`;
}

/**
 * Take out, every card went: "CD-2549-03 taken out of CLAMP 07, not done.
 * Put it back in REYES's bag: Open bags box, under R." (the bags from the
 * answer; without them "Put it back in its bag.").
 */
export function takenOutText(what: string, n: number, holderName: string, bags: TrackActionResponse["bags"]): string {
  const back = putBackSentence(bags ?? [], n) || (n === 1 ? "Put it back in its bag." : "Put them back in their bags.");
  return `${what} taken out of ${holderName}, not done. ${back}`;
}

/** Where the Desk page's "Open desk page" goes after cards went to a desk, or null (not a desk). */
export function deskLinkCode(res: Pick<TrackActionResponse, "location" | "results">): string | null {
  const to = res.location;
  return to && isDeskCode(to.code) && res.results.some((r) => r.ok) ? to.code : null;
}

/** The result line after a save: the Desk page's outcome (outcomeOf), and the desk to link to. */
export type HolderResult = { outcome: Outcome; deskCode: string | null };

/**
 * What the result line says after a save from the holder view: the API's
 * sentence (Done: "Done. Put it back in REYES's bag: Open bags box, under
 * R."; a move: "In HEAT PRESS 02. Step: Heat Press."), the step email, the
 * order's auto-complete line, finished bags' links (outcomeOf, as on the
 * Desk page). When every card went: Move to my desk says "CD-2549-03 is on
 * your desk." and Take out says where the bag is. Each card's line only
 * when one didn't go (all went: the sentence says it).
 */
export function holderOutcome(
  action: HolderAction,
  cards: readonly Pick<TrackCardSummary, "code" | "name">[],
  res: TrackActionResponse,
  holderName: string,
): HolderResult {
  const base = outcomeOf(res);
  const ok = res.results.filter((r) => r.ok).length;
  let title = base.title;
  if (base.tone === "ok" && action === "desk") title = onYourDeskText(cardsLabel(cards), ok);
  if (base.tone === "ok" && action === "takeout") title = takenOutText(cardsLabel(cards), ok, holderName, res.bags);
  return {
    outcome: { ...base, title, lines: base.tone === "ok" ? [] : base.lines },
    deskCode: action === "desk" || action === "other" ? deskLinkCode(res) : null,
  };
}
