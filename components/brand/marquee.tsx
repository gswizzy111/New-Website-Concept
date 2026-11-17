"use client";

import { Fragment, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export type MarqueeProps = {
  /** The row's items (owner's words). Rendered twice for a seamless loop. */
  items: React.ReactNode[];
  /** Seconds for one full loop (trust strip 38, symptoms ticker 44). */
  speed?: number;
  /** Drawn after every item, e.g. a small card shape or a sparkle. Decorative. */
  separator?: React.ReactNode;
  /** Also pause while a mouse is over the track (default true). Focus and the toggle always pause. */
  pauseOnHover?: boolean;
  /** Slide the other way (left to right), e.g. a second belt under another. */
  reverse?: boolean;
  /** Accessible name for the list, e.g. "Why collectors trust us". */
  label?: string;
  /** Hide both copies from screen readers (when the caller renders its own plain list). */
  decorative?: boolean;
  /** Colour scheme of the pause button: "dark" for ink bands, "light" for white. */
  tone?: "light" | "dark";
  className?: string;
  /** Classes for each item (type size, padding, gap). */
  itemClassName?: string;
};

/**
 * A seamless CSS marquee: the list is rendered twice and the track slides
 * one copy left, linear, forever. Screen readers get the first copy only.
 * A 44px pause/play toggle at the end stops it for touch and keyboard users
 * (WCAG 2.2.2); keyboard focus inside also pauses it. Reduced motion: no
 * movement, no toggle; the first copy wraps, centred.
 * Keep it flat and quiet: no tilted tape over the hero.
 */
export function Marquee({
  items,
  speed = 38,
  separator,
  pauseOnHover = true,
  reverse = false,
  label,
  decorative = false,
  tone = "light",
  className,
  itemClassName,
}: MarqueeProps) {
  const [paused, setPaused] = useState(false);
  const row = (hidden: boolean) => (
    <ul className="bm-marquee-list" aria-hidden={hidden || undefined} inert={hidden || undefined} aria-label={hidden ? undefined : label}>
      {items.map((item, i) => (
        <Fragment key={i}>
          <li className={cn("bm-marquee-item", itemClassName)}>{item}</li>
          {separator && (
            <li aria-hidden className="bm-marquee-item">
              {separator}
            </li>
          )}
        </Fragment>
      ))}
    </ul>
  );
  return (
    <div className={cn("flex items-center", className)}>
      <div
        className="bm-marquee min-w-0 flex-1"
        data-pause={pauseOnHover ? "" : undefined}
        data-paused={paused ? "" : undefined}
        data-reverse={reverse ? "" : undefined}
        aria-hidden={decorative || undefined}
        style={{ ["--bm-speed" as string]: `${speed}s` }}
      >
        <div className="bm-marquee-track">
          {row(decorative)}
          {row(true)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        aria-label={paused ? "Play scrolling text" : "Pause scrolling text"}
        className={cn(
          "relative z-[1] mx-1.5 grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-150 motion-reduce:hidden",
          tone === "dark"
            ? "text-white/80 hover:bg-white/10 hover:text-white"
            : "text-ink-soft hover:bg-ink/5 hover:text-ink"
        )}
      >
        {paused ? (
          <Play aria-hidden className="size-4" strokeWidth={1.75} />
        ) : (
          <Pause aria-hidden className="size-4" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}
