import type {
  AssignRequest,
  CapacityConflict,
  DoneRequest,
  MoveRequest,
  ReleaseRequest,
  ResolveResponse,
  SearchResponse,
  TrackActionResponse,
} from "@/lib/intake/tracking/types";

/**
 * The Scan page's calls to the tracking API (app/api/admin/track/**). Each
 * returns { ok: true, data } or { ok: false, error } with a sentence staff can
 * read; a full slot comes back as { ok: false, conflict } so the page can
 * offer "Add anyway".
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; conflict?: CapacityConflict };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, error: "No connection. Nothing was saved: scan again." };
  }
  const body = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: unknown }) | null;
  if (res.ok && body) return { ok: true, data: body as T };
  if (res.status === 409 && body?.overCapacity) {
    return { ok: false, status: 409, error: String(body.error ?? "That slot is full."), conflict: body as unknown as CapacityConflict };
  }
  const error =
    typeof body?.error === "string" && body.error
      ? body.error
      : res.status === 401 || res.status === 403
        ? "You're signed out. Sign in again, then scan again."
        : res.status === 404
          ? "Not found."
          : `Something went wrong (${res.status}). Nothing was saved.`;
  return { ok: false, status: res.status, error };
}

function post<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** A slot or place (and its cards), a bag or order (cards with their slots), or a typed Card ID. */
export function resolve(code: string) {
  return call<ResolveResponse>(`/api/admin/track/resolve?code=${encodeURIComponent(code)}`);
}

/** Cards by Card ID, card name, customer or order number (2+ characters). */
export function search(q: string) {
  return call<SearchResponse>(`/api/admin/track/search?q=${encodeURIComponent(q)}`);
}

export function assign(body: AssignRequest) {
  return post<TrackActionResponse>("/api/admin/track/assign", body);
}

export function move(body: MoveRequest) {
  return post<TrackActionResponse>("/api/admin/track/move", body);
}

export function release(body: ReleaseRequest) {
  return post<TrackActionResponse>("/api/admin/track/release", body);
}

export function done(body: DoneRequest) {
  return post<TrackActionResponse>("/api/admin/track/done", body);
}

/** A failed card in an otherwise saved request ("2 of 3 saved"), as one line; null when all went through. */
export function partialProblem(res: TrackActionResponse): string | null {
  const failed = res.results.filter((r) => !r.ok);
  if (!failed.length) return null;
  return failed.map((r) => `${r.code ?? r.name ?? "A card"}: ${r.message}`).join(" ");
}
