import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CurrentYear } from "@/components/marketing/current-year";
import { BrandLogo } from "@/components/brand/brand-logo";

const LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/affiliates", label: "Creator Portal" },
];

/**
 * The ink footer: the framed mark and line, the contact line, the legal
 * links, and an oversized wordmark sign-off that rises in and lights sun
 * under a mouse pointer. `sprite` is accepted for older callers and no
 * longer drawn.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Footer(_props: { sprite?: React.ReactNode } = {}) {
  return (
    <footer className="surface-ink relative mt-auto overflow-hidden">
      <div className="wrap pt-16 pb-8 md:pt-24">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1.2fr_1fr] md:gap-16">
          <div className="flex flex-col gap-6">
            <Link href="/" aria-label="The Card Doc, home" className="self-start rounded-xl">
              <BrandLogo size={56} surface="dark" wordmarkClassName="text-[30px] md:text-[36px]" />
            </Link>
            <p className="max-w-md text-[17px] leading-relaxed text-on-dark-muted">
              Expert PSA prep and card restoration. Every card treated like it&apos;s worth a fortune.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:items-start">
            <p className="eyebrow text-sun">Contact</p>
            <a
              href="https://www.instagram.com/the_card_doc"
              target="_blank"
              rel="noopener noreferrer"
              className="group self-start rounded-md font-heading text-[34px] leading-[0.95] font-black text-white transition-colors duration-200 hover:text-sun md:text-[44px] lg:whitespace-nowrap"
            >
              <span className="draw-underline pb-1">DM us on @the_card_doc</span>
              <ArrowUpRight
                aria-hidden
                className="ml-2 inline-block h-7 w-7 align-[-0.05em] text-sun transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] group-hover:translate-x-1 group-hover:-translate-y-1 md:h-9 md:w-9"
                strokeWidth={1.75}
              />
            </a>
            <p className="text-[15px] text-on-dark-muted">We reply within 1 business day.</p>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line-dark pt-5 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-0">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-on-dark-muted transition-colors duration-150 hover:text-white hover:underline hover:decoration-sun hover:underline-offset-4"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm text-on-dark-muted">
            &copy; <CurrentYear builtYear={new Date().getFullYear()} /> The Card Doc. All rights reserved.
          </p>
        </div>
      </div>

      {/* Sign-off: rises into place, lit sun under a mouse pointer */}
      <div aria-hidden className="overflow-hidden select-none">
        <div data-reveal="rise" className="mx-auto max-w-[100rem] px-2 md:px-4">
          <p className="wordmark wordmark-lit text-center font-display text-[17.6vw] leading-[0.78] font-black whitespace-nowrap uppercase tracking-[-0.01em] translate-y-[0.1em] 2xl:text-[17.5rem]">
            The Card Doc
          </p>
        </div>
      </div>
    </footer>
  );
}
