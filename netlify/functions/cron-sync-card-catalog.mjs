// Netlify scheduled function: every 5 minutes, runs one chunk of the admin
// card catalog sync (app/api/cron/sync-card-catalog, lib/card-catalog-sync.ts).
// Runs on the published production deploy only.
//
// Every 5 minutes so the catalog fills within about an hour of a deploy with
// nobody watching (the admin Card Catalog page's "Sync now" fills it in a few
// minutes). Once it is complete, a run is a single small database read, and
// every 6 hours it also checks TCGdex for new sets.
//
// It waits at most 9 seconds and always ends normally, like
// cron-sync-delivered: the site finishes the chunk on its own either way (a
// closed connection doesn't stop it, and every write is an upsert, so a
// second run never duplicates anything).
const WAIT_MS = 9000;

export default async function cronSyncCardCatalog(req, context) {
  try {
    const res = await fetch(`${context.site.url}/api/cron/sync-card-catalog`, {
      headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    const body = await res.text();
    if (res.ok) {
      // Quiet once the catalog is up to date
      if (!body.includes('"upToDate":true')) console.log(`[cron-sync-card-catalog] ${res.status} ${body}`);
    } else {
      console.error(`[cron-sync-card-catalog] ${res.status} ${body}`);
    }
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.log(`[cron-sync-card-catalog] started; still running after ${WAIT_MS / 1000}s, the result is in the site's function log`);
    } else {
      console.error("[cron-sync-card-catalog] could not reach the site:", err);
    }
  }
}

export const config = { schedule: "*/5 * * * *" };
