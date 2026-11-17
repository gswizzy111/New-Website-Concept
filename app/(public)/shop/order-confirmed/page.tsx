import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { cta } from "@/components/brand";
import { ClearCartAfterPayment } from "@/components/clear-cart-after-payment";
import { PurchasePixel } from "@/components/purchase-pixel";
import { readCheckoutReturn } from "@/lib/checkout-return";

export default async function ShopOrderConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe adds ?session_id=; the first script on the page takes it out of
  // the address before analytics run (lib/tracking-guard.ts). It is read here
  // for the purchase amount and to empty the cart; a reload has none, so
  // neither happens twice.
  // Stripe only returns here after a payment; `complete` is null when the lookup failed
  const { sessionId, amountCents, currency, complete } = await readCheckoutReturn(
    (await searchParams).session_id,
    "Kit order page",
  );

  // The same cobalt success band as /checkout/success, /gift-cards/success
  // and /subscribe/success, so every paid order lands on one design.
  return (
    <section className="surface-cobalt relative isolate flex min-h-[70vh] flex-1 items-center overflow-hidden">
      <PurchasePixel sessionId={sessionId} amountCents={amountCents} currency={currency} />
      <ClearCartAfterPayment paid={!!sessionId && complete !== false} />
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
          Order Confirmed!
        </h1>
        <p className="hero-in lead mx-auto mt-6 text-[#e6ebff]" style={{ ["--d" as string]: 300 }}>
          Thanks for your order. We&apos;ll ship it out shortly and send you a tracking number.
        </p>
        <div className="hero-in mt-10 flex flex-col justify-center gap-4 sm:flex-row" style={{ ["--d" as string]: 380 }}>
          <Link href="/shop" className={cta({ size: "lg" })}>
            Continue Shopping
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
