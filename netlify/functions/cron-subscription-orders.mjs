// Netlify scheduled function: daily at 8am UTC, calls the subscription
// safety-net job (app/api/cron/subscription-orders). Runs on the published
// production deploy only.
export default async function cronSubscriptionOrders(req, context) {
  const res = await fetch(`${context.site.url}/api/cron/subscription-orders`, {
    headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
  });
  console.log(`[cron-subscription-orders] ${res.status} ${await res.text()}`);
}

export const config = { schedule: "0 8 * * *" };
