import type {
  AssignRequest,
  BagReadyResponse,
  CapacityConflict,
  DoneRequest,
  HolderFull,
  MoveRequest,
  ReleaseRequest,
  ResolveResponse,
  SearchResponse,
  TrackActionResponse,
} from "@/lib/intake/tracking/types";

/**
 * The Scan page's calls to the tracking API (app/api/admin/track/**). Each
 * returns { ok: true, data } or { ok: false, error } with a sentence staff can
 * read; a one-card holder that can't take the cards comes back as { ok:
 * false, full } (its `error` says what to do: no "Add anyway"), a desk with a
 * limit that is full as { ok: false, conflict } so the page can offer "Add
 * anyway".
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; conflict?: CapacityConflict; full?: HolderFull };

/**
 * How long a call may take. Scans run one after another, so a request that
 * never answers (a phone on bad Wi-Fi) would hold up every scan after it.
 * Saves are safe to repeat: a card already in the slot stays as it is.
 */
const TIMEOUT_MS = 20_000;

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  let body: (Record<string, unknown> & { error?: unknown }) | null;
  try {
    res = await fetch(url, { cache: "no-store", ...init, signal: abort.signal });
    body = (await res.json().catch(() => {
      if (abort.signal.aborted) throw new Error("timed out");
      return null;
    })) as typeof body;
  } catch {
    return abort.signal.aborted
      ? { ok: false, status: 0, error: "No answer from the server. Check the connection, then scan again." }
      : { ok: false, status: 0, error: "No connection. Nothing was saved: scan again." };
  } finally {
    clearTimeout(timer);
  }
  if (res.ok && body) return { ok: true, data: body as T };
  if (res.status === 409 && body?.holderFull) {
    return { ok: false, status: 409, error: String(body.error ?? "That holder already has a card."), full: body as unknown as HolderFull };
  }
  if (res.status === 409 && body?.overCapacity) {
    return { ok: false, status: 409, error: String(body.error ?? "That slot is full."), conflict: body as unknown as CapacityConflict };
  }
  // The routes answer a signed-out phone (sessions end after 12 hours) with a bare "Unauthorized"
  const error =
    res.status === 401
      ? "You're signed out. Sign in again, then scan again."
      : typeof body?.error === "string" && body.error
        ? body.error
        : res.status === 403
          ? "Only admins can scan."
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

/** A finished bag is in the Ready to ship bin (LOC-SHIP). */
export function bagReady(body: { bagId: string }) {
  return post<BagReadyResponse>("/api/admin/track/bag-ready", body);
}

/** A failed card in an otherwise saved request ("2 of 3 saved"), as one line; null when all went through. */
export function partialProblem(res: TrackActionResponse): string | null {
  const failed = res.results.filter((r) => !r.ok);
  if (!failed.length) return null;
  return failed.map((r) => `${r.code ?? r.name ?? "A card"}: ${r.message}`).join(" ");
}
