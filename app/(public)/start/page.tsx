import Link from "next/link";
import type { Metadata } from "next";
import { getCardsRestoredStat } from "@/lib/site-stats";
import { TrustPills } from "@/components/marketing/trust-pills";
import { JsonLd } from "@/components/seo/json-ld";
import { INSTAGRAM_URL, breadcrumbs, canonical } from "@/lib/seo";
import { SERVICE_CARDS } from "@/lib/service-cards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What Are You Sending? | The Card Doc",
  description: "Expert card restoration & PSA prep — every card treated like it's worth a fortune.",
  alternates: canonical("/start"),
};

const STEPS = [
  "Choose Your Service, Tier, and Add-Ons",
  "Pack and Ship Your Cards",
  "Hands-On Work",
  "Return Shipping",
];

export default async function StartPage() {
  const cardsRestored = await getCardsRestoredStat();
  const [restoration, prep, kits] = SERVICE_CARDS;

  return (
    <div className="min-h-screen page-glow">
      <JsonLd data={breadcrumbs([{ name: "What Are You Sending?", path: "/start" }])} />
      <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-20 md:px-10 md:pt-20 md:pb-28">
        <h1 className="font-heading font-black uppercase leading-[0.88] tracking-[-0.03em] text-ink text-[clamp(2.75rem,11vw,6.5rem)]">
          What are you <span className="text-rx">sending?</span>
        </h1>
        <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink/70 md:text-base">
          Pick Restoration or Prep based on your card&apos;s current declared value (what it&apos;s worth right now, not its projected graded value).
        </p>

        <ul className="mt-10 grid gap-6 md:mt-12 md:grid-cols-2 md:gap-7">
          {[restoration, prep].map(({ href, name, line, price, action, Icon, band, dots }) => (
            <li key={href}>
              <Link href={href} className="comic-lift group grid h-full grid-cols-[5.5rem_1fr] overflow-hidden rounded-2xl comic-border comic-shadow bg-bone sm:grid-cols-[7.5rem_1fr]">
                <span className={`relative grid place-items-center border-r-[3px] border-ink ${band}`}>
                  <span aria-hidden className={`absolute inset-0 ${dots}`} />
                  <Icon className="relative h-10 w-10 transition-transform duration-500 ease-[var(--ease-out)] group-hover:-rotate-12 group-hover:scale-110 sm:h-14 sm:w-14" strokeWidth={1.5} />
                </span>
                <span className="flex flex-col p-5 sm:p-7">
                  <span className="font-heading text-[2rem] font-black uppercase leading-none tracking-[-0.02em] text-ink sm:text-[2.6rem]">{name}</span>
                  <span className="mt-2.5 text-[15px] leading-relaxed text-ink/70">{line}</span>
                  <span className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <span className="rounded-md border-2 border-ink bg-white px-2.5 py-1 font-heading text-xs font-extrabold uppercase tracking-[0.06em] text-ink tabular-nums">
                      {price}
                    </span>
                    <span className="comic-btn comic-btn-sm">{action}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href={kits.href}
          className="comic-lift mt-6 flex flex-col gap-3 rounded-2xl comic-border comic-shadow-sm bg-peach px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 md:mt-7"
        >
          <span className="flex items-center gap-4">
            <kits.Icon className="h-8 w-8 shrink-0 text-ink" strokeWidth={1.75} />
            <span>
              <span className="block font-heading text-xl font-black uppercase leading-none tracking-[-0.01em] text-ink">{kits.name}</span>
              <span className="mt-1 block text-sm text-ink/75">{kits.line}</span>
            </span>
          </span>
          <span className="comic-btn comic-btn-sm comic-btn-light self-start sm:self-auto">{kits.action}</span>
        </Link>

        <TrustPills cardsRestored={cardsRestored} align="start" className="mt-10" />

        <div className="mt-10 rounded-2xl border-[2.5px] border-ink bg-bone px-5 py-7 sm:px-8">
          <ol className="relative grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-4">
            <span aria-hidden className="absolute top-4 right-[12.5%] left-[12.5%] hidden h-[3px] bg-ink md:block" />
            {STEPS.map((title, i) => (
              <li key={title} className="relative flex flex-col items-center text-center">
                <span className={`grid h-9 w-9 place-items-center rounded-full border-[2.5px] border-ink font-heading text-sm font-black ${i === 0 ? "bg-rx text-white" : "bg-white text-ink"}`}>
                  {i + 1}
                </span>
                <span className="mt-3 max-w-[16ch] font-heading text-[13px] font-extrabold uppercase leading-tight tracking-[0.02em] text-ink">{title}</span>
              </li>
            ))}
          </ol>
          <div className="mt-7 flex justify-center">
            <Link href="/how-it-works" className="comic-btn comic-btn-sm comic-btn-light">How It Works</Link>
          </div>
        </div>

        <div className="relative mt-10 overflow-hidden rounded-2xl comic-border bg-ink px-6 py-7 text-white sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-8">
          <span aria-hidden className="halftone-light absolute inset-0" />
          <div className="relative">
            <p className="font-heading text-2xl font-black uppercase leading-none tracking-[-0.01em]">Free Photo Review</p>
            <p className="mt-2 text-sm text-white/70">We reply within 1 business day.</p>
          </div>
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="comic-btn comic-btn-sm comic-btn-light relative mt-5 sm:mt-0">
            DM us on @the_card_doc
            <span className="sr-only">on Instagram (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </div>
  );
}
