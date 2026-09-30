"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, ShoppingCart, X } from "lucide-react";
import { usePathname } from "next/navigation";
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

export function Nav() {
  const [open, setOpen] = useState(false);
  const { itemCount } = useCart();
  const pathname = usePathname();

  function isTabActive(tab: typeof TABS[number]) {
    return tab.match.some((m) => pathname.startsWith(m));
  }

  const cartLink = (
    <Link
      href="/cart"
      aria-label="Cart"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-secondary transition-colors"
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
    <header className="relative bg-paper/95 backdrop-blur-sm border-b border-rule">
      <nav className="max-w-7xl mx-auto px-4 md:px-10 h-16 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/card-doctor.jpg" alt="The Card Doc" className="w-8 h-8 rounded-md object-cover ring-1 ring-rule" />
          <span className="font-heading text-lg font-extrabold tracking-tight text-ink">The Card Doc</span>
        </Link>

        {/* Desktop — three service tabs */}
        <div className="hidden md:flex items-center gap-7 self-stretch">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isTabActive(tab) ? "page" : undefined}
              className={`relative flex items-center text-[15px] font-semibold transition-colors duration-150 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:transition-colors ${
                isTabActive(tab)
                  ? "text-ink after:bg-rx"
                  : "text-muted-foreground hover:text-ink after:bg-transparent"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* Desktop right */}
        <div className="hidden md:flex items-center gap-5 shrink-0">
          {SEC_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-muted-foreground hover:text-ink transition-colors duration-150"
            >
              {l.label}
            </Link>
          ))}
          {cartLink}
          <Link
            href="/account"
            className="inline-flex h-9 items-center rounded-md border border-rule px-3.5 text-sm font-semibold text-ink hover:border-ink/40 transition-colors duration-150"
          >
            My Account
          </Link>
        </div>

        {/* Mobile right */}
        <div className="flex items-center gap-1 md:hidden">
          {cartLink}
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-secondary"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden border-t border-rule bg-paper px-4 pt-3 pb-5">
          <div className="flex flex-col divide-y divide-rule">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setOpen(false)}
                aria-current={isTabActive(tab) ? "page" : undefined}
                className={`py-3.5 text-lg font-heading font-bold ${isTabActive(tab) ? "text-rx" : "text-ink"}`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="mt-2 border-t border-rule pt-4 flex flex-col gap-3">
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
          </div>
        </div>
      )}
    </header>
  );
}
