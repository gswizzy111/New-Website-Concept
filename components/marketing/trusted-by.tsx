import { ArrowUpRight } from "lucide-react";
import { VelocityMarquee } from "@/components/motion/velocity-marquee";
import { TRUSTED_BY, type TrustedPage } from "@/lib/trusted-by";

// Each copy of the marquee row repeats the list until it holds at least this
// many names, so even a short list is wider than the screen and loops without
// a gap.
const MIN_PER_COPY = 4;

function Entry({ page, decorative }: { page: TrustedPage; decorative: boolean }) {
  return (
    <li className={`shrink-0 flex items-center ${decorative ? "marquee-repeat" : ""}`} aria-hidden={decorative || undefined}>
      <a
        href={page.href}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={decorative ? -1 : undefined}
        className="group flex items-center gap-5 md:gap-8 px-8 md:px-14 py-4"
      >
        <span className="whitespace-nowrap font-heading text-5xl md:text-7xl lg:text-[5.5rem] leading-[0.9] tracking-[-0.025em] text-ink transition-colors duration-300 ease-[var(--ease-out)] group-hover:text-rx">
          {page.name}
        </span>
        <span className="flex flex-col gap-1.5 whitespace-nowrap text-[13px] md:text-sm leading-tight">
          {page.role && <span className="text-muted-foreground">{page.role}</span>}
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className="font-semibold text-ink">{page.handle}</span>
            {page.followers && <span className="text-muted-foreground">· {page.followers} followers</span>}
            <ArrowUpRight
              aria-hidden
              strokeWidth={1.75}
              className="h-4 w-4 text-muted-foreground transition-transform duration-300 ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-rx"
            />
          </span>
        </span>
      </a>
      <span aria-hidden className="h-14 md:h-20 w-px bg-rule" />
    </li>
  );
}

/**
 * "Trusted by": people The Card Doc has restored cards for, as a slow marquee
 * of poster-size names (role, handle and followers beside each, linking to
 * their page) that surges with scroll speed and pauses under a mouse. Static,
 * one of each, wrapping under reduced motion. Renders nothing until
 * lib/trusted-by.ts has entries.
 */
export function TrustedBy() {
  if (TRUSTED_BY.length === 0) return null;
  const reps = Math.ceil(MIN_PER_COPY / TRUSTED_BY.length);
  const row = Array.from({ length: reps }, (_, r) => TRUSTED_BY.map((page) => ({ page, decorative: r > 0 }))).flat();

  return (
    <section aria-labelledby="trusted-by" className="border-b border-rule bg-paper py-12 md:py-16">
      <p id="trusted-by" data-reveal className="rx-label text-center mb-6 md:mb-8">
        Trusted by
      </p>
      <div className="marquee-mask overflow-hidden">
        <VelocityMarquee>
          <ul className="flex">
            {row.map(({ page, decorative }, i) => <Entry key={i} page={page} decorative={decorative} />)}
          </ul>
          <ul aria-hidden className="marquee-dupe flex">
            {row.map(({ page }, i) => <Entry key={i} page={page} decorative />)}
          </ul>
        </VelocityMarquee>
      </div>
    </section>
  );
}
