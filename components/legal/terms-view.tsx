import Link from "next/link";
import { Download } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import type { DocBlock } from "@/lib/legal/legal-doc";
import { LegalDocument } from "./legal-document";

/**
 * One version of the Terms of Service: version and effective date up top, a
 * PDF download, contents, and the text exactly as published.
 */
export function TermsView({
  version,
  effectiveLabel,
  blocks,
  notice,
  otherVersions = [],
}: {
  version: string;
  effectiveLabel: string;
  blocks: DocBlock[];
  /** Shown above the text, e.g. on an earlier version's page. */
  notice?: React.ReactNode;
  otherVersions?: { version: string; label: string }[];
}) {
  const headings = blocks.filter((b): b is Extract<DocBlock, { kind: "heading" }> => b.kind === "heading");
  return (
    <div className="min-h-screen page-glow">
      <div className="max-w-5xl mx-auto px-4 md:px-10 pt-12 md:pt-20 pb-20">
        <PageHero eyebrow="Legal" title="Terms of Service" lead={`Version ${version} · Effective ${effectiveLabel}`} className="mb-8" />
        <a
          href={`/terms/v${version}/pdf`}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-foreground/70 text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors mb-12 md:mb-16"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} />
          Download PDF
        </a>

        {notice && <div className="mb-10 rounded-md border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950 leading-relaxed">{notice}</div>}

        <div className="grid gap-10 lg:grid-cols-[15rem_1fr] lg:gap-14">
          <nav aria-label="Sections" className="lg:sticky lg:top-28 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground mb-3">Contents</p>
            <ol className="flex flex-col gap-1.5 border-l border-border pl-4 text-sm">
              {headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-muted-foreground hover:text-foreground transition-colors">{h.text}</a>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-muted-foreground">Signed separately when they apply:</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              <li><Link href="/agreements/slab-removal" className="font-semibold text-primary underline underline-offset-2 hover:opacity-80">Slab Removal Authorization</Link></li>
              <li><Link href="/agreements/high-value" className="font-semibold text-primary underline underline-offset-2 hover:opacity-80">High-Value Agreement</Link></li>
            </ul>
            {otherVersions.length > 0 && (
              <>
                <p className="mt-6 text-sm text-muted-foreground">Other versions:</p>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {otherVersions.map((v) => (
                    <li key={v.version}>
                      <Link href={`/terms/v${v.version}`} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{v.label}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>

          <article className="max-w-[68ch] min-w-0 text-foreground">
            <LegalDocument blocks={blocks} />
          </article>
        </div>
      </div>
    </div>
  );
}
