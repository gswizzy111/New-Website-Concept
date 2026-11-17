import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Camera } from "lucide-react";
import { TrustPills } from "@/components/marketing/trust-pills";
import { JsonLd } from "@/components/seo/json-ld";
import { INSTAGRAM_URL, breadcrumbs, canonical } from "@/lib/seo";
import { SERVICE_CARDS } from "@/lib/service-cards";
import { Print, cta } from "@/components/brand";
import { cn } from "@/lib/utils";
import mantleInHand from "@/public/about/mantle-in-hand.jpg";
import charmanderPair from "@/public/home/charmander-pair.jpg";
import garchomp from "@/public/home/garchomp.jpg";

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

export default function StartPage() {
  const [restoration, prep, kits] = SERVICE_CARDS;

  return (
    <div className="min-h-screen overflow-x-clip">
      <JsonLd data={breadcrumbs([{ name: "What Are You Sending?", path: "/start" }])} />

      <section aria-labelledby="start-heading" className="surface-chalk">
        <div className="wrap pt-12 pb-16 md:pt-20 md:pb-24">
          <h1 id="start-heading" className="hero-in font-display text-[clamp(3.25rem,13vw,7rem)] font-black leading-[0.86] tracking-[-0.012em] text-ink">
            What are you <span className="text-cobalt">sending?</span>
          </h1>
          <p className="hero-in lead mt-6 text-ink-soft md:mt-8 md:text-[21px]" style={{ ["--d" as string]: 120 }}>
            Pick Restoration or Prep based on your card&apos;s current declared value (what it&apos;s worth right now, not its projected graded value).
          </p>

          {/* The two services, each with a real card as a print */}
          <ul className="mt-12 grid gap-6 md:mt-16 md:grid-cols-2 md:gap-7">
            <li className="hero-in" style={{ ["--d" as string]: 200 }}>
              <Link
                href={restoration.href}
                className="surface-cobalt group relative isolate flex h-full flex-col overflow-hidden rounded-2xl p-7 md:p-9"
              >
                <span aria-hidden className="halftone-dots -right-[10%] -bottom-[25%] h-[90%] w-[70%]" />
                <span className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-4 sm:gap-5 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                  <span>
                    <span className="caps block font-display text-[36px] font-black leading-[0.88] sm:text-[48px] md:text-[60px]">{restoration.name}</span>
                    <span className="mt-4 block text-[16px] leading-relaxed text-[#e6ebff] md:text-[17px]">{restoration.line}</span>
                  </span>
                  <Print
                    src={mantleInHand}
                    alt="The restored Mickey Mantle card held in a blue glove"
                    aspect="3/4"
                    position="60% 30%"
                    surface="dark"
                    border="sm"
                    tilt={5}
                    sizes="160px"
                    className="w-full self-start transition-transform duration-500 ease-[var(--ease-out)] group-hover:rotate-[1deg] motion-reduce:transition-none"
                  />
                </span>
                <span className="mt-auto flex flex-wrap items-end justify-between gap-5 pt-9">
                  <span className="font-display text-[36px] font-black leading-none text-sun md:text-[44px]">{restoration.price}</span>
                  <span className={cta({ size: "md" })}>
                    {restoration.action}
                    <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                  </span>
                </span>
              </Link>
            </li>
            <li className="hero-in" style={{ ["--d" as string]: 280 }}>
              <Link
                href={prep.href}
                className="group relative flex h-full flex-col rounded-2xl bg-white p-7 text-ink shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] md:p-9"
              >
                <span className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-4 sm:gap-5 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                  <span>
                    <span className="caps block font-display text-[36px] font-black leading-[0.88] sm:text-[48px] md:text-[60px]">{prep.name}</span>
                    <span className="mt-4 block text-[16px] leading-relaxed text-ink-soft md:text-[17px]">{prep.line}</span>
                  </span>
                  <Print
                    src={charmanderPair}
                    alt="A Charmander card before and after restoration"
                    aspect="3/4"
                    position="100% 50%"
                    border="sm"
                    tilt={-4}
                    sizes="160px"
                    className="w-full self-start transition-transform duration-500 ease-[var(--ease-out)] group-hover:rotate-[-1deg] motion-reduce:transition-none"
                  />
                </span>
                <span className="mt-auto flex flex-wrap items-end justify-between gap-5 pt-9">
                  <span className="font-display text-[36px] font-black leading-none text-cobalt md:text-[44px]">{prep.price}</span>
                  <span className={cta({ tone: "ink", size: "md" })}>
                    {prep.action}
                    <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                  </span>
                </span>
              </Link>
            </li>
          </ul>

          {/* DIY Kits: a slim sun row */}
          <Link
            href={kits.href}
            className="surface-sun group mt-6 grid items-center gap-5 rounded-2xl p-6 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] md:mt-7 md:px-8"
          >
            <Print
              src={garchomp}
              alt=""
              aspect="1"
              position="80% 30%"
              border="sm"
              tilt={-5}
              sizes="72px"
              className="hidden w-[4.5rem] sm:block"
            />
            <span>
              <span className="caps block font-display text-[32px] font-black leading-none">{kits.name}</span>
              <span className="mt-1.5 block text-[15px] font-medium text-ink">{kits.line}</span>
            </span>
            <span className={cta({ tone: "ink", size: "md", className: "justify-self-start sm:justify-self-auto" })}>
              {kits.action}
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </span>
          </Link>

          <TrustPills align="start" className="mt-12" />
        </div>
      </section>

      {/* The four stops */}
      <section aria-labelledby="stops-heading" className="surface-ink">
        <div className="wrap py-16 md:py-24">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
            <h2 id="stops-heading" className="sr-only">How It Works</h2>
            <ol data-reveal="stagger" className="grid w-full gap-px overflow-hidden rounded-2xl bg-line-dark sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((title, i) => (
                <li key={title} className="flex flex-col gap-5 bg-ink-2 p-6 md:p-8">
                  <span aria-hidden className="font-display text-[72px] font-black leading-[0.8] tracking-[-0.02em] text-sun md:text-[96px]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-[24px] font-extrabold leading-[1.02] text-white md:text-[28px]">
                    <span className="sr-only">Step {i + 1}: </span>
                    {title}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            <Link href="/how-it-works" className={cta({ tone: "outline-light", size: "lg" })}>
              How It Works
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      {/* Free Photo Review */}
      <section className="surface-white">
        <div className="wrap py-14 md:py-20">
          <div className={cn("flex flex-col gap-6 rounded-2xl bg-chalk p-7 sm:flex-row sm:items-center sm:justify-between md:p-10")}>
            <div className="flex items-center gap-5">
              <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-cobalt text-white">
                <Camera className="size-6" strokeWidth={1.75} />
              </span>
              <div>
                <p className="caps font-display text-[34px] font-black leading-none text-ink md:text-[44px]">Free Photo Review</p>
                <p className="mt-2 text-[15px] font-medium text-ink-soft">We reply within 1 business day.</p>
              </div>
            </div>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className={cta({ size: "lg", className: "self-start whitespace-normal sm:self-auto" })}>
              DM us on @the_card_doc
              <span className="sr-only">on Instagram (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
