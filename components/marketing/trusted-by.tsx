import { ArrowUpRight } from "lucide-react";
import { Marquee } from "@/components/brand";
import { TRUSTED_BY, type TrustedPage } from "@/lib/trusted-by";
import { cn } from "@/lib/utils";

/** One person on the belt: name, what they're known for, handle and followers, linking to their page. */
function Person({ page }: { page: TrustedPage }) {
  return (
    <a
      href={page.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3.5 rounded-full px-1 py-1 text-white focus-visible:outline-sun"
    >
      {/* The name, with the follower count right underneath it. */}
      <span className="flex flex-col">
        <span className="caps font-display text-[26px] font-extrabold leading-none tracking-[0.01em] transition-colors duration-200 group-hover:text-sun md:text-[34px]">
          {page.name}
        </span>
        {page.followers && (
          <span className="mt-1 text-[13px] leading-none text-on-dark-muted md:text-sm">
            <span className="font-display text-base font-black text-sun md:text-lg">{page.followers}</span> followers
          </span>
        )}
      </span>
      <span className="flex items-baseline gap-2 self-start pt-1.5 text-[13px] leading-none md:pt-2.5 md:text-sm">
        {page.role && <span className="text-on-dark-muted">{page.role}</span>}
        <span className="font-bold text-white/90">{page.handle}</span>
        <ArrowUpRight aria-hidden className="size-4 self-center text-sun" strokeWidth={1.75} />
      </span>
      <span className="sr-only">(opens {page.platform} in a new tab)</span>
    </a>
  );
}

/**
 * "Trusted by": the people The Card Doc has restored cards for, as an ink
 * belt sliding the opposite way to the symptoms ticker above it. Each name
 * links to their page. No photos or likeness. Renders nothing until
 * lib/trusted-by.ts has entries.
 */
export function TrustedBy({ className = "" }: { className?: string }) {
  if (TRUSTED_BY.length === 0) return null;

  return (
    <section aria-labelledby="trusted-by" className={cn("surface-ink relative", className)}>
      <div className="flex flex-col md:flex-row md:items-stretch">
        <h2
          id="trusted-by"
          className="caps relative z-[2] flex shrink-0 items-center gap-2 bg-sun px-[var(--gut)] py-2 font-display text-lg font-black leading-none tracking-[0.02em] text-ink md:px-7 md:text-[22px] md:shadow-[18px_0_24px_-6px_rgb(13_18_51/0.9)]"
        >
          Trusted by
        </h2>
        <Marquee
          reverse
          tone="dark"
          label="Trusted by"
          speed={40}
          className="min-w-0 flex-1 py-3 md:py-4"
          items={TRUSTED_BY.map((page) => <Person key={page.href} page={page} />)}
          separator={<span aria-hidden className="mx-7 block size-2 rotate-45 rounded-[2px] bg-sun md:mx-10" />}
        />
      </div>
    </section>
  );
}
