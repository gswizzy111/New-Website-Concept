"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

/**
 * The card behind the hero specimen fans further out as the page scrolls,
 * so the stack separates instead of moving as one flat picture.
 */
export function ScrollFan({ children }: { children: React.ReactNode }) {
  const reduce = usePrefersReducedMotion();
  const { scrollY } = useScroll();
  const rotate = useTransform(scrollY, [0, 700], [0, 7], { clamp: true });
  const x = useTransform(scrollY, [0, 700], [0, 36], { clamp: true });
  const y = useTransform(scrollY, [0, 700], [0, -70], { clamp: true });

  if (reduce) return <div>{children}</div>;
  return <motion.div style={{ rotate, x, y }}>{children}</motion.div>;
}
