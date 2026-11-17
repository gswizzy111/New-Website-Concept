"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { BeforeAfter } from "@/components/motion/before-after";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";
import { AcrylicHolder, Print } from "@/components/brand";
import { cn } from "@/lib/utils";
import type { ResultCase } from "@/lib/about";

/**
 * Real before/after results on ink, one case per slide. The slides sit in a
 * native scroll-snap track: phones swipe between them (the next one peeks
 * in), and the case names above jump to one on any screen. A slider case is
 * the drag/keyboard <BeforeAfter/> in the acrylic holder; a composite case is
 * the owner's own side-by-side photo as a print. Cases come from RESULTS in
 * lib/about.ts.
 */
export function ResultsGallery({ cases }: { cases: ResultCase[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const reduce = usePrefersReducedMotion();

  // The case in view is the slide whose start is nearest the track's scroll
  // position (read on scroll, so a swipe, a trackpad or a tap all agree).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
        const slides = Array.from(track.children) as HTMLElement[];
        let best = 0;
        slides.forEach((s, i) => {
          if (Math.abs(s.offsetLeft - pad - track.scrollLeft) < Math.abs(slides[best].offsetLeft - pad - track.scrollLeft)) best = i;
        });
        setActive(best);
      });
    };
    track.addEventListener("scroll", update, { passive: true });
    return () => {
      track.removeEventListener("scroll", update);
      cancelAnimationFrame(raf);
    };
  }, []);

  function go(i: number) {
    const track = trackRef.current;
    const slide = track?.children[i] as HTMLElement | undefined;
    if (!track || !slide) return;
    // Scroll the track only (scrollIntoView would also move the page). The
    // track is the slides' offset parent, so offsetLeft includes its padding.
    const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
    track.scrollTo({ left: slide.offsetLeft - pad, behavior: reduce ? "auto" : "smooth" });
    setActive(i);
  }

  if (cases.length === 0) return null;

  return (
    <div>
      {cases.length > 1 && (
        <div className="mb-8 flex flex-wrap items-center gap-3 md:mb-12" aria-label="Choose a result">
          {cases.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => go(i)}
              aria-controls={`result-${c.id}`}
              aria-current={i === active ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-2.5 rounded-full px-5 text-[15px] font-bold transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)]",
                i === active
                  ? "bg-sun text-ink"
                  : "bg-ink-2 text-white shadow-[inset_0_0_0_1px_var(--line-dark)] hover:bg-[#222a5c]"
              )}
            >
              <span aria-hidden className={cn("inline-block h-3.5 w-2.5 rounded-[2px]", i === active ? "bg-ink" : "border-[1.5px] border-sun")} />
              {c.card}
            </button>
          ))}
          <span className="label-caps ml-auto text-[17px] tabular-nums text-sun" aria-live="polite">
            {active + 1} / {cases.length}
          </span>
        </div>
      )}

      <div
        ref={trackRef}
        className="relative -mx-[var(--gut)] flex snap-x snap-mandatory gap-5 overflow-x-auto overscroll-x-contain scroll-px-[var(--gut)] px-[var(--gut)] pt-2 pb-6 [scrollbar-width:none] md:mx-0 md:scroll-px-0 md:gap-12 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {cases.map((c, i) => (
          <article
            key={c.id}
            id={`result-${c.id}`}
            data-index={i}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${cases.length}: ${c.card}`}
            className={cn(
              cases.length > 1 ? "w-[86%]" : "w-full",
              "grid shrink-0 snap-start gap-8 md:w-full md:grid-cols-12 md:items-center md:gap-14"
            )}
          >
            <div className="md:col-span-7">
              {c.kind === "slider" ? (
                <AcrylicHolder className="mx-auto max-w-[34rem]">
                  <BeforeAfter
                    before={c.before}
                    after={c.after}
                    beforeAlt={c.beforeAlt}
                    afterAlt={c.afterAlt}
                    sizes="(min-width: 1152px) 540px, (min-width: 768px) 52vw, 84vw"
                  />
                </AcrylicHolder>
              ) : (
                <Print
                  src={c.image}
                  alt={c.alt}
                  surface="dark"
                  border="lg"
                  tilt={-1.5}
                  sizes="(min-width: 768px) 520px, 84vw"
                  className="mx-auto w-full max-w-[32rem]"
                />
              )}
            </div>

            <div className="md:col-span-5">
              <h3 className="caps font-display text-[40px] font-black leading-[0.9] text-white md:text-[56px]">{c.card}</h3>
              {c.detail && <p className="mt-3 text-[15px] font-bold text-sun">{c.detail}</p>}
              <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-on-dark-muted md:text-[17px]">{c.caption}</p>
              {c.kind === "slider" && (
                <p className="mt-7 flex items-center gap-3 text-sm font-medium text-on-dark-muted">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-sun text-ink">
                    <ChevronsLeftRight className="size-4" strokeWidth={2} />
                  </span>
                  Drag the handle, or use the arrow keys, to compare.
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
