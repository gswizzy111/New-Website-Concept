import type { MoveResponse, MoveResultItem } from "@/lib/intake/tracking/types";

/**
 * Client side of POST /api/admin/track/move (lib/intake/tracking/types.ts
 * MoveRequest / MoveResponse) for the ship check page, plus the scan beep.
 */

export const SHIP_LOCATION = "LOC-SHIP";
export const DONE_LOCATION = "LOC-DONE";

export type MoveOutcome =
  | { ok: true; result: MoveResultItem | null; response: MoveResponse }
  | { ok: false; error: string };

/** Moves the codes to a place; one result per code. Never throws. */
export async function moveTo(locationCode: string, codes: string[], sessionId?: string): Promise<MoveOutcome> {
  try {
    const res = await fetch("/api/admin/track/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationCode, codes, ...(sessionId ? { sessionId } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<MoveResponse> & { error?: string };
    if (!res.ok || !Array.isArray(data.results)) {
      return { ok: false, error: data.error || (res.status === 401 ? "Signed out. Sign in again, then scan." : "Not saved. Try again.") };
    }
    return { ok: true, result: data.results[0] ?? null, response: data as MoveResponse };
  } catch {
    return { ok: false, error: "Network error. Check the connection, then scan again." };
  }
}

let audio: AudioContext | null = null;

/** A short beep (high = good, low = look) and a buzz on phones that can. Silent when blocked. */
export function scanFeedback(kind: "good" | "warn" | "bad"): void {
  try {
    navigator.vibrate?.(kind === "good" ? 40 : [90, 60, 90]);
  } catch {
    /* no vibration */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = kind === "good" ? 1320 : kind === "warn" ? 660 : 330;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (kind === "good" ? 0.09 : 0.22));
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (kind === "good" ? 0.1 : 0.24));
  } catch {
    /* no sound */
  }
}
