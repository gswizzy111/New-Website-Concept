import { isDay, weekday } from "@/lib/intake/business-days";
import { orderPhotosPath } from "@/lib/intake/codes";
import { filingLetter } from "@/lib/intake/filing-letter";
import {
  BAG_FINISHED_TEXT, bagPlaceOrNone, doneCountText, isReadyToShipPlace, openBagsSentence, orderCompletionNotes, type ToneLine,
} from "@/lib/intake/tracking/bag-home";
import type { DeskCard } from "@/lib/intake/tracking/desk";
import { isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type { LocationRef, TrackActionResponse } from "@/lib/intake/tracking/types";
import { formatCurrency } from "@/lib/utils";
import { deskPhotoGroups } from "@/app/admin/receiving/desk/_lib/view";
import type { PhotoGroup } from "@/app/admin/receiving/[orderId]/photos/photo-grid";

/**
 * The card's receiving and customer photos side by side (two across on a
 * phone) instead of one stacked group each, so a bag's cards fit on a few
 * screens. The full-screen viewer still names each photo's kind.
 */
export function onePhotoRow(groups: PhotoGroup[]): PhotoGroup[] {
  if (groups.length <= 1) return groups;
  const photos = groups.flatMap((g) => g.photos);
  return [{ kind: groups[0].kind, title: `Photos (${photos.length})`, photos }];
}

/**
 * The scan landing (/admin/receiving/open/<Bag ID or order number>, where a
 * bag or order QR opens): what the page shows and says, without the
 * database. buildOpenView runs on the server (photo addresses come from
 * lib/thumbnail.ts); the rest is pure and safe in the client components and
 * in tests (tests/intake/bag-open.test.ts).
 *
 * Plain words on purpose (owner, Nov 25 2026: "make it much easier to
 * understand"): where a card is now ("In the bag", "On your desk", "In CLAMP
 * 07"), one button to move every card that can go to the desk, a button per
 * card. Moving to a desk changes the card's place only, never its step.
 */

/** A desk cards can be moved to (a switched-on LOC-DESK / LOC-DESK-<NAME>). */
export type OpenDesk = { id: string; code: string; name: string };

/** ready: here and can be worked on; done / refunded / not_here: greyed, no move button. */
export type OpenCardState = "ready" | "done" | "refunded" | "not_here";

export type OpenCard = {
  id: string;
  code: string | null;
  name: string;
  /** "CD-2549-03 Charizard" (photo descriptions). */
  label: string;
  /** "CD-2549-03", or the name before a Card ID is given (messages, button names). */
  short: string;
  /** "1999 · Base Set · #4/102 · Holo" */
  details: string;
  declaredValue: string | null;
  notes: string | null;
  knownDefects: string | null;
  /** The step in plain words, read only ("Not started", "Humidor", "Drying", "Done"). */
  stepLabel: string;
  state: OpenCardState;
  bagId: string | null;
  /** The slot or place it is in now (null: in its bag, or nowhere). */
  location: LocationRef | null;
  photos: PhotoGroup[];
};

export type OpenDue = { text: string; overdue: boolean };

/** A run of cards under a small heading: one tier bag, or the cards in no bag. */
export type OpenGroup = {
  key: string;
  /** "Platinum · CD-2549-P", "Not here yet", "Not in a bag", "Cards in this bag". */
  title: string;
  /** "Due Mon Dec 7 · 3 cards" (bags of an order code only). */
  subtitle: string | null;
  overdue: boolean;
  cards: OpenCard[];
};

export type OpenBagLine = {
  id: string;
  code: string;
  tier: string;
  tierName: string;
  due: OpenDue;
  cardCount: number;
  doneCount: number;
  /** "4 cards", "3 of 4 done". */
  countText: string;
  /** Where the bag is: "Open bags box · R", "Shelf DUE MON DEC 7", "Ready to ship", "No place yet". */
  place: string;
};

/** A bag as the board's buttons need it: where it is now (the Ready to ship step). */
export type OpenBagState = { id: string; code: string; location: LocationRef | null };

export type OpenHeader = {
  kind: "bag" | "order";
  /** The scanned code, normalized (CD-2549-P, CD-2549). */
  code: string;
  orderId: string;
  /** The customer's name, or "No name". */
  customer: string;
  orderNumber: string;
  /** /admin/orders/<orderId> */
  orderUrl: string;
  /** The photos page: the bag's (?bag=) for a bag code, the whole order's for an order code. */
  photosUrl: string;
  /** The order's notes from the customer (orders.customer_notes). */
  customerNotes: string | null;
  /** Cards in scope, refunded ones not counted. */
  cardCount: number;
  /** Of those, done. */
  doneCount: number;
  /** "4 cards" while none is done, then "3 of 4 done". */
  countText: string;
  /** A bag code: that bag. */
  bag: OpenBagLine | null;
  /** An order code: each of its bags. */
  bags: OpenBagLine[];
};

export type OpenView = { header: OpenHeader; groups: OpenGroup[]; bags: OpenBagState[] };

/** What the server loader hands over (lib rows already turned into DeskCard views). */
export type OpenInput = {
  kind: "bag" | "order";
  code: string;
  /** The scanned bag (a bag code). */
  bagId: string | null;
  order: { id: string; orderNumber: string; customer: string | null; customerNotes: string | null };
  /** Every bag of the order, fastest tier first, then batch; `location`: where the bag is. */
  bags: {
    id: string; code: string; tier: string; tierName: string; dueDate: string | null; complete: boolean;
    cardCount: number; doneCount: number; location: LocationRef | null;
  }[];
  /** Every card of the order, in card number order. */
  cards: DeskCard[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 cards", "1 card". */
export function cardsText(n: number): string {
  return `${n} card${n === 1 ? "" : "s"}`;
}

/**
 * "Due Mon Dec 7" (the year added only when it isn't this year's: "Due Mon
 * Jan 4, 2027"), "No due date yet"; overdue when the day is past and the bag
 * isn't all done. `today` is New York's day (nyToday()).
 */
export function dueText(day: string | null | undefined, today: string, complete = false): OpenDue {
  if (!isDay(day)) return { text: "No due date yet", overdue: false };
  const [y, m, d] = day.split("-").map(Number);
  const year = isDay(today) && today.slice(0, 4) === day.slice(0, 4) ? "" : `, ${y}`;
  return { text: `Due ${WEEKDAYS[weekday(day)]} ${MONTHS[m - 1]} ${d}${year}`, overdue: !complete && isDay(today) && day < today };
}

/** The card's state on this page: refunded, then done, then not arrived, else ready to work on. */
export function cardState(c: Pick<DeskCard, "refunded" | "done" | "received">): OpenCardState {
  if (c.refunded) return "refunded";
  if (c.done) return "done";
  if (!c.received) return "not_here";
  return "ready";
}

/** The greyed cards' pill: "Done", "Refunded", "Not here yet" (null for a card that's ready). */
export function stateText(state: OpenCardState): string | null {
  if (state === "done") return "Done";
  if (state === "refunded") return "Refunded";
  if (state === "not_here") return "Not here yet";
  return null;
}

/**
 * Where a card is now, in plain words, for the desk `deskId` picked on this
 * page: "On your desk", "On DESK GAVIN" (another desk), "In CLAMP 07" (a
 * holder), "On the shelf", "On the Done shelf", "In Shipping", "At BENCH 2",
 * "In the bag" (no place yet), "Not in a holder"; a greyed card says what it
 * is: "Done", "Refunded", "Not here yet".
 */
export function whereText(card: Pick<OpenCard, "state" | "location" | "bagId">, deskId: string | null): string {
  const greyed = stateText(card.state);
  if (greyed) return greyed;
  const loc = card.location;
  if (!loc) return card.bagId ? "In the bag" : "Not in a holder";
  if (deskId && loc.id === deskId) return "On your desk";
  if (loc.kind === "other" && isDeskCode(loc.code)) return `On ${loc.name}`;
  if (loc.kind === "station") return `In ${loc.name}`;
  if (loc.kind === "shelf") return "On the shelf";
  if (loc.kind === "done") return "On the Done shelf";
  if (loc.kind === "shipping") return "In Shipping";
  return `At ${loc.name}`;
}

/** Can go to the desk: here, not done, not refunded, and not on that desk already. */
export function canMove(card: Pick<OpenCard, "state" | "location">, deskId: string | null): boolean {
  return card.state === "ready" && !(deskId && card.location?.id === deskId);
}

export function onDesk(card: Pick<OpenCard, "state" | "location">, deskId: string | null): boolean {
  return card.state === "ready" && !!deskId && card.location?.id === deskId;
}

/** The big button's label: "Move all 3 cards to my desk", "Move 1 card to my desk". */
export function moveAllLabel(n: number): string {
  return n === 1 ? "Move 1 card to my desk" : `Move all ${n} cards to my desk`;
}

export type MoveAllState =
  /** `ids`: the cards the button moves; `alreadyOnDesk`: ready cards there already. */
  | { kind: "move"; ids: string[]; alreadyOnDesk: number }
  /** Nothing left to move and at least one card is on the desk. */
  | { kind: "all_on_desk"; onDesk: number }
  /** Nothing to move: why, in one sentence. */
  | { kind: "nothing"; text: string };

/** What the big button area shows for these cards and the desk picked. */
export function moveAllState(cards: readonly Pick<OpenCard, "id" | "state" | "location">[], deskId: string | null): MoveAllState {
  const ids = cards.filter((c) => canMove(c, deskId)).map((c) => c.id);
  const there = cards.filter((c) => onDesk(c, deskId)).length;
  if (ids.length) return { kind: "move", ids, alreadyOnDesk: there };
  if (there) return { kind: "all_on_desk", onDesk: there };
  return { kind: "nothing", text: nothingText(cards) };
}

function nothingText(cards: readonly Pick<OpenCard, "state">[]): string {
  if (!cards.length) return "No cards yet.";
  const live = cards.filter((c) => c.state !== "refunded");
  if (!live.length) return "Every card was refunded.";
  if (live.every((c) => c.state === "done")) return "Every card is done.";
  if (live.every((c) => c.state === "not_here")) return "No cards are here yet.";
  return "Nothing to move: every card is done or not here yet.";
}

/** "2 already on your desk". */
export function alreadyText(n: number): string {
  return `${n} already on your desk`;
}

/** "3 cards are on your desk", "1 card is on your desk". */
export function onDeskText(n: number): string {
  return n === 1 ? "1 card is on your desk" : `${n} cards are on your desk`;
}

export type MoveLine = { key: string; label: string; message: string };

/** What a move to the desk did. `movedIds`: the cards that are on the desk now (moved, or there already). */
export type MoveOutcome = {
  tone: "ok" | "warn" | "error";
  title: string;
  /** "1 not moved:" (null when every card went). */
  failedTitle: string | null;
  failed: MoveLine[];
  movedIds: string[];
};

/** The answer of POST /api/admin/track/assign in this page's words; the server's message for each card that didn't go. */
export function moveOutcome(res: Pick<TrackActionResponse, "results">): MoveOutcome {
  const results = res.results ?? [];
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  return {
    tone: !bad.length ? "ok" : ok.length ? "warn" : "error",
    title: ok.length ? onDeskText(ok.length) : "Not moved",
    failedTitle: bad.length ? `${bad.length} not moved:` : null,
    failed: bad.map((r, i) => ({ key: `${r.cardId}-${i}`, label: r.code ?? r.name ?? "Card", message: r.message })),
    movedIds: ok.map((r) => r.cardId),
  };
}

/** A request that failed as a whole: the server's sentence as it is. */
export function failedMove(error: string): MoveOutcome {
  return { tone: "error", title: "Not moved", failedTitle: null, failed: [{ key: "error", label: "", message: error }], movedIds: [] };
}

/** At most this many Card IDs per request (the assign route's limit, MAX_CARDS in lib/intake/tracking/moves.ts). */
export const MOVE_CHUNK = 200;

/** The cards to move, in requests of at most `size` (one request for 200 or fewer). */
export function moveChunks<T>(ids: readonly T[], size = MOVE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** One request of a chunked move: its answer, or the error of a request that failed as a whole (and how many cards it held). */
export type MovePart =
  | { ok: true; results: TrackActionResponse["results"]; bags?: TrackActionResponse["bags"] }
  | { ok: false; error: string; count: number };

/**
 * What a move sent in several requests did, as one outcome: the cards that
 * went from every answer, then each refused card and each failed request in
 * the server's own words. One request that failed as a whole reads exactly
 * as `failedMove`.
 */
export function chunkedMoveOutcome(parts: readonly MovePart[]): MoveOutcome {
  const results = parts.flatMap((p) => (p.ok ? p.results ?? [] : []));
  const failedParts = parts.filter((p): p is Extract<MovePart, { ok: false }> => !p.ok);
  if (!failedParts.length) return moveOutcome({ results });
  if (!results.length) return failedMove([...new Set(failedParts.map((p) => p.error))].join(" "));
  const out = moveOutcome({ results });
  const bad = results.filter((r) => !r.ok).length + failedParts.reduce((n, p) => n + p.count, 0);
  return {
    tone: out.movedIds.length ? "warn" : "error",
    title: out.title,
    failedTitle: `${bad} not moved:`,
    failed: [...out.failed, ...failedParts.map((p, i) => ({ key: `request-${i}`, label: "", message: p.error }))],
    movedIds: out.movedIds,
  };
}

/**
 * The desk to use: the one this phone remembered (its code) while it is
 * still a switched-on desk, else `fallbackId` (LOC-DESK, the first one),
 * else the first desk; null when there is none.
 */
export function chooseDesk(desks: readonly OpenDesk[], storedCode: string | null | undefined, fallbackId: string | null): OpenDesk | null {
  const want = (storedCode ?? "").trim().toUpperCase();
  return (want && desks.find((d) => d.code === want)) || desks.find((d) => d.id === fallbackId) || desks[0] || null;
}

const text = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One card as its panel shows it (server: the photo addresses). */
export function openCard(c: DeskCard): OpenCard {
  const name = text(c.name) ?? "Card";
  const label = c.code ? `${c.code} ${name}` : name;
  const details = [text(c.year), text(c.set), text(c.number) ? `#${text(c.number)}` : null, c.variation]
    .filter(Boolean).join(" · ") || "No year, set or number";
  return {
    id: c.id,
    code: c.code,
    name,
    label,
    short: c.code ?? name,
    details,
    declaredValue: c.declaredValueCents ? formatCurrency(c.declaredValueCents) : null,
    notes: c.notes,
    knownDefects: c.knownDefects,
    stepLabel: c.done ? "Done" : c.stageLabel,
    state: cardState(c),
    bagId: c.bagId,
    location: c.location,
    photos: onePhotoRow(deskPhotoGroups(c, label)),
  };
}

/** Refunded cards last; otherwise the order given (card number). */
function refundedLast<T extends { state: OpenCardState }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => Number(a.state === "refunded") - Number(b.state === "refunded"));
}

/**
 * The page for a bag code (that bag's cards under "Cards in this bag") or an
 * order code (every card, a heading per bag "Platinum · CD-2549-P", then the
 * cards in no bag under "Not here yet" or "Not in a bag"). `today` = nyToday().
 */
export function buildOpenView(input: OpenInput, today: string): OpenView {
  const { order } = input;
  const all = input.cards.map(openCard);
  const letter = filingLetter(order.customer);
  const line = (b: OpenInput["bags"][number]): OpenBagLine => ({
    id: b.id, code: b.code, tier: b.tier, tierName: b.tierName, due: dueText(b.dueDate, today, b.complete), cardCount: b.cardCount,
    doneCount: b.doneCount, countText: doneCountText(b.doneCount, b.cardCount), place: bagPlaceOrNone(b.location, letter),
  });
  const bag = input.kind === "bag" ? input.bags.find((b) => b.id === input.bagId) ?? null : null;
  const scoped = bag ? all.filter((c) => c.bagId === bag.id) : all;
  const groups: OpenGroup[] = [];
  if (bag) {
    if (scoped.length) groups.push({ key: bag.id, title: "Cards in this bag", subtitle: null, overdue: false, cards: refundedLast(scoped) });
  } else {
    for (const b of input.bags) {
      const cards = scoped.filter((c) => c.bagId === b.id);
      if (!cards.length) continue;
      const due = dueText(b.dueDate, today, b.complete);
      const live = cards.filter((c) => c.state !== "refunded").length;
      groups.push({ key: b.id, title: `${b.tierName} · ${b.code}`, subtitle: `${due.text} · ${cardsText(live)}`, overdue: due.overdue, cards: refundedLast(cards) });
    }
    const loose = scoped.filter((c) => !c.bagId || !input.bags.some((b) => b.id === c.bagId));
    if (loose.length) {
      const noneHere = loose.every((c) => c.state === "not_here" || c.state === "refunded");
      groups.push({ key: "no-bag", title: noneHere ? "Not here yet" : "Not in a bag", subtitle: null, overdue: false, cards: refundedLast(loose) });
    }
  }
  const live = scoped.filter((c) => c.state !== "refunded");
  const doneCount = live.filter((c) => c.state === "done").length;
  return {
    header: {
      kind: input.kind,
      code: input.code,
      orderId: order.id,
      customer: text(order.customer) ?? "No name",
      orderNumber: order.orderNumber,
      orderUrl: `/admin/orders/${encodeURIComponent(order.id)}`,
      photosUrl: orderPhotosPath(order.id, bag?.id),
      customerNotes: text(order.customerNotes),
      cardCount: live.length,
      doneCount,
      countText: doneCountText(doneCount, live.length),
      bag: bag ? line(bag) : null,
      bags: bag ? [] : input.bags.filter((b) => b.cardCount > 0).map(line),
    },
    groups,
    bags: (bag ? [bag] : input.bags).map((b) => ({ id: b.id, code: b.code, location: b.location })),
  };
}

// ─── Done ─────────────────────────────────────────────────────────────────

/** Cards "Done" and "Mark all N done" can finish: here, not done, not refunded (wherever they are). */
export function canFinish(card: Pick<OpenCard, "state">): boolean {
  return card.state === "ready";
}

/** The cards "Mark all N done" marks (null: fewer than 2, the cards' own Done buttons are enough). */
export function doneAllIds(cards: readonly Pick<OpenCard, "id" | "state">[]): string[] | null {
  const ids = cards.filter(canFinish).map((c) => c.id);
  return ids.length >= 2 ? ids : null;
}

/** "Mark all 4 done". */
export function doneAllLabel(n: number): string {
  return n === 1 ? "Mark 1 card done" : `Mark all ${n} done`;
}

/** "Mark all 4 cards done?" */
export function doneAllQuestion(n: number): string {
  return n === 1 ? "Mark 1 card done?" : `Mark all ${n} cards done?`;
}

/** One request of a Done (at most 200 cards each, like the moves). */
export type DonePart =
  | { ok: true; res: Pick<TrackActionResponse, "results" | "message" | "orderCompletions"> }
  | { ok: false; error: string; count: number };

/** What a Done said: the server's own line ("Done. Put it back in REYES's bag: Open bags box, under R."), each refused card, the order's line. */
export type DoneOutcome = {
  tone: "ok" | "warn" | "error";
  title: string;
  failedTitle: string | null;
  failed: MoveLine[];
  /** Cards that are done now (marked, or done already). */
  doneIds: string[];
  /** The order auto-complete lines: "Order completed. Pat Collector emailed." (green), or why not (amber). */
  notes: ToneLine[];
};

/** The answers of POST /api/admin/track/done (one per request) as one outcome. */
export function doneOutcome(parts: readonly DonePart[]): DoneOutcome {
  const oks = parts.filter((p): p is Extract<DonePart, { ok: true }> => p.ok);
  const bads = parts.filter((p): p is Extract<DonePart, { ok: false }> => !p.ok);
  const results = oks.flatMap((p) => p.res.results ?? []);
  const good = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  const notDone = refused.length + bads.reduce((n, p) => n + p.count, 0);
  const lines = [...new Set(oks.map((p) => p.res.message).filter(Boolean))];
  return {
    tone: !good.length ? "error" : notDone ? "warn" : "ok",
    title: good.length ? lines.join(" ") || "Done." : "Not done",
    failedTitle: notDone && good.length ? `${notDone} not done:` : null,
    failed: [
      ...refused.map((r, i) => ({ key: `${r.cardId}-${i}`, label: r.code ?? r.name ?? "Card", message: r.message })),
      ...bads.map((p, i) => ({ key: `request-${i}`, label: "", message: p.error })),
    ],
    doneIds: good.map((r) => r.cardId),
    notes: orderCompletionNotes(oks.flatMap((p) => p.res.orderCompletions ?? [])),
  };
}

/** "Put the bag in the Open bags box, under R." after a move to the desk took cards out of their bag ("" when none did). */
export function openBagsLine(parts: readonly MovePart[]): string {
  const opened = parts.flatMap((p) => (p.ok ? p.bags ?? [] : [])).filter((b) => b.opened);
  return openBagsSentence(opened.filter((b, i) => opened.findIndex((x) => x.id === b.id) === i));
}

/** A finished bag on this page: every live card done. `inBin`: it is in the Ready to ship bin already. */
export type BagStep = { id: string; code: string; total: number; inBin: boolean };

/**
 * The bags whose every live card (on this page) is done: the one big step
 * "Bag finished: put it in the Ready to ship bin" until the bag is there.
 * `binned`: bags this page just put in the bin.
 */
export function bagSteps(bags: readonly OpenBagState[], cards: readonly Pick<OpenCard, "bagId" | "state">[], binned: ReadonlySet<string> = new Set()): BagStep[] {
  return bags.flatMap((b) => {
    const live = cards.filter((c) => c.bagId === b.id && c.state !== "refunded");
    if (!live.length || !live.every((c) => c.state === "done")) return [];
    return [{ id: b.id, code: b.code, total: live.length, inBin: binned.has(b.id) || isReadyToShipPlace(b.location) }];
  });
}

/** The step's title: "Bag finished: put it in the Ready to ship bin"; with several bags on the page, "Bag CD-2549-P finished: ...". */
export function bagStepTitle(step: Pick<BagStep, "code">, several: boolean): string {
  return several ? `Bag ${step.code} finished: put it in the Ready to ship bin` : BAG_FINISHED_TEXT;
}

/** The step's button. */
export const BIN_BUTTON = "It's in the Ready to ship bin";
/** Once the bag is there. */
export const IN_BIN_TEXT = "In the Ready to ship bin";
