import type { StationType } from "@/lib/intake/tracking/types";

/**
 * The kinds of work station whose holders are numbered slots, one per step
 * (lib/restoration-stages.ts STAGES). Pure (safe in client components).
 * A slot's code is LOC-<KEY>-<NN> (LOC-CLAMP-07), its name "<NAME> <NN>"
 * upper case ("CLAMP 07"). Each new slot takes the type's stage and default
 * capacity (stored on the slot, so changing this list later never changes
 * slots already made; capacity can be changed per slot, or for every slot of
 * a type on the Places page). Add a type here to offer it in Places; keys are
 * lower-case letters, digits and dashes.
 *
 * Default capacity (owner, Nov 24 2026): holders that take a stack (a heat
 * press, a humidor, book weights...) have no limit (null); a clamp and a slab
 * crack spot hold one card.
 */
export const STATION_TYPES: readonly StationType[] = [
  { key: "slab-crack", name: "Slab Crack", stage: "Ready for Slab Crack", defaultCapacity: 1 },
  { key: "humidor", name: "Humidor", stage: "Humidor", defaultCapacity: null },
  { key: "humidity-press", name: "Humidity Press", stage: "Humidity Press", defaultCapacity: null },
  { key: "drying", name: "Drying", stage: "Book", defaultCapacity: null },
  { key: "heat-press", name: "Heat Press", stage: "Heat Press", defaultCapacity: null },
  { key: "clamp", name: "Clamp", stage: "Clamp Work", defaultCapacity: 1 },
  { key: "book-weights", name: "Book Weights", stage: "Book with Weights", defaultCapacity: null },
  { key: "final-dry", name: "Final Dry", stage: "Final Dry", defaultCapacity: null },
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

/** "Holds 1 card", "Holds 3 cards", "No limit" (capacity null). */
export function capacityText(capacity: number | null | undefined): string {
  if (capacity == null) return "No limit";
  return `Holds ${capacity} card${capacity === 1 ? "" : "s"}`;
}
