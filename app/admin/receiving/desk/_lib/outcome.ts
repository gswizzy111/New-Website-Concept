import type { TrackActionResponse } from "@/lib/intake/tracking/types";

/**
 * What the Desk page says after Put in holder, Done or Take out: the API's
 * sentence for the whole request, each card's own message when there is
 * more than one card (or one was refused), and what else happened (a step
 * email, a bag finished). Pure (safe in client components and tests).
 */

export type OutcomeLine = { key: string; ok: boolean; label: string; message: string };

export type Outcome = {
  tone: "ok" | "warn" | "error";
  title: string;
  lines: OutcomeLine[];
  notes: string[];
  /** Take out can be undone: these cards go back on the desk. */
  undo?: { cardIds: string[] };
};

export function outcomeOf(res: TrackActionResponse): Outcome {
  const results = res.results ?? [];
  const okCount = results.filter((r) => r.ok).length;
  const tone = okCount === results.length ? "ok" : okCount > 0 ? "warn" : "error";
  const lines = results.length > 1 || okCount < results.length
    ? results.map((r, i) => ({ key: `${r.cardId}-${i}`, ok: r.ok, label: r.code ?? r.name ?? "Card", message: r.message }))
    : [];
  const notes: string[] = [];
  const emailed = res.emailedOrders?.length ?? 0;
  if (emailed === 1) notes.push("The customer got an email about the new step.");
  else if (emailed > 1) notes.push(`${emailed} customers got an email about the new step.`);
  const bags = res.bagsCompleted?.length ?? 0;
  if (bags === 1) notes.push("1 bag is now all done.");
  else if (bags > 1) notes.push(`${bags} bags are now all done.`);
  return { tone, title: res.message, lines, notes };
}

/** A request that failed as a whole (nothing was changed). */
export function failedOutcome(error: string): Outcome {
  return { tone: "error", title: error, lines: [], notes: [] };
}

/** The cards a request moved off the desk or changed (refused ones stay picked). */
export function settledIds(res: TrackActionResponse): string[] {
  return (res.results ?? []).filter((r) => r.ok).map((r) => r.cardId);
}
