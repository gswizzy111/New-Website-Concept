/**
 * Masked headline reveal: each word rises out of its own clip once on load.
 * The text stays a single readable string for assistive tech.
 *
 * Pass `lines` to fix where the headline breaks (each entry renders as its
 * own line); otherwise the words wrap naturally.
 */
export function SplitReveal({
  text,
  lines,
  delay = 0,
  step = 90,
}: {
  text: string;
  lines?: string[];
  delay?: number;
  step?: number;
}) {
  const rows = lines ?? [text];
  let index = 0;
  return (
    <span className="inline-block">
      <span className="sr-only">{text}</span>
      {rows.map((row, r) => {
        const words = row.split(" ");
        return (
          <span key={r} aria-hidden className={lines ? "block" : "inline"}>
            {words.map((w, i) => {
              const d = delay + index++ * step;
              return (
                <span key={i}>
                  <span className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom">
                    <span className="split-word inline-block" style={{ ["--d" as string]: d }}>
                      {w}
                    </span>
                  </span>
                  {i < words.length - 1 ? " " : ""}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}
