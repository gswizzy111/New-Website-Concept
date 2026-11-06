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
    let io: IntersectionObserver | null = null;
    let raf = 0;
    let tries = 0;
    const hydrated = (el: HTMLElement) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));

    const arm = () => {
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])"));
      if (els.length === 0 || !("IntersectionObserver" in window)) return;
      if (tries < 180 && !els.every(hydrated)) {
        tries++;
        raf = requestAnimationFrame(arm);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute("data-revealed", "");
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
      );
      io = observer;

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
        observer.observe(el);
      }
    };

    arm();
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [pathname]);

  return null;
}
