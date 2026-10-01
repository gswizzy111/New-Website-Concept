"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Menu, ShoppingCart, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";
import { useCart } from "@/lib/cart-context";

// Primary service tabs — shown prominently
const TABS = [
  { href: "/tier-selection", label: "Restorations", match: ["/tier-selection", "/restoration"] },
  { href: "/prep", label: "Prep", match: ["/prep"] },
  { href: "/shop", label: "Kits", match: ["/shop", "/cart"] },
];

// Secondary nav links
const SEC_LINKS = [
  { href: "/track", label: "Track Order" },
  { href: "/gift-cards", label: "Gift Cards" },
];

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// One-line hints under each service in the mobile menu (owner's own copy).
const TAB_HINTS: Record<string, string> = {
  "/tier-selection": "From $75 / card",
  "/prep": "From $25 / card",
  "/shop": "Free shipping on all kits",
};

export function Nav() {
  const [open, setOpen] = useState(false);
  // Client-only flag for the portal (no setState-in-effect, no hydration mismatch).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [hovered, setHovered] = useState<string | null>(null);
  const { itemCount } = useCart();
  const pathname = usePathname();
  const reduce = usePrefersReducedMotion();
  const glide = reduce ? { duration: 0 } : { type: "spring" as const, bounce: 0.15, duration: 0.45 };

  // Close on navigation (derived during render), then lock page scroll and
  // listen for Escape while open.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function isTabActive(tab: typeof TABS[number]) {
    return tab.match.some((m) => pathname.startsWith(m));
  }

  const cartLink = (
    <Link
      href="/cart"
      aria-label="Cart"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-ink/[0.05] transition-colors"
    >
      <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {itemCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-rx text-primary-foreground font-mono text-[10px] font-medium rounded-full flex items-center justify-center">
          {itemCount}
        </span>
      )}
    </Link>
  );

  return (
    <header className="relative bg-paper/90 backdrop-blur-xl backdrop-saturate-150 border-b border-rule/80">
      <nav className="max-w-7xl mx-auto px-4 md:px-10 h-16 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/card-doctor.jpg"
            alt="The Card Doc"
            className="w-8 h-8 rounded-md object-cover ring-1 ring-rule transition-transform duration-300 ease-[var(--ease-out)] group-hover:-rotate-6"
          />
          <span className="font-heading text-lg font-extrabold tracking-[-0.02em] text-ink [font-variation-settings:'wdth'_86]">The Card Doc</span>
        </Link>

        {/* Desktop — three service tabs */}
        <div className="hidden md:flex items-center gap-1 self-stretch" onMouseLeave={() => setHovered(null)}>
          {TABS.map((tab) => {
            const active = isTabActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => setHovered(tab.href)}
                className={`relative flex items-center px-3.5 text-[15px] font-semibold transition-colors duration-150 ${
                  active ? "text-ink" : "text-muted-foreground hover:text-ink"
                }`}
              >
                {hovered === tab.href && (
                  <motion.span
                    layoutId="nav-hover"
                    transition={glide}
                    className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-9 rounded-md bg-ink/[0.05]"
                    aria-hidden
                  />
                )}
                <span className="relative">{tab.label}</span>
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    transition={glide}
                    className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-rx"
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* Desktop right */}
        <div className="hidden md:flex items-center gap-5 shrink-0">
          {SEC_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="draw-underline pb-0.5 text-sm font-medium text-muted-foreground hover:text-ink transition-colors duration-150"
            >
              {l.label}
            </Link>
          ))}
          {cartLink}
          <Link
            href="/account"
            className="inline-flex h-9 items-center rounded-md border border-rule bg-white/60 px-3.5 text-sm font-semibold text-ink hover:border-ink/40 hover:bg-white transition-colors duration-150"
          >
            My Account
          </Link>
        </div>

        {/* Mobile right */}
        <div className="flex items-center gap-1 md:hidden">
          {cartLink}
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-ink/[0.05]"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={open ? "x" : "menu"}
                initial={reduce ? false : { opacity: 0, rotate: -45, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, rotate: 45, scale: 0.6 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="inline-flex"
              >
                {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </nav>

      {/* Mobile menu: full-screen sheet on the ink stage, portaled to <body> so the
          header's backdrop-filter doesn't trap its fixed positioning. */}
      {mounted && createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            initial={reduce ? { opacity: 0 } : { clipPath: "circle(0% at calc(100% - 2.25rem) 2rem)" }}
            animate={reduce ? { opacity: 1 } : { clipPath: "circle(150% at calc(100% - 2.25rem) 2rem)" }}
            exit={reduce ? { opacity: 0 } : { clipPath: "circle(0% at calc(100% - 2.25rem) 2rem)" }}
            transition={{ duration: reduce ? 0.2 : 0.6, ease: EASE_OUT }}
            className="stage md:hidden !fixed inset-0 z-[70] flex flex-col overflow-y-auto overscroll-contain bg-ink text-paper pt-[env(safe-area-inset-top)] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex h-16 shrink-0 items-center justify-between px-4">
              <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/card-doctor.jpg" alt="The Card Doc" className="w-8 h-8 rounded-md object-cover ring-1 ring-white/20" />
                <span className="font-heading text-lg font-extrabold tracking-[-0.02em] [font-variation-settings:'wdth'_86]">The Card Doc</span>
              </Link>
              <button
                onClick={() => setOpen(false)}
                className="press inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-paper"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            <nav className="mt-6 flex-1 px-4">
              <ul className="border-t border-white/15">
                {TABS.map((tab, i) => {
                  const active = isTabActive(tab);
                  return (
                    <li key={tab.href} className="overflow-hidden border-b border-white/15">
                      <motion.div
                        initial={reduce ? false : { y: "110%" }}
                        animate={{ y: 0 }}
                        transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.15 + i * 0.07 }}
                      >
                        <Link
                          href={tab.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className="press group flex items-end justify-between gap-4 py-5"
                        >
                          <span>
                            <span className={`block font-heading text-[2.75rem] leading-[0.95] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_80] ${active ? "text-[oklch(0.82_0.11_165)]" : "text-paper"}`}>
                              {tab.label}
                            </span>
                            <span className="mt-2 block font-mono text-xs text-paper/55">{TAB_HINTS[tab.href]}</span>
                          </span>
                          <span aria-hidden className="mb-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 text-paper/80">
                            →
                          </span>
                        </Link>
                      </motion.div>
                    </li>
                  );
                })}
              </ul>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.4 }}
                className="mt-8 grid grid-cols-2 gap-2"
              >
                {[...SEC_LINKS, { href: "/account", label: "My Account" }, { href: "/cart", label: "Cart" }].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="press flex h-12 items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] px-4 text-[15px] font-semibold text-paper"
                  >
                    {l.label}
                    {l.href === "/cart" && itemCount > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-rx font-mono text-[11px] flex items-center justify-center">{itemCount}</span>
                    )}
                  </Link>
                ))}
              </motion.div>
            </nav>

            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.55 }}
              className="mt-10 px-4 text-sm"
            >
              <p className="rx-label !text-paper/50 mb-2">Contact</p>
              <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className="block font-semibold text-paper">
                DM us on @the_card_doc
              </a>
              <p className="mt-1 text-paper/55">We reply within 1 business day.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body)}
    </header>
  );
}
