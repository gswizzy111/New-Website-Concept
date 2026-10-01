/**
 * Masked headline reveal: each word rises out of its own clip once on load.
 * The text stays a single readable string for assistive tech.
 */
export function SplitReveal({ text, delay = 0 }: { text: string; delay?: number }) {
  const words = text.split(" ");
  return (
    <span className="inline-block">
      <span className="sr-only">{text}</span>
      {words.map((w, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom">
          <span className="split-word inline-block" style={{ ["--d" as string]: delay + i * 90 }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        </span>
      ))}
    </span>
  );
}
