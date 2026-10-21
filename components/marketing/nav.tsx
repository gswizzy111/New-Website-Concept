"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronDown, Menu, ShoppingCart, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
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

// Featured in the Explore menu: what restoration can and can't fix.
const FIX_PAGE = { href: "/what-we-can-fix", label: "What We Can Fix" };

// Pages to read before ordering (Explore menu and the phone menu).
const LEARN_LINKS = [
  FIX_PAGE,
  { href: "/how-it-works", label: "How It Works" },
  { href: "/faq", label: "FAQ" },
  { href: "/about", label: "About Us" },
];

const ACCOUNT_LINKS = [...SEC_LINKS, { href: "/account", label: "My Account" }];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
];

// Every public page, grouped, for the Explore menu.
const EXPLORE_GROUPS = [
  { label: "Services", links: TABS },
  { label: "Before You Order", links: LEARN_LINKS.filter((l) => l !== FIX_PAGE) },
  { label: "Orders & Account", links: ACCOUNT_LINKS },
];

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// One-line hints under each service in the mobile menu (owner's own copy).
const TAB_HINTS: Record<string, string> = {
  "/tier-selection": "From $75 / card",
  "/prep": "From $25 / card",
  "/shop": "$5.99 flat-rate US shipping",
};

export function Nav() {
  const [open, setOpen] = useState(false);
  // Client-only flag for the portal (no setState-in-effect, no hydration mismatch).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [exploreOpen, setExploreOpen] = useState(false);
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
    setExploreOpen(false);
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

  const isCurrent = (href: string) => pathname === href;
  const exploreActive = LEARN_LINKS.some((l) => isCurrent(l.href));
  // Keep the hover pill on Explore while its menu is open and the pointer is in it.
  const exploreHighlighted = hovered === "explore" || (exploreOpen && hovered === null);

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
      <nav className="max-w-7xl mx-auto px-4 md:px-10 h-16 flex items-center justify-between gap-4 lg:gap-6">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/card-doctor.jpg"
            alt="The Card Doc"
            className="w-8 h-8 rounded-md object-cover ring-1 ring-rule transition-transform duration-300 ease-[var(--ease-out)] group-hover:-rotate-6"
          />
          <span className="font-heading text-lg font-extrabold tracking-[-0.01em] text-ink">The Card Doc</span>
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

          {/* Explore: every page on the site, with What We Can Fix up top */}
          <MenuPrimitive.Root open={exploreOpen} onOpenChange={setExploreOpen}>
            <MenuPrimitive.Trigger
              openOnHover
              delay={80}
              closeDelay={120}
              onMouseEnter={() => setHovered("explore")}
              className={`group relative flex items-center gap-1 px-3.5 text-[15px] font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-rx focus-visible:ring-offset-2 focus-visible:ring-offset-paper rounded-md ${
                exploreActive || exploreOpen ? "text-ink" : "text-muted-foreground hover:text-ink"
              }`}
            >
              {exploreHighlighted && (
                <motion.span
                  layoutId="nav-hover"
                  transition={glide}
                  className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-9 rounded-md bg-ink/[0.05]"
                  aria-hidden
                />
              )}
              <span className="relative">Explore</span>
              <ChevronDown
                className="relative h-4 w-4 transition-transform duration-200 ease-[var(--ease-out)] group-data-[popup-open]:rotate-180"
                strokeWidth={2}
                aria-hidden
              />
              {exploreActive && (
                <motion.span
                  layoutId="nav-active"
                  transition={glide}
                  className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-rx"
                  aria-hidden
                />
              )}
            </MenuPrimitive.Trigger>
            <MenuPrimitive.Portal>
              <MenuPrimitive.Positioner side="bottom" align="center" sideOffset={6} collisionPadding={16} className="z-[60] outline-none">
                <MenuPrimitive.Popup
                  className="w-[min(44rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-hidden rounded-xl border border-ink/70 bg-white text-ink shadow-[0_40px_70px_-40px_oklch(0.25_0.006_70/0.55)] outline-none transition-[opacity,transform] duration-200 ease-[var(--ease-out)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 motion-safe:data-[starting-style]:-translate-y-1 motion-safe:data-[starting-style]:scale-[0.98] motion-safe:data-[ending-style]:scale-[0.98]"
                >
                  <div className="p-3">
                    <MenuPrimitive.LinkItem
                      closeOnClick
                      render={<Link href={FIX_PAGE.href} />}
                      aria-current={isCurrent(FIX_PAGE.href) ? "page" : undefined}
                      className="group/fix flex items-center justify-between gap-6 rounded-lg border-t-[4px] border-t-rx bg-rx-soft px-5 py-4 outline-none transition-colors duration-150 data-[highlighted]:bg-[oklch(0.94_0.035_55)]"
                    >
                      <span>
                        <span className="rx-label block text-rx">Sports cards &amp; TCG</span>
                        <span className="mt-1 block font-heading text-2xl tracking-[-0.01em] text-ink">{FIX_PAGE.label}</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          Restoration has real limits. Here&apos;s an honest breakdown.
                        </span>
                      </span>
                      <ArrowRight
                        className="h-5 w-5 shrink-0 text-rx transition-transform duration-200 group-data-[highlighted]/fix:translate-x-1"
                        strokeWidth={2}
                        aria-hidden
                      />
                    </MenuPrimitive.LinkItem>
                  </div>

                  <div className="grid grid-cols-3 gap-x-2 px-3 pb-3">
                    {EXPLORE_GROUPS.map((group) => (
                      <MenuPrimitive.Group key={group.label} className="flex flex-col">
                        <MenuPrimitive.GroupLabel className="rx-label px-3 pt-2 pb-1.5 text-muted-foreground">
                          {group.label}
                        </MenuPrimitive.GroupLabel>
                        {group.links.map((l) => {
                          const current = isCurrent(l.href);
                          return (
                            <MenuPrimitive.LinkItem
                              key={l.href}
                              closeOnClick
                              render={<Link href={l.href} />}
                              aria-current={current ? "page" : undefined}
                              className="flex flex-col rounded-md px-3 py-2 outline-none transition-colors duration-150 data-[highlighted]:bg-ink/[0.05]"
                            >
                              <span className={`text-[15px] font-semibold ${current ? "text-rx" : "text-ink"}`}>{l.label}</span>
                              {TAB_HINTS[l.href] && (
                                <span className="font-mono text-xs text-muted-foreground tabular-nums">{TAB_HINTS[l.href]}</span>
                              )}
                            </MenuPrimitive.LinkItem>
                          );
                        })}
                      </MenuPrimitive.Group>
                    ))}
                  </div>

                  <div className="flex items-center gap-5 border-t border-rule bg-paper px-6 py-3">
                    {LEGAL_LINKS.map((l) => (
                      <MenuPrimitive.LinkItem
                        key={l.href}
                        closeOnClick
                        render={<Link href={l.href} />}
                        aria-current={isCurrent(l.href) ? "page" : undefined}
                        className="rounded-sm text-xs font-medium text-muted-foreground outline-none transition-colors duration-150 data-[highlighted]:text-ink data-[highlighted]:underline"
                      >
                        {l.label}
                      </MenuPrimitive.LinkItem>
                    ))}
                  </div>
                </MenuPrimitive.Popup>
              </MenuPrimitive.Positioner>
            </MenuPrimitive.Portal>
          </MenuPrimitive.Root>
        </div>

        {/* Desktop right (Track Order and Gift Cards move into Explore below lg) */}
        <div className="hidden md:flex items-center gap-5 shrink-0">
          {SEC_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="draw-underline hidden lg:inline pb-0.5 text-sm font-medium text-muted-foreground hover:text-ink transition-colors duration-150"
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
            className="stage vt-menu md:hidden !fixed inset-0 z-[70] flex flex-col overflow-y-auto overscroll-contain bg-ink text-paper pt-[env(safe-area-inset-top)] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex h-16 shrink-0 items-center justify-between px-4">
              <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/card-doctor.jpg" alt="The Card Doc" className="w-8 h-8 rounded-md object-cover ring-1 ring-white/20" />
                <span className="font-heading text-lg font-extrabold tracking-[-0.01em]">The Card Doc</span>
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
                            <span className={`block font-heading text-[2.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] ${active ? "text-rx-bright" : "text-paper"}`}>
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
                transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.36 }}
                className="mt-8"
              >
                <p className="rx-label !text-paper/50 mb-2">Before You Order</p>
                <ul className="border-t border-white/15">
                  {LEARN_LINKS.map((l) => {
                    const current = isCurrent(l.href);
                    return (
                      <li key={l.href} className="border-b border-white/15">
                        <Link
                          href={l.href}
                          onClick={() => setOpen(false)}
                          aria-current={current ? "page" : undefined}
                          className="press flex h-14 items-center justify-between gap-4"
                        >
                          <span className={`font-heading text-[1.375rem] tracking-[-0.01em] ${current ? "text-rx-bright" : "text-paper"}`}>
                            {l.label}
                          </span>
                          <ArrowRight
                            className={`h-4 w-4 shrink-0 ${l === FIX_PAGE ? "text-rx-bright" : "text-paper/55"}`}
                            strokeWidth={2}
                            aria-hidden
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.44 }}
                className="mt-8 grid grid-cols-2 gap-2"
              >
                {[...ACCOUNT_LINKS, { href: "/cart", label: "Cart" }].map((l) => (
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
              <div className="mt-6 flex items-center gap-5">
                {LEGAL_LINKS.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-xs font-medium text-paper/55 hover:text-paper">
                    {l.label}
                  </Link>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body)}
    </header>
  );
}
