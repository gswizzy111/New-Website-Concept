"use client";

import Link from "next/link";
import { useState } from "react";
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

export function Nav() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const { itemCount } = useCart();
  const pathname = usePathname();
  const reduce = usePrefersReducedMotion();
  const glide = reduce ? { duration: 0 } : { type: "spring" as const, bounce: 0.15, duration: 0.45 };

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

      {/* Mobile drawer */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="drawer"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
            className="md:hidden overflow-hidden border-t border-rule bg-paper"
          >
            <div className="px-4 pt-3 pb-6">
              <div className="flex flex-col divide-y divide-rule">
                {TABS.map((tab, i) => (
                  <motion.div
                    key={tab.href}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.05 + i * 0.05 }}
                  >
                    <Link
                      href={tab.href}
                      onClick={() => setOpen(false)}
                      aria-current={isTabActive(tab) ? "page" : undefined}
                      className={`flex items-center justify-between py-4 text-2xl font-heading font-extrabold tracking-[-0.02em] [font-variation-settings:'wdth'_84] ${isTabActive(tab) ? "text-rx" : "text-ink"}`}
                    >
                      {tab.label}
                      <span aria-hidden className="text-base text-muted-foreground">→</span>
                    </Link>
                  </motion.div>
                ))}
              </div>
              <motion.div
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="mt-2 border-t border-rule pt-4 flex flex-col gap-3"
              >
                {SEC_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="text-[15px] font-medium text-muted-foreground hover:text-ink transition-colors"
                  >
                    {l.label}
                  </Link>
                ))}
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="text-[15px] font-medium text-muted-foreground hover:text-ink transition-colors"
                >
                  My Account
                </Link>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
