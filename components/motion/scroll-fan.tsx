"use client";

import { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

/**
 * The card behind the hero specimen fans further out as the page scrolls,
 * so the stack separates instead of moving as one flat picture. It fans
 * outward on whichever side it sits: right on desktop, left on phones.
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
  const rotate = useTransform(scrollY, (v) => Math.min(v / 700, 1) * 7 * dir);
  const x = useTransform(scrollY, (v) => Math.min(v / 700, 1) * 36 * dir);
  const y = useTransform(scrollY, [0, 700], [0, -70], { clamp: true });

  if (reduce) return <div>{children}</div>;
  return <motion.div style={{ rotate, x, y }}>{children}</motion.div>;
}
