"use client";

import { useRef } from "react";
import {
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useSpring,
  type MotionValue,
} from "motion/react";

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

/**
 * Follows `progress` while the page scrolls down. As soon as it scrolls up,
 * the value settles back to `rest` on a spring (usually while still off
 * screen), so the effect never retraces the scroll in reverse.
 */
export function useSettleOnReturn(progress: MotionValue<number>, rest = 0) {
  const { scrollY } = useScroll();
  const down = useRef(true);
  const target = useMotionValue(progress.get());

  useMotionValueEvent(scrollY, "change", (y) => {
    const isDown = y >= (scrollY.getPrevious() ?? y);
    if (isDown === down.current) return;
    down.current = isDown;
    target.set(isDown ? progress.get() : rest);
  });
  useMotionValueEvent(progress, "change", (v) => {
    if (down.current) target.set(v);
  });

  return useSpring(target, { bounce: 0, duration: 0.6 });
}
