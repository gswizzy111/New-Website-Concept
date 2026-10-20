"use client";

import { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";
import { useSettleOnReturn } from "@/components/motion/use-scroll-once";

/**
 * The card behind the hero specimen fans further out as the page scrolls
 * down, so the stack separates instead of moving as one flat picture. It fans
 * outward on whichever side it sits: right on desktop, left on phones.
 * Scrolling back up settles it home on a spring rather than rewinding.
 */
export function ScrollFan({ children }: { children: React.ReactNode }) {
  const reduce = usePrefersReducedMotion();
  const [dir, setDir] = useState(1);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setDir(mq.matches ? 1 : -1);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const { scrollY } = useScroll();
  const scrolled = useTransform(scrollY, (v) => Math.min(Math.max(v, 0) / 700, 1));
  const fan = useSettleOnReturn(scrolled);
  const rotate = useTransform(fan, (p) => p * 7 * dir);
  const x = useTransform(fan, (p) => p * 36 * dir);
  const y = useTransform(fan, [0, 1], [0, -70]);

  if (reduce) return <div>{children}</div>;
  return <motion.div style={{ rotate, x, y }}>{children}</motion.div>;
}
