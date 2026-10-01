import Link from "next/link";

export function Footer() {
  return (
    <footer className="stage stage-light mt-auto overflow-hidden border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 md:px-10 pt-16 md:pt-24 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-12">
          {/* Brand */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/card-doctor.jpg"
                alt="The Card Doc"
                className="w-10 h-10 rounded-md object-cover ring-1 ring-white/15"
              />
              <span className="font-heading font-extrabold text-2xl tracking-[-0.02em] text-stage-fg [font-variation-settings:'wdth'_86]">The Card Doc</span>
            </div>
            <p className="text-[15px] text-stage-muted leading-relaxed max-w-sm">
              Expert PSA prep and card restoration. Every card treated like it&apos;s worth a fortune.
            </p>
            <p className="font-mono text-xs text-stage-muted mt-auto pt-4">
              &copy; {new Date().getFullYear()} The Card Doc. All rights reserved.
            </p>
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-3.5">
            <p className="rx-label text-rx-bright">Contact</p>
            <a
              href="https://www.instagram.com/the_card_doc"
              target="_blank"
              rel="noopener noreferrer"
              className="draw-underline self-start font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-stage-fg hover:text-rx-bright transition-colors"
            >
              DM us on @the_card_doc
            </a>
            <a
              href="mailto:thecarddoc1@gmail.com"
              className="draw-underline self-start font-heading text-lg md:text-xl font-bold tracking-[-0.01em] text-stage-fg hover:text-rx-bright transition-colors break-all sm:break-normal"
            >
              Email us at thecarddoc1@gmail.com
            </a>
            <p className="text-sm text-stage-muted">We reply within 1 business day.</p>
          </div>
        </div>

        <div className="mt-14 pt-6 border-t border-white/12 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <p className="text-xs text-stage-muted">
            All cards are insured during transit. Results may vary by card condition.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="text-xs font-medium text-stage-muted hover:text-stage-fg transition-colors">
              Terms & Conditions
            </Link>
            <Link href="/privacy" className="text-xs font-medium text-stage-muted hover:text-stage-fg transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>

      {/* Wordmark: rises into place, and lights up green under a mouse pointer */}
      <div aria-hidden className="overflow-hidden select-none">
        <div data-reveal="rise" className="max-w-[100rem] mx-auto px-3 md:px-6">
          <p className="wordmark wordmark-lit font-heading font-extrabold whitespace-nowrap text-center text-[15.6vw] 2xl:text-[15rem] leading-[0.78] tracking-[-0.05em] translate-y-[0.1em] [font-variation-settings:'wdth'_74]">
            The Card Doc
          </p>
        </div>
      </div>
    </footer>
  );
}
