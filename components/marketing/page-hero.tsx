import { SplitReveal } from "@/components/motion/split-reveal";

export function PageHero({
  eyebrow,
  title,
  lines,
  lead,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  lines?: string[];
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && (
        <p className="hero-in mb-5 flex items-center gap-3 font-heading text-xs font-extrabold uppercase tracking-[0.14em] text-rx md:text-[13px]">
          <span aria-hidden className="h-[3px] w-8 rounded-full bg-rx" />
          {eyebrow}
        </p>
      )}
      <h1 className="max-w-5xl font-heading font-black uppercase leading-[0.9] tracking-[-0.025em] text-ink text-[clamp(2.5rem,10.5vw,3.75rem)] md:text-6xl lg:text-[5.25rem]">
        <SplitReveal text={title} lines={lines} step={70} />
      </h1>
      {lead && (
        <p className="hero-in mt-6 max-w-2xl text-lg font-medium leading-relaxed text-ink/75 md:mt-7 md:text-xl" style={{ ["--d" as string]: 280 }}>
          {lead}
        </p>
      )}
    </div>
  );
}
