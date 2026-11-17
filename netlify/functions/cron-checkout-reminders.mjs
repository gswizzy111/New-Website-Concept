// Netlify scheduled function: every 5 minutes, starts the unpaid order
// reminders (app/api/cron/checkout-reminders, lib/checkout-reminder.ts).
// Runs on the published production deploy only.
//
// It waits at most 8 seconds and always ends normally, like
// cron-sync-delivered: the site finishes the run on its own either way (a
// closed connection doesn't stop it, and each order is claimed before its
// email, so a second run never emails anyone twice) and logs
// "[cron/checkout-reminders] {counts}" in the site's function log.
const WAIT_MS = 8000;

export default async function cronCheckoutReminders(req, context) {
  try {
    const res = await fetch(`${context.site.url}/api/cron/checkout-reminders`, {
      headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    const body = await res.text();
    if (res.ok) console.log(`[cron-checkout-reminders] ${res.status} ${body}`);
    else console.error(`[cron-checkout-reminders] ${res.status} ${body}`);
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      console.log(`[cron-checkout-reminders] started; still running after ${WAIT_MS / 1000}s, the result is in the site's function log`);
    } else {
      console.error("[cron-checkout-reminders] could not reach the site:", err);
    }
  }
}

export const config = { schedule: "*/5 * * * *" };
