import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { normalizeCatalogText, SEARCH_MAX, SEARCH_MIN, type CatalogCard } from "@/lib/card-catalog";

const LIMIT = 48;

// The card picker's search (components/admin/card-picker.tsx): up to 48
// catalog cards for ?q=, best match first (search_card_catalog() in
// supabase/migrations/20261118_card_catalog.sql). Admins only, like the card
// routes it serves. One database call; the answer is cached by the browser
// for a couple of minutes, so typing back over a search is instant.
export async function GET(request: Request) {
  const started = performance.now();
  const raw = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const q = normalizeCatalogText(raw);
  if (raw.length > SEARCH_MAX || q.length < SEARCH_MIN) {
    return Response.json({ error: `Type ${SEARCH_MIN} to ${SEARCH_MAX} characters.` }, { status: 400 });
  }

  // The session check and the search run side by side (the middleware has
  // already turned away anyone without a staff session)
  const [admin, search] = await Promise.all([
    isAdmin(),
    createAdminClient().rpc("search_card_catalog", { q, lim: LIMIT }),
  ]);
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (search.error) {
    console.error("[admin/card-catalog/search]", search.error.message);
    return Response.json({ error: "The card catalog isn't available right now. You can still type the card in." }, { status: 503 });
  }

  const cards = (search.data ?? []) as CatalogCard[];
  return Response.json({ cards }, {
    headers: {
      "Cache-Control": "private, max-age=120",
      "Server-Timing": `search;dur=${Math.round(performance.now() - started)}`,
    },
  });
}
