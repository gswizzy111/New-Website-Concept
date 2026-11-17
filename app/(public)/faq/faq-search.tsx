"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import type { FaqSection } from "./faq-data";

const INSTAGRAM = "https://www.instagram.com/the_card_doc";

// "Pokemon" finds "Pokémon"; case and accents don't matter
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const LINK = "font-bold text-cobalt underline decoration-2 underline-offset-4 hover:text-ink";

/** The text with @the_card_doc linked and each search word highlighted. */
function Rich({ text, words }: { text: string; words: string[] }) {
  const parts = text.split(/(@the_card_doc)/);
  return (
    <>
      {parts.map((part, i) =>
        part === "@the_card_doc" ? (
          <a key={i} href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className={LINK}>
            @the_card_doc
          </a>
        ) : (
          <Highlight key={i} text={part} words={words} />
        )
      )}
    </>
  );
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const folded = fold(text);
  const marks: [number, number][] = [];
  for (const w of words) {
    let at = folded.indexOf(w);
    while (at !== -1) {
      marks.push([at, at + w.length]);
      at = folded.indexOf(w, at + w.length);
    }
  }
  if (!marks.length) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const [start, end] of marks) {
    if (start < pos) continue;
    if (start > pos) out.push(text.slice(pos, start));
    out.push(<mark key={start} className="rounded-[3px] bg-sun px-0.5 text-ink">{text.slice(start, end)}</mark>);
    pos = end;
  }
  out.push(text.slice(pos));
  return <>{out}</>;
}

/** `aside` shows under the hero on phones; `asideWide` (the same card, its own ids) under the topics on wide screens. */
export function FaqSearch({
  sections,
  aside,
  asideWide,
}: {
  sections: FaqSection[];
  aside?: React.ReactNode;
  asideWide?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const words = useMemo(() => fold(query).split(/\s+/).filter((w) => w.length > 1), [query]);
  const searching = words.length > 0;

  // A question matches when every word appears in it or in its answer
  const results = useMemo(() => {
    if (!searching) return sections;
    return sections
      .map((s) => ({ ...s, items: s.items.filter((it) => words.every((w) => fold(`${it.q} ${it.a}`).includes(w))) }))
      .filter((s) => s.items.length > 0);
  }, [sections, words, searching]);
  const count = results.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="grid gap-x-14 gap-y-8 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]">
      {/* Phone: the Free Photo Review card right under the hero */}
      {aside && <div className="max-lg:order-first lg:hidden">{aside}</div>}

      {/* Topics, or the result count while searching; on wide screens a sticky column
          that starts level with the search box, the Free Photo Review card under it */}
      <div className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+28px)] lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start">
        <div aria-live="polite">
          {searching ? (
            <p className="inline-flex min-h-11 items-center text-[15px] font-bold text-ink-soft">
              {count === 0 ? "No questions match" : `${count} question${count === 1 ? "" : "s"} match`} &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            <nav aria-label="FAQ topics">
              <ul className="-mx-[var(--gut)] flex gap-2 overflow-x-auto px-[var(--gut)] pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
                {sections.map((s) => (
                  <li key={s.id} className="shrink-0 lg:border-t lg:border-line lg:last:border-b">
                    <a
                      href={`#${s.id}`}
                      className="group flex min-h-11 items-center justify-between gap-4 rounded-full bg-white px-4 text-[15px] font-bold whitespace-nowrap text-ink shadow-[0_0_0_1px_var(--line)] transition-colors duration-150 hover:text-cobalt lg:min-h-13 lg:rounded-none lg:bg-transparent lg:px-0 lg:shadow-none"
                    >
                      {s.title}
                      <span className="hidden font-display text-[17px] font-extrabold tabular-nums text-ink-soft transition-colors group-hover:text-cobalt lg:inline">
                        {String(s.items.length).padStart(2, "0")}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
        {asideWide && <div className="mt-8 hidden lg:block">{asideWide}</div>}
      </div>

      {/* Search, aligned with the answers */}
      <div className="min-w-0 max-lg:order-first lg:col-start-2 lg:row-start-1">
      <div className="relative">
          <label htmlFor={inputId} className="sr-only">Search the FAQ</label>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-5 size-5 md:left-6 -translate-y-1/2 text-ink-soft" strokeWidth={2} />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions, e.g. slab, PSA, drop-off"
            autoComplete="off"
            className={`h-16 w-full rounded-full border-0 bg-white pl-12 text-[16px] text-ink md:pl-14 md:text-[17px] ${query ? "pr-16" : "pr-5"} shadow-[0_0_0_1.5px_var(--line-strong),var(--panel-shadow)] outline-none transition-shadow duration-200 placeholder:text-ink-soft hover:shadow-[0_0_0_1.5px_var(--ink-soft),var(--panel-shadow)] focus-visible:shadow-[0_0_0_2px_var(--cobalt),0_0_0_6px_var(--cobalt-wash)] [&::-webkit-search-cancel-button]:hidden`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 grid size-11 -translate-y-1/2 place-items-center rounded-full text-ink transition-colors duration-150 hover:bg-sun focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-cobalt"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          )}
      </div>

      </div>

      <div className="min-w-0 lg:col-start-2 lg:row-start-2">
      {count === 0 ? (
        <div className="panel min-w-0 p-7 md:p-10">
          <p className="display-sm text-ink">Nothing here yet.</p>
          <p className="mt-3 text-[16px] text-ink-soft">
            Ask us directly: DM{" "}
            <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className={LINK}>@the_card_doc</a>{" "}
            on Instagram.
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-12 md:gap-16">
          {results.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`} className="scroll-mt-[calc(var(--header-h)+24px)]">
              <div className="mb-4 flex items-end justify-between gap-3 md:mb-5">
                <h2 id={`${section.id}-h`} className="caps font-display text-[32px] font-black leading-[0.95] text-ink md:text-[44px]">
                  {section.title}
                </h2>
                <span aria-hidden className="shrink-0 font-display text-[18px] font-extrabold tabular-nums text-cobalt">
                  {String(section.items.length).padStart(2, "0")}
                </span>
              </div>
              {/* While searching every match is open, so the answer is right there */}
              <Accordion
                key={searching ? `s-${query}` : "all"}
                multiple
                defaultValue={searching ? section.items.map((it) => it.q) : []}
                className="gap-2.5"
              >
                {section.items.map((item) => (
                  <AccordionItem
                    key={item.q}
                    value={item.q}
                    className="rounded-[18px] bg-white shadow-[0_0_0_1px_var(--line)] transition-shadow duration-200 not-last:border-b-0 data-open:shadow-[0_0_0_1.5px_var(--ink),var(--panel-shadow)]"
                  >
                    <AccordionTrigger className="min-h-16 items-center gap-4 font-sans tracking-normal rounded-[18px] border-0 px-5 py-4 text-[17px] leading-snug font-bold text-ink hover:no-underline hover:text-ink md:px-6 md:text-[18px] **:data-[slot=accordion-trigger-icon]:hidden">
                      <span className="flex-1"><Highlight text={item.q} words={words} /></span>
                      <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-full bg-chalk text-ink transition-[background-color,transform] duration-300 ease-[var(--ease-out)] group-hover/accordion-trigger:bg-cobalt-wash group-aria-expanded/accordion-trigger:rotate-45 group-aria-expanded/accordion-trigger:bg-sun motion-reduce:transition-none"
                      >
                        <Plus className="size-4" strokeWidth={2.5} />
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-5 pb-6 md:px-6">
                      <p className="max-w-[65ch] text-[16px] leading-relaxed text-ink-soft md:text-[17px]">
                        <Rich text={item.a} words={words} />
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
