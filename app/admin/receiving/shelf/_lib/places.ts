import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { slotSerial } from "@/lib/intake/tracking/stations";

/**
 * Places (the locations table, supabase/migrations/20261124_card_tracking.sql)
 * as the Places page, the Shelf view and the receiving workspace show them.
 * Pure (safe in client components). The tracking library
 * (lib/intake/tracking/**) owns the writes; these only name and link.
 *
 * The slot model (the owner's call, Nov 24): cards carry no sticker. Every
 * physical holder is a serial-numbered SLOT with a QR label ("CLAMP 07",
 * LOC-CLAMP-07) of a station type whose step is one of STAGES; plus
 * due-date shelf slots (bags wait there), the Done shelf and Shipping.
 * cards.location_id is the slot (or place) the card is in now.
 */

export type PlaceKind = "station" | "shelf" | "done" | "shipping" | "other";

export type PlaceRow = {
  id: string;
  code: string;
  name: string;
  kind: PlaceKind;
  /** The step a station slot sets (one of STAGES); null otherwise. */
  stage: string | null;
  /** A station slot's type key ('clamp', 'heat-press'...); null otherwise. */
  station: string | null;
  /** A station slot's serial number (7 for CLAMP 07); null otherwise. */
  serial: number | null;
  /** Cards the slot holds (null = no limit). */
  capacity: number | null;
  /** A shelf slot's due date (YYYY-MM-DD); null otherwise. */
  due_date: string | null;
  sort: number;
  active: boolean;
  created_at: string;
};

export const PLACE_COLUMNS = "id, code, name, kind, stage, station, serial, capacity, due_date, sort, active, created_at";

/** The card tracking update (20261124_card_tracking.sql) isn't applied yet. */
export function missingTracking(message: string): boolean {
  return /(locations|location_id|located_at|card_moves|station|serial|capacity)/.test(message)
    && /(does not exist|could not find|schema cache)/i.test(message);
}

/** The station types (key, name, step, default capacity) in step order: the tracking library's list. */
export { STATION_TYPES } from "@/lib/intake/tracking/stations";
export type { StationType } from "@/lib/intake/tracking/types";

export const KIND_NAMES: Record<PlaceKind, string> = {
  station: "Station slot",
  shelf: "Shelf slot",
  done: "Done shelf",
  shipping: "Shipping",
  other: "Other place",
};

/** A due date's shelf slot code and name ("LOC-SHELF-20261207", "DUE MON DEC 7"), as ensureShelfSlot makes them. */
export { shelfSlotCode, shelfSlotName } from "@/lib/intake/tracking/places";

/** "Step 6 · Clamp Work" for a stage; "" when there is none. */
export function stepText(stage: string | null | undefined): string {
  if (!stage) return "";
  const i = (STAGES as readonly string[]).indexOf(stage);
  return i >= 0 ? `Step ${i + 1} · ${adminStageLabel(stage)}` : adminStageLabel(stage);
}

/** Index of a stage in STAGES (unknown and none last). */
export function stageRank(stage: string | null | undefined): number {
  const i = stage ? (STAGES as readonly string[]).indexOf(stage) : -1;
  return i >= 0 ? i : STAGES.length;
}

/** The Scan page with this slot or place already scanned (/admin/scan?loc=LOC-CLAMP-07). */
export { scanPathForLocation as scanHref } from "@/lib/intake/codes";

/**
 * Slot and place QR labels, one 50 x 80 mm label each (PDF; add &format=json
 * for the label pages): the given places, or a station type's serial range.
 */
export function placeLabelsUrl(target: { ids: string[] } | { station: string; from?: number; to?: number }): string {
  if ("ids" in target) return `/api/admin/track/locations/labels?ids=${target.ids.map(encodeURIComponent).join(",")}`;
  const p = new URLSearchParams({ station: target.station });
  if (target.from != null) p.set("from", String(target.from));
  if (target.to != null) p.set("to", String(target.to));
  return `/api/admin/track/locations/labels?${p}`;
}

/** The 50 x 80 mm Katasymbol stock in inches (portrait), for QZ Tray. */
export const LABEL_PAPER = { widthIn: 50 / 25.4, heightIn: 80 / 25.4 };

/** "01".."99", "100": a slot serial as its label shows it. */
export function serialText(n: number | null | undefined): string {
  return n == null ? "" : slotSerial(n);
}
