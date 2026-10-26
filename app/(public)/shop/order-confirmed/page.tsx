import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
    <section className="flex-1 flex items-center justify-center min-h-[70vh] px-6">
      <PurchasePixel sessionId={sessionId} amountCents={amountCents} currency={currency} />
      <ClearCartAfterPayment paid={!!sessionId && complete !== false} />
      <div className="max-w-sm w-full text-center flex flex-col items-center gap-6">
        <CheckCircle className="h-16 w-16 text-primary" />
        <div>
          <h1 className="font-heading font-extrabold text-4xl text-foreground mb-2">Order Confirmed!</h1>
          <p className="text-muted-foreground text-sm">Thanks for your order. We&apos;ll ship it out shortly and send you a tracking number.</p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          <Button render={<Link href="/shop" />} className="font-bold w-full">Continue Shopping</Button>
          <Button variant="outline" render={<Link href="/" />} className="font-bold w-full border">Back to Home</Button>
        </div>
      </div>
    </section>
  );
}
