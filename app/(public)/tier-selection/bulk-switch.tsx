"use client";

import { useRef, useState } from "react";
import { BULK_PLANS, type BulkPlan } from "@/lib/bulk-pricing";
import { cn } from "@/lib/utils";

/**
 * Individual / 10+ / 20+ switch for the tier prices (and the Prep page's).
 * Each price block renders all three prices (marked data-plan); this sets
 * data-bulk on the wrapper and globals.css shows the matching one, so the
 * cards stay server-rendered. `note` replaces the Restorations page's note;
 * `stacked` keeps the note under the switch at every width (a narrow column).
 *
 * Drawn as a pill track: white, hairline-ringed, the chosen plan an ink pill
 * with its discount in sun.
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
      <div className={stacked ? "mb-8 flex flex-col gap-4" : "mb-6 flex flex-col gap-3 md:mb-10 md:flex-row md:items-center md:justify-between md:gap-10"}>
        <div
          role="radiogroup"
          aria-label="Number of cards"
          className={cn(
            "grid w-full grid-cols-3 gap-1 rounded-full bg-white p-1.5 shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]",
            !stacked && "md:inline-grid md:w-auto md:shrink-0"
          )}
        >
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
                className={cn(
                  "relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-full px-2 transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt active:scale-[0.98] motion-reduce:transition-none md:px-7",
                  active ? "bg-ink text-white shadow-[0_8px_18px_-10px_rgba(13,18,51,0.7)]" : "text-ink hover:bg-chalk"
                )}
              >
                <span className="text-[15px] font-extrabold leading-none whitespace-nowrap">{p.label}</span>
                <span
                  className={cn(
                    "label-caps text-[13px] leading-none",
                    p.percent > 0 ? (active ? "text-sun" : "text-cobalt") : active ? "text-on-dark-muted" : "text-ink-soft"
                  )}
                >
                  {p.percent > 0 ? `${p.percent}% off` : "Standard"}
                </span>
              </button>
            );
          })}
        </div>
        <p className={cn("text-[15px] leading-relaxed text-ink-soft", !stacked && "md:max-w-md")}>
          {note ?? <>Bulk pricing is applied automatically at checkout for every tier except Diamond. Discounts don&apos;t combine: you get the biggest one.</>}
        </p>
      </div>
      {children}
    </div>
  );
}
