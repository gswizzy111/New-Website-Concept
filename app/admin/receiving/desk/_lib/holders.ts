import { parseScan, scanKindLabel, typedSlotGuess } from "@/components/intake/scan/parse";
import { roomLeft } from "@/components/intake/scan/format";
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

/** A holder the picker lists: a switched-on work-station slot or other place, not the desk the cards are on. */
function listable(l: TrackLocationWithCount, excludeId: string | null | undefined): boolean {
  return l.active && (l.kind === "station" || l.kind === "other") && l.id !== excludeId;
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
 * the server, which names the problem (unknown, switched off). Null for
 * blank text.
 */
export function holderFromText(
  text: string,
  locations: readonly TrackLocationWithCount[],
  excludeId?: string | null,
): HolderChoice | null {
  const t = text.trim();
  if (!t) return null;
  const code = typedCode(t);
  const known = code ? locations.find((l) => l.code === code) : undefined;
  if (known) {
    if (known.id === excludeId) return { ok: false, error: `The cards are on ${known.name} already.` };
    return { ok: true, code: known.code, name: known.name };
  }
  const named = locations.filter((l) => listable(l, excludeId) && matchesHolder(l, t));
  if (named.length === 1) return { ok: true, code: named[0].code, name: named[0].name };
  if (code) return { ok: true, code, name: null };
  const parsed = parseScan(t);
  if (parsed) return { ok: false, error: `That's a ${scanKindLabel(parsed.kind).toLowerCase()} code, not a holder. Type or scan a holder, like clamp 7.` };
  if (!named.length) return { ok: false, error: `No holder is called "${t.slice(0, 40)}". Try clamp 7, or tap one below.` };
  return { ok: false, error: `${named.length} holders match. Tap one below.` };
}
