// Netlify scheduled function: every 10 minutes, brings the refund ledger up to
// date with Stripe (app/api/cron/refund-sync, syncRefunds() in
// lib/refund-ledger.ts). The admin reports and the dashboard no longer wait
// for Stripe while they load, so a refund made in the Stripe Dashboard shows
// in them within about 10 minutes. Runs on the published production deploy
// only.
//
// It waits at most 20 seconds and always ends normally, like
// cron-checkout-reminders: the site finishes the sync on its own either way
// (a closed connection doesn't stop it, and a refund already saved is never
// saved twice) and logs "[cron/refund-sync] {result}" in the site's function log.
const WAIT_MS = 20000;

export default async function cronRefundSync(req, context) {
  try {
    const res = await fetch(`${context.site.url}/api/cron/refund-sync`, {
      headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    const body = await res.text();
    if (res.ok) console.log(`[cron-refund-sync] ${res.status} ${body}`);
    else console.error(`[cron-refund-sync] ${res.status} ${body}`);
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.log(`[cron-refund-sync] started; still running after ${WAIT_MS / 1000}s, the result is in the site's function log`);
    } else {
      console.error("[cron-refund-sync] could not reach the site:", err);
    }
  }
}

export const config = { schedule: "*/10 * * * *" };
