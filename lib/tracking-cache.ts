import { unstable_cache } from "next/cache";

/**
 * Shippo tracking for the staff admin, cached for 10 minutes.
 *
 * The admin order pages and Kit Orders used to ask Shippo live on every view
 * and on every router.refresh() after a save (0.2-0.6 s each). The answer is
 * now kept in Next.js' data cache (shared between function instances on
 * Netlify) for TRACKING_TTL_SECONDS, keyed by tracking number and carrier, so
 * a changed number or carrier is looked up fresh at once. A status shown can
 * therefore be up to 10 minutes old, never more: an entry past that age is
 * not shown (Next would serve it while refreshing in the background), it is
 * fetched again. Failures are never cached; they answer null, as the pages'
 * old `.catch(() => null)` did.
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

async function fetchTracking(trackingNumber: string, carrier: string): Promise<Entry> {
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

const cachedTracking = unstable_cache(fetchTracking, ["admin-shippo-tracking-v1"], {
  revalidate: TRACKING_TTL_SECONDS,
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
    const entry = await cachedTracking(trackingNumber, carrier);
    if (Date.now() - entry.fetchedAt <= TRACKING_TTL_SECONDS * 1000) return entry.snapshot;
    return (await fetchTracking(trackingNumber, carrier)).snapshot;
  } catch {
    return null;
  }
}
