import type { TrackActionResponse } from "@/lib/intake/tracking/types";

/**
 * Client side of the tracking actions the ship check page uses
 * (lib/intake/tracking/types.ts): POST /api/admin/track/done { cardIds }
 * (marks cards done; they leave their slot for the Done place) and
 * POST /api/admin/track/release { cardIds } (takes cards out of their slot).
 */

export type TrackOutcome = { ok: true; response: TrackActionResponse; message: string } | { ok: false; error: string };

async function post(path: "done" | "release", cardIds: string[]): Promise<TrackOutcome> {
  try {
    const res = await fetch(`/api/admin/track/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardIds }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<TrackActionResponse> & { error?: string };
    if (!res.ok || !Array.isArray(data.results)) {
      return { ok: false, error: data.error || (res.status === 401 ? "Signed out. Sign in again, then try." : "Not saved. Try again.") };
    }
    const failed = data.results.find((r) => !r.ok);
    if (failed) return { ok: false, error: failed.message || "Not saved. Try again." };
    return { ok: true, response: data as TrackActionResponse, message: data.message ?? "" };
  } catch {
    return { ok: false, error: "Network error. Check the connection, then try again." };
  }
}

/** Marks the cards done (and frees their slots). */
export const markCardsDone = (cardIds: string[]) => post("done", cardIds);
/** Takes the cards out of their slots. */
export const takeCardsOut = (cardIds: string[]) => post("release", cardIds);
