import { parseScan, scanKindLabel, typedSlotGuess } from "@/components/intake/scan/parse";
import { roomLeft } from "@/components/intake/scan/format";
import { OPEN_BAGS_CODE } from "@/lib/intake/tracking/bag-home";
import { DONE_LOCATION_CODE, SHIP_LOCATION_CODE } from "@/lib/intake/tracking/places";
import type { StationType, TrackLocationWithCount } from "@/lib/intake/tracking/types";

/**
 * The Desk page's holder picker ("Put in holder"), without React: which
 * places it lists and in what groups, and what a typed or scanned holder
 * ("clamp 7", a slot's QR link, "desk gavin") means. Pure (safe in client
 * components and tests).
 */

export type HolderGroup = {
  key: string;
  /** "Clamp", "Other places" */
  title: string;
  /** The step its slots set ("Clamp Work"); null for other places. */
  step: string | null;
  /** Holders with room for the cards being put away, in list order. */
  free: TrackLocationWithCount[];
  /** Holders without room (they can still be picked: "Add anyway?"). */
  full: TrackLocationWithCount[];
};

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/** What the typed text names exactly, as a place code: "clamp 7" -> LOC-CLAMP-07, a QR link -> its code. */
function typedCode(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const parsed = parseScan(t);
  return typedSlotGuess(t) ?? (parsed?.kind === "location" ? parsed.code : null);
}

/**
 * Places that hold bags, not cards: the Open bags box, the Ready to ship bin
 * and the old Done shelf. Never a destination for a card here.
 */
export const BAG_ONLY_CODES: readonly string[] = [OPEN_BAGS_CODE, SHIP_LOCATION_CODE, DONE_LOCATION_CODE];

/** A place a card can be put in: a work-station slot or another place (a desk, BENCH 2), not one that holds bags. */
export function isCardDestination(l: Pick<TrackLocationWithCount, "kind" | "code">): boolean {
  return (l.kind === "station" || l.kind === "other") && !BAG_ONLY_CODES.includes(l.code);
}

/** Typed or scanned into the picker: a place that holds bags. */
const bagOnlyText = (name: string) => `${name} holds bags, not cards. Pick a holder, like clamp 7.`;

/**
 * The DONE sign scanned (or "done" typed) into the picker's box: a computer
 * with the box focused gets the scanner's typing there, so the Scan page's
 * "Move to another holder, then scan DONE" lands here. The picker never does
 * the Done itself: it says how.
 */
export const DONE_IN_PICKER_TEXT = "To finish it, close this list, then scan DONE or tap Done.";

/** A holder the picker lists: a switched-on place a card can go in, not the desk the cards are on. */
function listable(l: TrackLocationWithCount, excludeId: string | null | undefined): boolean {
  return l.active && isCardDestination(l) && l.id !== excludeId;
}

/** The holder matches the typed text: its exact code, or its name or code contains it ("heat press", "gavin"). */
export function matchesHolder(l: Pick<TrackLocationWithCount, "code" | "name">, text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const code = typedCode(t);
  if (code && code === l.code) return true;
  const q = squash(t);
  return !!q && (squash(l.name).includes(q) || squash(l.code.replace(/^LOC-/, "")).includes(q));
}

/**
 * The holders to offer for `need` cards, grouped by station type in step
 * order (the server's list order within a type), then other places; groups
 * with a free holder first. `query` narrows the list (matchesHolder).
 */
export function holderGroups(
  locations: readonly TrackLocationWithCount[],
  stations: readonly StationType[],
  opts: { excludeId?: string | null; need?: number; query?: string } = {},
): HolderGroup[] {
  const need = Math.max(1, opts.need ?? 1);
  const query = opts.query ?? "";
  const shown = locations.filter((l) => listable(l, opts.excludeId) && matchesHolder(l, query));
  const groups = new Map<string, HolderGroup>();
  const order: string[] = [...stations.map((s) => `station:${s.key}`)];
  for (const l of shown) {
    const key = l.kind === "station" ? `station:${l.station ?? ""}` : "other";
    let g = groups.get(key);
    if (!g) {
      const type = l.kind === "station" ? stations.find((s) => s.key === l.station) : undefined;
      g = {
        key,
        title: l.kind === "station" ? type?.name ?? l.stationName ?? l.station ?? "Slots" : "Other places",
        step: l.kind === "station" ? l.stageLabel : null,
        free: [],
        full: [],
      };
      groups.set(key, g);
      if (!order.includes(key) && key !== "other") order.push(key);
    }
    (roomLeft(l.capacity, l.cardCount) >= need ? g.free : g.full).push(l);
  }
  order.push("other");
  const list = order.map((k) => groups.get(k)).filter((g): g is HolderGroup => !!g);
  // Groups with room first (each kind keeps its step order)
  return [...list.filter((g) => g.free.length), ...list.filter((g) => !g.free.length)];
}

export type HolderChoice = { ok: true; code: string; name: string | null } | { ok: false; error: string };

/**
 * What typed or scanned text in the picker's box means: a holder's code
 * ("clamp 7", "LOC-CLAMP-07", its QR link), else the one listed holder
 * whose name contains it ("desk gavin"). A code nothing lists still goes to
 * the server, which names the problem (unknown, switched off). Places that
 * hold bags are refused ("DUE MON DEC 7 holds bags, not cards. …"), the
 * DONE sign with how to finish (DONE_IN_PICKER_TEXT). Null for blank text.
 */
export function holderFromText(
  text: string,
  locations: readonly TrackLocationWithCount[],
  excludeId?: string | null,
): HolderChoice | null {
  const t = text.trim();
  if (!t) return null;
  const code = typedCode(t);
  // Listed or not (the list may still be loading): never sent as a holder
  if (code === DONE_LOCATION_CODE) return { ok: false, error: DONE_IN_PICKER_TEXT };
  const known = code ? locations.find((l) => l.code === code) : undefined;
  if (known) {
    if (known.id === excludeId) return { ok: false, error: `The cards are on ${known.name} already.` };
    if (!isCardDestination(known)) return { ok: false, error: bagOnlyText(known.name) };
    return { ok: true, code: known.code, name: known.name };
  }
  const named = locations.filter((l) => listable(l, excludeId) && matchesHolder(l, t));
  if (named.length === 1) return { ok: true, code: named[0].code, name: named[0].name };
  if (code) return { ok: true, code, name: null };
  const parsed = parseScan(t);
  if (parsed) return { ok: false, error: `That's a ${scanKindLabel(parsed.kind).toLowerCase()} code, not a holder. Type or scan a holder, like clamp 7.` };
  if (!named.length) {
    // "open bags": a place that holds bags, named
    const bagPlace = locations.filter((l) => l.active && !isCardDestination(l) && matchesHolder(l, t));
    if (bagPlace.length === 1) return { ok: false, error: bagOnlyText(bagPlace[0].name) };
    return { ok: false, error: `No holder is called "${t.slice(0, 40)}". Try clamp 7, or tap one below.` };
  }
  return { ok: false, error: `${named.length} holders match. Tap one below.` };
}
