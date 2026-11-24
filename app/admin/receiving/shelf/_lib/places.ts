import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { isDay } from "@/lib/intake/business-days";

/**
 * Places (the locations table, supabase/migrations/20261124_card_tracking.sql)
 * as the Places page, the Shelf view and the receiving workspace show them.
 * Pure (safe in client components). The tracking library
 * (lib/intake/tracking/**) owns the writes; these only name and link.
 */

export type PlaceKind = "station" | "shelf" | "done" | "shipping" | "other";

export type PlaceRow = {
  id: string;
  code: string;
  name: string;
  kind: PlaceKind;
  /** The step a station sets (one of STAGES); null otherwise. */
  stage: string | null;
  /** A shelf slot's due date (YYYY-MM-DD); null otherwise. */
  due_date: string | null;
  sort: number;
  active: boolean;
  created_at: string;
};

export const PLACE_COLUMNS = "id, code, name, kind, stage, due_date, sort, active, created_at";

/** The card tracking update (20261124_card_tracking.sql) isn't applied yet. */
export function missingTracking(message: string): boolean {
  return /(locations|location_id|located_at|card_moves)/.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

export const KIND_NAMES: Record<PlaceKind, string> = {
  station: "Station",
  shelf: "Shelf slot",
  done: "Done shelf",
  shipping: "Shipping",
  other: "Other place",
};

/** "LOC-SHELF-20261207": the shelf slot code for a due date (as ensureShelfSlot makes it). */
export function shelfSlotCode(day: string): string {
  return `LOC-SHELF-${day.replaceAll("-", "")}`;
}

/** "DUE MON DEC 7": the shelf slot name for a due date (as ensureShelfSlot makes it). */
export function shelfSlotName(day: string): string {
  if (!isDay(day)) return "NO DUE DATE";
  const d = new Date(`${day}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", { timeZone: "UTC", ...o }).toUpperCase();
  return `DUE ${part({ weekday: "short" })} ${part({ month: "short" })} ${d.getUTCDate()}`;
}

/** "Step 2 · Humidor" for a station's stage; "" when it has none. */
export function stationStepText(stage: string | null | undefined): string {
  if (!stage) return "";
  const i = (STAGES as readonly string[]).indexOf(stage);
  return i >= 0 ? `Step ${i + 1} · ${adminStageLabel(stage)}` : adminStageLabel(stage);
}

/** Sort key for stations: in step order, custom stations after. */
export function stationRank(p: Pick<PlaceRow, "stage" | "sort">): number {
  const i = p.stage ? (STAGES as readonly string[]).indexOf(p.stage) : -1;
  return i >= 0 ? i : STAGES.length + (p.sort ?? 0);
}

/** The Scan page in Move mode with this place already picked. */
export function scanMoveHref(code: string): string {
  return `/admin/scan?mode=move&loc=${encodeURIComponent(code)}`;
}

/** A place's sign (PDF; add ?format=json for the label pages). */
export function signUrl(placeId: string): string {
  return `/api/admin/track/locations/${encodeURIComponent(placeId)}/sign`;
}

/** Card stickers, one 50 x 80 mm page per card (PDF; add &format=json for the label pages). */
export function cardStickersUrl(target: { order: string } | { bag: string } | { ids: string[] }): string {
  if ("order" in target) return `/api/admin/intake/labels/cards?order=${encodeURIComponent(target.order)}`;
  if ("bag" in target) return `/api/admin/intake/labels/cards?bag=${encodeURIComponent(target.bag)}`;
  return `/api/admin/intake/labels/cards?ids=${target.ids.map(encodeURIComponent).join(",")}`;
}

/** The 50 x 80 mm Katasymbol stock in inches (portrait), for QZ Tray. */
export const STICKER_PAPER = { widthIn: 50 / 25.4, heightIn: 80 / 25.4 };
