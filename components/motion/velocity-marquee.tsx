"use client";

import { useRef } from "react";
import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  wrap,
} from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

// Resting drift in % of the track per second (one copy every 38s).
const DRIFT = 50 / 38;

/**
 * A marquee that drifts left on its own and surges with scroll speed in
 * either direction (it never reverses). Children are two identical copies of
 * the row; the track slides one copy-width and wraps. Pauses under a mouse
 * pointer and while off screen. Reduced motion: static (CSS wraps the row).
 */
export function VelocityMarquee({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const inView = useInView(ref);
  const paused = useRef(false);

  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const smoothVelocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const boost = useTransform(smoothVelocity, (v) => Math.min(Math.abs(v) / 1000, 1) * 4);
  const x = useTransform(baseX, (v) => `${wrap(-50, 0, v)}%`);

  useAnimationFrame((_, delta) => {
    if (reduce || !inView || paused.current) return;
    const step = DRIFT * (Math.min(delta, 64) / 1000);
    baseX.set(baseX.get() - step * (1 + boost.get()));
  });

  return (
    <motion.div
      ref={ref}
      style={reduce ? undefined : { x }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") paused.current = true; }}
      onPointerLeave={() => { paused.current = false; }}
      className="marquee-track flex w-max"
    >
      {children}
    </motion.div>
  );
}
