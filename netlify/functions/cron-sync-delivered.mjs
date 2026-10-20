// Netlify scheduled function: daily at 2pm UTC, calls the delivery-tracking
// sync (app/api/cron/sync-delivered). Runs on the published production
// deploy only.
export default async function cronSyncDelivered(req, context) {
  const res = await fetch(`${context.site.url}/api/cron/sync-delivered`, {
    headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
  });
  console.log(`[cron-sync-delivered] ${res.status} ${await res.text()}`);
}

export const config = { schedule: "0 14 * * *" };
