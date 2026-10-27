"use client";

import { useMotionValue, useMotionValueEvent, type MotionValue } from "motion/react";

/**
 * Scroll progress that only moves forward. Scrolling back up leaves the
 * effect finished instead of rewinding it.
 */
export function useForwardOnly(progress: MotionValue<number>) {
  const reached = useMotionValue(progress.get());
  useMotionValueEvent(progress, "change", (v) => {
    if (v > reached.get()) reached.set(v);
  });
  return reached;
}
