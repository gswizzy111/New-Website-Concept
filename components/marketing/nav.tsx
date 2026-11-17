"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronDown, CircleUserRound, Menu, ShoppingCart, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/use-reduced-motion";
import { useCart } from "@/lib/cart-context";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cta } from "@/components/brand/button-class";

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
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

// Every public page, grouped, for the Explore menu.
const EXPLORE_GROUPS = [
  { label: "Services", links: TABS },
  { label: "Before You Order", links: LEARN_LINKS.filter((l) => l !== FIX_PAGE) },
  { label: "Orders & Account", links: ACCOUNT_LINKS },
];

// One-line hints under each service in the mobile menu (owner's own copy).
const TAB_HINTS: Record<string, string> = {
  "/tier-selection": "From $75 / card",
  "/prep": "From $25 / card",
  "/shop": "US shipping at cost + $2 handling",
};

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The site header: the framed logo and wordmark, three service tabs and
 * Explore, cart and account, and the sun "Book a Restoration" pill, which
 * stays on phones as a compact "Book" pill beside the cart and menu.
 * `sprite` is accepted for older callers and no longer drawn.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Nav(_props: { sprite?: React.ReactNode } = {}) {
  const [open, setOpen] = useState(false);
  // Client-only flag for the portal (no setState-in-effect, no hydration mismatch).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [exploreOpen, setExploreOpen] = useState(false);
  const { itemCount } = useCart();
  const pathname = usePathname();
  const reduce = usePrefersReducedMotion();

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
  const pillOn = hovered ?? (exploreOpen ? "explore" : null);

  // A soft chalk pill that slides between the hovered tabs.
  const hoverPill = (key: string) =>
    pillOn === key && (
      <motion.span
        layoutId="nav-hover-pill"
        aria-hidden
        className="absolute inset-0 -z-10 rounded-full bg-chalk"
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40, mass: 0.6 }}
      />
    );

  const cartLink = (
    <Link
      href="/cart"
      aria-label="Cart"
      className="press relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors duration-150 hover:bg-chalk"
    >
      <ShoppingCart className="h-[22px] w-[22px]" strokeWidth={1.75} />
      {itemCount > 0 && (
        <span className="absolute top-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cobalt px-1 text-[11px] font-extrabold leading-none text-white tabular-nums shadow-[0_0_0_2px_var(--white)]">
          {itemCount}
        </span>
      )}
    </Link>
  );

  return (
    <header className="relative border-b border-line bg-white/[0.94] backdrop-blur-md backdrop-saturate-150">
      <nav aria-label="Main" className="wrap flex h-16 items-center gap-2 md:h-[74px] lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
        <Link href="/" aria-label="The Card Doc, home" className="mr-auto flex min-h-11 shrink-0 items-center rounded-xl justify-self-start lg:mr-0">
          <BrandLogo size={40} priority className="gap-2.5 md:hidden" wordmarkClassName="text-[22px]" />
          <BrandLogo size={46} priority className="hidden md:inline-flex" />
        </Link>

        {/* Desktop: three service tabs and Explore */}
        <div className="hidden items-center gap-0.5 lg:flex" onMouseLeave={() => setHovered(null)}>
          {TABS.map((tab) => {
            const active = isTabActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => setHovered(tab.href)}
                onFocus={() => setHovered(tab.href)}
                onBlur={() => setHovered(null)}
                className={`relative isolate inline-flex h-11 items-center rounded-full px-4 text-[15px] transition-colors duration-150 ${
                  active ? "font-bold text-ink" : "font-semibold text-ink/80 hover:text-ink"
                }`}
              >
                {hoverPill(tab.href)}
                {tab.label}
                {active && <span aria-hidden className="absolute inset-x-4 bottom-1.5 h-[3px] rounded-full bg-sun" />}
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
              className={`group relative isolate inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] outline-none transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt ${
                exploreActive || exploreOpen ? "font-bold text-ink" : "font-semibold text-ink/80 hover:text-ink"
              }`}
            >
              {hoverPill("explore")}
              Explore
              <ChevronDown
                className="h-4 w-4 transition-transform duration-200 group-data-[popup-open]:rotate-180"
                strokeWidth={2}
                aria-hidden
              />
              {exploreActive && <span aria-hidden className="absolute inset-x-4 bottom-1.5 h-[3px] rounded-full bg-sun" />}
            </MenuPrimitive.Trigger>
            <MenuPrimitive.Portal>
              <MenuPrimitive.Positioner side="bottom" align="center" sideOffset={12} collisionPadding={16} className="z-[60] outline-none">
                <MenuPrimitive.Popup
                  className="w-[min(46rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-hidden rounded-[22px] bg-white text-ink shadow-[0_0_0_1px_var(--line),var(--pop-shadow)] outline-none transition-[opacity,transform] duration-200 ease-[cubic-bezier(.16,1,.3,1)] data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-120"
                >
                  <div className="p-3">
                    <MenuPrimitive.LinkItem
                      closeOnClick
                      render={<Link href={FIX_PAGE.href} />}
                      aria-current={isCurrent(FIX_PAGE.href) ? "page" : undefined}
                      className="group/fix flex items-center justify-between gap-6 rounded-[16px] bg-sun-tint px-5 py-4 outline-none transition-colors duration-150 data-[highlighted]:bg-sun"
                    >
                      <span>
                        <span className="label-caps block text-[15px] text-cobalt-deep">Sports cards &amp; TCG</span>
                        <span className="mt-1.5 block font-heading text-[30px] leading-none font-black">
                          {FIX_PAGE.label}
                        </span>
                        <span className="mt-1.5 block text-sm text-ink-soft group-data-[highlighted]/fix:text-ink">
                          Restoration has real limits. Here&apos;s an honest breakdown.
                        </span>
                      </span>
                      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white transition-transform duration-200 group-data-[highlighted]/fix:translate-x-1">
                        <ArrowRight className="h-5 w-5" strokeWidth={1.75} />
                      </span>
                    </MenuPrimitive.LinkItem>
                  </div>

                  <div className="grid grid-cols-3 gap-x-2 px-3 pb-3">
                    {EXPLORE_GROUPS.map((group) => (
                      <MenuPrimitive.Group key={group.label} className="flex flex-col">
                        <MenuPrimitive.GroupLabel className="label-caps px-3 pt-2 pb-2 text-[14px] text-ink-soft">
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
                              className="flex min-h-11 flex-col justify-center rounded-[12px] px-3 py-2 outline-none transition-colors duration-150 data-[highlighted]:bg-chalk"
                            >
                              <span className={`text-[15px] font-bold ${current ? "text-cobalt" : "text-ink"}`}>{l.label}</span>
                              {TAB_HINTS[l.href] && (
                                <span className="text-[13px] text-ink-soft tabular-nums">{TAB_HINTS[l.href]}</span>
                              )}
                            </MenuPrimitive.LinkItem>
                          );
                        })}
                      </MenuPrimitive.Group>
                    ))}
                  </div>

                  <div className="flex items-center gap-6 border-t border-line bg-chalk px-6 py-2">
                    {LEGAL_LINKS.map((l) => (
                      <MenuPrimitive.LinkItem
                        key={l.href}
                        closeOnClick
                        render={<Link href={l.href} />}
                        aria-current={isCurrent(l.href) ? "page" : undefined}
                        className="inline-flex min-h-10 items-center text-[13px] font-semibold text-ink-soft outline-none transition-colors duration-150 data-[highlighted]:text-ink data-[highlighted]:underline"
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

        <div className="flex shrink-0 items-center gap-1 justify-self-end">
          <Link
            href="/restoration"
            aria-label="Book a Restoration"
            className={cta({ size: "sm", className: "order-first mr-1 min-h-11 px-4 text-[14px] sm:hidden" })}
          >
            Book
          </Link>
          {cartLink}
          <Link
            href="/account"
            aria-label="My Account"
            title="My Account"
            className="press hidden h-11 w-11 items-center justify-center rounded-full text-ink transition-colors duration-150 hover:bg-chalk lg:inline-flex"
          >
            <CircleUserRound className="h-[22px] w-[22px]" strokeWidth={1.75} />
          </Link>
          <Link href="/restoration" className={cta({ size: "sm", className: "ml-2 hidden sm:inline-flex" })}>
            Book a Restoration
          </Link>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="press ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white transition-colors duration-150 hover:bg-ink-2 lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" strokeWidth={2} /> : <Menu className="h-5 w-5" strokeWidth={2} />}
          </button>
        </div>
      </nav>

      {/* Phone menu: a full-screen ink sheet, portaled to <body> so its fixed
          positioning is never trapped. */}
      {mounted && createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE }}
            className="surface-ink vt-menu !fixed inset-0 z-[70] flex flex-col overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)] pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:hidden"
          >
            <div className="wrap flex h-16 shrink-0 items-center justify-between border-b border-line-dark md:h-[74px]">
              <Link href="/" onClick={() => setOpen(false)} aria-label="The Card Doc, home" className="rounded-xl">
                <BrandLogo size={40} surface="dark" className="gap-2.5" wordmarkClassName="text-[22px] md:text-[26px]" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="press inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <nav aria-label="Menu" className="wrap mt-7 flex-1">
              <p className="eyebrow mb-3 text-sun">Services</p>
              <ul className="flex flex-col border-t border-line-dark">
                {TABS.map((tab, i) => {
                  const active = isTabActive(tab);
                  return (
                    <motion.li
                      key={tab.href}
                      initial={reduce ? false : { opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: EASE, delay: 0.05 + i * 0.05 }}
                      className="border-b border-line-dark"
                    >
                      <Link
                        href={tab.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className="group flex items-center justify-between gap-4 py-3.5"
                      >
                        <span>
                          <span className={`block font-heading text-[44px] leading-[0.9] font-black ${active ? "text-sun" : "text-white"}`}>
                            {tab.label}
                          </span>
                          <span className="mt-1.5 block text-sm font-semibold text-on-dark-muted">{TAB_HINTS[tab.href]}</span>
                        </span>
                        <ArrowRight aria-hidden className="h-6 w-6 shrink-0 text-sun transition-transform duration-200 group-active:translate-x-1" strokeWidth={1.75} />
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE, delay: 0.2 }}
                className="mt-9"
              >
                <p className="eyebrow mb-2 text-sun">Before You Order</p>
                <ul className="grid grid-cols-2 gap-x-4">
                  {LEARN_LINKS.map((l) => {
                    const current = isCurrent(l.href);
                    return (
                      <li key={l.href}>
                        <Link
                          href={l.href}
                          onClick={() => setOpen(false)}
                          aria-current={current ? "page" : undefined}
                          className={`flex min-h-12 items-center text-lg font-bold ${current ? "text-sun" : "text-white"}`}
                        >
                          {l.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE, delay: 0.26 }}
                className="mt-8 grid grid-cols-2 gap-3"
              >
                {[...ACCOUNT_LINKS, { href: "/cart", label: "Cart" }].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cta({ tone: "outline-light", size: "sm", className: "justify-between px-5" })}
                  >
                    {l.label}
                    {l.href === "/cart" && itemCount > 0 && (
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-sun px-1.5 text-xs font-extrabold text-ink tabular-nums">{itemCount}</span>
                    )}
                  </Link>
                ))}
                <Link href="/restoration" onClick={() => setOpen(false)} className={cta({ size: "lg", className: "col-span-2 mt-2" })}>
                  Book a Restoration
                  <ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden />
                </Link>
              </motion.div>
            </nav>

            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.34 }}
              className="wrap mt-10 text-sm"
            >
              <p className="eyebrow mb-2 text-sun">Contact</p>
              <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-base font-bold text-white underline decoration-sun decoration-2 underline-offset-4">
                DM us on @the_card_doc
              </a>
              <p className="text-on-dark-muted">We reply within 1 business day.</p>
              <div className="mt-4 flex items-center gap-6">
                {LEGAL_LINKS.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-on-dark-muted hover:text-white">
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
