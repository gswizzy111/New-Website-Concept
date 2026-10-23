// Netlify scheduled function: daily at 05:20 UTC (just after midnight New York
// time), calls app/api/cron/dashboard-metrics to sync the refund ledger with
// Stripe and save the finished backlog days. Runs on the published production
// deploy only.
export default async function cronDashboardMetrics(req, context) {
  const res = await fetch(`${context.site.url}/api/cron/dashboard-metrics`, {
    headers: { authorization: `Bearer ${Netlify.env.get("CRON_SECRET")}` },
  });
  console.log(`[cron-dashboard-metrics] ${res.status} ${await res.text()}`);
}

export const config = { schedule: "20 5 * * *" };
