import { outcomeOf } from "@/app/admin/receiving/desk/_lib/outcome";
import { isBackInBag, isOpenBagsPlace, openBagsSentence, orderCompletionNotes, type ToneLine } from "@/lib/intake/tracking/bag-home";
import { isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type {
  AssignRequest, CapacityConflict, DoneRequest, HolderFull, LocationKind, LocationRef, MoveRequest, ReleaseRequest, TrackActionResponse,
  TrackBagSummary, TrackCardSummary, TrackOrderSummary, TrackSlotSummary,
} from "@/lib/intake/tracking/types";
import {
  EMAILED_TEXT, EXPIRED_TITLE, NOT_RECEIVED_TEXT, PENDING_SUB, PICKED_SUB, PICK_FIRST_SUB, PICK_FIRST_TITLE, READY_SUB, READY_TITLE,
  REFUNDED_TEXT, SAVE_BUSY_TEXT, STARTING_TITLE, SWITCHED_OFF_TEXT, TAP_TO_PICK, DONE_ALREADY_SUB, addAnywayText, alreadyThereTitle,
  cardLabel, didntMoveText, doneAlreadyTitle, expiredSub, holderFullTitle, inItNowText, movedTitle, notReceivedRefusal,
  pendingDoneTitle, pendingMoveTitle, pickedTitle, refundedRefusal, savingTitle, scanAgainText, spotTakenSub, spotTakenTitle,
  stepLine, switchedOffText, takenOutText,
} from "./flow-text";

/**
 * The plain Scan page's flow (owner, Nov 26 2026: "if I scan a humidity
 * press for example that has a card, it pulls up the order and then if I scan
 * another spot that has nothing in it twice, it auto moves that card to the
 * empty spot that I scanned"). Pure: what each scan or tap does, given what is
 * on screen (the picked card) and the move or Done waiting for its second
 * scan. scan-app.tsx runs it (lookups and saves through the tracking API);
 * tests: tests/intake/scan-flow.test.ts. Words: flow-text.ts.
 *
 *  - Plain by default ("Ready to scan"). Every scan replaces what's on screen.
 *  - A bag or order: its cards still IN THE BAG (not in a holder or on a
 *    desk; not done, not refunded, arrived), and one line for the cards
 *    that are out. Exactly one: it is picked at once; else tap one.
 *  - A spot with a card (a work-station slot, any other holder): that card,
 *    picked. 2+ cards (a desk, a holder from before the one-card rule): the
 *    list, tap one. A desk with one card: that card, picked.
 *  - With a card picked, an EMPTY spot (no card in it) or any desk (a desk
 *    is never full): "Scan CLAMP 07 again to move CD-2549-03 here". The same
 *    spot again within PENDING_MS (30 s), with no other scan in between:
 *    the card moves (assign with `fromBag` from its bag, move with
 *    `fromCode` from its holder: a card someone moved meanwhile is refused).
 *    Any other scan cancels it and does its own thing; after 30 s it ends
 *    with a soft sound. The same spot again within 750 ms (the scanner's
 *    repeat gate) doesn't count: "Scan CLAMP 09 again" (quickRepeat).
 *  - A spot that has another card: that card is picked instead ("CLAMP 07
 *    already has CD-2549-05", the scan's read beep only); the spot the
 *    picked card is in (the spot's answer lists it): nothing to move, it
 *    just shows. A card picked in a switched-off holder says so.
 *  - The DONE sign twice: Done for the picked card (back in its bag).
 *  - Done (asks first) and Take out are taps on the picked card.
 *  - Nothing changes on a single scan: only the double scan or a tap saves.
 *  - One save at a time: a tap while something runs says so and changes
 *    nothing on screen; a scan waits for the save before it (the page's
 *    queue), then is read against what the save left.
 */

/** How long the first scan of a spot (or DONE) waits for the second. */
export const PENDING_MS = 30_000;
/** How long "CD-2549-03 is in CLAMP 07 now" shows before the page is plain again. */
export const MOVED_SHOW_MS = 8_000;

/** What a scanned place is to the flow. */
export type SpotRole = "holder" | "desk" | "done" | "bags";

/**
 * A work-station slot or any other holder (BENCH 2): "holder" (empty when it
 * has no card); a desk (LOC-DESK, LOC-DESK-<NAME>): "desk", never full; the
 * DONE sign (kind done): "done"; a place that holds bags (a due-date shelf,
 * the Open bags box, the Ready to ship bin): "bags".
 */
export function spotRole(place: Pick<LocationRef, "kind" | "code">): SpotRole {
  if (place.kind === "done") return "done";
  if (place.kind === "shelf" || place.kind === "shipping" || isOpenBagsPlace(place)) return "bags";
  if (place.kind === "other" && isDeskCode(place.code)) return "desk";
  return "holder";
}

/** A spot a card waits to go to. */
export type SpotRef = { code: string; name: string; kind: LocationKind; desk: boolean };

function spotRef(place: Pick<LocationRef, "code" | "name" | "kind">): SpotRef {
  return { code: place.code, name: place.name, kind: place.kind, desk: place.kind === "other" && isDeskCode(place.code) };
}

export type ListSource = "bag" | "order" | "desk" | "holder" | "search";

/** Cards to tap one of: a bag's or order's cards still in the bag, a desk's cards, a search. */
export type CardList = {
  source: ListSource;
  /** Bag ID, order number, the place's code, or the search text. */
  code: string;
  /** What the list's heading says: "CD-2549-P", "CD-2549", "DESK", the search text. */
  title: string;
  customer: string | null;
  /** The cards to pick from. */
  cards: TrackCardSummary[];
  /** Bag or order: cards out of the bag (in a holder, on a desk). */
  out: TrackCardSummary[];
  /** Bag or order: done cards back in the bag. */
  doneInBag: number;
  /** Bag or order: its cards (not refunded). */
  total: number;
  /** A search cut short. */
  truncated?: boolean;
  /** A desk's or holder's list: the place is switched off (a card picked from it says so). */
  off?: boolean;
};

/** What the page shows under the top panel. */
export type Screen =
  | { kind: "ready" }
  /**
   * The picked card (`from`: the list it came from, for "Back"; `off`: it was
   * picked in a switched-off holder or desk: SWITCHED_OFF_TEXT).
   */
  | { kind: "card"; card: TrackCardSummary; from: CardList | null; off?: boolean }
  | { kind: "list"; list: CardList }
  /** An empty holder or desk, or a place that holds bags (its bags). */
  | { kind: "place"; place: TrackSlotSummary };

/** The first scan of an empty spot (move) or of the DONE sign (done), waiting for the second. */
export type Pending = { kind: "move" | "done"; card: TrackCardSummary; to: SpotRef; at: number };

/** A save: the double scan's move or Done, a tap's Done or Take out, "Add anyway" (force, a desk with a limit set). */
export type Save =
  | { kind: "move"; card: TrackCardSummary; to: SpotRef; force?: boolean }
  | { kind: "done"; card: TrackCardSummary }
  | { kind: "takeout"; card: TrackCardSummary };

export type Tone = "info" | "ok" | "warn" | "error";

/** The one message the top panel shows (until the next scan, or `until`). */
export type Message = {
  tone: Tone;
  title: string;
  sub?: string;
  /** The order's auto-complete line(s) after a Done (green / amber). */
  lines?: ToneLine[];
  /** Finished bags: their scan landing ("Open REYES's bag"), where the Ready to ship step is. */
  links?: { href: string; label: string }[];
  /** The card it is about (its thumbnail shows with it). */
  card?: TrackCardSummary;
  /** "Add anyway": a desk with a limit set in Places is full (tap: the same desk, with force; never a one-card holder). */
  retry?: Save;
  /** Gone at this time (a move's result: the page is plain again). */
  until?: number;
};

export type FlowState = {
  screen: Screen;
  pending: Pending | null;
  saving: Save | null;
  message: Message | null;
};

/** pending: a move or Done waits for its second scan; moved: saved; refused; expired: the wait ran out (soft). */
export type FlowSound = "pending" | "moved" | "refused" | "expired" | null;
/** A transition: the next state and the sound it makes. */
export type Step = { state: FlowState; sound: FlowSound };

export function startFlow(): FlowState {
  return { screen: { kind: "ready" }, pending: null, saving: null, message: null };
}

/** The picked card: the card on screen (nothing is picked unless it shows). */
export function pickedCard(state: FlowState): TrackCardSummary | null {
  return state.screen.kind === "card" ? state.screen.card : null;
}

/** Whether a card can go in a spot: not refunded, arrived. */
export function canMove(card: Pick<TrackCardSummary, "refunded" | "received" | "awaiting">): boolean {
  return !card.refunded && card.received && !card.awaiting;
}

/** In its bag: no place, or a place that holds bags (a shelf, the Open bags box, the Ready to ship bin). */
export function inItsBag(card: Pick<TrackCardSummary, "location">): boolean {
  return isBackInBag(card.location);
}

/**
 * The picked card's buttons: Done unless it is refunded, not arrived, or done
 * and back in its bag; Take out when it is out of its bag (in a holder, on a
 * desk).
 */
export function cardActions(card: TrackCardSummary): { done: boolean; takeout: boolean } {
  const inBag = inItsBag(card);
  return {
    done: canMove(card) && !(card.done && inBag),
    takeout: !inBag,
  };
}

// ─── Lists ──────────────────────────────────────────────────────────────

/** A bag's or order's cards as the page lists them: those still in the bag to pick, and the out / done counts. */
export function bagCardList(source: "bag" | "order", code: string, customer: string | null, cards: readonly TrackCardSummary[]): CardList {
  const live = cards.filter((c) => !c.refunded);
  const inBag = live.filter(inItsBag);
  return {
    source,
    code,
    title: code,
    customer,
    cards: inBag.filter((c) => !c.done && canMove(c)),
    out: live.filter((c) => !inItsBag(c)),
    doneInBag: inBag.filter((c) => c.done).length,
    total: live.length,
  };
}

export function listOfBag(bag: TrackBagSummary): CardList {
  return bagCardList("bag", bag.code, bag.customer, bag.cards);
}

/** An order's cards in its bags (cards not received yet are in no bag: left out). */
export function listOfOrder(order: TrackOrderSummary): CardList {
  return bagCardList("order", order.orderNumber, order.customer, order.bags.flatMap((b) => b.cards));
}

/** A desk's cards (or a holder's, from before the one-card rule). */
export function listOfPlace(place: TrackSlotSummary): CardList {
  return {
    source: spotRole(place) === "desk" ? "desk" : "holder",
    code: place.code,
    title: place.name,
    customer: null,
    cards: place.cards,
    out: [],
    doneInBag: 0,
    total: place.cards.length,
    ...(place.active === false ? { off: true } : {}),
  };
}

export function listOfSearch(query: string, cards: readonly TrackCardSummary[], truncated: boolean): CardList {
  return { source: "search", code: query, title: query, customer: null, cards: [...cards], out: [], doneInBag: 0, total: cards.length, truncated };
}

// ─── Scans ──────────────────────────────────────────────────────────────

/** What a scan does before anything is looked up. */
export type ScanPlan =
  /** The second scan of the waiting spot (or DONE) within PENDING_MS: save now. */
  | { do: "save"; save: Save }
  /** Look it up, then afterLookup. */
  | { do: "lookup" }
  /** A save is running: handle this scan after it (against what it left). */
  | { do: "wait" };

/** A code came in (scanned, typed, or a place's QR link), at `now`. */
export function planScan(state: FlowState, code: string, now: number): ScanPlan {
  if (state.saving) return { do: "wait" };
  const p = state.pending;
  if (p && p.to.code === code && now - p.at <= PENDING_MS) {
    return { do: "save", save: p.kind === "done" ? { kind: "done", card: p.card } : { kind: "move", card: p.card, to: p.to } };
  }
  return { do: "lookup" };
}

/** A save starts: the waiting move is used up, the old message goes. */
export function startSave(state: FlowState, save: Save): FlowState {
  return { ...state, pending: null, saving: save, message: null };
}

/** What a lookup found. */
export type Found =
  | { kind: "spot"; spot: TrackSlotSummary }
  | { kind: "bag"; bag: TrackBagSummary }
  | { kind: "order"; order: TrackOrderSummary }
  | { kind: "card"; card: TrackCardSummary }
  | { kind: "search"; query: string; cards: TrackCardSummary[]; truncated: boolean };

const quiet = (state: FlowState): Step => ({ state, sound: null });

/** A list to show: one card is picked at once (a bag's last card in it, a desk's one card, a search's one hit). */
function showList(base: FlowState, list: CardList): FlowState {
  return list.cards.length === 1 ? { ...base, screen: pickedScreen(list.cards[0], list, !!list.off) } : { ...base, screen: { kind: "list", list } };
}

/** The card screen for a picked card (`off`: picked in a switched-off holder or desk). */
function pickedScreen(card: TrackCardSummary, from: CardList | null, off: boolean): Screen {
  return off ? { kind: "card", card, from, off: true } : { kind: "card", card, from };
}

/** The card can't go in a spot: why, as the server would say it. */
function moveRefusal(card: TrackCardSummary): string | null {
  if (card.refunded) return refundedRefusal(card);
  if (!canMove(card)) return notReceivedRefusal(card);
  return null;
}

/**
 * What a scan shows (and whether it starts a waiting move), from what it
 * found. Every scan that gets here drops the waiting move and the last
 * message.
 */
export function afterLookup(state: FlowState, found: Found, now: number): Step {
  const base: FlowState = { ...state, pending: null, message: null };
  const picked = pickedCard(state);
  if (found.kind === "bag") return quiet(showList(base, listOfBag(found.bag)));
  if (found.kind === "order") return quiet(showList(base, listOfOrder(found.order)));
  if (found.kind === "card") return quiet({ ...base, screen: { kind: "card", card: found.card, from: null } });
  if (found.kind === "search") return quiet(showList(base, listOfSearch(found.query, found.cards, found.truncated)));

  const spot = found.spot;
  const role = spotRole(spot);
  const refuse = (title: string, sub?: string): Step => ({ state: { ...base, message: { tone: "error", title, ...(sub ? { sub } : {}) } }, sound: "refused" });
  const wait = (kind: "move" | "done", card: TrackCardSummary): Step => ({
    state: { ...base, pending: { kind, card, to: spotRef(spot), at: now } },
    sound: "pending",
  });

  if (role === "bags") return quiet({ ...base, screen: { kind: "place", place: spot } });

  if (role === "done") {
    if (!picked) return { state: { ...base, message: { tone: "warn", title: PICK_FIRST_TITLE, sub: PICK_FIRST_SUB } }, sound: "refused" };
    if (picked.done && inItsBag(picked)) return { state: { ...base, message: { tone: "info", title: doneAlreadyTitle(picked), sub: DONE_ALREADY_SUB } }, sound: "refused" };
    const why = moveRefusal(picked);
    if (why) return refuse(why);
    return wait("done", picked);
  }

  const cards = spot.cards;
  // The picked card is in this spot when the spot's answer lists it (its own place may be stale: someone
  // moved it meanwhile); by its place only when the answer was cut short (a place with 200+ cards)
  const here = !!picked && (cards.some((c) => c.id === picked.id) || (spot.cardCount > cards.length && picked.location?.code === spot.code));
  const fresh = picked ? cards.find((c) => c.id === picked.id) ?? picked : null;
  const off = spot.active === false;

  if (role === "desk") {
    // A desk is never full: a card picked elsewhere waits to go on it
    if (picked && !here) {
      const why = moveRefusal(picked);
      if (why) return refuse(why);
      if (!spot.active) return refuse(switchedOffText(spot.name));
      return wait("move", picked);
    }
    // No card picked, or the picked card is on this desk: the desk shows (one card: picked)
    const info: Message | null = picked && here
      ? { tone: "info", title: alreadyThereTitle(picked, spot), sub: cards.length > 1 ? TAP_TO_PICK : off ? SWITCHED_OFF_TEXT : PICKED_SUB }
      : null;
    if (!cards.length) return quiet({ ...base, screen: { kind: "place", place: spot }, message: info });
    return quiet({ ...showList(base, listOfPlace(spot)), message: info });
  }

  // A holder (a work-station slot, any other holder)
  if (!cards.length) {
    if (!picked) return quiet({ ...base, screen: { kind: "place", place: spot } });
    const why = moveRefusal(picked);
    if (why) return refuse(why);
    if (!spot.active) return refuse(switchedOffText(spot.name));
    return wait("move", picked);
  }
  if (picked && here && fresh) {
    // The spot the picked card is in: nothing to move, it just shows
    return quiet({ ...base, screen: pickedScreen(fresh, null, off), message: { tone: "info", title: alreadyThereTitle(fresh, spot), sub: off ? SWITCHED_OFF_TEXT : PICKED_SUB } });
  }
  // A spot with a card: that card is picked (another card was picked: it didn't move). Browsing
  // full holders is normal: the scan's own read beep only, and a line that says what happened
  const next = cards.length === 1 ? cards[0] : null;
  const shown: FlowState = next ? { ...base, screen: pickedScreen(next, null, off) } : { ...base, screen: { kind: "list", list: listOfPlace(spot) } };
  if (!picked) return quiet(shown);
  return quiet({ ...shown, message: { tone: "warn", title: spotTakenTitle(spot.name, cards), sub: spotTakenSub(picked, next) } });
}

/**
 * The scanner's repeat gate dropped `code` (the same label again within
 * SCAN_REPEAT_MS, 750 ms): when it is the spot the picked card waits to go
 * to, the page says to scan it again (the pending sound again, and
 * "Scan CLAMP 09 again"); it doesn't count as the second scan. Null: say
 * nothing (a plain double read).
 */
export function quickRepeat(state: FlowState, code: string): string | null {
  const p = state.pending;
  if (!p || state.saving || p.to.code !== code) return null;
  return scanAgainText(p.kind === "done" ? "DONE" : p.to.name);
}

/**
 * A scan that found nothing: not one of our codes, a code nothing has, a
 * lookup that failed. The waiting move is dropped (it was another scan); what
 * is on screen, and the picked card, stay.
 */
export function afterScanProblem(state: FlowState, text: string): Step {
  return { state: { ...state, pending: null, message: { tone: "error", title: text } }, sound: "refused" };
}

// ─── Saves ──────────────────────────────────────────────────────────────

/** Which tracking route a save calls, and its body (the page adds the session id). */
export type SaveCall =
  | { route: "assign"; body: AssignRequest }
  | { route: "move"; body: MoveRequest }
  | { route: "done"; body: DoneRequest }
  | { route: "release"; body: ReleaseRequest };

/**
 * Every save names where the card was when it was picked, so a card someone
 * moved meanwhile is refused (nothing written, no email), never taken or
 * finished from wherever it is now. From its bag (no place, a shelf, the Open
 * bags box, the Ready to ship bin): a move is an assign and Done is a done,
 * both with `fromBag`. From a holder or desk: a move, Done or Take out with
 * `fromCode` = that place.
 */
export function saveCall(save: Save): SaveCall {
  const { card } = save;
  const force = save.kind === "move" && save.force ? { force: true } : {};
  const out = !!card.location && !inItsBag(card);
  if (save.kind === "move") {
    if (out) return { route: "move", body: { fromCode: card.location!.code, toCode: save.to.code, cardIds: [card.id], ...force } };
    return { route: "assign", body: { locationCode: save.to.code, cardIds: [card.id], fromBag: true, ...force } };
  }
  if (save.kind === "done") return { route: "done", body: { cardIds: [card.id], ...(out ? { fromCode: card.location!.code } : { fromBag: true }) } };
  return { route: "release", body: { cardIds: [card.id], ...(card.location ? { fromCode: card.location.code } : {}) } };
}

/** A save's answer: the tracking API's (api.ts ApiResult). */
export type SaveOutcome =
  | { ok: true; res: TrackActionResponse }
  | { ok: false; error: string; status: number; conflict?: CapacityConflict; full?: HolderFull };

/**
 * After a save. Saved: the page is plain again with the result in the panel
 * ("CD-2549-03 is in CLAMP 07 now" for MOVED_SHOW_MS; Done and Take out say
 * where the bag is, until the next scan). Refused: the server's sentence,
 * the card stays picked (the page reads it again: refreshCard); a desk with a
 * limit set that is full asks "Add anyway?".
 */
export function afterSave(state: FlowState, outcome: SaveOutcome, now: number): Step {
  const save = state.saving;
  if (!save) return quiet(state);
  const base: FlowState = { ...state, saving: null, pending: null };
  const { card } = save;
  if (!outcome.ok) {
    if (outcome.full && save.kind === "move") {
      // A one-card holder filled meanwhile (409 HolderFull, one card per holder): what's in it, no "Add anyway", the card stays picked
      return {
        state: { ...base, message: { tone: "warn", title: holderFullTitle(save.to.name, outcome.full.occupants), sub: didntMoveText(card), card } },
        sound: "refused",
      };
    }
    if (outcome.conflict && save.kind === "move") {
      if (save.to.desk) {
        return {
          state: { ...base, message: { tone: "warn", title: addAnywayText(save.to.name, outcome.conflict), sub: inItNowText(outcome.conflict), card, retry: { ...save, force: true } } },
          sound: "refused",
        };
      }
      // A holder filled meanwhile: no "Add anyway" (one card per holder); what's in it, and the card stays picked
      return {
        state: { ...base, message: { tone: "warn", title: holderFullTitle(save.to.name, outcome.conflict.occupants), sub: didntMoveText(card), card } },
        sound: "refused",
      };
    }
    return { state: { ...base, message: { tone: "error", title: outcome.error, card } }, sound: "refused" };
  }
  const res = outcome.res;
  const mine = res.results.find((r) => r.cardId === card.id) ?? res.results[0];
  if (!mine?.ok) return { state: { ...base, message: { tone: "error", title: mine?.message || res.message, card } }, sound: "refused" };
  const ready: Screen = { kind: "ready" };
  if (save.kind === "move") {
    const to = res.location ?? save.to;
    const opened = (res.bags ?? []).filter((b) => b.opened);
    const sub = [
      to.kind === "station" ? stepLine(mine.stageLabel) : null,
      opened.length ? openBagsSentence(opened) : null,
      res.emailedOrders?.length ? EMAILED_TEXT : null,
    ].filter(Boolean).join(" ");
    return {
      state: { ...base, screen: ready, message: { tone: "ok", title: movedTitle(card, to), ...(sub ? { sub } : {}), card, until: now + MOVED_SHOW_MS } },
      sound: "moved",
    };
  }
  const out = outcomeOf(res);
  const title = save.kind === "takeout" && card.location ? takenOutText(cardLabel(card), card.location.name, res.bags) : out.title;
  const lines = orderCompletionNotes(res.orderCompletions);
  return {
    state: {
      ...base,
      screen: ready,
      message: {
        tone: "ok",
        title,
        ...(out.notes.length ? { sub: out.notes.join(" ") } : {}),
        ...(lines.length ? { lines } : {}),
        ...(out.bagLinks?.length ? { links: out.bagLinks.map((l) => ({ href: l.href, label: l.label })) } : {}),
        card,
      },
    },
    sound: "moved",
  };
}

/** The picked card read again after a refusal (where it really is now): shown if it is still the one picked. */
export function refreshCard(state: FlowState, card: TrackCardSummary): FlowState {
  const screen = state.screen;
  if (screen.kind !== "card" || screen.card.id !== card.id) return state;
  // Somewhere else now: the switched-off note was about the old place
  const off = !!screen.off && card.location?.code === screen.card.location?.code;
  return { ...state, screen: pickedScreen(card, screen.from, off) };
}

// ─── Taps ───────────────────────────────────────────────────────────────

/** A card tapped in a list: picked (the list stays for "Back"). */
export function pickCard(state: FlowState, card: TrackCardSummary): FlowState {
  const from = state.screen.kind === "list" ? state.screen.list : state.screen.kind === "card" ? state.screen.from : null;
  return { ...state, pending: null, message: null, screen: pickedScreen(card, from, !!from?.off) };
}

/** "Back to bag CD-2549-P": the list again, nothing picked. */
export function backToList(state: FlowState): FlowState {
  if (state.screen.kind !== "card" || !state.screen.from) return state;
  return { ...state, pending: null, message: null, screen: { kind: "list", list: state.screen.from } };
}

/** Cancel (or Esc): the waiting move goes; the card stays picked. */
export function cancelPending(state: FlowState): FlowState {
  return state.pending ? { ...state, pending: null } : state;
}

/** The waiting move or Done timed out (PENDING_MS): it goes, the panel says nothing moved, with a soft sound. Null: nothing to do. */
export function expirePending(state: FlowState, now: number): Step | null {
  const p = state.pending;
  if (!p || state.saving || now - p.at <= PENDING_MS) return null;
  return { state: { ...state, pending: null, message: { tone: "warn", title: EXPIRED_TITLE, sub: expiredSub(p.kind, p.to.name, p.card) } }, sound: "expired" };
}

/** A move's result has shown long enough (MOVED_SHOW_MS): the page is plain. Null: nothing to do. */
export function clearShownMessage(state: FlowState, now: number): FlowState | null {
  const m = state.message;
  if (!m?.until || now < m.until) return null;
  return { ...state, message: null };
}

/** The message goes (Hide). */
export function hideMessage(state: FlowState): FlowState {
  return state.message ? { ...state, message: null } : state;
}

/**
 * A tap on Done ("Mark done") or Take out for the picked card, or "Add
 * anyway". `busy`: a scan is being looked up or a save runs; nothing starts
 * and the screen stays as it is (the page only flashes SAVE_BUSY_TEXT).
 */
export function tapSave(state: FlowState, kind: "done" | "takeout" | "retry", busy: boolean): { ok: true; save: Save } | { ok: false; text: string } {
  if (busy || state.saving) return { ok: false, text: SAVE_BUSY_TEXT };
  if (kind === "retry") {
    const retry = state.message?.retry;
    return retry ? { ok: true, save: retry } : { ok: false, text: SAVE_BUSY_TEXT };
  }
  const card = pickedCard(state);
  if (!card || !cardActions(card)[kind]) return { ok: false, text: SAVE_BUSY_TEXT };
  return { ok: true, save: { kind, card } };
}

// ─── The top panel ──────────────────────────────────────────────────────

export type Panel =
  | { kind: "ready"; title: string; sub: string }
  | { kind: "pending"; title: string; sub: string; card: TrackCardSummary }
  | { kind: "saving"; title: string; card: TrackCardSummary }
  | { kind: "message"; message: Message }
  | { kind: "picked"; title: string; sub: string; card: TrackCardSummary };

/**
 * The one message at the top: a save running, else the waiting move ("Scan
 * CLAMP 07 again to move CD-2549-03 here"), else the last result or problem,
 * else the picked card ("Picked: CD-2549-03"), else "Ready to scan"
 * ("Getting ready…" until the page is listening for the scanner).
 */
export function panelOf(state: FlowState, listening = true): Panel {
  const s = state.saving;
  if (s) return { kind: "saving", title: savingTitle(s.kind, s.card, s.kind === "move" ? s.to.name : null), card: s.card };
  const p = state.pending;
  if (p) return { kind: "pending", title: p.kind === "done" ? pendingDoneTitle(p.card) : pendingMoveTitle(p.to.name, p.card), sub: PENDING_SUB, card: p.card };
  if (state.message) return { kind: "message", message: state.message };
  const card = pickedCard(state);
  if (card) {
    const off = state.screen.kind === "card" && !!state.screen.off;
    const sub = card.refunded ? REFUNDED_TEXT : !canMove(card) ? NOT_RECEIVED_TEXT : off ? SWITCHED_OFF_TEXT : PICKED_SUB;
    return { kind: "picked", title: pickedTitle(card), sub, card };
  }
  return { kind: "ready", title: listening ? READY_TITLE : STARTING_TITLE, sub: READY_SUB };
}
