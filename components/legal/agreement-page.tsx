import Link from "next/link";
import { PageHero } from "@/components/marketing/page-hero";
import { AGREEMENTS_VERSION, type AgreementText } from "@/lib/agreements";

/** A checkout agreement's public page: the wording customers sign, as a template. */
export function AgreementPage({ agreement, when }: { agreement: AgreementText; when: string }) {
  return (
    <div className="min-h-screen page-glow">
      <div className="max-w-3xl mx-auto px-4 md:px-10 pt-12 md:pt-20 pb-20">
        <PageHero eyebrow="Legal" title={agreement.title} lead={when} className="mb-10 md:mb-14" />
        <div className="lit-border relative bg-white border border-ink/70 rounded-xl px-6 md:px-8 py-7 border-t-[6px] border-t-rx">
          <p className="text-[15px] md:text-base text-ink leading-relaxed">{agreement.intro}</p>
          <ol className="mt-5 flex flex-col gap-3.5">
            {agreement.points.map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-[15px] text-muted-foreground leading-relaxed">
                <span className="font-mono text-xs text-rx mt-1 w-5 shrink-0 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 pt-5 border-t border-rule font-mono text-xs text-muted-foreground">
            Signed at checkout with your typed name; the date is recorded when you place the order. Version {AGREEMENTS_VERSION}.
          </p>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          These sit alongside our <Link href="/terms" className="font-semibold text-rx hover:underline">Terms of Service</Link>.
        </p>
      </div>
    </div>
  );
}
