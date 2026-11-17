import Link from "next/link";
import { Check } from "lucide-react";
import { PurchasePixel } from "@/components/purchase-pixel";
import { readCheckoutReturn } from "@/lib/checkout-return";
import { getSubscriptionPriceCents } from "@/lib/store-config";
import { formatCurrency } from "@/lib/utils";
import { cta } from "@/components/brand";

export const dynamic = "force-dynamic";

export default async function SubscribeSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe's ?session_id=, for the Meta Purchase event (lib/checkout-return.ts)
  const [priceCents, purchase] = await Promise.all([
    getSubscriptionPriceCents(),
    searchParams.then((p) => readCheckoutReturn(p.session_id, "Kit Club success page")),
  ]);
  return (
    <section className="surface-cobalt relative isolate flex min-h-[70vh] flex-1 items-center overflow-hidden">
      <PurchasePixel sessionId={purchase.sessionId} amountCents={purchase.amountCents} currency={purchase.currency} />
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
          You&rsquo;re subscribed!
        </h1>
        <p className="hero-in lead mx-auto mt-6 text-[#e6ebff]" style={{ ["--d" as string]: 300 }}>
          Your first kit will ship within 1-2 business days. You&rsquo;ll be billed {formatCurrency(priceCents)} on the
          same day each month.
        </p>
        <div className="hero-in mt-10 flex justify-center" style={{ ["--d" as string]: 380 }}>
          <Link href="/" className={cta({ size: "lg", className: "w-full sm:w-auto" })}>
            Back to home
          </Link>
        </div>
        <p className="hero-in mt-10 border-t border-white/20 pt-7 text-[15px] text-[#e6ebff] sm:mx-auto sm:max-w-md" style={{ ["--d" as string]: 440 }}>
          Need to cancel?{" "}
          <Link href="/subscribe/manage" className="font-bold text-white underline decoration-sun decoration-2 underline-offset-4 hover:text-sun">
            Manage your subscription
          </Link>
        </p>
      </div>
    </section>
  );
}
