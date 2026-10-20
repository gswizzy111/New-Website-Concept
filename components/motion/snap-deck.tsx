"use client";

import { Children, useEffect, useRef, useState } from "react";

/**
 * Phones: a swipeable deck (native scroll-snap, next card peeking) with a row
 * of name chips that tracks the visible card and jumps to one on tap.
 * md and up: children fall back to the grid given in `gridClassName`.
 */
export function SnapDeck({
  labels,
  gridClassName,
  children,
}: {
  labels: string[];
  gridClassName: string;
  children: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const items = Children.toArray(children);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { root: track, threshold: 0.6 }
    );
    Array.from(track.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  function go(i: number) {
    const el = trackRef.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  return (
    <div>
      {/* Phone chips */}
      <div className="md:hidden -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Tiers">
        {labels.map((l, i) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => go(i)}
            className={`press shrink-0 rounded-full border px-4 h-9 text-sm font-semibold transition-colors duration-200 ${
              i === active ? "border-ink bg-ink text-paper" : "border-rule bg-white text-muted-foreground"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div
        ref={trackRef}
        className={`-mx-4 flex items-start snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0 md:pb-0 ${gridClassName}`}
      >
        {items.map((child, i) => (
          <div key={i} data-index={i} className="w-[86%] shrink-0 snap-start md:w-auto">
            {child}
          </div>
        ))}
      </div>

      {/* Phone position */}
      <div className="md:hidden mt-1 flex items-center justify-center gap-1.5" aria-hidden>
        {items.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === active ? "w-6 bg-rx" : "w-1.5 bg-rule"}`}
          />
        ))}
      </div>
    </div>
  );
}
