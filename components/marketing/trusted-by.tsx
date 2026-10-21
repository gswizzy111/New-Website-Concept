import { ArrowUpRight } from "lucide-react";
import { VelocityMarquee } from "@/components/motion/velocity-marquee";
import { TRUSTED_BY, type TrustedPage } from "@/lib/trusted-by";

// Below this many people a marquee would loop the same few names with gaps,
// so they sit still in a row instead.
const MARQUEE_MIN = 4;

function Entry({ page, hidden = false }: { page: TrustedPage; hidden?: boolean }) {
  return (
    <li className="shrink-0">
      <a
        href={page.href}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={hidden ? -1 : undefined}
        className="group flex items-baseline gap-3 px-6 md:px-10 py-2"
      >
        <span className="font-heading text-2xl md:text-4xl font-extrabold tracking-[-0.015em] text-ink transition-colors duration-200 group-hover:text-rx">
          {page.name}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {page.handle}
          {page.followers && <> · {page.followers}</>}
        </span>
        <ArrowUpRight
          aria-hidden
          strokeWidth={1.75}
          className="h-4 w-4 self-center text-muted-foreground transition-transform duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-rx"
        />
      </a>
    </li>
  );
}

function RosterEntry({ page, index }: { page: TrustedPage; index: number }) {
  return (
    <li
      style={{ ["--i" as string]: index }}
      className={`border-b border-rule ${index % 2 === 1 ? "sm:border-l" : ""}`}
    >
      <a
        href={page.href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex h-full flex-col gap-2.5 py-7 sm:px-8 md:py-9 transition-colors duration-300 hover:bg-white/80"
      >
        <span className="flex items-start justify-between gap-4">
          <span className="font-heading text-[2.25rem] md:text-5xl font-extrabold leading-[0.95] tracking-[-0.02em] text-ink transition-colors duration-200 group-hover:text-rx">
            {page.name}
          </span>
          <ArrowUpRight
            aria-hidden
            strokeWidth={1.75}
            className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-[transform,color] duration-300 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-rx"
          />
        </span>
        {page.role && <span className="text-[15px] leading-snug text-muted-foreground">{page.role}</span>}
        <span className="text-[13px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-ink">{page.handle}</span>
          {page.followers && <> · {page.followers} followers on {page.platform}</>}
        </span>
      </a>
    </li>
  );
}

/**
 * "Trusted by": people The Card Doc has restored cards for, each linking to
 * their page. A few names sit still as rows of the label (ink rule, hairlines);
 * from MARQUEE_MIN up they become a slow marquee that surges with scroll speed
 * (static and wrapping under reduced motion). Renders nothing until
 * lib/trusted-by.ts has entries.
 */
export function TrustedBy() {
  if (TRUSTED_BY.length === 0) return null;

  if (TRUSTED_BY.length < MARQUEE_MIN) {
    return (
      <section aria-labelledby="trusted-by" className="border-b border-rule bg-paper">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-12 md:py-16">
          <p id="trusted-by" data-reveal className="rx-label text-center mb-7 md:mb-9">
            Trusted by
          </p>
          <ul data-reveal="stagger" className="grid grid-cols-1 sm:grid-cols-2 border-t border-ink/80">
            {TRUSTED_BY.map((p, i) => <RosterEntry key={p.handle} page={p} index={i} />)}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="trusted-by" className="border-b border-rule bg-paper py-10 md:py-14">
      <p id="trusted-by" data-reveal className="rx-label text-center mb-6 md:mb-8">
        Trusted by
      </p>
      <div className="marquee-mask overflow-hidden">
        <VelocityMarquee>
          <ul className="flex">
            {TRUSTED_BY.map((p) => <Entry key={p.handle} page={p} />)}
          </ul>
          <ul aria-hidden className="marquee-dupe flex">
            {TRUSTED_BY.map((p) => <Entry key={p.handle} page={p} hidden />)}
          </ul>
        </VelocityMarquee>
      </div>
    </section>
  );
}
