import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { cta } from "@/components/brand";
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
    <div className="surface-chalk min-h-screen">
      <div className="wrap pt-14 pb-10 md:pt-24 md:pb-14">
        <PageHero
          eyebrow="Legal"
          title="Terms of Service"
          lead={`Version ${version} · Effective ${effectiveLabel}`}
          actions={
            <a href={`/terms/v${version}/pdf`} className={cta({ tone: "ink", size: "md" })}>
              <Download aria-hidden className="size-[18px]" strokeWidth={2} />
              Download PDF
            </a>
          }
        />
      </div>

      <div className="wrap pb-24 md:pb-32">
        {notice && (
          <div className="surface-sun mb-8 rounded-[18px] p-5 text-[15px] leading-relaxed text-ink md:mb-10 md:p-6 [&_a]:font-bold [&_a]:decoration-2 [&_a]:underline-offset-4">
            {notice}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <nav
            aria-label="Sections"
            className="lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:max-h-[calc(100vh-var(--header-h)-48px)] lg:self-start lg:overflow-y-auto lg:rounded-[22px] lg:bg-white lg:p-6 lg:shadow-[0_0_0_1px_var(--line)] lg:[scrollbar-width:thin]"
          >
            {/* On a phone the contents fold away so the Terms start right below */}
            <details className="group rounded-[18px] bg-white shadow-[0_0_0_1px_var(--line)] lg:hidden">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[15px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                <span>Contents ({headings.length} sections)</span>
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-chalk transition-[transform,background-color] duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:bg-sun motion-reduce:transition-none"
                >
                  <Plus className="size-4" strokeWidth={2.5} />
                </span>
              </summary>
              <div className="border-t border-line px-5 py-4">
                <SectionLinks headings={headings} otherVersions={otherVersions} />
              </div>
            </details>
            <div className="hidden lg:block">
              <SectionLinks headings={headings} otherVersions={otherVersions} />
            </div>
          </nav>

          {/* The Terms word for word, on a calm reading sheet */}
          <article className="min-w-0 rounded-[22px] bg-white px-5 py-8 text-ink shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] sm:px-8 md:px-12 md:py-14 lg:px-16">
            <div className="max-w-[68ch]">
              <LegalDocument blocks={blocks} />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

type Heading = Extract<DocBlock, { kind: "heading" }>;

function SectionLinks({ headings, otherVersions }: { headings: Heading[]; otherVersions: { version: string; label: string }[] }) {
  return (
    <>
      <p className="label-caps mb-3 hidden text-[16px] text-cobalt lg:block">Contents</p>
      <ol className="flex flex-col text-[14px]">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className="flex min-h-10 items-center rounded-[8px] py-1.5 leading-snug text-ink-soft transition-colors duration-150 hover:text-cobalt focus-visible:text-ink lg:-mx-2 lg:px-2 lg:hover:bg-cobalt-wash"
            >
              <span>{h.text}</span>
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-line pt-5 text-[14px] text-ink-soft">Signed separately when it applies:</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[14px]">
        <li>
          <Link href="/agreements/slab-removal" className="inline-flex min-h-10 items-center font-bold text-cobalt underline decoration-2 underline-offset-4 hover:text-ink">
            Slab Removal Authorization
          </Link>
        </li>
      </ul>
      {otherVersions.length > 0 && (
        <>
          <p className="mt-5 text-[14px] text-ink-soft">Other versions:</p>
          <ul className="mt-1 flex flex-col text-[14px]">
            {otherVersions.map((v) => (
              <li key={v.version}>
                <Link href={`/terms/v${v.version}`} className="inline-flex min-h-10 items-center text-ink-soft underline underline-offset-4 hover:text-ink">
                  {v.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
