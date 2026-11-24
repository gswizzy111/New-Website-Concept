import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { isLocationCode, normalizeCode } from "@/lib/intake/codes";
import { ScanApp } from "@/components/intake/scan/scan-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scan", robots: { index: false } };

type Params = { loc?: string | string[]; mode?: string | string[] };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The Scan page: the phone's camera (or a handheld scanner) reads slot and
 * bag QR labels, one after another (components/intake/scan). Full admins
 * only. ?loc=<slot code> opens on that slot (a slot's QR scanned with the
 * phone's own camera lands here through /q/<CODE>); ?mode=ship starts in ship
 * check. The URL never carries anything about a customer.
 */
export default async function ScanPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const loc = normalizeCode(first(sp.loc));
  return <ScanApp initialLoc={loc && isLocationCode(loc) ? loc : null} initialShip={first(sp.mode) === "ship"} />;
}
