// Netlify scheduled function: daily at 8am UTC, calls the subscription
// safety-net job (app/api/cron/subscription-orders). Runs on the published
// production deploy only.
export default async function cronSubscriptionOrders() {
  const res = await fetch(`${process.env.URL}/api/cron/subscription-orders`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log(`[cron-subscription-orders] ${res.status} ${await res.text()}`);
}

export const config = { schedule: "0 8 * * *" };
