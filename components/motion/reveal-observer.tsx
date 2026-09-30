"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll reveals for marketing pages.
 *
 * Mark elements with `data-reveal` (the element rises in) or
 * `data-reveal="stagger"` (its children rise in one after another).
 * Content is visible by default: only elements still below the fold when the
 * page loads are armed, and each one reveals once.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])"));
    if (els.length === 0 || !("IntersectionObserver" in window)) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );

    const fold = window.innerHeight * 0.9;
    for (const el of els) {
      if (el.getAttribute("data-reveal") === "stagger") {
        Array.from(el.children).forEach((child, i) => {
          (child as HTMLElement).style.setProperty("--i", String(Math.min(i, 12)));
        });
      }
      if (el.getBoundingClientRect().top < fold) {
        el.setAttribute("data-revealed", "");
        continue;
      }
      el.setAttribute("data-armed", "");
      io.observe(el);
    }
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
