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
 * A marquee that drifts on its own, surges with scroll speed and turns to
 * follow the scroll direction. Children are two identical copies of the row;
 * the track slides one copy-width and wraps. Pauses under a mouse pointer and
 * while off screen. Reduced motion: static (CSS wraps the row).
 */
export function VelocityMarquee({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const inView = useInView(ref);
  const paused = useRef(false);
  const direction = useRef(1);

  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const smoothVelocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const boost = useTransform(smoothVelocity, [0, 1000], [0, 4], { clamp: false });
  const x = useTransform(baseX, (v) => `${wrap(-50, 0, v)}%`);

  useAnimationFrame((_, delta) => {
    if (reduce || !inView || paused.current) return;
    const b = boost.get();
    if (b < 0) direction.current = -1;
    else if (b > 0) direction.current = 1;
    const step = -DRIFT * (Math.min(delta, 64) / 1000);
    baseX.set(baseX.get() + direction.current * step * (1 + Math.abs(b)));
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
