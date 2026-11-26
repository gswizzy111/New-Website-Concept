import type { Metadata } from "next";
import { requireAdminOrWorkshop } from "@/lib/admin-auth";
import { isLocationCode, normalizeCode } from "@/lib/intake/codes";
import { ScanApp } from "@/components/intake/scan/scan-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scan", robots: { index: false } };

type Params = { loc?: string | string[]; mode?: string | string[] };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The Scan page: a handheld scanner (the Eyoyo paired with the phone as a
 * Bluetooth keyboard) reads slot, bag, order and desk QR labels, one after
 * another (components/intake/scan); there is no camera on the page, and a
 * code can be typed ("Type a code instead"). Full admins and workshop
 * logins (lib/workshop-access.ts). ?loc=<slot
 * code> opens on that slot (a slot's QR opened from any phone's own camera
 * app lands here through /q/<CODE>); ?mode=ship starts in ship check. The
 * URL never carries anything about a customer.
 */
export default async function ScanPage({ searchParams }: { searchParams: Promise<Params> }) {
  const role = await requireAdminOrWorkshop();
  const sp = await searchParams;
  const loc = normalizeCode(first(sp.loc));
  // Ship check is for full admins (its pages aren't open to workshop logins)
  const shipCheck = role === "admin";
  return <ScanApp initialLoc={loc && isLocationCode(loc) ? loc : null} initialShip={shipCheck && first(sp.mode) === "ship"} shipCheck={shipCheck} />;
}
