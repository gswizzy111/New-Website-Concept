import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { withOg } from "@/lib/seo";
import { ArrowLeft } from "lucide-react";
import { PREVIEW_MESSAGE, PREVIEW_MODE } from "@/lib/preview";
import { Print, cta } from "@/components/brand";
import mantleBeforeHeld from "@/public/home/mantle-before-held.jpg";

export const metadata: Metadata = withOg("/not-available", {
  title: "Not available yet | The Card Doc",
  description: "This part of The Card Doc's preview site is not functional yet.",
  robots: { index: false },
});

export default function NotAvailablePage() {
  // Only preview mode sends people here (middleware.ts); on the live site the
  // preview message would be false, so the page does not exist there.
  if (!PREVIEW_MODE) notFound();

  return (
    <section className="surface-chalk overflow-x-clip">
      <div className="wrap grid items-center gap-x-16 gap-y-12 py-20 md:py-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="min-w-0">
          <h1 className="hero-in display-lg text-ink">Not functional yet</h1>
          <p className="hero-in lead mt-6 text-ink-soft" style={{ ["--d" as string]: 120 }}>
            {PREVIEW_MESSAGE}
          </p>
          <div className="hero-in mt-10" style={{ ["--d" as string]: 200 }}>
            <Link href="/" className={cta({ tone: "ink", size: "lg" })}>
              <ArrowLeft aria-hidden className="size-5" strokeWidth={2} />
              Back to home
            </Link>
          </div>
        </div>
        <Print
          src={mantleBeforeHeld}
          alt=""
          aspect="4/5"
          position="50% 24%"
          tilt={4}
          border="lg"
          enterDelay={240}
          sizes="(min-width: 1024px) 340px, 60vw"
          className="mx-auto w-[64%] max-w-[20rem] lg:w-full"
        />
      </div>
    </section>
  );
}
