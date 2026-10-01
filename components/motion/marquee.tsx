/**
 * Continuous horizontal marquee (one per page). Items are rendered twice so
 * the loop is seamless; it pauses on hover/focus and becomes a plain
 * scrollable row under reduced motion.
 */
export function Marquee({ children, seconds = 70 }: { children: React.ReactNode; seconds?: number }) {
  return (
    <div className="marquee group relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
      <div className="marquee-track flex w-max gap-4" style={{ ["--marquee-duration" as string]: `${seconds}s` }}>
        <div className="flex shrink-0 gap-4">{children}</div>
        <div className="flex shrink-0 gap-4" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
