import { openCodePath } from "@/lib/intake/codes";
import { isReadyToShipPlace, orderCompletionNotes, ownerName, type ToneLine } from "@/lib/intake/tracking/bag-home";
import type { TrackActionResponse } from "@/lib/intake/tracking/types";

/**
 * What the Desk page says after Put in holder, Done or Take out: the API's
 * sentence for the whole request (after Done it ends with where each card's
 * bag is: "Done. Put it back in REYES's bag: Open bags box, under R."), each
 * card's own message when there is more than one card (or one was refused),
 * and what else happened (a step email; the order completed, green, or why
 * not, amber; a finished bag's page, where it goes in the Ready to ship bin).
 * Pure (safe in client components and tests).
 */

export type OutcomeLine = { key: string; ok: boolean; label: string; message: string };

export type Outcome = {
  tone: "ok" | "warn" | "error";
  title: string;
  lines: OutcomeLine[];
  notes: string[];
  /** The order auto-complete lines ("Order completed. Pat Collector emailed."). */
  orderNotes?: ToneLine[];
  /** Finished bags not in the Ready to ship bin yet: their scan landing ("Open REYES's bag"), where the bin button is. */
  bagLinks?: { key: string; href: string; label: string }[];
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
  // With the bags' places the title says it already ("Bag finished: put it in the Ready to ship bin.")
  if (!res.bags?.length) {
    if (bags === 1) notes.push("1 bag is now all done.");
    else if (bags > 1) notes.push(`${bags} bags are now all done.`);
  }
  const orderNotes = orderCompletionNotes(res.orderCompletions);
  const bagLinks = (res.bags ?? []).filter((b) => b.finished && b.returned > 0 && !isReadyToShipPlace(b.location)).map((b) => {
    const owner = ownerName(b.customer);
    return { key: b.id, href: openCodePath(b.code), label: owner ? `Open ${owner}'s bag` : `Open bag ${b.code}` };
  });
  return {
    tone, title: res.message, lines, notes,
    ...(orderNotes.length ? { orderNotes } : {}),
    ...(bagLinks.length ? { bagLinks } : {}),
  };
}

/** A request that failed as a whole (nothing was changed). */
export function failedOutcome(error: string): Outcome {
  return { tone: "error", title: error, lines: [], notes: [] };
}

/** The cards a request moved off the desk or changed (refused ones stay picked). */
export function settledIds(res: TrackActionResponse): string[] {
  return (res.results ?? []).filter((r) => r.ok).map((r) => r.cardId);
}
