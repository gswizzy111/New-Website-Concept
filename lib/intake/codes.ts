import { siteUrl } from "@/lib/site-url";

/**
 * Card IDs, Bag IDs and the QR links that point at them. Pure (safe in client
 * components and tests).
 *
 *   Card ID  <order_number>-<seq>             CD-2549-03 (2 digits, 3+ from 100)
 *   Bag ID   <order_number>-<letter><batch>   CD-2549-P, second Platinum batch CD-2549-P2
 *   QR       HTTPS://<SITE>/Q/<CODE>          all upper case (QR alphanumeric mode keeps it small)
 */

/** One letter per tier for Bag IDs; anything else is "U". */
export const TIER_LETTERS: Readonly<Record<string, string>> = {
  regular: "B",        // Bronze
  expedited: "S",      // Silver
  premium: "G",        // Gold
  ultra_premium: "P",  // Platinum
  elite: "D",          // Diamond
  fast_pass: "F",      // Fast Pass
  prep: "R",           // PSA Prep
};

/** Built-in tier names; the pages prefer restoration_settings.display_name when it exists. */
export const TIER_NAMES: Readonly<Record<string, string>> = {
  regular: "Bronze",
  expedited: "Silver",
  premium: "Gold",
  ultra_premium: "Platinum",
  elite: "Diamond",
  fast_pass: "Fast Pass",
  prep: "Prep",
};

/** Bag and label order: fastest tier first, prep last, unknown tiers after. */
export const TIER_ORDER: readonly string[] = ["fast_pass", "elite", "ultra_premium", "premium", "expedited", "regular", "prep"];

/** A stored tier as lib/intake uses it: trimmed, 'prep_standard' -> 'prep', blank -> null. */
export function normalizeTier(tier: string | null | undefined): string | null {
  const t = (tier ?? "").trim();
  if (!t) return null;
  return t === "prep_standard" ? "prep" : t;
}

/** The tier a card is worked under: its own, else the order's. */
export function effectiveTier(cardTier: string | null | undefined, orderTier: string | null | undefined): string | null {
  return normalizeTier(cardTier) ?? normalizeTier(orderTier);
}

export function tierLetter(tier: string | null | undefined): string {
  const t = normalizeTier(tier);
  return (t && TIER_LETTERS[t]) || "U";
}

/** "Gold", "Prep"; `names` (tier -> display name) overrides the built-in names. */
export function tierDisplayName(tier: string | null | undefined, names?: Readonly<Record<string, string>>): string {
  const t = normalizeTier(tier);
  if (!t) return "No tier";
  return names?.[t] || TIER_NAMES[t] || t;
}

/** Sort key for tiers (TIER_ORDER, then by name). */
export function tierRank(tier: string | null | undefined): number {
  const i = TIER_ORDER.indexOf(normalizeTier(tier) ?? "");
  return i === -1 ? TIER_ORDER.length : i;
}

function orderPrefix(orderNumber: string): string {
  const n = orderNumber.trim().toUpperCase();
  if (!n) throw new Error("An order number is required for a Card or Bag ID");
  return n;
}

/** Card ID: "CD-2549-03" (seq 3), "CD-2549-104" (seq 104). */
export function cardCode(orderNumber: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Invalid card number ${seq}`);
  return `${orderPrefix(orderNumber)}-${String(seq).padStart(2, "0")}`;
}

/** Bag ID: "CD-2549-P" (batch 1), "CD-2549-P2" (batch 2). */
export function bagCode(orderNumber: string, tier: string | null | undefined, batch = 1): string {
  if (!Number.isInteger(batch) || batch < 1) throw new Error(`Invalid bag batch ${batch}`);
  return `${orderPrefix(orderNumber)}-${tierLetter(tier)}${batch > 1 ? batch : ""}`;
}

/**
 * A scanned, typed or pasted code as stored: upper case, no spaces or "#",
 * and the code part of a pasted QR link (".../q/cd-2549-03"). Returns "" when
 * what is left isn't a plausible code (letters, digits and dashes only).
 */
export function normalizeCode(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep it as typed
  }
  const link = /\/q\/([^/?#]+)/i.exec(s);
  if (link) s = link[1];
  s = s.replace(/\s+/g, "").replace(/^#+/, "").toUpperCase();
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(s) && s.length <= 40 ? s : "";
}

/** What a normalized code looks like: a Card ID, a Bag ID, or neither. */
export function codeKind(code: string): "card" | "bag" | null {
  if (/^[A-Z]+-\d+-\d{2,}$/.test(code)) return "card";
  if (/^[A-Z]+-\d+-[A-Z]\d*$/.test(code)) return "bag";
  return null;
}

/** The path a QR opens on this site (lower-case /q; the /Q mirror also works). */
export function qrPath(code: string): string {
  return `/q/${encodeURIComponent(normalizeCode(code) || code.trim().toUpperCase())}`;
}

/**
 * What a card or bag QR encodes: the site's /q/<CODE> link, all upper case
 * ("HTTPS://THECARDDOC1.COM/Q/CD-2549-03"), so the QR uses alphanumeric mode.
 * Stable: it never contains an image or other temporary URL.
 */
export function qrUrl(code: string): string {
  return `${siteUrl()}${qrPath(code)}`.toUpperCase();
}

type SeqCard = { id: string; created_at: string | null; card_seq: number | null };

/** A timestamptz as a sortable string with microseconds (Date.parse keeps only milliseconds). */
function timeKey(ts: string | null): string {
  if (!ts) return "";
  const frac = (/\.(\d+)/.exec(ts)?.[1] ?? "").padEnd(6, "0").slice(0, 6);
  const ms = Date.parse(ts.replace(/\.\d+/, ""));
  if (Number.isNaN(ms)) return ts;
  return `${String(ms).padStart(16, "0")}${frac}`;
}

/** Cards in the order they get numbers: (created_at, id), as in the database. */
export function compareCardsForSeq(a: SeqCard, b: SeqCard): number {
  const ta = timeKey(a.created_at);
  const tb = timeKey(b.created_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Numbers for an order's cards that don't have one yet, after the highest
 * number already used, in (created_at, id) order. Existing numbers are never
 * changed or reused.
 */
export function nextCardSeqs(cards: readonly SeqCard[]): { id: string; seq: number }[] {
  let max = 0;
  for (const c of cards) if (c.card_seq != null && c.card_seq > max) max = c.card_seq;
  return cards
    .filter((c) => c.card_seq == null)
    .sort(compareCardsForSeq)
    .map((c) => ({ id: c.id, seq: ++max }));
}
