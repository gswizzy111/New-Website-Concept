// Netlify scheduled function: daily at 2pm UTC, starts the delivery-tracking
// sync (app/api/cron/sync-delivered). Runs on the published production
// deploy only.
//
// The sync takes 10 to 30 seconds. When this function was cut off waiting for
// it, Netlify ran it again, so the sync ran three times a day. It now waits
// at most 8 seconds and always ends normally: the site finishes the sync on
// its own either way (a closed connection doesn't stop it, and a second run
// never changes an order twice) and logs "[cron/sync-delivered] checked N,
// updated N" in the site's function log.
const WAIT_MS = 8000;

export default async function cronSyncDelivered(req, context) {
  try {
    const res = await fetch(`${context.site.url}/api/cron/sync-delivered`, {
      headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    const body = await res.text();
    if (res.ok) console.log(`[cron-sync-delivered] ${res.status} ${body}`);
    else console.error(`[cron-sync-delivered] ${res.status} ${body}`);
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.log(`[cron-sync-delivered] started; still running after ${WAIT_MS / 1000}s, the result is in the site's function log`);
    } else {
      console.error("[cron-sync-delivered] could not reach the site:", err);
    }
  }
}

export const config = { schedule: "0 14 * * *" };
