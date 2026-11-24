import { createAdminClient } from "@/lib/supabase/admin";
import { loadHistory } from "@/lib/intake/tracking/history";
import { json, resultResponse, trackAdmin } from "@/lib/intake/tracking/http";

export const dynamic = "force-dynamic";

/**
 * GET ?code=<Card ID | Bag ID | order code | slot code>
 *   → 200 HistoryResponse { kind, code, moves: TrackMove[] } (last 50, newest first); 400 / 404 { error }
 */
export async function GET(request: Request) {
  const admin = await trackAdmin();
  if ("response" in admin) return admin.response;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!code.trim()) return json({ error: "Scan a code." }, 400);
  return resultResponse(await loadHistory(createAdminClient(), code));
}
