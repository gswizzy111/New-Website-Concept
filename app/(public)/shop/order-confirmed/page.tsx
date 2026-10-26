import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PurchasePixel } from "@/components/purchase-pixel";
import { stripe } from "@/lib/stripe";
import { CHECKOUT_SESSION_ID } from "@/lib/tracking-guard";

export default async function ShopOrderConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe adds ?session_id=; the first script on the page takes it out of
  // the address before analytics run (lib/tracking-guard.ts). It is read here
  // only for the purchase amount.
  const raw = (await searchParams).session_id;
  const sessionId = raw && CHECKOUT_SESSION_ID.test(raw) ? raw : undefined;
  let amountCents: number | null = null;
  let currency = "usd";
  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // Only a completed checkout is a purchase
      if (session.status === "complete" && session.amount_total != null) {
        amountCents = session.amount_total;
        currency = session.currency ?? "usd";
      }
    } catch (err) {
      console.error("Kit order page: Stripe session lookup failed:", err instanceof Error ? err.message : err);
    }
  }

  return (
    <section className="flex-1 flex items-center justify-center min-h-[70vh] px-6">
      <PurchasePixel sessionId={sessionId} amountCents={amountCents} currency={currency} />
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
