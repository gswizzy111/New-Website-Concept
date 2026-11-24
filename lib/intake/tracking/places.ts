import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { isDay, weekday } from "@/lib/intake/business-days";
import { isLocationCode, qrUrl } from "@/lib/intake/codes";
import { DONE_LABEL, NOT_STARTED_LABEL } from "@/lib/intake/stage-plan";
import type { LocationKind, LocationRef, LocationRow, TrackLocation } from "@/lib/intake/tracking/types";
import { LOCATION_KINDS } from "@/lib/intake/tracking/types";

/**
 * Places (locations) without the database: codes, names, shelf slots, views
 * and order. Pure (safe in client components and tests).
 */

/** The columns lib/intake/tracking reads from `locations`. */
export const LOCATION_COLUMNS = "id, code, name, kind, stage, due_date, sort, active, created_at, created_by";

/** The Done shelf and Shipping, as seeded (supabase/migrations/20261124_card_tracking.sql). */
export const DONE_LOCATION_CODE = "LOC-DONE";
export const SHIP_LOCATION_CODE = "LOC-SHIP";

/** The seeded station of each step (stored stage name -> place code). */
export const STATION_CODES: Readonly<Record<string, string>> = {
  "Ready for Slab Crack": "LOC-SLAB-CRACK",
  "Humidor": "LOC-HUMIDOR",
  "Humidity Press": "LOC-HUMIDITY-PRESS",
  "Book": "LOC-DRYING",
  "Heat Press": "LOC-HEAT-PRESS",
  "Clamp Work": "LOC-CLAMP",
  "Book with Weights": "LOC-BOOK-WEIGHTS",
  "Final Dry": "LOC-FINAL-DRY",
};

/** "card" stage key in card_moves for a finished card. */
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
 * Place codes to try for a new place named `name`, in order: LOC-<SLUG>,
 * then LOC-<SLUG>-2 ... LOC-<SLUG>-99 (the slug shortened so every code stays
 * within 40 characters).
 */
export function locationCodeCandidates(name: string): string[] {
  const base = locationSlug(name);
  const out = [`LOC-${base}`];
  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    out.push(`LOC-${locationSlug(base, MAX_SLUG - suffix.length)}${suffix}`);
  }
  return out.filter(isLocationCode);
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

/** A locations row as the pages show it. */
export function locationView(row: LocationRow): TrackLocation {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
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

export function locationRef(row: Pick<LocationRow, "id" | "code" | "name" | "kind">): LocationRef {
  return { id: row.id, code: row.code, name: row.name, kind: row.kind };
}

const KIND_RANK: Record<LocationKind, number> = { station: 0, shelf: 1, done: 2, shipping: 3, other: 4 };

/**
 * Place order for lists: stations by step, shelf slots by due date, the Done
 * shelf, Shipping, then other places; within a kind by sort, then name.
 */
export function compareLocations(
  a: Pick<LocationRow, "kind" | "stage" | "due_date" | "sort" | "name">,
  b: Pick<LocationRow, "kind" | "stage" | "due_date" | "sort" | "name">,
): number {
  const k = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
  if (k) return k;
  if (a.kind === "station") {
    const s = (STAGES as readonly string[]).indexOf(a.stage ?? "") - (STAGES as readonly string[]).indexOf(b.stage ?? "");
    if (s) return s;
  }
  if (a.kind === "shelf" && (a.due_date ?? "") !== (b.due_date ?? "")) return (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1;
  if ((a.sort ?? 0) !== (b.sort ?? 0)) return (a.sort ?? 0) - (b.sort ?? 0);
  return a.name.localeCompare(b.name);
}
