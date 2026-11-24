import { codeKind, isLocationCode, normalizeCode, type CodeKind } from "@/lib/intake/codes";

/**
 * What the Scan page (/admin/scan) reads from a scan: the camera's QR text, a
 * handheld scanner's keystrokes, a pasted link or a typed code all go through
 * parseScan(). Pure (safe in client components and tests).
 *
 *   "HTTPS://THECARDDOC1.COM/Q/CD-2549-03"  -> card      CD-2549-03 (any host, any case)
 *   "cd-2549-p"                             -> bag       CD-2549-P
 *   "CD-2549"                               -> order     CD-2549
 *   ".../q/loc-humidor"                     -> location  LOC-HUMIDOR
 *
 * Anything else (another company's QR, a shipping barcode, a bare number) is
 * null. The page never opens the link itself: it sends the code to the API.
 */

export type ScanKind = CodeKind;
export type ParsedScan = { code: string; kind: ScanKind };

export { isLocationCode };

export function parseScan(raw: string | null | undefined): ParsedScan | null {
  const code = normalizeCode(raw);
  // codeKind checks places first ("LOC-2" is a place, never an order)
  const kind = code ? codeKind(code) : null;
  return kind ? { code, kind } : null;
}

/** "Card", "Bag", "Order", "Place". */
export function scanKindLabel(kind: ScanKind | string | null | undefined): string {
  if (kind === "card") return "Card";
  if (kind === "bag") return "Bag";
  if (kind === "order") return "Order";
  if (kind === "location") return "Place";
  return "Code";
}

/**
 * Ignores a repeat: the same code seen again within `windowMs` (2 s) of the
 * last time it was seen. Every sighting renews the time, so a code held in
 * front of the camera fires once, and again only after it has been out of
 * view for 2 s. Several codes are remembered at once, so two stickers in the
 * same frame don't fire turn about.
 */
export function createScanGate(windowMs = 2000) {
  const seen = new Map<string, number>();
  return function accept(key: string, now: number): boolean {
    for (const [k, at] of seen) if (now - at >= windowMs) seen.delete(k);
    const repeat = seen.has(key);
    seen.set(key, now);
    return !repeat;
  };
}

/** The key the gate compares: the code when it parses, else the text itself. */
export function scanKey(raw: string): string {
  return parseScan(raw)?.code ?? raw.trim().toUpperCase().slice(0, 200);
}
