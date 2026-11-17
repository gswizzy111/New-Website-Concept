import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cta } from "@/components/brand/button-class";
import { Print } from "@/components/brand/print";
import garchomp from "@/public/home/garchomp.jpg";

/**
 * The 404 message: Next's default words under an oversized 404, then the
 * way home and the way to the prices, beside one real print (the Garchomp
 * corner). Stacked on phones, the print first. `sprite` is accepted for older
 * callers and no longer drawn.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function NotFoundPanel(_props: { sprite?: React.ReactNode } = {}) {
  return (
    <div className="wrap grid w-full items-center gap-x-16 gap-y-10 py-16 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:py-28 lg:max-w-6xl lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <Print
        src={garchomp}
        alt="The corner of a Garchomp holo card"
        aspect="1"
        position="30% 70%"
        tilt={-5}
        sizes="(min-width: 768px) 272px, 200px"
        className="w-[11rem] sm:w-[13rem] md:w-full"
      />
      <div>
      <p className="font-display text-[clamp(8rem,34vw,15rem)] leading-[0.78] font-black tracking-[-0.02em] text-ink">404</p>
      <h1 className="mt-8 font-heading text-[2rem] leading-none font-extrabold text-ink md:text-[2.75rem]">
        This page could not be found.
      </h1>
      <div className="mt-10 flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:gap-4">
        <Link href="/" className={cta({ tone: "ink", size: "lg" })}>
          Back to home
          <ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden />
        </Link>
        <Link href="/tier-selection" className={cta({ tone: "outline", size: "lg" })}>
          Restoration Pricing
        </Link>
      </div>
      </div>
    </div>
  );
}
