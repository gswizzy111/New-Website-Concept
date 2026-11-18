import { PREVIEW_MODE } from "@/lib/preview";
import { syncCardCatalog } from "@/lib/card-catalog-sync";

// Runs every 5 minutes via netlify/functions/cron-sync-card-catalog.mjs.
// Fills the admin card catalog from TCGdex a chunk at a time
// (lib/card-catalog-sync.ts). Each run does about 8 seconds of work so it ends
// inside the function time limit; the first full fill takes a handful of runs.
// Once everything is synced, a run is one small read of card_catalog_sync.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  // As the other cron routes, plus: no secret set means no access
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Preview deploys write nothing
  if (PREVIEW_MODE) {
    return Response.json({ preview: true, setsSynced: 0, cardsSaved: 0 });
  }

  try {
    const result = await syncCardCatalog({ budgetMs: 8000 });
    if (!result.upToDate) console.log("[cron/sync-card-catalog]", JSON.stringify(result));
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-card-catalog] failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
