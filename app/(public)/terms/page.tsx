import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/marketing/page-hero";
import { LinkedText } from "@/components/legal/linked-text";
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_UPDATED } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: "Terms of Service | The Card Doc",
  description: "The terms that apply to restoration, prep and shop orders with The Card Doc LLC.",
};

const LINK = "font-semibold text-rx underline underline-offset-2 hover:opacity-80";

export default function TermsPage() {
  return (
    <div className="min-h-screen page-glow">
      <div className="max-w-5xl mx-auto px-4 md:px-10 pt-12 md:pt-20 pb-20">
        <PageHero eyebrow="Legal" title="Terms of Service" lead={`Last updated ${TERMS_UPDATED}.`} className="mb-12 md:mb-16" />

        <div className="grid gap-10 lg:grid-cols-[15rem_1fr] lg:gap-14">
          {/* Contents */}
          <nav aria-label="Sections" className="lg:sticky lg:top-28 lg:self-start">
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground mb-3">Contents</p>
            <ol className="flex flex-col gap-1.5 border-l border-rule pl-4 text-sm">
              {TERMS_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-muted-foreground hover:text-ink transition-colors">{s.title}</a>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-muted-foreground">
              Signed at checkout when they apply:
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              <li><Link href="/agreements/slab-removal" className={LINK}>Slab-Removal Authorization</Link></li>
              <li><Link href="/agreements/high-value" className={LINK}>High-Value Card Agreement</Link></li>
            </ul>
          </nav>

          <article className="max-w-[68ch]">
            <div className="flex flex-col gap-4 text-[15px] md:text-base text-ink leading-relaxed">
              {TERMS_INTRO.map((p) => <p key={p}>{p}</p>)}
            </div>
            {TERMS_SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-28 mt-12 border-t border-ink/70 pt-6">
                <h2 className="font-heading text-2xl md:text-3xl font-extrabold tracking-[-0.01em] text-ink mb-4">{s.title}</h2>
                <div className="flex flex-col gap-4 text-[15px] md:text-base text-muted-foreground leading-relaxed">
                  {s.blocks.map((b, i) =>
                    typeof b === "string" ? (
                      <p key={i}><LinkedText text={b} linkClassName={LINK} /></p>
                    ) : (
                      <ul key={i} className="flex flex-col gap-2.5">
                        {b.list.map((item) => (
                          <li key={item} className="flex items-start gap-3">
                            <span className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-rx" aria-hidden />
                            <span><LinkedText text={item} linkClassName={LINK} /></span>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              </section>
            ))}
            <p className="mt-14 text-xs text-muted-foreground">© {new Date().getFullYear()} The Card Doc LLC</p>
          </article>
        </div>
      </div>
    </div>
  );
}
