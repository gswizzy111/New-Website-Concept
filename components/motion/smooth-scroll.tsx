"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

// Booking and payment screens keep native scrolling (no new motion there).
const NATIVE_ROUTES = ["/cart", "/checkout", "/order", "/prep/order"];

/**
 * Inertia scrolling for wheels and trackpads. Touch keeps the platform's own
 * scrolling, so phones feel native. Lenis drives the real window scroll, so
 * sticky elements and Motion's useScroll effects follow it without changes.
 */
export function SmoothScroll() {
  const pathname = usePathname();
  const reduce = usePrefersReducedMotion();
  const native = NATIVE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  useEffect(() => {
    if (reduce || native) return;
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.12,
      anchors: { offset: -112 },
      // Pauses while the phone menu locks the page (overflow: hidden on <html>).
      autoToggle: true,
      allowNestedScroll: true,
      // Clicking through to another page drops any leftover glide.
      stopInertiaOnNavigate: true,
    });
    return () => lenis.destroy();
  }, [reduce, native]);

  return null;
}
