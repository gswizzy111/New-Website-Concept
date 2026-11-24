import { isLocationCode, normalizeCode } from "@/lib/intake/codes";

/**
 * Desk codes and the Desk page's address, without the database. Pure (safe
 * in client components such as the Scan page and Places, and in tests); it
 * needs only lib/intake/codes.ts. lib/intake/tracking/desk.ts re-exports
 * these and adds the loaders.
 *
 * A desk (owner's request, Nov 24 2026) is a place of kind 'other' whose
 * code is LOC-DESK or LOC-DESK-<NAME> (LOC-DESK-GAVIN, LOC-DESK-2). Cards
 * put on a desk change place only, never step.
 */

/** The first desk's code and name (made by ensureDesk when there is no desk). */
export const DESK_CODE = "LOC-DESK";
export const DESK_NAME = "DESK";
/** The Desk page. */
export const DESK_PAGE = "/admin/receiving/desk";

const DESK_CODE_RE = /^LOC-DESK(?:-[A-Z0-9]+)*$/;

/** A desk's code (LOC-DESK, LOC-DESK-GAVIN), typed, normalized or as its QR link. LOC-DESKTOP is not a desk. */
export function isDeskCode(code: string | null | undefined): boolean {
  const c = normalizeCode(code);
  return !!c && isLocationCode(c) && DESK_CODE_RE.test(c);
}

/** The Desk page, on one desk: /admin/receiving/desk?desk=LOC-DESK-GAVIN (no code, or not a desk's: the first desk). */
export function deskPagePath(code?: string | null): string {
  const c = normalizeCode(code);
  return c && isDeskCode(c) ? `${DESK_PAGE}?desk=${encodeURIComponent(c)}` : DESK_PAGE;
}
