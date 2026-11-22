import type { Metadata } from "next";
import { getDropoffServices } from "@/lib/show-dropoff-services";
import { canonical, withOg } from "@/lib/seo";
import { ShowDropoffForm } from "./show-dropoff-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = withOg("/show-dropoffs", {
  title: "Show Dropoffs | The Card Doc",
  description: "Dropping off cards with The Card Doc at a card show? Fill in your details here. No online payment.",
  alternates: canonical("/show-dropoffs"),
});

/**
 * In-person intake at card shows: the customer fills this in at the table
 * (or on our tablet). A link like /show-dropoffs?show=Philly%20Card%20Show
 * records which show each drop-off came from.
 */
export default async function ShowDropoffsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [services, sp] = await Promise.all([getDropoffServices(), searchParams]);
  const show = (sp.show ?? "").trim().slice(0, 120);

  return (
    <div className="min-h-screen bg-chalk">
      <div className="mx-auto max-w-2xl px-5 pt-10 pb-16 md:pt-16 md:pb-24">
        <header className="mb-10">
          <p className="eyebrow inline-flex items-center gap-2.5 text-cobalt">
            <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
            In person at card shows
          </p>
          <h1 className="mt-4 font-display text-[56px] font-black leading-[0.88] tracking-[-0.01em] text-ink md:text-[80px]">
            Show Dropoffs
          </h1>
          <p className="lead mt-5 text-ink-soft">
            Handing us your cards at the table? Fill this in and we&apos;ll take it from there. It takes about two minutes, and nothing is paid online.
          </p>
          {show && (
            <p className="mt-5 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-[0_0_0_1px_var(--line)]">
              Card show: {show}
            </p>
          )}
        </header>
        <ShowDropoffForm services={services} show={show} />
      </div>
    </div>
  );
}
