import Link from "next/link";
import { PageHero } from "@/components/marketing/page-hero";
import type { AgreementDoc } from "@/lib/legal/agreements-v1";
import { LegalDocument } from "./legal-document";

/** A card-specific agreement's public page: the wording customers sign, as a template. */
export function AgreementPage({ doc, when, footnote }: { doc: AgreementDoc; when: string; footnote: string }) {
  return (
    <div className="min-h-screen page-glow">
      <div className="max-w-3xl mx-auto px-4 md:px-10 pt-12 md:pt-20 pb-20">
        <PageHero eyebrow="Legal" title={doc.title} lead={when} className="mb-10 md:mb-14" />
        <div className="lit-border relative bg-white border border-foreground/70 rounded-xl px-6 md:px-8 py-7 border-t-[6px] border-t-primary">
          <LegalDocument blocks={doc.blocks} />
          <p className="mt-6 pt-5 border-t border-border font-mono text-xs text-muted-foreground">{footnote}</p>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          This sits alongside our <Link href="/terms" className="font-semibold text-primary hover:underline">Terms of Service</Link>.
        </p>
      </div>
    </div>
  );
}
