import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PurchasePixel } from "@/components/purchase-pixel";
import { readCheckoutReturn } from "@/lib/checkout-return";
import { cta } from "@/components/brand";

export default async function GiftCardSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe's ?session_id=, for the Meta Purchase event (lib/checkout-return.ts)
  const { sessionId, amountCents, currency } = await readCheckoutReturn(
    (await searchParams).session_id,
    "Gift card success page",
  );
  return (
    <section className="surface-cobalt relative isolate flex min-h-[70vh] flex-1 items-center overflow-hidden">
      <PurchasePixel sessionId={sessionId} amountCents={amountCents} currency={currency} />
      <span aria-hidden className="halftone-dots -right-[10%] -top-[20%] h-[130%] w-[64%]" />
      <span aria-hidden className="halftone-dots -bottom-[30%] -left-[16%] h-[80%] w-[50%] opacity-70" />
      <div className="wrap py-20 text-center md:py-28">
        <span
          aria-hidden
          className="sticker-pop mx-auto grid size-20 place-items-center rounded-full bg-sun text-ink shadow-[0_0_0_4px_var(--white),var(--pop-shadow)] md:size-24"
          style={{ ["--d" as string]: 120 }}
        >
          <Check className="size-10 md:size-12" strokeWidth={3} />
        </span>
        <h1 className="hero-in display-lg mx-auto mt-9 max-w-4xl text-white" style={{ ["--d" as string]: 200 }}>
          Gift Card Purchased!
        </h1>
        <p className="hero-in lead mx-auto mt-6 text-[#e6ebff]" style={{ ["--d" as string]: 300 }}>
          The gift card code has been emailed. It can be applied at checkout on any restoration order.
        </p>
        <div className="hero-in mt-10 flex flex-col justify-center gap-4 sm:flex-row" style={{ ["--d" as string]: 380 }}>
          <Link href="/gift-cards" className={cta({ size: "lg" })}>
            Buy Another
            <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
          </Link>
          <Link href="/" className={cta({ tone: "outline-light", size: "lg" })}>
            Back to Home
          </Link>
        </div>
      </div>
    </section>
  );
}
