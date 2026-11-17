import Link from "next/link";
import { PageHero } from "@/components/marketing/page-hero";
import type { AgreementDoc } from "@/lib/legal/agreements-v1";
import { LegalDocument } from "./legal-document";

/** A card-specific agreement's public page: the wording customers sign, as a template. */
export function AgreementPage({ doc, when, footnote }: { doc: AgreementDoc; when: string; footnote: string }) {
  return (
    <div className="surface-chalk min-h-screen">
      <div className="wrap pt-14 pb-10 md:pt-24 md:pb-14">
        <PageHero eyebrow="Legal" title={doc.title} lead={when} className="mx-auto max-w-4xl" />
      </div>
      <div className="wrap pb-24 md:pb-32">
        <article className="mx-auto max-w-4xl rounded-[22px] bg-white px-5 py-8 shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] sm:px-8 md:px-12 md:py-14 lg:px-16">
          <div className="max-w-[68ch]">
            <LegalDocument blocks={doc.blocks} />
          </div>
          <p className="mt-10 max-w-[68ch] rounded-[14px] bg-chalk p-5 text-[14px] leading-relaxed text-ink-soft">{footnote}</p>
        </article>
        <p className="mx-auto mt-8 max-w-4xl text-[15px] text-ink-soft">
          This sits alongside our{" "}
          <Link href="/terms" className="font-bold text-cobalt underline decoration-2 underline-offset-4 hover:text-ink">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
