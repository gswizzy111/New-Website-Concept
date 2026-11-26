import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import type { CsvValue } from "@/lib/csv";
import { addCalendarDays, isDay, nyToday, toNyDate, weekday } from "@/lib/intake/business-days";
import { NOT_STARTED_LABEL } from "@/lib/intake/stage-plan";
import { dayText } from "@/lib/intake/tracking-format";
import { moveStageLabel } from "@/lib/intake/tracking/places";
import type { StageHistoryEntry } from "@/lib/intake/types";
import { adminStageLabel, parseStageEvent } from "@/lib/restoration-stages";

/**
 * Who did what: the Team > Activity page (/admin/team/activity) and the Team
 * page's "Cards this week". Owner, Nov 26 2026: "I want to hire and be able
 * to see who scanned what cards"; the log is "Only actions", the ones the
 * system already records with a name:
 *
 * - `card_moves` (`by`): moves into a holder or onto a desk ("Moved"), Done,
 *   Take out ("Taken out");
 * - `order_events` 'stage_update' (`metadata.by`): step changes (the step
 *   picker, the order page's stage buttons). A move into a holder writes one
 *   too, right after its card_moves row: that one is part of the move and
 *   counts once, as the move (its step change shows on the move's line);
 * - `cards.received_by` / `received_at`: received (a card_moves 'receive' row
 *   for the same card, by the same person, within RECEIPT_WINDOW_MS is the
 *   same receipt: counted once);
 * - `order_events` 'card_unreceived', 'card_added_at_receiving',
 *   'round_started' (`metadata.by`), and whatever else `EVENT_KINDS` lists;
 * - `tier_bag_due_changes.changed_by`: due date changes;
 * - `card_photo_events` (`by`; migration 20261126): receiving photos added,
 *   replaced or removed;
 * - `tier_bags.label_printed_by` / `label_printed_at` (20261126): the latest
 *   print of each bag's label.
 *
 * Before 20261126 is applied the last two are left out (`ActivityLoad.notes`
 * says so); nothing else changes.
 *
 * Looking a card up is never recorded. A line with no name ("Not recorded")
 * was saved before names were kept, or on the old site. Days are New York
 * days. Full admins' actions are included (their username is the name).
 *
 * The pure builders come first (tests); `loadActivity` reads the database
 * with the server admin client it is given: every read is paged (fetchAll)
 * or by at most 100 ids. No server-only import, so the pure parts are safe
 * anywhere.
 */

// ─── Kinds ───────────────────────────────────────────────────────────────

export const ACTIVITY_KINDS = [
  "received", "moved", "done", "taken_out", "step",
  "photo", "label_printed", "card_added", "unreceived", "new_round", "due_date",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The counts per person per day the owner asked for, in this order. */
export const COUNTED_KINDS = ["received", "moved", "done", "taken_out", "step"] as const;
export type CountedKind = (typeof COUNTED_KINDS)[number];

/** What one action is called in the list, the filter and the CSV. */
export const ACTION_LABEL: Record<ActivityKind, string> = {
  received: "Received",
  moved: "Moved",
  done: "Done",
  taken_out: "Taken out",
  step: "Step change",
  photo: "Photo",
  label_printed: "Label printed",
  unreceived: "Receiving undone",
  card_added: "Card added",
  new_round: "New round",
  due_date: "Due date changed",
};

/** Column headings of the per-day counts. */
export const COUNT_LABEL: Record<CountedKind, string> = {
  received: "Received",
  moved: "Moved",
  done: "Done",
  taken_out: "Taken out",
  step: "Step changes",
};

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && (ACTIVITY_KINDS as readonly string[]).includes(v);
}

const isCounted = (k: ActivityKind): k is CountedKind => (COUNTED_KINDS as readonly string[]).includes(k);

/** The kind of a card_moves row (assign / move / ship_check put a card somewhere; receive is receiving). */
export function moveKind(action: string): ActivityKind | null {
  if (action === "done") return "done";
  if (action === "release") return "taken_out";
  if (action === "receive") return "received";
  if (action === "assign" || action === "move" || action === "ship_check") return "moved";
  return null;
}

/** What a card_photo_events row did, as the list says it. */
export const PHOTO_DETAIL: Readonly<Record<string, string>> = {
  add: "Added a photo",
  replace: "Replaced a photo",
  remove: "Removed a photo",
};

/** The order_events types that are someone's action on a card, and what each is. */
export const EVENT_KINDS: Readonly<Record<string, ActivityKind>> = {
  stage_update: "step",
  card_unreceived: "unreceived",
  card_added_at_receiving: "card_added",
  round_started: "new_round",
};

// ─── People ──────────────────────────────────────────────────────────────

/** A name nobody can have (usernames are letters, digits and . _ -): the "Not recorded" filter. */
export const NOT_RECORDED_KEY = "~none";
export const NOT_RECORDED = "Not recorded";

/** The name as recorded, trimmed; null when none was saved. */
export function actorOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
export const personKey = (by: string | null): string => by ?? NOT_RECORDED_KEY;
export const personLabel = (by: string | null): string => by ?? NOT_RECORDED;

/** "Not recorded" last; else more actions first, then by name. */
function comparePeople(a: { by: string | null; total: number }, b: { by: string | null; total: number }): number {
  if ((a.by === null) !== (b.by === null)) return a.by === null ? 1 : -1;
  return b.total - a.total || (a.by ?? "").localeCompare(b.by ?? "");
}

// ─── Rows as read ────────────────────────────────────────────────────────

export type MoveRow = {
  id: string;
  card_id: string;
  order_id: string | null;
  bag_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  stage_before: string | null;
  stage_after: string | null;
  action: string;
  by: string | null;
  created_at: string;
};
export type EventRow = {
  id: string;
  order_id: string | null;
  event_type: string;
  description: string | null;
  metadata: unknown;
  created_at: string;
};
export type ReceiptRow = {
  id: string;
  order_id: string | null;
  bag_id: string | null;
  card_code: string | null;
  card_name: string | null;
  received_at: string;
  received_by: string | null;
};
export type DueChangeRow = {
  id: string;
  bag_id: string;
  old_due: string | null;
  new_due: string | null;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
};
export type PhotoEventRow = {
  id: string;
  card_id: string;
  order_id: string | null;
  action: string;
  by: string | null;
  created_at: string;
};
export type LabelPrintRow = {
  id: string;
  order_id: string | null;
  bag_code: string | null;
  label_printed_at: string;
  label_printed_by: string | null;
};
export type CardRef = { orderId: string | null; bagId: string | null; code: string | null; name: string | null };
export type BagRef = { orderId: string | null; code: string | null };

export const MOVE_COLUMNS = "id, card_id, order_id, bag_id, from_location_id, to_location_id, stage_before, stage_after, action, by, created_at";
export const EVENT_COLUMNS = "id, order_id, event_type, description, metadata, created_at";
export const RECEIPT_COLUMNS = "id, order_id, bag_id, card_code, card_name, received_at, received_by";
export const DUE_CHANGE_COLUMNS = "id, bag_id, old_due, new_due, reason, changed_by, created_at";
export const PHOTO_EVENT_COLUMNS = "id, card_id, order_id, action, by, created_at";
export const LABEL_PRINT_COLUMNS = "id, order_id, bag_code, label_printed_at, label_printed_by";

// ─── One action ──────────────────────────────────────────────────────────

/** Where a card was before its first place, and after Done: back in its bag. */
export const IN_BAG = "Its bag";
/** Where a card is after Take out: in no place. */
export const OUT = "Out";

export type ActivityAction = {
  /** "move:<id>", "event:<id>", "card:<id>" (a receipt), "due:<id>". */
  id: string;
  at: string;
  /** New York day of `at`. */
  day: string;
  /** The username as recorded; null = not recorded. */
  by: string | null;
  kind: ActivityKind;
  cardId: string | null;
  cardCode: string | null;
  cardName: string | null;
  bagId: string | null;
  bagCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  /** Where the card went ("CLAMP 07" → "HEAT PRESS 01"); `from` null = not shown (a receipt). */
  place: { from: string | null; to: string } | null;
  /** The step it changed ("Clamp Work" → "Heat Press", "Drying" for Book); `from` null = not known. */
  step: { from: string | null; to: string } | null;
  /** Anything else ("Round 2", "Mon, Dec 7, 2026 → Fri, Dec 11, 2026 · reason"). */
  detail: string | null;
};

export type ActivityInput = {
  moves: readonly MoveRow[];
  /** Events in the range read: 'stage_update' and the other EVENT_KINDS. */
  events: readonly EventRow[];
  /** 'stage_update' events before the range, for the step a card came from. */
  priorSteps?: readonly EventRow[];
  receipts: readonly ReceiptRow[];
  dueChanges?: readonly DueChangeRow[];
  photoEvents?: readonly PhotoEventRow[];
  labelPrints?: readonly LabelPrintRow[];
  cards?: ReadonlyMap<string, CardRef>;
  /** Order id → order number. */
  orders?: ReadonlyMap<string, string>;
  /** Place id → its name ("CLAMP 07"). */
  places?: ReadonlyMap<string, string>;
  bags?: ReadonlyMap<string, BagRef>;
};

/** How long after a move its own stage event can be written (same request: milliseconds; this is generous). */
export const MOVE_STEP_WINDOW_MS = 60_000;
/** A 'receive' move this close to a card's received_at, by the same person, is the same receipt. */
export const RECEIPT_WINDOW_MS = 10 * 60_000;

const timeOf = (iso: string) => Date.parse(iso) || 0;
const meta = (e: EventRow): Record<string, unknown> => (e.metadata && typeof e.metadata === "object" ? e.metadata as Record<string, unknown> : {});
const byOldest = <T extends { id: string; created_at: string }>(a: T, b: T) => timeOf(a.created_at) - timeOf(b.created_at) || a.id.localeCompare(b.id);
const stepLabel = (stage: string, round: number) => (round > 1 ? `${adminStageLabel(stage)} (round ${round})` : adminStageLabel(stage));

/** The card an event is about (metadata.card_id, or the old "[card:<id>]" description). */
export function eventCardId(e: EventRow): string | null {
  if (e.event_type === "stage_update") return parseStageEvent(e)?.card_id ?? null;
  const id = meta(e).card_id;
  return typeof id === "string" && id ? id : null;
}

/**
 * Every recorded action of the rows given, newest first (time, then id).
 * With `range` ({ from, to } New York days), only actions on those days.
 * A stage event written by a move (same card, same step, same name, within
 * MOVE_STEP_WINDOW_MS after it) is part of that move and not listed.
 */
export function buildActivity(input: ActivityInput, range?: { from: string; to: string }): ActivityAction[] {
  const cards = input.cards ?? new Map<string, CardRef>();
  const orders = input.orders ?? new Map<string, string>();
  const places = input.places ?? new Map<string, string>();
  const bags = input.bags ?? new Map<string, BagRef>();
  const placeName = (id: string | null, none: string) => (id ? places.get(id) ?? "A place" : none);
  const cardBits = (cardId: string | null, orderId: string | null) => {
    const c = cardId ? cards.get(cardId) : undefined;
    const order = orderId ?? c?.orderId ?? null;
    const bag = c?.bagId ? bags.get(c.bagId) : undefined;
    return {
      cardId,
      cardCode: c?.code ?? null,
      cardName: c?.name ?? null,
      bagId: c?.bagId ?? null,
      bagCode: bag?.code ?? null,
      orderId: order,
      orderNumber: order ? orders.get(order) ?? null : null,
    };
  };

  // Stage events per card, oldest first (before the range too): the step each change came from
  const stepEvents = [...new Map([...(input.priorSteps ?? []), ...input.events]
    .filter((e) => e.event_type === "stage_update")
    .map((e) => [e.id, e] as const)).values()].sort(byOldest);
  const previous = new Map<string, { stage: string; round: number } | null>();
  const lastByCard = new Map<string, { stage: string; round: number }>();
  for (const e of stepEvents) {
    const s = parseStageEvent(e);
    if (!s) continue;
    previous.set(e.id, lastByCard.get(s.card_id) ?? null);
    lastByCard.set(s.card_id, { stage: s.stage, round: s.round });
  }

  // A move into a holder writes its stage event right after it: that event is the move's
  const claimed = new Set<string>();
  const stepsByCard = new Map<string, { e: EventRow; stage: string; at: number; by: string | null }[]>();
  for (const e of input.events) {
    const s = e.event_type === "stage_update" ? parseStageEvent(e) : null;
    if (!s) continue;
    const list = stepsByCard.get(s.card_id) ?? [];
    list.push({ e, stage: s.stage, at: timeOf(e.created_at), by: actorOf(meta(e).by) });
    stepsByCard.set(s.card_id, list);
  }
  for (const list of stepsByCard.values()) list.sort((a, b) => byOldest(a.e, b.e));
  for (const m of [...input.moves].sort(byOldest)) {
    if (!m.stage_after || m.stage_after === "done" || m.stage_after === m.stage_before) continue;
    const t = timeOf(m.created_at);
    const by = actorOf(m.by);
    const hit = stepsByCard.get(m.card_id)?.find((s) =>
      !claimed.has(s.e.id) && s.stage === m.stage_after && s.by === by && s.at - t >= -5_000 && s.at - t <= MOVE_STEP_WINDOW_MS);
    if (hit) claimed.add(hit.e.id);
  }

  // Where a step change came from: the card's previous step this round; none (or an earlier
  // round's) = Not started, once the earlier events were read (`priorSteps`), else not known
  const knowsPrior = input.priorSteps !== undefined;
  const stepFrom = (eventId: string, round: number): string | null => {
    const prev = previous.get(eventId) ?? null;
    if (prev && prev.round === round) return stepLabel(prev.stage, prev.round);
    return prev || knowsPrior || round > 1 ? NOT_STARTED_LABEL : null;
  };

  const out: ActivityAction[] = [];
  const push =(a: Omit<ActivityAction, "day"> & { day?: string }) => {
    const day = a.day ?? toNyDate(a.at);
    if (!day) return;
    if (range && (day < range.from || day > range.to)) return;
    out.push({ ...a, day });
  };

  for (const m of input.moves) {
    const kind = moveKind(m.action);
    if (!kind) continue;
    const placeChanged = m.from_location_id !== m.to_location_id;
    const stepChanged = m.stage_before !== m.stage_after;
    push({
      id: `move:${m.id}`,
      at: m.created_at,
      by: actorOf(m.by),
      kind,
      ...cardBits(m.card_id, m.order_id),
      place: placeChanged || kind !== "done"
        ? { from: placeName(m.from_location_id, IN_BAG), to: placeName(m.to_location_id, kind === "taken_out" ? OUT : IN_BAG) }
        : null,
      step: stepChanged ? { from: moveStageLabel(m.stage_before), to: moveStageLabel(m.stage_after) } : null,
      detail: null,
    });
  }

  for (const e of input.events) {
    const kind = EVENT_KINDS[e.event_type];
    if (!kind || claimed.has(e.id)) continue;
    const m = meta(e);
    const cardId = eventCardId(e);
    let step: ActivityAction["step"] = null;
    let detail: string | null = null;
    if (e.event_type === "stage_update") {
      const s = parseStageEvent(e);
      if (!s) continue;
      step = { from: stepFrom(e.id, s.round), to: stepLabel(s.stage, s.round) };
    } else if (e.event_type === "round_started") {
      const r = Number(m.round);
      detail = Number.isFinite(r) && r > 1 ? `Round ${r}` : null;
    }
    push({
      id: `event:${e.id}`,
      at: e.created_at,
      by: actorOf(m.by),
      kind,
      ...cardBits(cardId, e.order_id),
      place: null,
      step,
      detail,
    });
  }

  const receiveMoves = new Map<string, { at: number; by: string | null }[]>();
  for (const m of input.moves) {
    if (m.action !== "receive") continue;
    receiveMoves.set(m.card_id, [...(receiveMoves.get(m.card_id) ?? []), { at: timeOf(m.created_at), by: actorOf(m.by) }]);
  }
  for (const r of input.receipts) {
    const at = timeOf(r.received_at);
    const by = actorOf(r.received_by);
    if (receiveMoves.get(r.id)?.some((m) => m.by === by && Math.abs(m.at - at) <= RECEIPT_WINDOW_MS)) continue;
    const bag = r.bag_id ? bags.get(r.bag_id) : undefined;
    const order = r.order_id;
    push({
      id: `card:${r.id}`,
      at: r.received_at,
      by,
      kind: "received",
      cardId: r.id,
      cardCode: r.card_code,
      cardName: r.card_name,
      bagId: r.bag_id,
      bagCode: bag?.code ?? null,
      orderId: order,
      orderNumber: order ? orders.get(order) ?? null : null,
      place: bag?.code ? { from: null, to: `Bag ${bag.code}` } : null,
      step: null,
      detail: null,
    });
  }

  for (const d of input.dueChanges ?? []) {
    const bag = bags.get(d.bag_id);
    const order = bag?.orderId ?? null;
    const reason = d.reason?.trim();
    push({
      id: `due:${d.id}`,
      at: d.created_at,
      by: actorOf(d.changed_by),
      kind: "due_date",
      cardId: null,
      cardCode: null,
      cardName: null,
      bagId: d.bag_id,
      bagCode: bag?.code ?? null,
      orderId: order,
      orderNumber: order ? orders.get(order) ?? null : null,
      place: null,
      step: null,
      detail: `${dayText(d.old_due)} → ${dayText(d.new_due)}${reason ? ` · ${reason}` : ""}`,
    });
  }

  for (const p of input.photoEvents ?? []) {
    push({
      id: `photo:${p.id}`,
      at: p.created_at,
      by: actorOf(p.by),
      kind: "photo",
      ...cardBits(p.card_id, p.order_id),
      place: null,
      step: null,
      detail: PHOTO_DETAIL[p.action] ?? "Changed a photo",
    });
  }

  for (const l of input.labelPrints ?? []) {
    push({
      id: `label:${l.id}`,
      at: l.label_printed_at,
      by: actorOf(l.label_printed_by),
      kind: "label_printed",
      cardId: null,
      cardCode: null,
      cardName: null,
      bagId: l.id,
      bagCode: l.bag_code,
      orderId: l.order_id,
      orderNumber: l.order_id ? orders.get(l.order_id) ?? null : null,
      place: null,
      step: null,
      detail: null,
    });
  }

  return out.sort((a, b) => timeOf(b.at) - timeOf(a.at) || b.id.localeCompare(a.id));
}

/** "CLAMP 07 → HEAT PRESS 01" (a receipt: "→ Bag CD-2549-P"); "" when the action has no place. */
export function placeText(a: Pick<ActivityAction, "place">): string {
  if (!a.place) return "";
  return a.place.from ? `${a.place.from} → ${a.place.to}` : `→ ${a.place.to}`;
}

/** "Clamp Work → Heat Press" ("→ Heat Press" when where it came from isn't known); "" without a step. */
export function stepText(a: Pick<ActivityAction, "step">): string {
  if (!a.step) return "";
  return a.step.from ? `${a.step.from} → ${a.step.to}` : `→ ${a.step.to}`;
}

/** The action's "from → to" in one line: place, then step, then detail. */
export function fromToText(a: Pick<ActivityAction, "place" | "step" | "detail">): string {
  const step = stepText(a);
  return [placeText(a), step && (a.place ? `Step ${step}` : step), a.detail ?? ""].filter(Boolean).join(" · ");
}

/**
 * The card page's Restoration history: a Done line saved without a name
 * takes the name of the Done action recorded with it (within 5 minutes).
 */
export function withDoneBy(history: readonly StageHistoryEntry[], actions: readonly ActivityAction[]): StageHistoryEntry[] {
  return history.map((h) => {
    if (h.kind !== "completed" || h.by || !h.at) return h;
    const at = timeOf(h.at);
    const done = actions.find((a) => a.kind === "done" && a.by && Math.abs(timeOf(a.at) - at) <= 5 * 60_000);
    return done ? { ...h, by: done.by } : h;
  });
}

// ─── Counts ──────────────────────────────────────────────────────────────

export type Counts = Record<CountedKind, number> & {
  /** Photos, labels printed, cards added, receiving undone, new rounds, due date changes. */
  other: number;
  /** Every action. */
  total: number;
  /** Different cards. */
  cards: number;
};
export type PersonDay = { day: string; by: string | null; counts: Counts };
export type DaySummary = { day: string; people: PersonDay[]; counts: Counts };
export type PersonTotal = { by: string | null; counts: Counts; days: number };
export type ActivitySummary = { days: DaySummary[]; people: PersonTotal[]; counts: Counts };

function countsOf(actions: readonly ActivityAction[]): Counts {
  const c: Counts = { received: 0, moved: 0, done: 0, taken_out: 0, step: 0, other: 0, total: actions.length, cards: 0 };
  const cards = new Set<string>();
  for (const a of actions) {
    if (isCounted(a.kind)) c[a.kind] += 1;
    else c.other += 1;
    if (a.cardId) cards.add(a.cardId);
  }
  c.cards = cards.size;
  return c;
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Per day (newest first) per person, and per person over all the days. */
export function summarize(actions: readonly ActivityAction[]): ActivitySummary {
  const days = [...groupBy(actions, (a) => a.day)].map(([day, list]): DaySummary => ({
    day,
    counts: countsOf(list),
    people: [...groupBy(list, (a) => personKey(a.by))]
      .map(([, mine]) => ({ day, by: mine[0].by, counts: countsOf(mine) }))
      .sort((a, b) => comparePeople({ by: a.by, total: a.counts.total }, { by: b.by, total: b.counts.total })),
  })).sort((a, b) => b.day.localeCompare(a.day));
  const people = [...groupBy(actions, (a) => personKey(a.by))]
    .map(([, mine]): PersonTotal => ({ by: mine[0].by, counts: countsOf(mine), days: new Set(mine.map((a) => a.day)).size }))
    .sort((a, b) => comparePeople({ by: a.by, total: a.counts.total }, { by: b.by, total: b.counts.total }));
  return { days, people, counts: countsOf(actions) };
}

/** Different cards each person handled (key: personKey). */
export function cardsHandled(actions: readonly ActivityAction[]): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const a of actions) {
    if (!a.cardId) continue;
    const k = personKey(a.by);
    if (!sets.has(k)) sets.set(k, new Set());
    sets.get(k)!.add(a.cardId);
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}

/** The people in the actions, as the person filter lists them ("Not recorded" last). */
export function peopleIn(actions: readonly ActivityAction[]): { key: string; label: string }[] {
  return summarize(actions).people.map((p) => ({ key: personKey(p.by), label: personLabel(p.by) }));
}

// ─── Filters ─────────────────────────────────────────────────────────────

export const DEFAULT_RANGE_DAYS = 7;
export const MAX_RANGE_DAYS = 92;

export type ActivityFilters = {
  from: string;
  to: string;
  /** personKey of the person, or null for everyone. */
  person: string | null;
  action: ActivityKind | null;
  /** Said above the results when the range asked for was changed. */
  note: string | null;
};

type Params = Record<string, string | string[] | undefined>;
const param = (p: Params, k: string): string | undefined => {
  const v = p[k];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The filters in the page's address: `from` / `to` (New York days; default
 * the last 7 days to today; never past today; at most MAX_RANGE_DAYS),
 * `person` (a username, or NOT_RECORDED_KEY), `action` (an ActivityKind).
 */
export function readFilters(params: Params, today: string = nyToday()): ActivityFilters {
  const rawTo = param(params, "to");
  const rawFrom = param(params, "from");
  let to = isDay(rawTo) && rawTo <= today ? rawTo : today;
  let from = isDay(rawFrom) ? (rawFrom > today ? today : rawFrom) : addCalendarDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  let note: string | null = null;
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    from = addCalendarDays(to, -(MAX_RANGE_DAYS - 1));
    note = `Showing ${MAX_RANGE_DAYS} days at most: ${dayText(from)} to ${dayText(to)}.`;
  }
  const person = param(params, "person")?.trim().slice(0, 120) || null;
  const action = param(params, "action");
  return { from, to, person, action: isActivityKind(action) ? action : null, note };
}

/** The actions the person and action filters keep (the days are read already). */
export function applyFilters(actions: readonly ActivityAction[], f: Pick<ActivityFilters, "person" | "action">): ActivityAction[] {
  return actions.filter((a) => (!f.person || personKey(a.by) === f.person) && (!f.action || a.kind === f.action));
}

/** "?from=…&to=…&person=…&action=…" for links (extra values added, empty ones left out). */
export function activityQuery(f: Pick<ActivityFilters, "from" | "to" | "person" | "action">, extra: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  q.set("from", f.from);
  q.set("to", f.to);
  if (f.person) q.set("person", f.person);
  if (f.action) q.set("action", f.action);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") q.set(k, String(v));
  return `?${q.toString()}`;
}

/** Monday of `day`'s week (New York days): "this week" on the Team page. */
export function weekStart(day: string = nyToday()): string {
  return addCalendarDays(day, -((weekday(day) + 6) % 7));
}

// ─── CSV ─────────────────────────────────────────────────────────────────

const nyTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** "4:12 PM" in New York. */
export function actionTime(a: Pick<ActivityAction, "at">): string {
  return nyTime(a.at);
}

export const ACTIVITY_CSV_HEADER = [
  "Date", "Time (New York)", "Person", "Action", "Card ID", "Card name", "Bag", "Order",
  "From place", "To place", "Step before", "Step after", "Details",
];

/** The actions as CSV rows (header first), for lib/csv.ts csvText. */
export function activityCsvRows(actions: readonly ActivityAction[]): CsvValue[][] {
  return [
    ACTIVITY_CSV_HEADER,
    ...actions.map((a) => [
      a.day,
      nyTime(a.at),
      personLabel(a.by),
      ACTION_LABEL[a.kind],
      a.cardCode ?? "",
      a.cardName ?? "",
      a.bagCode ?? "",
      a.orderNumber ? `#${a.orderNumber}` : "",
      a.place?.from ?? "",
      a.place?.to ?? "",
      a.step?.from ?? "",
      a.step?.to ?? "",
      a.detail ?? "",
    ]),
  ];
}

export const DAILY_CSV_HEADER = ["Date", "Person", ...COUNTED_KINDS.map((k) => COUNT_LABEL[k]), "Other", "Cards"];

/** The per-person per-day counts as CSV rows (header first). */
export function dailyCsvRows(days: readonly DaySummary[]): CsvValue[][] {
  return [
    DAILY_CSV_HEADER,
    ...days.flatMap((d) => d.people.map((p) => [
      d.day,
      personLabel(p.by),
      ...COUNTED_KINDS.map((k) => p.counts[k]),
      p.counts.other,
      p.counts.cards,
    ])),
  ];
}

// ─── Server loader ───────────────────────────────────────────────────────

const CHUNK = 100;
const chunks = <T,>(xs: readonly T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const uniq = (xs: readonly (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/**
 * The UTC times that surely cover New York days `from`..`to` (midnight there
 * is 04:00 or 05:00 UTC); buildActivity keeps only the actions on those days.
 */
export function readBounds(range: { from: string; to: string }): { lo: string; hi: string } {
  return { lo: `${range.from}T04:00:00.000Z`, hi: `${addCalendarDays(range.to, 1)}T05:00:00.000Z` };
}

export type ActivityLoad =
  | { ok: true; actions: ActivityAction[]; notes: string[] }
  | { ok: false; status: number; error: string };

/** The words when photos and label prints can't be read yet (20261126 not applied). */
export const PHOTOS_LABELS_MISSING = "Photos and label prints aren't in this log yet: the database update that records who did them isn't applied.";

/** A table or column the database doesn't have (yet). */
export function isMissingTable(message: string): boolean {
  return /does not exist|schema cache|PGRST20[045]|42P01|42703/i.test(message);
}

/** A read of a source added by 20261126: [] (and a note) while the database doesn't have it. */
async function optional<T>(read: () => Promise<T[]>, missing: { yes: boolean }): Promise<T[]> {
  try {
    return await read();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingTable(message)) throw e;
    missing.yes = true;
    return [];
  }
}

/**
 * Every recorded action on New York days `range.from`..`range.to`, newest
 * first. Never throws: a failed read answers { ok: false, status: 500 }
 * whose message names what couldn't be read (before
 * 20261124_card_tracking.sql is applied, `card_moves` is missing). Photos and
 * label prints (20261126) are left out with a note while their table or
 * column is missing.
 */
export async function loadActivity(admin: SupabaseClient, range: { from: string; to: string }): Promise<ActivityLoad> {
  if (!isDay(range.from) || !isDay(range.to)) return { ok: false, status: 400, error: "Pick a start and an end day." };
  const { lo, hi } = readBounds(range);
  const missing = { yes: false };
  const named = <T,>(table: string, read: Promise<T[]>) => read.catch((e: unknown) => {
    throw new Error(`${table}: ${e instanceof Error ? e.message : String(e)}`);
  });
  try {
    // Step events on their own (eq: the partial index on order_events (created_at) where
    // event_type = 'stage_update' serves it), the few other kinds of event in a second read
    const otherEventTypes = Object.keys(EVENT_KINDS).filter((t) => t !== "stage_update");
    const [moves, stepEvents, otherEvents, receipts, dueChanges, placeRows, photoEvents, labelPrints] = await Promise.all([
      named("card_moves", fetchAll<MoveRow>((f, t) => admin.from("card_moves").select(MOVE_COLUMNS)
        .gte("created_at", lo).lt("created_at", hi).order("created_at").order("id").range(f, t))),
      named("order_events", fetchAll<EventRow>((f, t) => admin.from("order_events").select(EVENT_COLUMNS)
        .eq("event_type", "stage_update")
        .gte("created_at", lo).lt("created_at", hi).order("created_at").order("id").range(f, t))),
      named("order_events", fetchAll<EventRow>((f, t) => admin.from("order_events").select(EVENT_COLUMNS)
        .in("event_type", otherEventTypes)
        .gte("created_at", lo).lt("created_at", hi).order("created_at").order("id").range(f, t))),
      named("cards", fetchAll<ReceiptRow>((f, t) => admin.from("cards").select(RECEIPT_COLUMNS)
        .gte("received_at", lo).lt("received_at", hi).order("received_at").order("id").range(f, t))),
      named("tier_bag_due_changes", fetchAll<DueChangeRow>((f, t) => admin.from("tier_bag_due_changes").select(DUE_CHANGE_COLUMNS)
        .gte("created_at", lo).lt("created_at", hi).order("created_at").order("id").range(f, t))),
      named("locations", fetchAll<{ id: string; name: string }>((f, t) => admin.from("locations").select("id, name").order("id").range(f, t))),
      optional(() => named("card_photo_events", fetchAll<PhotoEventRow>((f, t) => admin.from("card_photo_events").select(PHOTO_EVENT_COLUMNS)
        .gte("created_at", lo).lt("created_at", hi).order("created_at").order("id").range(f, t))), missing),
      optional(() => named("tier_bags", fetchAll<LabelPrintRow>((f, t) => admin.from("tier_bags").select(LABEL_PRINT_COLUMNS)
        .gte("label_printed_at", lo).lt("label_printed_at", hi).order("label_printed_at").order("id").range(f, t))), missing),
    ]);

    const events = [...stepEvents, ...otherEvents];
    // The step each card was at before the range: its orders' earlier stage events
    const stepOrders = uniq(stepEvents.map((e) => e.order_id));
    const priorSteps = (await Promise.all(chunks(stepOrders).map((part) => named("order_events", fetchAll<EventRow>((f, t) =>
      admin.from("order_events").select(EVENT_COLUMNS).eq("event_type", "stage_update").in("order_id", part)
        .lt("created_at", lo).order("created_at").order("id").range(f, t)))))).flat();

    // Card IDs and names, order numbers, bag codes (by id, at most 100 a read)
    const cards = new Map<string, CardRef>(receipts.map((r) => [r.id, { orderId: r.order_id, bagId: r.bag_id, code: r.card_code, name: r.card_name }]));
    const cardIds = uniq([...moves.map((m) => m.card_id), ...events.map(eventCardId), ...photoEvents.map((p) => p.card_id)]).filter((id) => !cards.has(id));
    for (const part of chunks(cardIds)) {
      const { data, error } = await admin.from("cards").select("id, order_id, bag_id, card_code, card_name").in("id", part);
      if (error) throw new Error(`cards: ${error.message}`);
      for (const c of data ?? []) cards.set(c.id as string, { orderId: c.order_id as string | null, bagId: c.bag_id as string | null, code: c.card_code as string | null, name: c.card_name as string | null });
    }
    const bags = new Map<string, BagRef>();
    for (const part of chunks(uniq([...[...cards.values()].map((c) => c.bagId), ...dueChanges.map((d) => d.bag_id)]))) {
      const { data, error } = await admin.from("tier_bags").select("id, order_id, bag_code").in("id", part);
      if (error) throw new Error(`tier_bags: ${error.message}`);
      for (const b of data ?? []) bags.set(b.id as string, { orderId: b.order_id as string | null, code: b.bag_code as string | null });
    }
    const orders = new Map<string, string>();
    const orderIds = uniq([
      ...moves.map((m) => m.order_id), ...events.map((e) => e.order_id), ...receipts.map((r) => r.order_id),
      ...photoEvents.map((p) => p.order_id), ...labelPrints.map((l) => l.order_id),
      ...[...cards.values()].map((c) => c.orderId), ...[...bags.values()].map((b) => b.orderId),
    ]);
    for (const part of chunks(orderIds)) {
      const { data, error } = await admin.from("orders").select("id, order_number").in("id", part);
      if (error) throw new Error(`orders: ${error.message}`);
      for (const o of data ?? []) orders.set(o.id as string, String(o.order_number ?? ""));
    }

    const actions = buildActivity({
      moves, events, priorSteps, receipts, dueChanges, photoEvents, labelPrints, cards, orders, bags,
      places: new Map(placeRows.map((p) => [p.id, p.name])),
    }, range);
    return { ok: true, actions, notes: missing.yes ? [PHOTOS_LABELS_MISSING] : [] };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the activity. (${e instanceof Error ? e.message : String(e)})` };
  }
}

/**
 * Every recorded action on one card, newest first: the card page's "Who did
 * what" (moves, Done, Take out, step changes, receiving, photos). Same rules
 * as loadActivity; never throws.
 */
export async function loadCardActivity(admin: SupabaseClient, cardId: string): Promise<ActivityLoad> {
  const missing = { yes: false };
  try {
    const { data: card, error } = await admin.from("cards")
      .select("id, order_id, bag_id, card_code, card_name, received_at, received_by").eq("id", cardId).maybeSingle();
    if (error) throw new Error(`cards: ${error.message}`);
    if (!card) return { ok: true, actions: [], notes: [] };
    const orderId = card.order_id as string | null;
    const bagId = card.bag_id as string | null;
    const [moves, events, photoEvents, placeRows, bag, order] = await Promise.all([
      fetchAll<MoveRow>((f, t) => admin.from("card_moves").select(MOVE_COLUMNS).eq("card_id", cardId)
        .order("created_at").order("id").range(f, t)),
      orderId
        ? fetchAll<EventRow>((f, t) => admin.from("order_events").select(EVENT_COLUMNS).eq("order_id", orderId)
          .in("event_type", Object.keys(EVENT_KINDS)).order("created_at").order("id").range(f, t))
        : Promise.resolve([] as EventRow[]),
      optional(() => fetchAll<PhotoEventRow>((f, t) => admin.from("card_photo_events").select(PHOTO_EVENT_COLUMNS).eq("card_id", cardId)
        .order("created_at").order("id").range(f, t)), missing),
      fetchAll<{ id: string; name: string }>((f, t) => admin.from("locations").select("id, name").order("id").range(f, t)),
      bagId ? admin.from("tier_bags").select("id, order_id, bag_code").eq("id", bagId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      orderId ? admin.from("orders").select("id, order_number").eq("id", orderId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (bag.error) throw new Error(`tier_bags: ${bag.error.message}`);
    if (order.error) throw new Error(`orders: ${order.error.message}`);
    const receipt: ReceiptRow[] = card.received_at
      ? [{ id: cardId, order_id: orderId, bag_id: bagId, card_code: card.card_code as string | null, card_name: card.card_name as string | null, received_at: card.received_at as string, received_by: card.received_by as string | null }]
      : [];
    const actions = buildActivity({
      moves,
      // Every stage event of the order is read, so the step each change came from is known
      events: events.filter((e) => eventCardId(e) === cardId),
      priorSteps: [],
      receipts: receipt,
      photoEvents,
      cards: new Map([[cardId, { orderId, bagId, code: card.card_code as string | null, name: card.card_name as string | null }]]),
      orders: new Map(order.data ? [[order.data.id as string, String(order.data.order_number ?? "")]] : []),
      bags: new Map(bag.data ? [[bag.data.id as string, { orderId: bag.data.order_id as string | null, code: bag.data.bag_code as string | null }]] : []),
      places: new Map(placeRows.map((p) => [p.id, p.name])),
    });
    return { ok: true, actions, notes: missing.yes ? [PHOTOS_LABELS_MISSING] : [] };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read who worked on this card. (${e instanceof Error ? e.message : String(e)})` };
  }
}
