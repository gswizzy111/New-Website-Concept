import { ArrowUpRight } from "lucide-react";
import { TRUSTED_BY, type TrustedPage } from "@/lib/trusted-by";

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
        <span className="font-heading text-2xl md:text-4xl font-extrabold tracking-[-0.03em] text-ink [font-variation-settings:'wdth'_82] transition-colors duration-200 group-hover:text-rx">
          {page.name}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {page.platform}
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

/**
 * "Trusted by": the pages The Card Doc has restored cards for, as a slow
 * marquee of handles linking to each page. Static and wrapping under
 * reduced motion. Renders nothing until lib/trusted-by.ts has entries.
 */
export function TrustedBy() {
  if (TRUSTED_BY.length === 0) return null;
  return (
    <section aria-labelledby="trusted-by" className="border-b border-rule bg-paper py-10 md:py-14">
      <p id="trusted-by" data-reveal className="rx-label text-center mb-6 md:mb-8">
        Trusted by
      </p>
      <div className="marquee-mask overflow-hidden">
        <div className="marquee-track flex w-max">
          <ul className="flex">
            {TRUSTED_BY.map((p) => <Entry key={p.href} page={p} />)}
          </ul>
          <ul aria-hidden className="marquee-dupe flex">
            {TRUSTED_BY.map((p) => <Entry key={p.href} page={p} hidden />)}
          </ul>
        </div>
      </div>
    </section>
  );
}
