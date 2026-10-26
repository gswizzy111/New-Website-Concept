import { PartyPopper } from "lucide-react";
import Link from "next/link";
import { PurchasePixel } from "@/components/purchase-pixel";
import { readCheckoutReturn } from "@/lib/checkout-return";
import { getSubscriptionPriceCents } from "@/lib/store-config";
import { formatCurrency } from "@/lib/utils";

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
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center px-4">
      <PurchasePixel sessionId={purchase.sessionId} amountCents={purchase.amountCents} currency={purchase.currency} />
      <div className="bg-white rounded-lg border border-border p-10 max-w-md w-full text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-rx-soft text-rx"><PartyPopper className="h-7 w-7" strokeWidth={1.75} /></div>
        <h1 className="font-heading font-extrabold text-3xl text-foreground mb-3">
          You&rsquo;re subscribed!
        </h1>
        <p className="text-muted-foreground text-base mb-8">
          Your first kit will ship within 1-2 business days. You&rsquo;ll be billed {formatCurrency(priceCents)} on the
          same day each month.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Back to home
        </Link>
        <p className="text-xs text-muted-foreground mt-6">
          Need to cancel?{" "}
          <Link href="/subscribe/manage" className="underline hover:text-foreground">
            Manage your subscription
          </Link>
        </p>
      </div>
    </div>
  );
}
