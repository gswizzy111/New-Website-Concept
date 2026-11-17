import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Print, cta } from "@/components/brand";
import mantleDetail from "@/public/about/mantle-detail-before.jpg";

/**
 * The at-capacity notice /restoration and /order show while isSoldOut() is on:
 * the owner's words beside a real card, with the way back to the prices.
 */
export function RestorationSoldOut() {
  return (
    <section className="surface-chalk overflow-x-clip">
      <div className="wrap grid items-center gap-x-16 gap-y-12 py-16 md:py-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <p className="hero-in eyebrow mb-5 inline-flex items-center gap-2.5 text-cobalt">
            <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
            Restoration Services
          </p>
          <h1 className="hero-in font-display text-[clamp(3rem,12vw,6rem)] font-black leading-[0.88] tracking-[-0.01em] text-ink" style={{ ["--d" as string]: 80 }}>
            Currently Unavailable
          </h1>
          <p className="hero-in lead mt-6 text-ink-soft md:mt-8" style={{ ["--d" as string]: 160 }}>
            We&apos;re at capacity right now. Check back soon — we&apos;ll be accepting new restoration orders again shortly.
          </p>
          <div className="hero-in mt-9" style={{ ["--d" as string]: 240 }}>
            <Link href="/tier-selection" className={cta({ tone: "ink", size: "lg" })}>
              Restoration Pricing
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
          </div>
        </div>
        <Print
          src={mantleDetail}
          alt="A close-up of a cracked Mickey Mantle card"
          aspect="880/760"
          tilt={3}
          border="lg"
          enterDelay={120}
          sizes="(min-width: 1024px) 460px, 86vw"
          className="mx-auto w-full max-w-[28rem]"
        />
      </div>
    </section>
  );
}
