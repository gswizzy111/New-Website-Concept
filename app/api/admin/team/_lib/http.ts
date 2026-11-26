import { getAdminSession } from "@/lib/admin-auth";
import type { WorkshopResult } from "@/lib/workshop-users";

/** Shared bits of the Team API (/api/admin/team/**): full admins only. */

const NO_STORE = { "Cache-Control": "no-store" };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * The full admin managing the team (their username, for created_by), or a
 * 401. Workshop logins, support staff (and an admin viewing as support) and
 * accountants are refused.
 */
export async function teamAdmin(): Promise<{ by: string } | { response: Response }> {
  const session = await getAdminSession();
  if (session?.role !== "admin") return { response: json({ error: "Unauthorized" }, 401) };
  return { by: session.username };
}

/** The request body as a JSON object, or null (over 4 KB, not JSON, not an object). */
export async function smallBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => "");
  if (text.length > 4_000) return null;
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A lib/workshop-users.ts result as a response. */
export function respond<T extends object>(result: WorkshopResult<T>, okStatus = 200): Response {
  if (!result.ok) return json({ error: result.error }, result.status);
  const { ok: _ok, ...body } = result;
  void _ok;
  return json(body, okStatus);
}
