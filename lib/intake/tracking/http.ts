import "server-only";
import { getAdminSession } from "@/lib/admin-auth";
import type { TrackResult } from "@/lib/intake/tracking/moves";

/** Shared bits of the /api/admin/track/* routes (server only). */

const NO_STORE = { "Cache-Control": "no-store" };

/** The full admin's username (for card_moves.by and stage events), or a 401 response. */
export async function trackAdmin(): Promise<{ by: string } | { response: Response }> {
  const session = await getAdminSession();
  if (session?.role !== "admin") return { response: json({ error: "Unauthorized" }, 401) };
  return { by: session.username ?? "admin" };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The request body as a JSON object, or null when it isn't one (or is over 40 KB: 200 card ids fit). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > 40_000) return null;
  const text = await req.text().catch(() => "");
  if (!text || text.length > 40_000) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
export const optString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A tracking service result as a response: the TrackActionResponse, { error }, or a 409 HolderFull (a one-card holder) or CapacityConflict (a desk with a limit). */
export function trackResponse(result: TrackResult): Response {
  if (result.ok) {
    const { ok: _ok, ...body } = result;
    void _ok;
    return json(body);
  }
  if (result.full) return json(result.full, 409);
  if (result.conflict) return json(result.conflict, 409);
  return json({ error: result.error }, result.status);
}

/** An IntakeResult carrying `response` as a response. */
export function resultResponse<T>(result: { ok: true; response: T } | { ok: false; status: number; error: string }): Response {
  return result.ok ? json(result.response) : json({ error: result.error }, result.status);
}
