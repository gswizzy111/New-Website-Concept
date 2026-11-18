import { createAdminClient } from "@/lib/supabase/admin";
import { syncRefunds } from "@/lib/refund-ledger";
import { PREVIEW_MODE } from "@/lib/preview";

// Runs every 10 minutes via netlify/functions/cron-refund-sync.mjs. Brings the
// refund ledger up to date with Stripe (refunds made in the Stripe Dashboard,
// pending refunds that later succeed or fail), so the admin reports never wait
// for Stripe: their pages only start a sync after they're sent. The daily
// dashboard-metrics job still runs its own full sync.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  // As the other cron routes, plus: no secret set means no access
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Preview deploys write nothing
  if (PREVIEW_MODE) {
    return Response.json({ preview: true, synced: 0, skipped: true });
  }

  try {
    // Skipped when a page started one in the last minute; an unfinished run
    // (over budget) carries on at the next one
    const result = await syncRefunds(createAdminClient(), { budgetMs: 10_000, requestTimeoutMs: 3_000 });
    console.log("[cron/refund-sync]", JSON.stringify(result));
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/refund-sync] failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
