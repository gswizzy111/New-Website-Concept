import { SplitReveal } from "@/components/motion/split-reveal";

/**
 * The opening of every marketing page: optional rx-label, an oversized
 * narrowed headline whose words rise out of their clips, and the lead line.
 * Copy is passed through untouched.
 */
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
      {eyebrow && <p className="hero-in rx-label text-rx mb-5">{eyebrow}</p>}
      <h1 className="font-heading font-extrabold text-ink tracking-[-0.042em] leading-[0.9] text-[2.9rem] sm:text-6xl md:text-7xl lg:text-[5.75rem] max-w-5xl [font-variation-settings:'wdth'_78]">
        <SplitReveal text={title} lines={lines} step={70} />
      </h1>
      {lead && (
        <p className="hero-in mt-6 md:mt-7 text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed" style={{ ["--d" as string]: 280 }}>
          {lead}
        </p>
      )}
    </div>
  );
}
