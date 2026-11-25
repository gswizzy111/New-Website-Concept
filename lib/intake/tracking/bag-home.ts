import { customerLastName, filingLetter } from "@/lib/intake/filing-letter";
import type { OrderAutoComplete } from "@/lib/intake/order-autocomplete";
import { SHIP_LOCATION_CODE } from "@/lib/intake/tracking/places";
import type { LocationRef, TrackBagPlace } from "@/lib/intake/tracking/types";

/**
 * Where a bag lives and what staff are told to do with it (owner, Nov 25
 * 2026), without the database. Pure (safe in client components and tests).
 *
 * - A finished card goes back IN ITS OWN BAG (cards carry no sticker, so a
 *   loose card can't be matched): Done leaves the card in no place
 *   (cards.location_id null, "In the bag") and frees its holder.
 * - A bag has two homes: its due-date shelf slot while every card is in it,
 *   and the ONE Open bags box (LOC-OPEN-BAGS, A-Z dividers by the customer's
 *   last name) as soon as any card comes out to a desk or holder.
 * - A finished bag (every non-refunded card done) goes in the Ready to ship
 *   bin (LOC-SHIP).
 * Server side: lib/intake/tracking/bag-places.ts (the writes) and moves.ts.
 */

/** The Open bags box: one place (kind 'other'), made on first use. */
export const OPEN_BAGS_CODE = "LOC-OPEN-BAGS";
export const OPEN_BAGS_NAME = "OPEN BAGS";
/** What staff call LOC-SHIP. */
export const READY_TO_SHIP = "Ready to ship";
/** The big step once a bag's last card is done. */
export const BAG_FINISHED_TEXT = "Bag finished: put it in the Ready to ship bin";

type Place = Pick<LocationRef, "code" | "kind">;
type NamedPlace = Place & Pick<LocationRef, "name">;

export function isOpenBagsPlace(loc: Pick<LocationRef, "code"> | null | undefined): boolean {
  return loc?.code === OPEN_BAGS_CODE;
}

/** The Ready to ship bin: LOC-SHIP, or any Shipping place. */
export function isReadyToShipPlace(loc: Place | null | undefined): boolean {
  return !!loc && (loc.code === SHIP_LOCATION_CODE || loc.kind === "shipping");
}

/**
 * A place where a card still sits with its bag: no place ("In the bag"), a
 * due-date shelf, the Open bags box, the Ready to ship bin, or the old Done
 * shelf (LOC-DONE, still a place for anyone scanning cards to it).
 */
export function isWithBag(loc: Place | null | undefined): boolean {
  return !loc || loc.kind === "shelf" || loc.kind === "done" || loc.kind === "shipping" || isOpenBagsPlace(loc);
}

/** A place that takes a card out of its bag: a holder (work-station slot), a desk, any other place but the Open bags box. */
export function takesCardOut(loc: Place | null | undefined): boolean {
  return !!loc && (loc.kind === "station" || (loc.kind === "other" && !isOpenBagsPlace(loc)));
}

/** One card's change, as the bag rule reads it. */
export type BagRuleMove = { bagId: string | null; from: Place | null; locationChanges: boolean };

/**
 * The bag-location rule: the bags that go to the Open bags box because a
 * card of theirs comes out of the bag with this request (it was with its bag
 * and goes to a desk or holder). A bag already in the box is left out, so a
 * repeat files nothing twice; a card moving from one holder to another was
 * out already and files nothing (its bag is where staff left it).
 * `bagPlace(bagId)`: where the bag is now (undefined: unknown bag).
 */
export function bagsToOpen(target: Place | null, moves: readonly BagRuleMove[], bagPlace: (bagId: string) => Pick<LocationRef, "code"> | null | undefined): string[] {
  if (!takesCardOut(target)) return [];
  const out: string[] = [];
  for (const m of moves) {
    if (!m.bagId || !m.locationChanges || !isWithBag(m.from) || out.includes(m.bagId)) continue;
    const at = bagPlace(m.bagId);
    if (at === undefined || isOpenBagsPlace(at)) continue;
    out.push(m.bagId);
  }
  return out;
}

/** "REYES" for "Maria Reyes" (the bag label's big name), null without a name. */
export function ownerName(customer: string | null | undefined): string | null {
  const last = customerLastName(customer);
  return last ? last.toUpperCase() : null;
}

/** "REYES's", or null without a name. */
function owners(customer: string | null | undefined): string | null {
  const name = ownerName(customer);
  return name ? `${name}'s` : null;
}

/**
 * Where a bag is, short: "Open bags box · R" ("Open bags · R" when
 * `compact`, the Bags board), "Shelf DUE MON DEC 7", "Ready to ship", "Done
 * shelf", any other place's name; null when no place is recorded.
 */
export function bagPlaceText(loc: NamedPlace | null | undefined, letter: string, compact = false): string | null {
  if (!loc) return null;
  if (isOpenBagsPlace(loc)) return `${compact ? "Open bags" : "Open bags box"} · ${letter}`;
  if (isReadyToShipPlace(loc)) return READY_TO_SHIP;
  if (loc.kind === "shelf") return `Shelf ${loc.name}`;
  if (loc.kind === "done") return "Done shelf";
  return loc.name;
}

/** bagPlaceText, or "No place yet". */
export function bagPlaceOrNone(loc: NamedPlace | null | undefined, letter: string, compact = false): string {
  return bagPlaceText(loc, letter, compact) ?? "No place yet";
}

/** In a sentence: "Open bags box, under R", "on shelf DUE MON DEC 7", "in the Ready to ship bin", "at BENCH 2"; null when not recorded. */
export function bagPlacePhrase(loc: NamedPlace | null | undefined, letter: string): string | null {
  if (!loc) return null;
  if (isOpenBagsPlace(loc)) return `Open bags box, under ${letter}`;
  if (isReadyToShipPlace(loc)) return "in the Ready to ship bin";
  if (loc.kind === "shelf") return `on shelf ${loc.name}`;
  if (loc.kind === "done") return "on the Done shelf";
  return `at ${loc.name}`;
}

/** What the done and open-bags sentences need of a bag. */
export type BagWords = Pick<TrackBagPlace, "customer" | "letter" | "location">;

/**
 * After Done, what to do with the cards: "Put it back in REYES's bag: Open
 * bags box, under R." (`cards` > 1: "Put them back in ..."); several bags:
 * "Put each back in its bag: REYES's (Open bags box, under R), SMITH's (on
 * shelf DUE MON DEC 7)."; "" with no bag.
 */
export function putBackSentence(bags: readonly BagWords[], cards = 1): string {
  if (!bags.length) return "";
  if (bags.length === 1) {
    const [bag] = bags;
    const whose = owners(bag.customer) ?? "its";
    const where = bagPlacePhrase(bag.location, bag.letter);
    return `Put ${cards > 1 ? "them" : "it"} back in ${whose} bag${where ? `: ${where}` : ""}.`;
  }
  const each = bags.map((b, i) => {
    const whose = owners(b.customer) ?? `bag ${i + 1}`;
    const where = bagPlacePhrase(b.location, b.letter);
    return where ? `${whose} (${where})` : whose;
  });
  return `Put each back in its bag: ${each.join(", ")}.`;
}

/** The scan landing's line after one card's Done: "Done. Put it back in REYES's bag: Open bags box, under R." */
export function doneText(bag: BagWords | null): string {
  return bag ? `Done. ${putBackSentence([bag])}` : "Done.";
}

/** "Bag finished: put it in the Ready to ship bin." / "2 bags finished: put them in the Ready to ship bin." ("" for none). */
export function finishedSentence(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? `${BAG_FINISHED_TEXT}.` : `${count} bags finished: put them in the Ready to ship bin.`;
}

/**
 * A card came out of its bag: "Put the bag in the Open bags box, under R.";
 * several bags: "Put the bags in the Open bags box: REYES's under R, SMITH's
 * under S."; "" with none.
 */
export function openBagsSentence(bags: readonly Pick<TrackBagPlace, "customer" | "letter">[]): string {
  if (!bags.length) return "";
  if (bags.length === 1) return `Put the bag in the Open bags box, under ${bags[0].letter}.`;
  const each = bags.map((b, i) => `${owners(b.customer) ?? `bag ${i + 1}`} under ${b.letter}`);
  return `Put the bags in the Open bags box: ${each.join(", ")}.`;
}

/**
 * The bag sentences that follow a request's own line: for Done, where to put
 * the cards back (and the finished bags), for a card that came out, where to
 * file its bag. `doneCards`: cards marked done or put back with this request.
 */
export function bagSentences(bags: readonly TrackBagPlace[], doneCards: number): string {
  const back = doneCards > 0 ? bags.filter((b) => b.returned > 0) : [];
  const parts = [
    back.length ? putBackSentence(back, doneCards) : "",
    finishedSentence(back.filter((b) => b.finished && !isReadyToShipPlace(b.location)).length),
    openBagsSentence(bags.filter((b) => b.opened)),
  ];
  return parts.filter(Boolean).join(" ");
}

/** A line followed by the bag sentences ("Done." + " Put it back in ..."). */
export function withBagSentences(line: string, bags: readonly TrackBagPlace[] | undefined, doneCards: number): string {
  const extra = bagSentences(bags ?? [], doneCards);
  return [line, extra].filter(Boolean).join(" ");
}

/** "3 of 4 done" once a card is done, "4 cards" before; "No cards" for none. */
export function doneCountText(done: number, total: number): string {
  if (total <= 0) return "No cards";
  if (done <= 0) return `${total} card${total === 1 ? "" : "s"}`;
  return `${done} of ${total} done`;
}

/** The bag's place and words, from rows already read (the server builds it after a request). */
export function bagPlaceOf(input: {
  bag: { id: string; bag_code: string; location_id: string | null };
  customer: string | null;
  location: LocationRef | null;
  cards: readonly { completed: boolean; refunded: boolean }[];
  opened?: boolean;
  returned?: number;
}): TrackBagPlace {
  const live = input.cards.filter((c) => !c.refunded);
  const done = live.filter((c) => c.completed).length;
  return {
    id: input.bag.id,
    code: input.bag.bag_code,
    customer: input.customer,
    letter: filingLetter(input.customer),
    location: input.location,
    opened: !!input.opened,
    returned: input.returned ?? 0,
    finished: live.length > 0 && done === live.length,
    doneCount: done,
    cardCount: live.length,
  };
}

/** A line staff read after Done, with its colour: green ("ok") or amber ("warn"). */
export type ToneLine = { tone: "ok" | "warn"; text: string };

/**
 * The order auto-complete lines after Done (lib/intake/order-autocomplete.ts
 * `message`, e.g. "Order completed. Pat Collector emailed."): green when the
 * request completed the order, amber otherwise (why it wasn't). Results
 * without a message say nothing.
 */
export function orderCompletionNotes(list: readonly (Pick<OrderAutoComplete, "completed" | "message"> | null | undefined)[] | null | undefined): ToneLine[] {
  const out: ToneLine[] = [];
  for (const r of list ?? []) {
    const text = r?.message?.trim();
    if (text && !out.some((l) => l.text === text)) out.push({ tone: r!.completed ? "ok" : "warn", text });
  }
  return out;
}
