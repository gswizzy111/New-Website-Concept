"use client";

import { useRef } from "react";
import { motion, useMotionTemplate, useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";
import { useForwardOnly } from "@/components/motion/use-scroll-once";
import { cn } from "@/lib/utils";

/**
 * A dark stage that arrives as an inset, rounded panel and opens to full
 * bleed as it scrolls up the viewport, like a light box being switched on.
 * Once open it stays open (scrolling back up doesn't shrink it again).
 * The inset size comes from `--stage-inset` (set per breakpoint) so phones
 * never clip into their 16px gutter. Reduced motion: full bleed, static.
 */
export function ExpandingStage({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 12%"] });
  const opened = useForwardOnly(scrollYProgress);
  const p = useTransform(opened, [0, 1], [1, 0]);
  const radius = useTransform(opened, [0, 1], [28, 0]);
  const clipPath = useMotionTemplate`inset(0 calc(${p} * var(--stage-inset)) round ${radius}px)`;

  return (
    <motion.div
      ref={ref}
      style={{ clipPath: reduce ? "none" : clipPath }}
      className={cn("[--stage-inset:12px] md:[--stage-inset:48px]", className)}
    >
      {children}
    </motion.div>
  );
}
