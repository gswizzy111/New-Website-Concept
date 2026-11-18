import { unstable_cache } from "next/cache";

/**
 * Shippo tracking for the staff admin, cached for 10 minutes.
 *
 * The admin order pages and Kit Orders used to ask Shippo live on every view
 * and on every router.refresh() after a save (0.2-0.6 s each). The answer is
 * now kept in Next.js' data cache (shared between function instances on
 * Netlify) for TRACKING_TTL_SECONDS, keyed by tracking number and carrier, so
 * a changed number or carrier is looked up fresh at once. Each 10-minute
 * window of the clock has its own entry (the window number is part of the
 * key), so a status shown is never more than 10 minutes old and an old entry
 * is never read again: no background refresh racing a fresh fetch, one Shippo
 * call per number per window. Failures are never cached; they answer null, as
 * the pages' old `.catch(() => null)` did.
 *
 * Admin only. Customer pages and checkout keep calling lib/shippo.ts directly.
 * Shippo's SDK is imported on first use, so admin routes no longer load it
 * (with zod, about 1 MB) when they start.
 */

export const TRACKING_TTL_SECONDS = 600;
/** For revalidateTag() if every cached status ever needs dropping at once. */
export const TRACKING_CACHE_TAG = "shippo-tracking";

/** The parts of Shippo's Track the admin shows, as plain JSON (same field names). */
export type TrackingSnapshot = {
  trackingStatus: { status: string; statusDetails: string | null } | null;
  /** ISO date, or null when the carrier gave none. */
  eta: string | null;
};

type Entry = { snapshot: TrackingSnapshot; fetchedAt: number };

// `window` only makes each 10-minute window its own cache entry
async function fetchTracking(trackingNumber: string, carrier: string, window: number): Promise<Entry> {
  void window;
  const { shippo } = await import("@/lib/shippo");
  const track = await shippo.trackingStatus.get(trackingNumber, carrier);
  const eta = track.eta ? new Date(track.eta) : null;
  return {
    fetchedAt: Date.now(),
    snapshot: {
      trackingStatus: track.trackingStatus
        ? { status: track.trackingStatus.status, statusDetails: track.trackingStatus.statusDetails || null }
        : null,
      eta: eta && !Number.isNaN(eta.getTime()) ? eta.toISOString() : null,
    },
  };
}

const cachedTracking = unstable_cache(fetchTracking, ["admin-shippo-tracking-v2"], {
  // Kept a little past its window, then dropped; a window is never read after it ends
  revalidate: TRACKING_TTL_SECONDS * 2,
  tags: [TRACKING_CACHE_TAG],
});

/**
 * The latest tracking status for a number at a carrier (a Shippo carrier
 * token: "usps", "ups", "fedex", "dhl_express"...), at most 10 minutes old.
 * Null when there's no number or carrier, or Shippo can't answer. Never throws.
 */
export async function cachedTrackingStatus(
  trackingNumber: string | null | undefined,
  carrier: string | null | undefined,
): Promise<TrackingSnapshot | null> {
  if (!trackingNumber || !carrier) return null;
  try {
    const window = Math.floor(Date.now() / (TRACKING_TTL_SECONDS * 1000));
    return (await cachedTracking(trackingNumber, carrier, window)).snapshot;
  } catch {
    return null;
  }
}
