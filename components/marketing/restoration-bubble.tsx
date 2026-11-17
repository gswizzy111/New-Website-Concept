"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";

// Booking and checkout pages, where the dock would cover the form, and the
// Prep pages, where a visitor is shopping Prep, not Restoration: the
// restoration and prep order forms, the cart and its checkout, gift cards,
// subscriptions and the pages a payment returns to.
const HIDE_ON = [
  "/restoration",
  "/tier-selection",
  "/order",
  "/prep",
  "/cart",
  "/checkout",
  "/gift-cards",
  "/subscribe",
  "/shop/order-confirmed",
];

/** True on a listed page or anything under it ("/cart" hides "/cart/checkout"). */
export function hidesBookingButton(pathname: string) {
  return HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Phone call button: a small ink pill with the brand mark,
 * bottom right. It climbs in once the visitor scrolls
 * past the first screen, tucks away when the footer arrives (so it never
 * covers the end of the page) and pads for the home indicator.
 */
export function RestorationBubble() {
  const pathname = usePathname();
  const reduce = usePrefersReducedMotion();
  const [pastHero, setPastHero] = useState(false);
  const [atFooter, setAtFooter] = useState(false);
  const hidden = hidesBookingButton(pathname);

  // While the dock can show, phones get room under <main> (globals.css,
  // html[data-dock]) so it never sits over the last rows of a page.
  useEffect(() => {
    if (hidden) return;
    const root = document.documentElement;
    root.setAttribute("data-dock", "");
    return () => root.removeAttribute("data-dock");
  }, [hidden]);

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
          initial={reduce ? { opacity: 0 } : { y: "140%", opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "140%", opacity: 0 }}
          transition={reduce ? { duration: 0.15 } : { duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          className="vt-dock md:hidden fixed right-3 bottom-0 z-50 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <Link
            href="/restoration"
            className="group flex min-h-14 items-center gap-3 rounded-full bg-ink py-1.5 pr-5 pl-1.5 text-white shadow-[0_0_0_2px_var(--white),0_14px_30px_-10px_rgba(8,12,40,0.6)] transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            <span aria-hidden className="relative block size-11 shrink-0 overflow-hidden rounded-full bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/card-doctor.jpg" alt="" className="block size-full scale-[1.9] object-cover object-[52%_0%] [transform-origin:52%_12%]" />
            </span>
            <span className="flex flex-col items-start gap-1">
              <span className="text-[15px] font-extrabold leading-none">Book a Restoration</span>
              <span className="font-display text-[15px] font-extrabold leading-none tracking-[0.02em] text-sun tabular-nums">
                From $75 / card
              </span>
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
