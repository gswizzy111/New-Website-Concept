import type { DocBlock } from "@/lib/legal/legal-doc";
import { LinkedText } from "./linked-text";

/**
 * Renders a legal text (lib/legal/legal-doc.ts) without changing a word.
 * "page" is the full /terms layout: a calm reading column, section heads in
 * the display face, clause numbers in ink. "compact" fits a scroll box or an
 * agreement card at checkout.
 */
export function LegalDocument({
  blocks,
  variant = "page",
  linkClassName = "font-bold text-cobalt underline decoration-2 underline-offset-4 hover:text-ink",
}: {
  blocks: DocBlock[];
  variant?: "page" | "compact";
  linkClassName?: string;
}) {
  const page = variant === "page";
  return (
    <div
      className={
        page
          ? "flex flex-col gap-4 font-sans text-[16px] leading-[1.7] text-ink-soft md:text-[17px]"
          : "flex flex-col gap-2.5 text-[13px] leading-relaxed text-muted-foreground"
      }
    >
      {blocks.map((b, i) => {
        if (b.kind === "title") {
          return (
            <p
              key={i}
              className={
                page
                  ? "caps font-display text-[28px] font-black leading-[0.95] text-ink md:text-[36px] [text-wrap:balance]"
                  : "font-bold text-foreground"
              }
            >
              {b.text}
            </p>
          );
        }
        if (b.kind === "heading") {
          return page ? (
            <h2
              key={i}
              id={b.id}
              className="caps mt-10 scroll-mt-[calc(var(--header-h)+24px)] border-t border-line pt-8 font-display text-[24px] font-extrabold leading-[1.05] text-ink md:text-[28px] [text-wrap:balance]"
            >
              {b.text}
            </h2>
          ) : (
            <p key={i} className="mt-2 font-bold text-foreground">{b.text}</p>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className={page ? "flex flex-col gap-3" : "flex flex-col gap-1.5"}>
              {b.items.map((item, j) => (
                <li key={j} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={page ? "mt-[0.55em] h-[11px] w-2 shrink-0 rounded-[2px] bg-cobalt" : "mt-[0.6em] size-1.5 shrink-0 rounded-full bg-cobalt"}
                  />
                  <span><LinkedText text={item} linkClassName={linkClassName} /></span>
                </li>
              ))}
            </ul>
          );
        }
        const clause = b.clause ? `${b.clause}.` : null;
        return (
          <p key={i}>
            {clause ? (
              <>
                <span className="font-bold text-ink">{clause}</span>
                <LinkedText text={b.text.slice(clause.length)} linkClassName={linkClassName} />
              </>
            ) : (
              <LinkedText text={b.text} linkClassName={linkClassName} />
            )}
          </p>
        );
      })}
    </div>
  );
}
