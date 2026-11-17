"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getTierById, type RestorationTier, type RestorationTierId } from "@/lib/restoration-tiers";

/**
 * Sold-out and closed tiers, caught before the customer signs. The builder
 * reads GET /api/tiers/availability when it loads and again at the review
 * step; a card on a tier that is closed or has no slots left keeps the Sign
 * button from submitting, with a way back to step 1 to pick another tier.
 * /api/checkout stays the final word: if the read fails (or in preview mode,
 * where /api answers 503), nothing is blocked.
 */

export type TierAvailability = {
  restorationsOpen: boolean;
  tiers: Partial<Record<RestorationTierId, { open: boolean; slotsLeft: number | null }>>;
};

/** The route's answer, or null if it isn't one. */
function parseAvailability(data: unknown): TierAvailability | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { restorations_open?: unknown; tiers?: unknown };
  if (typeof d.restorations_open !== "boolean" || !d.tiers || typeof d.tiers !== "object") return null;
  const tiers: TierAvailability["tiers"] = {};
  for (const [id, raw] of Object.entries(d.tiers as Record<string, unknown>)) {
    const t = raw as { open?: unknown; slots_left?: unknown } | null;
    if (typeof t?.open !== "boolean") continue;
    tiers[id as RestorationTierId] = { open: t.open, slotsLeft: typeof t.slots_left === "number" ? t.slots_left : null };
  }
  return { restorationsOpen: d.restorations_open, tiers };
}

/**
 * The tiers' availability: read on load, and again whenever the customer
 * reaches (or leaves) the review step. null while unknown.
 */
export function useTierAvailability(atReview: boolean): TierAvailability | null {
  const [availability, setAvailability] = useState<TierAvailability | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/tiers/availability", { cache: "no-store", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!ctrl.signal.aborted) setAvailability(parseAvailability(data)); })
      // Unknown: block nothing
      .catch(() => { if (!ctrl.signal.aborted) setAvailability(null); });
    return () => ctrl.abort();
  }, [atReview]);
  return availability;
}

export type TierProblem =
  | { kind: "shop_closed" }
  | { kind: "sold_out" | "closed"; tierId: RestorationTierId; tierName: string; cardNames: string[] };

/** The tiers this order's cards use that can't take it now (none while availability is unknown). */
export function tierAvailabilityProblems(
  cards: { tier?: RestorationTierId; name: string }[],
  availability: TierAvailability | null,
  tiers: RestorationTier[],
): TierProblem[] {
  if (!availability) return [];
  if (!availability.restorationsOpen) return [{ kind: "shop_closed" }];
  const used = [...new Set(cards.map((c) => c.tier).filter((t): t is RestorationTierId => !!t))];
  const problems: TierProblem[] = [];
  for (const tierId of used) {
    const a = availability.tiers[tierId];
    if (!a) continue;
    // Checkout refuses a tier once its slots taken + this order would pass the limit
    const kind = !a.open ? "closed" : a.slotsLeft !== null && a.slotsLeft <= 0 ? "sold_out" : null;
    if (!kind) continue;
    problems.push({
      kind,
      tierId,
      tierName: tiers.find((t) => t.id === tierId)?.name ?? getTierById(tierId).name,
      cardNames: cards.filter((c) => c.tier === tierId).map((c) => c.name.trim()).filter(Boolean),
    });
  }
  return problems;
}

function problemText(p: TierProblem): string {
  // The checkout's own wording when restorations are closed
  if (p.kind === "shop_closed") return "We're not accepting new restoration orders right now. Check back soon!";
  const which = p.cardNames.length > 1 ? "those cards" : "that card";
  return p.kind === "sold_out"
    ? `${p.tierName} just sold out. Choose another tier for ${which} to continue.`
    : `${p.tierName} is closed right now. Choose another tier for ${which} to continue.`;
}

/** Shown just above the Sign button while a tier on the order can't take it. */
export function TierAvailabilityNotice({ problems, onChooseTier }: { problems: TierProblem[]; onChooseTier: () => void }) {
  if (problems.length === 0) return null;
  const canSwitch = problems.some((p) => p.kind !== "shop_closed");
  return (
    // data-missing: a Sign press scrolls here when this is all that's left (revealMissing)
    <div data-missing className="mt-8 rounded-[22px] bg-white p-5 text-ink shadow-[inset_6px_0_0_var(--danger),0_0_0_1px_var(--line),var(--panel-shadow)] sm:p-6">
      <div className="flex gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-6 shrink-0 text-destructive" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div role="alert" className="flex flex-col gap-3">
            {problems.map((p) => (
              <div key={p.kind === "shop_closed" ? p.kind : p.tierId}>
                <p className="text-[15px] font-bold leading-snug text-ink">{problemText(p)}</p>
                {p.kind !== "shop_closed" && p.cardNames.length > 0 && (
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{p.cardNames.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
          {canSwitch && (
            <button type="button" onClick={onChooseTier} className="btn btn-outline mt-4">
              <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
              Choose another tier
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
