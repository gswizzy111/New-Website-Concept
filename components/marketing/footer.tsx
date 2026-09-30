import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-paper border-t border-rule mt-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-14 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-10">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/card-doctor.jpg"
                alt="The Card Doc"
                className="w-9 h-9 rounded-md object-cover ring-1 ring-rule"
              />
              <span className="font-heading font-extrabold text-xl text-ink">The Card Doc</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              Expert PSA prep and card restoration. Every card treated like it&apos;s worth a fortune.
            </p>
            <p className="font-mono text-xs text-muted-foreground mt-auto pt-4">
              &copy; {new Date().getFullYear()} The Card Doc. All rights reserved.
            </p>
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-3">
            <p className="rx-label">Contact</p>
            <a
              href="https://www.instagram.com/the_card_doc"
              target="_blank"
              rel="noopener noreferrer"
              className="draw-underline self-start text-sm font-medium text-ink hover:text-rx transition-colors"
            >
              DM us on @the_card_doc
            </a>
            <a
              href="mailto:thecarddoc1@gmail.com"
              className="draw-underline self-start text-sm font-medium text-ink hover:text-rx transition-colors"
            >
              Email us at thecarddoc1@gmail.com
            </a>
            <p className="text-sm text-muted-foreground">We reply within 1 business day.</p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-rule flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <p className="text-xs text-muted-foreground">
            All cards are insured during transit. Results may vary by card condition.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="text-xs font-medium text-muted-foreground hover:text-ink transition-colors">
              Terms & Conditions
            </Link>
            <Link href="/privacy" className="text-xs font-medium text-muted-foreground hover:text-ink transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
