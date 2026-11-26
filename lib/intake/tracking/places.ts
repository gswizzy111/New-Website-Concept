import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { isDay, weekday } from "@/lib/intake/business-days";
import { isLocationCode, qrUrl } from "@/lib/intake/codes";
import { DONE_LABEL, NOT_STARTED_LABEL } from "@/lib/intake/stage-plan";
import { isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type { LocationKind, LocationRef, LocationRow, TrackLocation } from "@/lib/intake/tracking/types";
import { LOCATION_KINDS } from "@/lib/intake/tracking/types";
import { STATION_TYPES, stationName } from "@/lib/intake/tracking/stations";

/**
 * Places (locations) without the database: codes, names, shelf slots, views
 * and order. Pure (safe in client components and tests).
 */

/** The columns lib/intake/tracking reads from `locations`. */
export const LOCATION_COLUMNS = "id, code, name, kind, station, serial, capacity, stage, due_date, sort, active, created_at, created_by";
/** The columns of a LocationRef. */
export const LOCATION_REF_COLUMNS = "id, code, name, kind, station, serial, stage";

/** The Done shelf and Shipping, as seeded (supabase/migrations/20261124_card_tracking.sql). */
export const DONE_LOCATION_CODE = "LOC-DONE";
export const SHIP_LOCATION_CODE = "LOC-SHIP";
/** The Open bags box: one place (kind 'other') that holds bags, A-Z (bag-home.ts re-exports it). */
export const OPEN_BAGS_CODE = "LOC-OPEN-BAGS";

/** What a one-card holder holds (holdsOneCard). */
export const ONE_CARD = 1;

/**
 * The owner's rule (Nov 26 2026: "I want every single sticker station thingy
 * to only be able to hold one card other than my desk"): every holder with a
 * QR sticker holds at most ONE card. That is every work-station slot (kind
 * 'station') and every other place (kind 'other') that is not a desk
 * (LOC-DESK, LOC-DESK-<NAME>: isDeskCode) and not the Open bags box (it holds
 * bags). Desks have no limit (unless one is set on the desk). Shelves, Done
 * and Shipping hold bags, or are legacy: unchanged. The server enforces it
 * whatever the stored capacity column says, and `force` never bypasses it
 * (moves.ts).
 */
export function holdsOneCard(loc: Pick<LocationRow, "kind" | "code"> | null | undefined): boolean {
  if (!loc) return false;
  if (loc.kind === "station") return true;
  return loc.kind === "other" && !isDeskCode(loc.code) && loc.code !== OPEN_BAGS_CODE;
}

/** The cards a place holds: 1 for a one-card holder (holdsOneCard) whatever is stored, else the stored capacity (null = no limit). */
export function placeCapacity(loc: Pick<LocationRow, "kind" | "code" | "capacity">): number | null {
  return holdsOneCard(loc) ? ONE_CARD : loc.capacity ?? null;
}

/** The stage key card_moves stores for a finished card. */
export const DONE_STAGE_KEY = "done";

export function isLocationKind(v: unknown): v is LocationKind {
  return typeof v === "string" && (LOCATION_KINDS as readonly string[]).includes(v);
}

export function isStage(v: unknown): v is string {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

/** A stage value of card_moves (stored name, "done" or null) as staff read it. */
export function moveStageLabel(stage: string | null): string {
  if (stage === null) return NOT_STARTED_LABEL;
  if (stage === DONE_STAGE_KEY) return DONE_LABEL;
  return adminStageLabel(stage);
}

const MAX_SLUG = 36; // "LOC-" + 36 = 40: the /q links and the sign-in `next` accept codes up to 40

/** "Back shelf #2" -> "BACK-SHELF-2" (A-Z, 0-9, single dashes, at most 36 characters; "PLACE" if nothing is left). */
export function locationSlug(name: string, max = MAX_SLUG): string {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = s.slice(0, max).replace(/-+$/, "");
  return cut || "PLACE";
}

/**
 * Codes kept for the places made for us: a due-date shelf slot
 * (LOC-SHELF-20261207) and a numbered slot of a station type (LOC-CLAMP-07),
 * so a place named "Clamp 07" or "Shelf 20261207" never takes the code that
 * slot or shelf will need.
 */
export function isReservedPlaceCode(code: string): boolean {
  if (/^LOC-SHELF-\d{8}$/.test(code)) return true;
  return STATION_TYPES.some((t) => new RegExp(`^LOC-${t.key.toUpperCase()}-\\d+$`).test(code));
}

/**
 * Place codes to try for a new place named `name`, in order: LOC-<SLUG>,
 * then LOC-<SLUG>-2 ... LOC-<SLUG>-99 (the slug shortened so every code stays
 * within 40 characters). Codes kept for shelf and station slots are left out.
 */
export function locationCodeCandidates(name: string): string[] {
  const base = locationSlug(name);
  const out = [`LOC-${base}`];
  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    out.push(`LOC-${locationSlug(base, MAX_SLUG - suffix.length)}${suffix}`);
  }
  return out.filter((c) => isLocationCode(c) && !isReservedPlaceCode(c));
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** A due date's shelf slot code: "2026-12-07" -> "LOC-SHELF-20261207". */
export function shelfSlotCode(dueDate: string): string {
  if (!isDay(dueDate)) throw new Error(`Not a YYYY-MM-DD date: ${dueDate}`);
  return `LOC-SHELF-${dueDate.replaceAll("-", "")}`;
}

/** A due date's shelf slot name: "2026-12-07" -> "DUE MON DEC 7". */
export function shelfSlotName(dueDate: string): string {
  if (!isDay(dueDate)) throw new Error(`Not a YYYY-MM-DD date: ${dueDate}`);
  const [, m, d] = dueDate.split("-").map(Number);
  return `DUE ${WEEKDAYS[weekday(dueDate)]} ${MONTHS[m - 1]} ${d}`;
}

/** A shelf slot's sort key: the date as a number (20261207), so slots list in due-date order. */
export function shelfSlotSort(dueDate: string): number {
  if (!isDay(dueDate)) throw new Error(`Not a YYYY-MM-DD date: ${dueDate}`);
  return Number(dueDate.replaceAll("-", ""));
}

/** A locations row as the pages show it (`capacity`: the owner's one-card rule applied, placeCapacity). */
export function locationView(row: LocationRow): TrackLocation {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    station: row.station ?? null,
    stationName: row.kind === "station" ? stationName(row.station) : null,
    serial: row.serial ?? null,
    capacity: placeCapacity(row),
    stage: row.stage,
    stageLabel: row.stage ? adminStageLabel(row.stage) : null,
    dueDate: row.due_date,
    sort: row.sort ?? 0,
    active: row.active !== false,
    createdAt: row.created_at,
    createdBy: row.created_by,
    qrUrl: qrUrl(row.code),
  };
}

export function locationRef(row: Pick<LocationRow, "id" | "code" | "name" | "kind"> & Partial<Pick<LocationRow, "station" | "serial" | "stage">>): LocationRef {
  return { id: row.id, code: row.code, name: row.name, kind: row.kind, station: row.station ?? null, serial: row.serial ?? null, stage: row.stage ?? null };
}

/** A work-station slot (holds cards at a step), as opposed to a shelf, Done, Shipping or other place. */
export function isSlot(loc: Pick<LocationRow, "kind"> | null | undefined): boolean {
  return loc?.kind === "station";
}

/** Room for `adding` more cards next to `holding` (capacity null = no limit). */
export function hasRoom(capacity: number | null | undefined, holding: number, adding = 1): boolean {
  return capacity == null || holding + adding <= capacity;
}

const KIND_RANK: Record<LocationKind, number> = { station: 0, shelf: 1, done: 2, shipping: 3, other: 4 };

const stationRank = (key: string | null | undefined) => {
  const i = STATION_TYPES.findIndex((t) => t.key === key);
  return i === -1 ? STATION_TYPES.length : i;
};

/**
 * Place order for lists: slots by station type (in step order) then number,
 * shelf slots by due date, Done, Shipping, then other places; within a kind
 * by sort, then name.
 */
export function compareLocations(
  a: Pick<LocationRow, "kind" | "stage" | "due_date" | "sort" | "name"> & Partial<Pick<LocationRow, "station" | "serial">>,
  b: Pick<LocationRow, "kind" | "stage" | "due_date" | "sort" | "name"> & Partial<Pick<LocationRow, "station" | "serial">>,
): number {
  const k = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
  if (k) return k;
  if (a.kind === "station") {
    const t = stationRank(a.station) - stationRank(b.station);
    if (t) return t;
    if ((a.station ?? "") !== (b.station ?? "")) return (a.station ?? "") < (b.station ?? "") ? -1 : 1;
    const s = (STAGES as readonly string[]).indexOf(a.stage ?? "") - (STAGES as readonly string[]).indexOf(b.stage ?? "");
    if (s) return s;
    if ((a.serial ?? 0) !== (b.serial ?? 0)) return (a.serial ?? 0) - (b.serial ?? 0);
  }
  if (a.kind === "shelf" && (a.due_date ?? "") !== (b.due_date ?? "")) return (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1;
  if ((a.sort ?? 0) !== (b.sort ?? 0)) return (a.sort ?? 0) - (b.sort ?? 0);
  return a.name.localeCompare(b.name);
}
