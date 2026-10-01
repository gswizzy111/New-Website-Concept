"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

const HIDE_ON = ["/restoration", "/tier-selection"];

/**
 * Phone booking dock: a frosted bar on the bottom edge. It slides up once the
 * visitor scrolls past the first screen, tucks away when the footer arrives
 * (so it never covers the end of the page) and pads for the home indicator.
 */
export function RestorationBubble() {
  const pathname = usePathname();
  const reduce = usePrefersReducedMotion();
  const [pastHero, setPastHero] = useState(false);
  const [atFooter, setAtFooter] = useState(false);
  const hidden = HIDE_ON.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (hidden) return;
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:85svh;pointer-events:none";
    document.body.appendChild(sentinel);
    const heroIo = new IntersectionObserver(([e]) => setPastHero(!e.isIntersecting));
    heroIo.observe(sentinel);

    const footer = document.querySelector("footer");
    const footIo = new IntersectionObserver(([e]) => setAtFooter(e.isIntersecting), { rootMargin: "0px 0px -10% 0px" });
    if (footer) footIo.observe(footer);
    return () => {
      heroIo.disconnect();
      footIo.disconnect();
      sentinel.remove();
    };
  }, [hidden, pathname]);

  if (hidden) return null;
  const show = pastHero && !atFooter;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="dock"
          initial={reduce ? { opacity: 0 } : { y: "110%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "110%" }}
          transition={reduce ? { duration: 0.2 } : { type: "spring", bounce: 0, duration: 0.45 }}
          className="md:hidden fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <Link
            href="/restoration"
            className="press flex items-center gap-3 rounded-2xl border border-white/10 bg-ink/85 p-2 pr-2.5 text-paper shadow-[0_18px_40px_-14px_oklch(0.2_0.03_165/0.7)] backdrop-blur-xl backdrop-saturate-150"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/card-doctor.jpg" alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-white/15" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block font-heading text-[17px] font-bold tracking-[-0.01em]">Book a Restoration</span>
              <span className="block font-mono text-[11px] text-paper/60">From $75 / card</span>
            </span>
            <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rx text-lg text-primary-foreground">
              →
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
