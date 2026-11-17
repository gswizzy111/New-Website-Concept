import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Print, cta } from "@/components/brand";
import charmanderAfter from "@/public/home/charmander-after.jpg";

export default function CheckoutCancelPage() {
  return (
    <section className="surface-chalk flex flex-1 items-center overflow-x-clip">
      <div className="wrap grid items-center gap-x-16 gap-y-12 py-16 md:py-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="min-w-0">
          <h1 className="hero-in display-lg text-ink">Checkout cancelled.</h1>
          <p className="hero-in lead mt-6 text-ink-soft" style={{ ["--d" as string]: 120 }}>
            Your order wasn&apos;t placed and you weren&apos;t charged. Your
            selections are still saved if you&apos;d like to return.
          </p>
          <div className="hero-in mt-10" style={{ ["--d" as string]: 200 }}>
            <Link href="/order" className={cta({ tone: "ink", size: "lg" })}>
              <ArrowLeft aria-hidden className="size-5" strokeWidth={2} />
              Return to Order Builder
            </Link>
          </div>
        </div>
        {/* The card still waiting for its turn (decorative) */}
        <Print
          src={charmanderAfter}
          alt=""
          aspect="364/503"
          tilt={-4}
          border="lg"
          enterDelay={240}
          sizes="(min-width: 1024px) 340px, 56vw"
          className="mx-auto w-[56%] max-w-[20rem] lg:w-full"
        />
      </div>
    </section>
  );
}
