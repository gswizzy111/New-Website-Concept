"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Print } from "@/components/brand";
import { cn } from "@/lib/utils";
import { RECEIPTS, type Receipt } from "./receipts";

// Alternating small tilts, like prints laid on a table.
const TILT = [-1.6, 1.2, -0.6, 1.8, -1.1];

/**
 * The "receipts": real DM screenshots as small prints in one row. Phones
 * swipe it (scroll-snap) with a "1 / 8" counter; from lg up five sit across,
 * and longer sets keep scrolling with arrow buttons.
 */
export function ReceiptStrip({
  ids,
  exclude = [],
  className = "",
}: {
  /** Which receipts, in order. Defaults to all of them. */
  ids?: string[];
  /** Receipts already shown elsewhere on the page. */
  exclude?: string[];
  className?: string;
}) {
  const list: Receipt[] = (ids ? ids.map((id) => RECEIPTS.find((r) => r.id === id)).filter((r): r is Receipt => !!r) : RECEIPTS).filter(
    (r) => !exclude.includes(r.id)
  );
  const ref = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [scrollable, setScrollable] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setScrollable(el.scrollWidth - el.clientWidth > 4);
      const first = el.children[0] as HTMLElement | undefined;
      const second = el.children[1] as HTMLElement | undefined;
      if (!first) return;
      const step = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      setIndex(atEnd ? list.length - 1 : Math.min(list.length - 1, Math.max(0, Math.round(el.scrollLeft / step))));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [list.length]);

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className={className}>
      <ul
        ref={ref}
        aria-label="Customer messages (screenshots)"
        // Scrolls sideways, so keyboards can reach it too.
        tabIndex={0}
        className={cn(
          "no-scrollbar focus-visible:outline-offset-[-3px] -mx-[var(--gut)] flex snap-x snap-mandatory scroll-px-[var(--gut)] gap-5 overflow-x-auto px-[var(--gut)] pt-5 pb-8 lg:mx-0 lg:scroll-px-0 lg:gap-6 lg:px-1",
          list.length <= 5 && "lg:grid lg:grid-cols-[repeat(var(--n),minmax(0,1fr))] lg:overflow-visible",
        )}
        style={list.length <= 5 ? ({ ["--n" as string]: list.length } as React.CSSProperties) : undefined}
      >
        {list.map((r, i) => (
          <li
            key={r.id}
            className={cn(
              "w-[74%] max-w-[280px] shrink-0 snap-start",
              list.length <= 5 ? "lg:w-auto lg:max-w-none" : "lg:w-[calc((100%-6rem)/5)] lg:max-w-none",
            )}
          >
            <Print
              src={r.src}
              alt={r.alt}
              aspect="1"
              fit="contain"
              matte={r.matte}
              border="sm"
              tilt={TILT[i % TILT.length]}
              lift
              sizes="(min-width: 1024px) 280px, 74vw"
            />
          </li>
        ))}
      </ul>
      {scrollable && (
        <div className="mt-2 flex items-center gap-3">
          <p aria-hidden className="font-display text-lg font-extrabold tabular-nums tracking-[0.02em] text-ink-soft">
            <span className="text-ink">{index + 1}</span> / {list.length}
          </p>
          <div className="ml-auto hidden gap-2 lg:flex">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={index === 0}
              aria-label="Previous messages"
              className="grid size-11 place-items-center rounded-full bg-white text-ink shadow-[0_0_0_1px_var(--line)] transition-colors duration-150 hover:bg-sun disabled:opacity-40 disabled:hover:bg-white"
            >
              <ChevronLeft className="size-5" strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={index >= list.length - 1}
              aria-label="Next messages"
              className="grid size-11 place-items-center rounded-full bg-white text-ink shadow-[0_0_0_1px_var(--line)] transition-colors duration-150 hover:bg-sun disabled:opacity-40 disabled:hover:bg-white"
            >
              <ChevronRight className="size-5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
