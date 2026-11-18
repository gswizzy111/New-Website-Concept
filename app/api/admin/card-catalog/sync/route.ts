import { isAdmin } from "@/lib/admin-auth";
import { readCatalogStatus, syncCardCatalog } from "@/lib/card-catalog-sync";

// The admin Card Catalog page's "Sync now": one chunk of the catalog sync
// (lib/card-catalog-sync.ts), about 8 seconds of work. The page calls it again
// while there is more to do; its first call ({ refreshLists: true }) also
// looks for new sets. A chunk running at the same time as the cron's is
// harmless: every write is an upsert.
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { refreshLists?: unknown };
  try {
    const result = await syncCardCatalog({ budgetMs: 8000, refreshLists: body?.refreshLists === true });
    const status = await readCatalogStatus();
    return Response.json({ result, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/card-catalog/sync] failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
