import type { StationType } from "@/lib/intake/tracking/types";

/**
 * The kinds of work station whose holders are numbered slots, one per step
 * (lib/restoration-stages.ts STAGES). Pure (safe in client components).
 * A slot's code is LOC-<KEY>-<NN> (LOC-CLAMP-07), its name "<NAME> <NN>"
 * upper case ("CLAMP 07"). Each new slot takes the type's stage. Add a type
 * here to offer it in Places; keys are lower-case letters, digits and dashes.
 *
 * Every slot holds ONE card (owner, Nov 26 2026: "I want every single sticker
 * station thingy to only be able to hold one card other than my desk"):
 * holdsOneCard / placeCapacity in places.ts, enforced by the server
 * (moves.ts) whatever a slot's stored capacity says, with no "Add anyway".
 * New slots store capacity 1; older slots that stored no limit (or 2+) hold
 * one card all the same. Only a desk can hold a stack. (Before, Nov 24 2026:
 * a heat press, humidor, humidity press, drying or book weights slot took a
 * stack; a clamp and a slab crack spot held one.)
 */
export const STATION_TYPES: readonly StationType[] = [
  { key: "slab-crack", name: "Slab Crack", stage: "Ready for Slab Crack", defaultCapacity: 1 },
  { key: "humidor", name: "Humidor", stage: "Humidor", defaultCapacity: 1 },
  { key: "humidity-press", name: "Humidity Press", stage: "Humidity Press", defaultCapacity: 1 },
  { key: "drying", name: "Drying", stage: "Book", defaultCapacity: 1 },
  { key: "heat-press", name: "Heat Press", stage: "Heat Press", defaultCapacity: 1 },
  { key: "clamp", name: "Clamp", stage: "Clamp Work", defaultCapacity: 1 },
  { key: "book-weights", name: "Book Weights", stage: "Book with Weights", defaultCapacity: 1 },
  { key: "final-dry", name: "Final Dry", stage: "Final Dry", defaultCapacity: 1 },
];

export function stationType(key: string | null | undefined): StationType | null {
  return (key && STATION_TYPES.find((s) => s.key === key)) || null;
}

/** "07", "12", "103": slot numbers have at least two digits. */
export function slotSerial(serial: number): string {
  return String(serial).padStart(2, "0");
}

/** LOC-CLAMP-07 */
export function slotCode(stationKey: string, serial: number): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stationKey)) throw new Error(`Invalid station key ${stationKey}`);
  if (!Number.isInteger(serial) || serial < 1 || serial > 9999) throw new Error(`Invalid slot number ${serial}`);
  return `LOC-${stationKey.toUpperCase()}-${slotSerial(serial)}`;
}

/** "CLAMP 07" */
export function slotName(type: Pick<StationType, "name">, serial: number): string {
  return `${type.name.toUpperCase()} ${slotSerial(serial)}`;
}

/** The station type's name for a slot ("Clamp"), else null. */
export function stationName(key: string | null | undefined): string | null {
  return stationType(key)?.name ?? (key ? key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : null);
}

/** "Holds 1 card" (every slot, ONE_CARD), "Holds 3 cards" (a desk with a limit set), "No limit" (capacity null: a desk). */
export function capacityText(capacity: number | null | undefined): string {
  if (capacity == null) return "No limit";
  return `Holds ${capacity} card${capacity === 1 ? "" : "s"}`;
}
