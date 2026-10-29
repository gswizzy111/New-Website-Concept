"use client";

import { useRef, useState } from "react";
import { BULK_PLANS, type BulkPlan } from "@/lib/bulk-pricing";

/**
 * Individual / 10+ / 20+ switch for the tier prices (and the Prep page's).
 * Each price block renders all three prices (marked data-plan); this sets
 * data-bulk on the wrapper and globals.css shows the matching one, so the
 * cards stay server-rendered. `note` replaces the Restorations page's note;
 * `stacked` keeps the note under the switch at every width (a narrow column).
 */
export function BulkSwitch({ children, note, stacked = false }: { children: React.ReactNode; note?: React.ReactNode; stacked?: boolean }) {
  const [plan, setPlan] = useState<BulkPlan>("single");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Radio-group keys: arrows move and select, Home/End jump to the ends
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = BULK_PLANS.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setPlan(BULK_PLANS[next].id);
    buttons.current[next]?.focus();
  }

  return (
    <div data-bulk={plan}>
      <div className={stacked ? "mb-6 flex flex-col gap-3" : "mb-6 md:mb-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"}>
        {/* A segmented control, so on phones it doesn't read as another row of tier chips */}
        <div role="radiogroup" aria-label="Number of cards" className={`grid w-full grid-cols-3 rounded-full border border-rule bg-white p-1${stacked ? "" : " md:inline-grid md:w-auto"}`}>
          {BULK_PLANS.map((p, i) => {
            const active = p.id === plan;
            return (
              <button
                key={p.id}
                ref={(el) => { buttons.current[i] = el; }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setPlan(p.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`press flex h-12 flex-col items-center justify-center rounded-full px-3 transition-colors duration-200 md:px-6 ${
                  active ? "bg-ink text-paper" : "text-muted-foreground hover:text-ink"
                }`}
              >
                <span className="text-sm font-semibold leading-tight">{p.label}</span>
                <span className={`font-mono text-[10px] uppercase leading-tight tracking-wide ${
                  p.percent > 0 ? (active ? "text-rx-bright" : "text-rx") : active ? "text-paper/70" : "text-muted-foreground"
                }`}>
                  {p.percent > 0 ? `${p.percent}% off` : "Standard"}
                </span>
              </button>
            );
          })}
        </div>
        <p className={stacked ? "text-sm text-muted-foreground" : "text-sm text-muted-foreground md:max-w-sm md:text-right"}>
          {note ?? <>Bulk pricing is applied automatically at checkout for every tier except Diamond. Discounts don&apos;t combine: you get the biggest one.</>}
        </p>
      </div>
      {children}
    </div>
  );
}
