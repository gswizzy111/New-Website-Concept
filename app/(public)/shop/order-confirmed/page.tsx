import Link from "next/link";
import { ArrowRight, PackageCheck } from "lucide-react";
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

  return (
    <section className="surface-chalk flex min-h-[72vh] flex-1 items-center py-16 md:py-24">
      <PurchasePixel sessionId={sessionId} amountCents={amountCents} currency={currency} />
      <ClearCartAfterPayment paid={!!sessionId && complete !== false} />
      <div className="wrap">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-8 rounded-[22px] bg-white px-6 py-10 text-center shadow-[0_0_0_1px_var(--line),var(--panel-shadow)] sm:px-10 sm:py-14">
          <span aria-hidden className="hero-in grid size-20 place-items-center rounded-[22px] bg-sun text-ink shadow-[var(--cut-edge),0_10px_20px_-10px_rgba(8,12,40,0.5)]">
            <PackageCheck className="size-10" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="hero-in font-heading text-[3rem] leading-[0.9] font-black text-ink md:text-[4rem]" style={{ ["--d" as string]: 80 }}>
              Order Confirmed!
            </h1>
            <p className="hero-in lead mx-auto mt-5 text-ink-soft" style={{ ["--d" as string]: 160 }}>
              Thanks for your order. We&apos;ll ship it out shortly and send you a tracking number.
            </p>
          </div>
          <div className="hero-in flex w-full flex-col gap-3 sm:flex-row sm:justify-center" style={{ ["--d" as string]: 240 }}>
            <Link href="/shop" className={cta({ tone: "sun", size: "lg", className: "w-full sm:w-auto" })}>
              Continue Shopping
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
            <Link href="/" className={cta({ tone: "outline", size: "lg", className: "w-full sm:w-auto" })}>Back to Home</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
