import type { ShipRowStatus } from "./rules";

/** The ship check page's rows (pure types: the server loader builds them, the client checklist shows them). */

export type ShipPlace = { code: string; name: string; kind: string };

export type ShipRow = {
  id: string;
  code: string | null;
  name: string;
  /** "2023 · Obsidian Flames · #125" */
  detail: string;
  bagId: string | null;
  bagCode: string | null;
  done: boolean;
  refunded: boolean;
  /** "Final Dry", "Drying", "Not started", "Done". */
  stageLabel: string;
  atFinalDry: boolean;
  /** The place it's in now (a slot, Done, Shipping, a shelf), or null. */
  place: ShipPlace | null;
  inSlot: boolean;
  /** "CLAMP 07, 2 h ago" / "Out of CLAMP 07, 3 days ago" / "Not in a slot". */
  lastSeen: string;
  status: ShipRowStatus;
};

export type ShipGroup = {
  bag: { id: string; code: string; tierName: string; place: string | null } | null;
  rows: ShipRow[];
};
